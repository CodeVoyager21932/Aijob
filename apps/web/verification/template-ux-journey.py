"""Real scroll/focus and template application checks with a fresh synthetic owner."""
import json,pathlib,uuid
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/resume-template-ux-2026-09-10';BASE='http://127.0.0.1:5173'
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
    context=browser.new_context(viewport={'width':1600,'height':1000});context.request.get(BASE+'/v1/session')
    csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    def api(method,path,data=None):
        r=context.request.fetch(BASE+path,method=method,data=data,headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())});assert r.ok,(r.status,r.text());return r.json()
    draft=api('POST','/v1/resume-documents/studio',{'title':'模板体验回归 · 合成稿'});doc=draft['documentId']
    assert [s['kind'] for s in draft['content']['sections']]==['education','internship','project','skills']
    assert not any(e['experienceId'] for s in draft['content']['sections'] for e in s['entries'])
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(30000)
    page.goto(BASE+'/resumes/'+doc);expect(page.get_by_label('姓名',exact=True)).to_be_visible()
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    frame=page.frame_locator('.sw-preview-pane iframe');expect(frame.locator('.rs-page').get_by_text('教育经历',exact=True)).to_be_visible()
    page.screenshot(path=str(OUT/'after-empty-starter.png'))
    page.get_by_role('button',name='模板',exact=True).click();gallery=page.get_by_role('dialog',name='选择简历模板')
    gallery.locator('[data-preview-ready="true"]').wait_for()
    expect(gallery.get_by_text('第 1 / 1 页',exact=True)).to_be_visible()
    gallery.get_by_role('button',name='放大查看信息整齐',exact=True).click();gallery.locator('[data-preview-ready="true"]').wait_for()
    expect(gallery.get_by_text('第 1 / 1 页',exact=True)).to_be_visible()
    listing=gallery.get_by_role('region',name='模板列表');before=listing.evaluate('e=>e.scrollTop')
    bounds=listing.bounding_box();page.mouse.move(bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2);page.mouse.wheel(0,20000)
    page.wait_for_function("document.querySelector('.sw-gallery-list').scrollTop>1000")
    page.wait_for_timeout(400)
    last=gallery.get_by_role('button',name='放大查看深色侧栏',exact=True);expect(last).to_be_in_viewport()
    scroll=listing.evaluate('e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop})')
    page.screenshot(path=str(OUT/'after-gallery-scroll.png'))
    last.click();gallery.locator('[data-preview-ready="true"]').wait_for();expect(last).to_be_in_viewport()
    for name in ['深色侧栏','书签标题']:
        card=gallery.locator('.sw-template-card').filter(has=page.get_by_role('heading',name=name,exact=True));card.get_by_label('对照',exact=True).check()
    saved_scroll=listing.evaluate('e=>e.scrollTop');gallery.get_by_role('button',name='对照所选模板',exact=True).click()
    expect(gallery.locator('.sw-gallery-comparison iframe')).to_have_count(2)
    gallery.locator('.sw-gallery-comparison [data-preview-ready="true"]').first.wait_for()
    gallery.locator('.sw-gallery-comparison > header').get_by_role('button',name='返回模板列表',exact=True).click()
    assert abs(listing.evaluate('e=>e.scrollTop')-saved_scroll)<2
    gallery.get_by_label('搜索模板').fill('横幅商务');expect(gallery.locator('.sw-template-card')).to_have_count(1)
    gallery.get_by_role('button',name='使用模板',exact=True).click();expect(gallery).not_to_be_visible()
    page.locator('[data-content-ready="true"] [data-preview-ready="true"]').wait_for()
    latest=api('GET',f'/v1/resume-documents/{doc}/studio')
    assert latest['layout']['templateKey']=='magic_executive_band'
    assert len(latest['content']['sections'])==4
    assert '林知夏' not in json.dumps(latest['content'],ensure_ascii=False)
    page.screenshot(path=str(OUT/'after-template-applied.png'))
    # Guides navigate to the same actual form, then disappear from a real document.
    entry=latest['content']['sections'][0]['entries'][0]['id']
    frame.locator(f'.rs-page [data-entry-id="{entry}"]').click()
    school=page.get_by_label('学校',exact=True);expect(school).to_be_focused();school.fill('真实填写的合成学校')
    expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
    written=api('GET',f'/v1/resume-documents/{doc}/studio')['content']
    page.get_by_role('button',name='模板',exact=True).click();gallery.get_by_label('搜索模板').fill('双栏分区');gallery.get_by_role('button',name='使用模板',exact=True).click()
    changed=api('GET',f'/v1/resume-documents/{doc}/studio');assert changed['content']==written
    page.get_by_role('button',name='撤销修改',exact=True).click();expect(page.locator('.sw-save-status')).to_contain_text('已自动保存')
    assert api('GET',f'/v1/resume-documents/{doc}/studio')['layout']['templateKey']=='magic_executive_band'
    # Mobile: return to the list, keep its scroll position, close and restore toolbar focus.
    mobile=[]
    for width in [360,320,800]:
        page.set_viewport_size({'width':width,'height':800});page.get_by_role('button',name='模板',exact=True).click()
        gallery.get_by_role('button',name='放大查看经典单栏',exact=True).click();gallery.locator('[data-preview-ready="true"]').wait_for()
        back=gallery.locator('.sw-gallery-detail').get_by_role('button',name='返回模板列表',exact=True);expect(back).to_be_in_viewport()
        expect(gallery.get_by_role('button',name='应用这套模板',exact=True)).to_be_in_viewport()
        assert gallery.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        page.screenshot(path=str(OUT/f'gallery-{width}.png'))
        back.click();expect(gallery.get_by_label('搜索模板')).to_be_visible()
        page.keyboard.press('Escape');expect(page.get_by_role('button',name='模板',exact=True)).to_be_focused();mobile.append(width)
    report={'passed':True,'nativeWheelReaches30thTemplate':True,'listGeometry':scroll,'comparisonRetainsScroll':True,'emptyModulesReady':True,'noSamplePersisted':True,'guideToForm':True,'existingContentPreserved':True,'templateUndo':True,'mobileWidths':mobile,'pageErrors':errors}
    assert not errors,errors
    (OUT/'browser-journey.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));browser.close()
