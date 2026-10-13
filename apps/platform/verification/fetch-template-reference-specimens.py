"""Download pinned public upstream examples for source comparison, never user data."""
import concurrent.futures,hashlib,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/evidence/resume-studio-quality-2026-09-10/upstream/specimens';OUT.mkdir(parents=True,exist_ok=True)
tasks=[]
old='6416da28a4db7833a80b5d19b30c9b28d7df1807';new='730f795073126e850cab348038f9557da6f810fd'
for name in ['azurill','bronzor','chikorita','ditto','gengar','glalie','kakuna','lapras','meowth','onyx','rhyhorn','scizor','ditgar','leafish','pikachu']:
    tasks.append(('rx_'+name,'amruthpillai/reactive-resume',new if name in ['ditgar','leafish','pikachu'] else old,'apps/web/public/templates/jpg/'+name+'.jpg'))
for name in ['cool','creative','oblique']:
    tasks.append(('bre_'+name,'salomonelli/best-resume-ever','29e753cd842585b4a2e9dbbb5e1ef3a0f5e66767','src/assets/preview/resume-'+name+'.png'))
def fetch(task):
    id,repo,commit,path=task;url=f'https://raw.githubusercontent.com/{repo}/{commit}/{path}';target=OUT/(id+pathlib.Path(path).suffix)
    try:
        if not target.exists():
            request=urllib.request.Request(url,headers={'User-Agent':'Aijob-template-source-audit'})
            with urllib.request.urlopen(request,timeout=35) as response:target.write_bytes(response.read())
        return {'id':id,'commit':commit,'source':f'https://github.com/{repo}/blob/{commit}/{path}','file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'fetched':True}
    except Exception as error:return {'id':id,'source':url,'fetched':False,'error':str(error)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,tasks))
(OUT/'manifest.json').write_text(json.dumps(results,indent=2),encoding='utf8')
print(json.dumps({'total':len(results),'fetched':sum(r['fetched'] for r in results),'failed':[r for r in results if not r['fetched']]}))
