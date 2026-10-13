"""Reproducible local font preparation. Read Noto TTC sources; never change old regular faces."""
from pathlib import Path
from fontTools.ttLib import TTCollection, TTFont
from fontTools import subset
import hashlib, json, sys, importlib.util
module_spec = importlib.util.spec_from_file_location("unique_cmap", Path(__file__).with_name("unique-cmap.py"))
module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)

root = Path(__file__).resolve().parents[3]
source = Path(sys.argv[1])
dest = root / 'apps/web/public/fonts'
report = []
codepoints = set(range(0x20, 0x250)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xff00, 0xfff0))
for a in range(0xa1, 0xff):
    for b in range(0xa1, 0xff):
        try: codepoints.update(map(ord, bytes([a, b]).decode('gb2312')))
        except UnicodeDecodeError: pass
for family, weight in [('Sans','Regular'),('Sans','Bold'),('Serif','Regular'),('Serif','Bold')]:
    src = source / f'Noto{family}CJK-{weight}.ttc'
    collection = TTCollection(src)
    try:
        font = next(f for f in collection.fonts if any('cjksc' in n.toUnicode().lower() for n in f['name'].names if n.nameID == 6))
        unique = module.unique_cmap(font)
        name = f'AijobV3{family}{weight}'
        for record in font['name'].names:
            if record.nameID in [1,2,3,4,6,16,17]: record.string = (weight if record.nameID in [2,17] else name).encode(record.getEncoding())
        if 'CFF ' in font:
            cff = font['CFF '].cff; cff.fontNames = [name]; cff.topDictIndex[0].FamilyName = name; cff.topDictIndex[0].FullName = name
        full = dest / (name + '.otf'); font.save(full)
    finally: collection.close()
    print(json.dumps({'built':name,**unique}),flush=True)
    full_font = TTFont(full); full_font.flavor = 'woff2'; full_font.save(dest / (name + '.woff2'))
    sub_font = TTFont(full); selected = codepoints & set(sub_font.getBestCmap())
    original_metrics = {cp: sub_font['hmtx'].metrics[sub_font.getBestCmap()[cp]][0] for cp in selected}
    options = subset.Options(); options.flavor = 'woff2'; options.layout_features = ['*']; options.name_IDs = ['*']; options.name_legacy = True
    sub = subset.Subsetter(options=options); sub.populate(unicodes=selected); sub.subset(sub_font)
    sub_font.flavor = 'woff2'; common = dest / (name + 'Common.woff2'); sub_font.save(common)
    checked = TTFont(common); cm = checked.getBestCmap()
    assert all(checked['hmtx'].metrics[cm[cp]][0] == w for cp, w in original_metrics.items())
    report.append({'family': family, 'source': src.name, 'sourceSha256': hashlib.sha256(src.read_bytes()).hexdigest(), 'weight': weight, **unique, 'commonAdvanceWidthsUnchanged': True})
files = [f'AijobV3{family}{weight}{suffix}' for family in ['Sans','Serif'] for weight in ['Regular','Bold'] for suffix in ['.otf','.woff2','Common.woff2']]
(dest/'font-set-v3.json').write_text(json.dumps({'version':'cjk-2026-09-10.1','sourceImage':'aijob-platform:experience-20260908-fontfix','license':'LICENSE-Noto.txt','faces':report,'files':[{'file':f,'sha256':hashlib.sha256((dest/f).read_bytes()).hexdigest(),'bytes':(dest/f).stat().st_size} for f in files]},indent=2),encoding='utf-8')
print(json.dumps({'version':'cjk-2026-09-10.1','files':len(files),'verifiedAdvanceWidths':True}))
