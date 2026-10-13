from fontTools.ttLib import TTCollection
from pathlib import Path
import hashlib
import json
import os
import unicodedata

output = Path(os.environ.get('AIJOB_FONT_OUTPUT', '/opt/fonts'))
output.mkdir(parents=True, exist_ok=True)
report = []
for family, destination in [('Sans', 'AijobCJK.otf'), ('Serif', 'AijobSerifCJK.otf')]:
    source = Path(f'/usr/share/fonts/opentype/noto/Noto{family}CJK-Regular.ttc')
    collection = TTCollection(source)
    try:
        for font in collection.fonts:
            names = [name.toUnicode().lower() for name in font['name'].names if name.nameID == 6]
            if any('cjksc' in name for name in names):
                # Chromium's CFF/Type3 PDF mapping can pick the first Unicode alias
                # of a glyph (e.g. a Kangxi radical instead of the ordinary Hanzi).
                # Drop only redundant compatibility aliases to the identical glyph;
                # keep all distinct outlines and canonical characters.
                removed = set()
                for table in font['cmap'].tables:
                    if not table.isUnicode() or not hasattr(table, 'cmap'):
                        continue
                    for codepoint, glyph in list(table.cmap.items()):
                        normalized = unicodedata.normalize('NFKC', chr(codepoint))
                        if len(normalized) == 1 and ord(normalized) != codepoint and table.cmap.get(ord(normalized)) == glyph:
                            del table.cmap[codepoint]
                            removed.add(codepoint)
                # Contact strings must copy as f+i, not the optional fi ligature.
                disabled = []
                if 'GSUB' in font and font['GSUB'].table.FeatureList:
                    for feature in font['GSUB'].table.FeatureList.FeatureRecord:
                        if feature.FeatureTag in ('liga', 'clig', 'dlig', 'hlig'):
                            feature.Feature.LookupListIndex = []
                            feature.Feature.LookupCount = 0
                            disabled.append(feature.FeatureTag)
                family_name = f'Aijob {family} CJK'
                postscript = f'Aijob{family}CJK-Regular'
                replacements = {1: family_name, 2: 'Regular', 3: postscript + '-1',
                    4: family_name + ' Regular', 6: postscript, 16: family_name, 17: 'Regular'}
                for name in font['name'].names:
                    if name.nameID in replacements:
                        name.string = replacements[name.nameID].encode(name.getEncoding())
                if 'CFF ' in font:
                    cff = font['CFF '].cff
                    cff.fontNames = [postscript]
                    cff.topDictIndex[0].FamilyName = family_name
                    cff.topDictIndex[0].FullName = family_name + ' Regular'
                target = output / destination
                font.save(target)
                report.append({'family': family, 'source': str(source),
                    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'output': destination, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                    'removedRedundantAliases': len(removed), 'disabledOptionalLigatures': sorted(set(disabled))})
                break
        else:
            raise RuntimeError(f'SIMPLIFIED_CHINESE_{family.upper()}_FONT_NOT_FOUND')
    finally:
        collection.close()
(output / 'LICENSE-Noto.txt').write_bytes(Path('/usr/share/doc/fonts-noto-cjk/copyright').read_bytes())
(output / 'font-provenance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
