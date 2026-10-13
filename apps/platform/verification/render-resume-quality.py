"""Rasterize actual synthetic PDFs for visual QA; never renders or copies private resumes."""
import argparse, concurrent.futures, hashlib, json, math, pathlib, subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT=pathlib.Path(__file__).resolve().parents[3]
MATRIX=ROOT/'docs/evidence/resume-studio-quality-2026-09-10/matrix'
OUT=MATRIX/'pdf-raster-v3'
POPPLER=pathlib.Path('C:/Users/72998/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
parser=argparse.ArgumentParser();parser.add_argument('--samples',default='short,medium,long');parser.add_argument('--office',action='store_true');args=parser.parse_args()
if args.office:MATRIX=MATRIX/'office-v3';OUT=MATRIX/'pdf-raster'
OUT.mkdir(parents=True,exist_ok=True)
pdfs=[p for p in MATRIX.glob('*.pdf') if p.stem.rsplit('-',1)[-1] in args.samples.split(',')]
def render(pdf):
    stem=pdf.stem; digest=hashlib.sha256(pdf.read_bytes()).hexdigest(); marker=OUT/(stem+'.sha256')
    if not marker.exists() or marker.read_text()!=digest:
        # Only remove prior renders of this exact synthetic matrix entry.
        for old in OUT.glob(stem+'-page-*.png'):old.unlink()
        subprocess.run([str(POPPLER),'-r','100','-png',str(pdf),str(OUT/(stem+'-page'))],check=True,capture_output=True,timeout=90)
        marker.write_text(digest)
    images=sorted(OUT.glob(stem+'-page-*.png'),key=lambda p:int(p.stem.rsplit('-',1)[-1]))
    return {'id':stem,'pdfSha256':digest,'pageCount':len(images),'pages':[p.name for p in images]}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(render,sorted(pdfs)))
(OUT/('render-report-'+args.samples.replace(',','-')+'.json')).write_text(json.dumps(rows,indent=2),encoding='utf8')
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
def sheet(items,path,columns=5,width=340):
    height=round(width*297/210)+28; image=Image.new('RGB',(columns*width,math.ceil(len(items)/columns)*height),'#e6e8e9');draw=ImageDraw.Draw(image)
    for i,(label,file) in enumerate(items):
        x=(i%columns)*width;y=(i//columns)*height;page=Image.open(file).convert('RGB');page.thumbnail((width-12,height-34))
        image.paste(page,(x+(width-page.width)//2,y+27));draw.text((x+7,y+5),label,font=font,fill='#17222d')
    image.save(path)
short=[(r['id'],OUT/r['pages'][0]) for r in rows if r['id'].endswith('-short') and r['pages']]
for i in range(0,len(short),10):sheet(short[i:i+10],OUT/f'short-overview-{i//10+1}.png')
templates=sorted({r['id'].rsplit('-',1)[0] for r in rows})
for template in templates:
    pages=[(r['id'].rsplit('-',1)[-1]+' / '+str(i+1),OUT/p) for r in rows if r['id'].rsplit('-',1)[0]==template for i,p in enumerate(r['pages'])]
    sheet(pages,OUT/(template+'-all-pages.png'),columns=4,width=340)
print(json.dumps({'pdfs':len(rows),'pages':sum(r['pageCount'] for r in rows),'output':str(OUT)}))
