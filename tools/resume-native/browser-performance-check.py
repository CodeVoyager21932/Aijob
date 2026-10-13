"""Real native editor/input/save measurements while two real PDF exports run."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import argparse, json, math, time, uuid, copy, platform

parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://127.0.0.1:5194')
parser.add_argument('--mode',default='development')
parser.add_argument('--output',default='.data/resume-native-k5-20260913/performance-dev')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
out=root/args.output
out.mkdir(parents=True,exist_ok=True)
fixture=json.loads((root/'.data/resume-native-k4-20260913/current22-v9/gengar-cn-long.json').read_text(encoding='utf-8'))
def summary(values):
    ordered=sorted(values)
    return {'count':len(values),'p95Ms':ordered[max(0,math.ceil(len(ordered)*.95)-1)] if values else None,'maxMs':max(values) if values else None}

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page()
    errors=[]; headers={}; saves=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def capture(request):
        if request.method in ('POST','PUT') and '/v2/resume-documents' in request.url:
            headers.update({key:value for key,value in request.headers.items() if key in ('x-csrf-token','x-aijob-owner-context','origin','content-type')})
    page.on('request',capture)
    page.goto(args.base+'/resumes/native')
    page.get_by_role('button',name='新建原生简历',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=30000)
    document_id=page.url.rsplit('/',1)[1]
    def request(method,path,body=None):
        response=context.request.fetch(args.base+path,method=method,data=body,headers={**headers,'Origin':args.base,'Idempotency-Key':str(uuid.uuid4())})
        assert response.ok,(response.status,response.text()[:300])
        return response.json()
    first=request('GET',f'/v2/resume-documents/{document_id}/native')
    first=request('PUT',f'/v2/resume-documents/{document_id}/native',{'expectedRevision':first['revision'],'title':'性能检查合成稿','document':fixture})
    second=request('POST','/v2/resume-documents/native',{'title':'后台并行合成稿'})
    other=copy.deepcopy(fixture);other['data']['basics']['name']='并行导出核验'
    second=request('PUT',f'/v2/resume-documents/{second["documentId"]}/native',{'expectedRevision':second['revision'],'title':second['title'],'document':other})
    pairs=[{'id':draft['documentId'],'pair':request('POST',f'/v2/resume-documents/{draft["documentId"]}/native/checkpoint',{'expectedRevision':draft['revision']})} for draft in (first,second)]
    cdp=context.new_cdp_session(page)
    cdp.send('Network.clearBrowserCache')
    started=time.perf_counter()
    page.goto(args.base+f'/resumes/native/{document_id}')
    expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏',timeout=30000)
    ready_ms=(time.perf_counter()-started)*1000
    expect(page.get_by_role('status').filter(has_text='纸张已更新')).to_be_visible(timeout=90000)
    pages=page.locator('.native-paper canvas').count()
    def finished(req):
        if req.method=='PUT' and req.url.endswith(f'/v2/resume-documents/{document_id}/native'):
            saves.append({'elapsedMs':req.timing['responseEnd'],'startedAt':req.timing['startTime'],'endedAt':req.timing['startTime']+req.timing['responseEnd'],'status':req.response().status})
    page.on('requestfinished',finished)
    page.evaluate("""() => {
        window.inputTimings=[];
        document.addEventListener('input',e=>{
            const start=e.timeStamp;
            requestAnimationFrame(()=>requestAnimationFrame(()=>window.inputTimings.push(performance.now()-start)));
        },true);
    }""")
    def type_round():
        field=page.get_by_label('姓名',exact=True)
        field.focus(); field.press('End')
        for index in range(24):
            before=page.evaluate('window.inputTimings.length')
            field.press('a' if index%2==0 else 'Backspace')
            page.wait_for_function('(count)=>window.inputTimings.length>count',arg=before)
        expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
        return page.evaluate('window.inputTimings.splice(0)')
    idle=type_round()
    def save_samples(phase,count):
        for index in range(count):
            with page.expect_response(lambda response: response.request.method=='PUT' and response.url.endswith(f'/v2/resume-documents/{document_id}/native')) as response:
                page.get_by_label('姓名',exact=True).fill(f'林知夏{phase}{index}')
            assert response.value.status==200
            expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
    save_samples('空闲',12)
    page.evaluate('window.inputTimings=[]')
    page.evaluate("""({pairs,headers})=>{
        window.exportTimings=[];
        window.parallelExports=Promise.all(pairs.map(async item=>{
            const start=performance.now();
            const response=await fetch(`/v2/resume-documents/${item.id}/native/exports`,{
                method:'POST',headers:{...headers,'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},
                body:JSON.stringify({...item.pair,format:'pdf'})});
            const artifact=await response.json();
            window.exportTimings.push({elapsedMs:performance.now()-start,startedAt:performance.timeOrigin+start,endedAt:performance.timeOrigin+performance.now(),status:response.status,state:artifact.state,code:artifact.code});
            if(!response.ok||artifact.state!=='ready') throw new Error(`EXPORT_FAILED:${response.status}:${artifact.code ?? artifact.state}`);
            return artifact.id;
        })).then(ids=>({ok:true,ids}),error=>({ok:false,message:error.message}));
    }""",{'pairs':pairs,'headers':headers})
    busy=type_round()
    save_samples('并行',5)
    artifacts=page.evaluate('window.parallelExports')
    if not artifacts['ok']:
        (out/'failed-exports.json').write_text(json.dumps({'result':artifacts,'exports':page.evaluate('window.exportTimings'),'saves':saves},indent=2),encoding='utf-8')
    assert artifacts['ok'],artifacts
    from pypdf import PdfReader
    import io
    for artifact_id in artifacts['ids']:
        response=context.request.get(args.base+f'/v2/resume-exports/{artifact_id}/file')
        assert response.ok
        pdf=PdfReader(io.BytesIO(response.body()))
        text=''.join(page.extract_text() or '' for page in pdf.pages)
        assert len(pdf.pages)==5 and '研究记录70号' in text.replace(' ',''), 'Incomplete parallel PDF'
        (out/f'{artifact_id}.pdf').write_bytes(response.body())
    export_times=page.evaluate('window.exportTimings')
    for saved in saves:
        saved['overlapsExport']=any(saved['startedAt']<job['endedAt'] and saved['endedAt']>job['startedAt'] for job in export_times)
    assert all(item['status']==200 for item in saves),saves
    assert not errors,errors
    assert idle and busy and saves
    page.screenshot(path=str(out/'editor.png'))
    result={'mode':args.mode,'system':platform.platform(),'browser':browser.version,'fixture':'gengar-cn-long: 70 paragraphs, built-in and research modules','actualPreviewPages':pages,'cacheClearedNavigationReadyMs':ready_ms,'idleInput':summary(idle),'parallelInput':summary(busy),'saves':summary([r['elapsedMs'] for r in saves]),'savesOverlappingExports':summary([r['elapsedMs'] for r in saves if r['overlapsExport']]),'savesWithoutExports':summary([r['elapsedMs'] for r in saves if not r['overlapsExport']]),'saveRequests':saves,'exports':page.evaluate('window.exportTimings'),'errors':errors,'scope':'Local single owner, two concurrent actual exports; not a capacity test or before/after improvement claim'}
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
    browser.close()
