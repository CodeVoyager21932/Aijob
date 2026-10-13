import json,pathlib,time,traceback,hashlib
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[3];out=root/'docs/evidence/direction-studio-upgrade-2026-09-09/browser';checks=[];errors=[]
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
  context=browser.new_context(viewport={'width':1600,'height':1000},storage_state=str(root/'.data/direction-studio-qa-state.json'),accept_downloads=True)
  page=context.new_page();page.set_default_timeout(25000);page.on('pageerror',lambda e:errors.append(str(e)))
  def passed(name):checks.append({'name':name,'passed':True});print(name,flush=True)
  try:
    page.goto('http://127.0.0.1:5173/jobs/insights')
    page.locator('.dg-direction').filter(has=page.get_by_role('heading',name='产品',exact=True)).click()
    page.locator('.dg-directions .dg-direction').first.wait_for();page.screenshot(path=str(out/'product-directions.png'),full_page=True)
    page.locator('.dg-directions .dg-direction').first.click();page.locator('.dg-group--task').wait_for()
    page.screenshot(path=str(out/'single-direction-overview.png'),full_page=True)
    expect(page.get_by_role('heading',name='申请条件',exact=True)).to_be_visible()
    assert page.locator('.dg-group--task').get_by_text('学历',exact=True).count()==0
    saved_url=page.url
    comparison=page.get_by_label('与另一个方向对照',exact=False)
    options=comparison.locator('option').evaluate_all('(nodes)=>nodes.map(n=>({value:n.value,label:n.label}))')
    target=next(o['value'] for o in options if o['value'] and '运营' in o['label'])
    comparison.select_option(target);page.get_by_text('共同内容',exact=True).first.wait_for()
    page.screenshot(path=str(out/'direction-comparison.png'),full_page=True)
    comparison.select_option('');page.locator('.dg-group--task').wait_for();passed('产品子方向、条件分组、两个方向对照')
    # The synthetic medium resume explicitly contains SQL work; do not force a
    # relationship to a task that this user's experience has never described.
    task=page.locator('.dg-group--tool .dg-concept').filter(has_text='SQL').first
    task.locator('.dg-concept-open').click()
    evidence=page.locator('.dg-evidence');evidence.get_by_role('button',name='查看我的相关经历').click()
    evidence.locator('.dg-experience').first.wait_for();evidence.get_by_role('button',name='从全部经历选择').click();evidence.locator('.dg-experience input').first.check()
    evidence.locator('.core-quotes article').first.get_by_role('button',name='关联经历 / 加入准备').click()
    editor=page.get_by_role('dialog',name='添加事项');editor.get_by_label('事项名称',exact=True).fill('R5 从岗位原句准备一份调研表达')
    editor.get_by_role('button',name='保存事项').click();expect(editor).not_to_be_visible()
    passed('原句查看、完整经历关联、带来源的准备事项保存')
    # Reopen the original concept if preparing closed its side view.
    if not evidence.is_visible():task.locator('.dg-concept-open').click();evidence.get_by_role('button',name='查看我的相关经历').click();evidence.locator('.dg-experience input').first.check()
    evidence.get_by_role('button',name='用所选经历开始方向简历').click();page.wait_for_url('**/resumes/*');page.locator('.sw-record').first.wait_for()
    assert page.locator('.sw-record').count()>0;passed('所选完整经历直接建立方向简历')
    page.go_back();page.get_by_role('heading',name='方向图谱',exact=True).wait_for();assert 'scope=' in page.url
    passed('返回方向保留筛选范围')
    page.goto('http://127.0.0.1:5173/resumes/import')
    file=root/'docs/evidence/direction-studio-upgrade-2026-09-09/templates/jp_classic-short.docx'
    page.locator('.studio-upload-zone input').set_input_files(str(file));page.get_by_role('button',name='导入并开始编辑').click()
    page.wait_for_url('**/resumes/*');page.locator('.resume-workspace').wait_for()
    expect(page.get_by_label('电话',exact=True)).to_have_value('13800000000',timeout=90000)
    expect(page.get_by_label('邮箱',exact=True)).to_have_value('lin.zhixia@example.com')
    assert page.get_by_text('脱敏预览',exact=True).count()==0
    page.get_by_role('button',name='导入原件',exact=True).click()
    with page.expect_download() as pending:page.get_by_role('button',name='下载原件',exact=True).click()
    downloaded=out/'original-redownload.docx';pending.value.save_as(str(downloaded))
    assert hashlib.sha256(downloaded.read_bytes()).digest()==hashlib.sha256(file.read_bytes()).digest()
    page.get_by_role('button',name='删除原件',exact=True).click();page.get_by_role('button',name='确认删除原件',exact=True).click()
    page.keyboard.press('Escape');expect(page.get_by_label('电话',exact=True)).to_have_value('13800000000')
    passed('DOCX 导入直接可编辑、联系方式完整、原件相同且独立删除')
    page.screenshot(path=str(out/'import-direct-editor.png'),full_page=True)
  except Exception as e:
    checks.append({'name':'linked-journey','passed':False,'error':str(e),'trace':traceback.format_exc()});page.screenshot(path=str(out/'linked-journey-failure.png'),full_page=True);print(traceback.format_exc(),flush=True)
  finally:
    (out/'linked-journey-report.json').write_text(json.dumps({'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
if any(not c['passed'] for c in checks) or errors:raise SystemExit(1)

