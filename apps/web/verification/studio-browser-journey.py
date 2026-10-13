import json,pathlib,time,uuid,traceback
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[3];out=root/'docs/evidence/direction-studio-upgrade-2026-09-09/browser';out.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
  context=browser.new_context(viewport={'width':1600,'height':1000},accept_downloads=True)
  assert context.request.get('http://127.0.0.1:5173/v1/session').ok
  page=context.new_page();page.set_default_timeout(25000);page.on('pageerror',lambda e:errors.append(str(e)))
  base='http://127.0.0.1:5173'
  def request(method,path,data=None):
    cookie=next(c['value'] for c in context.cookies() if c['name']=='aijob_csrf')
    response=context.request.fetch(base+path,method=method,data=data,headers={'origin':base,'x-csrf-token':cookie,'idempotency-key':str(uuid.uuid4())})
    assert response.ok, f'{method} {path}: {response.status} {response.text()[:150]}'
    return response.json()
  def checkpoint(name):
    checks.append({'name':name,'passed':True});print(name,flush=True)
  def saved():
    expect(page.locator('.sw-save-status')).to_contain_text('已自动保存',timeout=30000)
  try:
    draft=request('POST','/v1/resume-documents/studio',{'title':'R5 浏览器合成验收'})
    fixture=json.loads((out.parent/'synthetic-medium.json').read_text(encoding='utf-8'))
    content=fixture.get('content',fixture)
    draft=request('PUT',f"/v1/resume-documents/{draft['documentId']}/studio",{'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':draft['layout']})
    doc=draft['documentId'];url=base+'/resumes/'+doc
    (root/'.data/r5-journey-document.json').write_text(json.dumps({'id':doc,'url':url}))
    page.goto(url);page.locator('.resume-workspace').wait_for();saved()
    expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏')
    expect(page.get_by_label('电话',exact=True)).to_have_value('13800000000')
    assert page.locator('.sw-record').count()>=10
    checkpoint('完整中文材料与多个专用模块可编辑')
    page.get_by_label('所在城市',exact=True).fill('杭州');saved()
    initial=page.locator('.sw-record').count()
    page.locator('.sw-record').first.get_by_role('button',name='复制',exact=True).click()
    expect(page.locator('.sw-record')).to_have_count(initial+1)
    page.get_by_role('button',name='撤销修改',exact=True).click();expect(page.locator('.sw-record')).to_have_count(initial)
    module=page.locator('.sw-module').filter(has=page.get_by_role('heading',name='教育经历',exact=True)).first
    module.get_by_role('button',name='隐藏模块',exact=True).click();expect(module).to_have_class('sw-module is-hidden')
    module.get_by_role('button',name='恢复显示',exact=True).click();saved()
    checkpoint('条目复制撤销、模块隐藏恢复')
    page.get_by_role('button',name='模板',exact=True).click()
    gallery=page.get_by_role('dialog',name='选择简历模板')
    expect(gallery.locator('.sw-template-card')).to_have_count(30)
    for n in range(3):gallery.locator('.sw-template-card').nth(n).get_by_label('加入对照').check()
    assert gallery.locator('iframe').count()==3
    assert gallery.locator('.sw-template-card').nth(3).get_by_label('加入对照').is_disabled()
    gallery.get_by_label('用我的内容预览').check()
    favorite=gallery.locator('.sw-template-card').nth(1).locator('.sw-template-name button')
    if favorite.get_attribute('aria-pressed')!='true':favorite.click()
    page.wait_for_timeout(500)
    gallery.get_by_role('button',name='已收藏',exact=True).click();expect(gallery.locator('.sw-template-card')).to_have_count(1)
    gallery.get_by_role('button',name='全部',exact=True).click()
    gallery.get_by_label('搜索模板').fill('Azurill');expect(gallery.locator('.sw-template-card')).to_have_count(1)
    gallery.locator('.sw-template-card').get_by_role('button',name='使用模板',exact=True).click();expect(gallery).not_to_be_visible();saved()
    assert request('GET',f'/v1/resume-documents/{doc}/studio')['layout']['templateKey']=='rx_azurill'
    checkpoint('30 套图库、搜索、收藏、最多三套个人对照、应用模板')
    page.locator('.sw-photo-upload input').set_input_files(str(root/'apps/web/public/resume-templates/sample-photo.png'))
    expect(page.get_by_label('显示照片',exact=True)).to_be_checked();saved()
    assert request('GET',f'/v1/resume-documents/{doc}/studio')['content']['basics']['photoId']
    page.get_by_label('显示照片',exact=True).uncheck();saved();page.get_by_label('显示照片',exact=True).check();saved()
    checkpoint('私有照片上传与显示开关')
    page.screenshot(path=str(out/'studio-full-1600.png'),full_page=True)
    # Headless Chromium composition protocol exercises composition events without substituting text character by character.
    city=page.get_by_label('所在城市',exact=True);city.fill('');city.focus()
    cdp=context.new_cdp_session(page);cdp.send('Input.imeSetComposition',{'text':'上海','selectionStart':2,'selectionEnd':2});cdp.send('Input.insertText',{'text':'上海'})
    expect(city).to_have_value('上海');saved();checkpoint('中文输入法组合提交不丢输入')
    # A competing draft retains local input and requires comparing an actual server revision.
    current=request('GET',f'/v1/resume-documents/{doc}/studio');current['content']['basics']['city']='南京'
    request('PUT',f'/v1/resume-documents/{doc}/studio',{'expectedRevision':current['revision'],'title':current['title'],'content':current['content'],'layout':current['layout']})
    city.fill('广州');page.get_by_role('button',name='比较并处理修改',exact=True).wait_for(timeout=30000)
    page.get_by_role('button',name='比较并处理修改',exact=True).click()
    conflict=page.get_by_role('dialog',name='比较未同步修改');expect(conflict).to_contain_text('广州');expect(conflict).to_contain_text('南京')
    conflict.get_by_role('button',name='保留当前输入并保存').click();expect(conflict).not_to_be_visible();saved()
    assert request('GET',f'/v1/resume-documents/{doc}/studio')['content']['basics']['city']=='广州'
    checkpoint('真实并发冲突比较并保留输入')
    # Block only saving this synthetic document, retain the failed edit across navigation/reload.
    fail={'active':True}
    def intercept(route):
      if fail['active'] and route.request.method=='PUT':route.abort('failed')
      else:route.continue_()
    page.route(f'**/v1/resume-documents/{doc}/studio',intercept)
    city.fill('成都');page.wait_for_timeout(1500);page.reload();page.locator('.resume-workspace').wait_for();expect(page.get_by_label('所在城市',exact=True)).to_have_value('成都')
    page.get_by_role('button',name='重试保存',exact=True).wait_for(timeout=30000)
    fail['active']=False
    page.get_by_role('button',name='重试保存',exact=True).click();saved()
    checkpoint('保存网络失败、刷新后的本机恢复与重试')
    # Real downloads use the UI checkpoint and fixed content/layout pair.
    for label,extension in [('下载 PDF','pdf'),('DOCX','docx')]:
      with page.expect_download(timeout=60000) as pending:page.get_by_role('button',name=label,exact=True).click()
      download=pending.value;download.save_as(str(out/f'journey-export.{extension}'))
      assert (out/f'journey-export.{extension}').stat().st_size>1000
    page.get_by_role('button',name='版本',exact=True).click();expect(page.get_by_role('dialog')).to_contain_text('恢复这一版');page.keyboard.press('Escape')
    checkpoint('当前稿 PDF/DOCX 下载、固定版本入口')
    for w,h in [(1200,900),(1000,800),(820,900),(360,740),(320,640),(360,420)]:
      page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(250)
      tabs=page.get_by_role('button',name='编辑内容',exact=True)
      if tabs.is_visible():tabs.click()
      page.get_by_label('所在城市',exact=True).fill(f'杭州{w}');saved()
      if tabs.is_visible():
        page.get_by_role('button',name='纸张预览',exact=False).click();assert page.locator('.sw-preview-pane').is_visible();tabs.click();expect(page.get_by_label('所在城市',exact=True)).to_have_value(f'杭州{w}')
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
      page.screenshot(path=str(out/f'journey-{w}-{h}.png'),full_page=True)
    checkpoint('320/360 窄屏与短视口编辑、切换预览和返回保留输入')
    page.set_viewport_size({'width':1600,'height':1000});page.goto(base+'/jobs/insights');page.locator('.dg-direction').first.wait_for()
    direction=page.locator('.dg-direction').filter(has=page.get_by_role('heading',name='产品',exact=True)).first;direction.click()
    page.wait_for_timeout(600)
    (out/'direction-controls.txt').write_text(page.locator('main').inner_text(),encoding='utf-8')
    page.screenshot(path=str(out/'direction-selected.png'),full_page=True)
    checkpoint('方向入口按职能进入子方向')
  except Exception as e:
    checks.append({'name':'journey','passed':False,'error':str(e),'trace':traceback.format_exc()});page.screenshot(path=str(out/'journey-failure.png'),full_page=True);print(traceback.format_exc(),flush=True)
  finally:
    context.storage_state(path=str(root/'.data/direction-studio-qa-state.json'))
    (out/'journey-report.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'at':time.time()},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
if any(not c['passed'] for c in checks) or errors:raise SystemExit(1)


