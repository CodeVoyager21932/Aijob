"""Render every synthetic output page for human visual review (not an automatic visual pass)."""
from pathlib import Path
from PIL import Image, ImageDraw
import argparse, subprocess, json

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--gallery', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source, target = root / args.input, root / args.output
target.mkdir(parents=True, exist_ok=True)
manifest = []
for pdf in sorted(source.glob('*.pdf')):
    subprocess.run(['pdftoppm', '-scale-to', '1100', '-png', str(pdf), str(target/pdf.stem)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    pages = sorted(target.glob(pdf.stem+'-*.png'))
    manifest.append({'file':pdf.name,'pages':[p.name for p in pages],'visualReview':'pending'})
    if args.gallery:
        if len(pages) != 1: raise ValueError(f'Gallery must be one page: {pdf.name}')
        destination=root/'apps/web/public/native-templates'/f'{pdf.stem}.png'
        with Image.open(pages[0]) as im:
            im.thumbnail((440,622)); im.save(destination)
for template in sorted({pdf.stem.rsplit('-',1)[0] for pdf in source.glob('*.pdf')}):
    pages = [target/name for row in manifest if row['file'].startswith(template+'-') for name in row['pages']]
    if not pages: continue
    columns=3
    sheet=Image.new('RGB',(columns*370,((len(pages)+columns-1)//columns)*540),'#e8ece8')
    draw=ImageDraw.Draw(sheet)
    for index,page in enumerate(pages):
        x,y=(index%columns)*370,(index//columns)*540
        with Image.open(page) as im:
            im.thumbnail((350,500)); sheet.paste(im,(x+10,y+28))
        draw.text((x+10,y+5),page.stem,fill='black')
    sheet.save(target/f'{template}-contact.jpg')
(target/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'documents':len(manifest),'pages':sum(len(row['pages']) for row in manifest),'review':'pending'}))
