"""One-page fitting and the real API PDF, using synthetic content only."""
import json,pathlib,uuid
from playwright.sync_api import sync_playwright,expect
from pypdf import PdfReader
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/resume-template-ux-2026-09-10';BASE='http://127.0.0.1:5173'
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    context=browser.new_context(viewport={'width':1600,'height':1000});context.request.get(BASE+'/v1/session')
    csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    def api(method,path,data=None):
        r=context.request.fetch(BASE+path,method=method,data=data,headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())});assert r.ok,(r.status,r.text());return r.json()
    draft=api('POST','/v1/resume-documents/studio',{'title':'一页排版 · 合成验收'});doc=draft['documentId']
    content=json.loads((ROOT/'docs/evidence/direction-studio-upgrade-2026-09-09/synthetic-short.json').read_text(encoding='utf-8'))
    layout={**draft['layout'],'templateKey':'jp_ats','fontFamily':'sans','fontSize':11,'margin':17,'sectionGap':12,'lineHeight':1.4,'paragraphGap':3,'entryGap':8}
    draft=api('PUT',f'/v1/resume-documents/{doc}/studio',{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':layout})
    page=context.new_page();page.set_default_timeout(30000);page.goto(BASE+'/resumes/'+doc)
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    paper=page.frame_locator('.sw-preview-pane iframe');assert paper.locator('.rs-page').count()==2
    page.get_by_role('button',name='模板',exact=True).click();gallery=page.get_by_role('dialog',name='选择简历模板')
    gallery.get_by_label('用我的内容预览',exact=True).check();gallery.locator('[data-preview-ready="true"]').wait_for()
    expect(gallery.get_by_text('第 1 / 2 页',exact=True)).to_be_visible()
    gallery.get_by_role('button',name='下一页预览').click();expect(gallery.get_by_text('第 2 / 2 页',exact=True)).to_be_visible()
    preview=page.frame_locator('.sw-gallery iframe');expect(preview.locator('.rs-page:not([hidden])')).to_have_count(1)
    gallery.get_by_role('button',name='放大查看信息整齐',exact=True).click();gallery.locator('[data-preview-ready="true"]').wait_for()
    expect(gallery.locator('.sw-page-navigation')).to_contain_text('第 1 /')
    gallery.get_by_role('button',name='返回编辑',exact=True).click()
    # Input during a delayed computation must win over the result.
    changed_during_measurement=False
    def hold_fonts(route):
        global changed_during_measurement
        if not changed_during_measurement:
            changed_during_measurement=True
            page.get_by_label('所在城市',exact=True).fill('杭州')
        route.continue_()
    page.route('**/fonts/**',hold_fonts)
    page.get_by_role('button',name='尝试一页排版',exact=True).click()
    expect(page.locator('.sw-notice')).to_contain_text('这次测算未应用',timeout=45000)
    page.unroute('**/fonts/**')
    expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
    before=api('GET',f'/v1/resume-documents/{doc}/studio')
    page.route('**/fonts/**',lambda route:route.abort())
    page.get_by_role('button',name='尝试一页排版',exact=True).click()
    expect(page.locator('.sw-notice')).to_contain_text('中文字体尚未加载',timeout=45000)
    assert api('GET',f'/v1/resume-documents/{doc}/studio')['layout']==before['layout']
    page.unroute('**/fonts/**')
    page.get_by_role('button',name='尝试一页排版',exact=True).click()
    expect(page.locator('.sw-notice')).to_contain_text('已整理为一页',timeout=45000)
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    expect(paper.locator('.rs-page')).to_have_count(1)
    after=api('GET',f'/v1/resume-documents/{doc}/studio');assert after['content']==before['content'];assert after['layout']['fontSize']==11
    page.screenshot(path=str(OUT/'after-one-page-fit.png'))
    with page.expect_download(timeout=90000) as download:
        page.get_by_role('button',name='下载 PDF',exact=True).click()
    path=OUT/'real-api-one-page.pdf';download.value.save_as(str(path))
    pdf=PdfReader(path);text=''.join(p.extract_text() for p in pdf.pages)
    assert len(pdf.pages)==1 and 'lin.zhixia@example.com' in text and '林知夏' in text
    assert '你的姓名' not in text and '待填写' not in text
    page.get_by_role('button',name='撤销修改',exact=True).click();expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
    restored=api('GET',f'/v1/resume-documents/{doc}/studio');assert restored['layout']==before['layout']
    report={'passed':True,'ownPreviewPaging':True,'templateChangeReturnsToFirstPage':True,'lateFitDoesNotOverrideInput':True,'fontFailureKeepsLayout':True,'pagesBefore':2,'pagesAfter':1,'bodyUnchanged':True,'fontSizeUnchanged':11,'realApiPdfPages':len(pdf.pages),'pdfChineseAndContact':True,'undoRestoresLayout':True}
    (OUT/'one-page-fit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));browser.close()
