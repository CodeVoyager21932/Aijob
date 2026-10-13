"""Make Unicode aliases distinct glyph IDs, without changing outlines or advance widths.
Chromium otherwise may copy e.g. 户 as ⼾. Removing only NFKC aliases is insufficient.
This is part of the versioned SC horizontal document font build, not runtime processing.
"""
from copy import copy
from fontTools import subset

def unique_cmap(font):
    initial = font.getBestCmap().copy()
    widths = {cp:font['hmtx'].metrics[g][0] for cp,g in initial.items()}
    options = subset.Options()
    options.layout_features = ['kern']  # SC face cmap is authoritative; no locale/ligature substitutions.
    options.name_IDs = ['*']; options.name_legacy = True
    sub = subset.Subsetter(options=options); sub.populate(unicodes=initial); sub.subset(font)
    top = font['CFF '].cff.topDictIndex[0]
    order = list(font.getGlyphOrder()); charstrings = top.CharStrings
    used_cids = {int(g[3:]) for g in order if g.startswith('cid')}
    next_cid = 1
    seen = {}; replacements = {}
    for cp, glyph in sorted(font.getBestCmap().items()):
        if glyph not in seen: seen[glyph] = cp; continue
        while next_cid in used_cids: next_cid += 1
        new = f'cid{next_cid:05d}' if hasattr(top,'ROS') else f'uni{cp:06X}'
        used_cids.add(next_cid)
        old_index = charstrings.charStrings[glyph]
        new_index = len(order)
        charstrings.charStringsIndex.append(copy(charstrings[glyph]))
        charstrings.charStrings[new] = new_index
        if hasattr(top, 'FDSelect'): top.FDSelect.gidArray.append(top.FDSelect[old_index])
        order.append(new)
        font['hmtx'].metrics[new] = font['hmtx'].metrics[glyph]
        if 'vmtx' in font: font['vmtx'].metrics[new] = font['vmtx'].metrics[glyph]
        replacements[cp] = new
    top.charset = order
    if hasattr(top,'ROS'): top.CIDCount = max(used_cids) + 1
    font.setGlyphOrder(order); font['maxp'].numGlyphs = len(order)
    for table in font['cmap'].tables:
        if table.isUnicode() and hasattr(table,'cmap'):
            for cp in set(table.cmap) & set(replacements): table.cmap[cp] = replacements[cp]
    result = font.getBestCmap()
    assert set(result) == set(initial)
    assert len(set(result.values())) == len(result)
    assert all(font['hmtx'].metrics[result[cp]][0] == width for cp,width in widths.items())
    return {'uniqueGlyphClones':len(replacements),'unicodeCoverageUnchanged':True,'advanceWidthsUnchanged':True,'glyphCount':len(order)}
