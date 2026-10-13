"""Create a small first-load web face; the complete same-source face remains the fallback."""
import hashlib,json,pathlib
from fontTools.ttLib import TTFont
from fontTools import subset
ROOT=pathlib.Path(__file__).resolve().parents[3]
DIR=ROOT/'apps/web/public/fonts'
codepoints=set(range(0x20,0x250))|set(range(0x2000,0x2070))|set(range(0x3000,0x3040))|set(range(0xff00,0xfff0))
for first in range(0xa1,0xff):
    for second in range(0xa1,0xff):
        try:codepoints.update(map(ord,bytes([first,second]).decode('gb2312')))
        except UnicodeDecodeError:pass
report=[]
for name in ['AijobCJK','AijobSerifCJK']:
    font=TTFont(DIR/f'{name}.otf');cmap=font.getBestCmap();selected=codepoints&set(cmap)
    metrics={code:font['hmtx'].metrics[cmap[code]][0] for code in selected}
    options=subset.Options();options.flavor='woff2';options.layout_features=['*'];options.name_IDs=['*'];options.name_legacy=True
    sub=subset.Subsetter(options=options);sub.populate(unicodes=selected);sub.subset(font)
    for record in font['name'].names:
        if record.nameID in [1,2,3,4,6,16,17]:
            value='Regular' if record.nameID in [2,17] else name+'Common'
            record.string=value.encode(record.getEncoding())
    target=DIR/f'{name}Common.woff2';font.flavor='woff2';font.save(target)
    check=TTFont(target);newmap=check.getBestCmap()
    assert all(check['hmtx'].metrics[newmap[code]][0]==width for code,width in metrics.items())
    report.append({'file':target.name,'source':name+'.otf','codepoints':len(selected),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'advanceWidthsUnchanged':True,'fallback':name+'.woff2'})
(DIR/'common-font-provenance.json').write_text(json.dumps({'method':'GB2312 characters plus Latin, punctuation and fullwidth symbols, with unchanged advance widths. Rare characters fall back to the complete same-source CJK font.','fonts':report},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report))
