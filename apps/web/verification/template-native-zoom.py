"""Native Chrome zoom, zoomable template preview and keyboard return."""
import json,pathlib,uuid
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/resume-template-ux-2026-09-10';BASE='http://127.0.0.1:5173'
with sync_playwright() as p:
    context=p.chromium.launch_persistent_context(str(ROOT/'.data/template-native-zoom-qa'),executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True,no_viewport=True,args=['--window-size=1600,1000'])
    context.request.get(BASE+'/v1/session');csrf=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    r=context.request.post(BASE+'/v1/resume-documents/studio',data={'title':'模板缩放 · 合成验收'},headers={'origin':BASE,'x-csrf-token':csrf,'idempotency-key':str(uuid.uuid4())});assert r.ok
    page=context.pages[0];page.goto('chrome://settings/appearance');page.locator('select#zoomLevel').select_option('2')
    page.goto(BASE+'/resumes/'+r.json()['documentId']);page.get_by_role('button',name='模板',exact=True).click()
    gallery=page.get_by_role('dialog',name='选择简历模板');gallery.get_by_role('button',name='放大查看经典单栏',exact=True).click()
    gallery.locator('[data-preview-ready="true"]').wait_for()
    back=gallery.locator('.sw-gallery-detail').get_by_role('button',name='返回模板列表',exact=True)
    expect(back).to_be_focused();expect(gallery.get_by_role('button',name='应用这套模板')).to_be_in_viewport()
    metrics=page.evaluate('()=>({innerWidth,outerWidth,devicePixelRatio,visualScale:visualViewport.scale})')
    assert metrics['devicePixelRatio']==2 and metrics['innerWidth']<900
    assert gallery.evaluate('e=>e.scrollWidth<=e.clientWidth+1')
    page.screenshot(path=str(OUT/'gallery-native-200.png'))
    gallery.get_by_label('模板预览缩放').select_option('actual');scroll=gallery.locator('.sw-single-page-scroll')
    assert scroll.evaluate('e=>e.scrollHeight>e.clientHeight && e.scrollWidth>e.clientWidth')
    box=scroll.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.wheel(0,600)
    page.wait_for_function("document.querySelector('.sw-single-page-scroll').scrollTop>100")
    gallery.get_by_label('模板预览缩放').select_option('page');back.click()
    expect(gallery.get_by_role('button',name='放大查看经典单栏')).to_be_focused()
    page.keyboard.press('Escape');expect(page.get_by_role('button',name='模板',exact=True)).to_be_focused()
    report={'passed':True,'metrics':metrics,'actualSizeScrollable':True,'applyAndReturnReachable':True,'keyboardFocusRestored':True,'physicalPhoneKeyboardVerified':False}
    (OUT/'native-zoom.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
    page.goto('chrome://settings/appearance');page.locator('select#zoomLevel').select_option('1');context.close()
