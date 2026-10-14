from playwright.sync_api import sync_playwright, expect
from pathlib import Path
from urllib.request import urlopen
import json, time, hashlib, os
from datetime import datetime

root=Path(__file__).resolve().parents[2]
output=Path(os.environ.get('AIJOB_BROWSER_OUTPUT', root/'.data/runs/browser-import-python'/datetime.now().strftime('%Y%m%dT%H%M%S')))
output.mkdir(parents=True,exist_ok=True)
manifest_path=Path(os.environ.get('AIJOB_RESUME_REGRESSION_MANIFEST',root/'.data/resume-regression/manifest.json'))
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
sample=next(row for row in manifest['cases'] if row['id']=='existing-medium-word')
source=manifest_path.parent/sample['file']
if hashlib.sha256(source.read_bytes()).hexdigest()!=sample['sha256']:raise RuntimeError('REGRESSION_INPUT_CHANGED')
for _ in range(60):
    try:
        with urlopen('http://127.0.0.1:5194/v1/session',timeout=3) as response:
            if response.status==200:break
    except Exception:time.sleep(1)
else:raise RuntimeError('Isolated API unavailable')

with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.get_by_role('button',name='新建原生简历',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=30000)
    original_url=page.url
    page.get_by_label('稿件名称',exact=True).fill('中文导入与续写')
    expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
    page.reload()
    expect(page.get_by_label('稿件名称',exact=True)).to_have_value('中文导入与续写',timeout=30000)
    page.get_by_role('button',name='导入与原件',exact=True).click()
    page.get_by_role('dialog').locator('input[type=file]').set_input_files(str(source))
    expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏',timeout=60000)
    expect(page.get_by_label('学校',exact=True)).to_have_count(2)
    expect(page.get_by_label('企业／组织',exact=True)).to_have_count(3)
    expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
    print('REAL_UPLOAD_PARSE_EDIT',flush=True)
    page.get_by_role('button',name='导入与原件',exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button',name='下载原件',exact=True).click()
    downloaded=output/'original.docx'
    download.value.save_as(str(downloaded))
    assert hashlib.sha256(downloaded.read_bytes()).digest()==hashlib.sha256(source.read_bytes()).digest()
    page.get_by_role('button',name=source.name,exact=True).click()
    expect(page.get_by_role('heading',name='文件中的内容',exact=True)).to_be_visible()
    page.screenshot(path=str(output/'original-source.png'))
    page.get_by_role('button',name='调整识别分段',exact=True).click()
    page.locator('.native-import-block').filter(has_text='尚未填写标题的真实项目正文').get_by_role('combobox').select_option('projects')
    page.get_by_role('button',name='按调整结果更新当前稿 · 可撤销',exact=True).click()
    expect(page.get_by_label('项目名称',exact=True)).to_have_count(2)
    page.get_by_role('button',name='导入与原件',exact=True).click()
    page.get_by_role('button',name='删除原件',exact=True).click()
    expect(page.get_by_role('button',name='下载原件',exact=True)).to_have_count(0)
    page.get_by_role('button',name='返回编辑',exact=True).click()
    page.get_by_label('姓名',exact=True).fill('导入后继续编辑')
    with page.expect_download(timeout=60000) as download:
        page.get_by_role('button',name='下载 PDF',exact=True).click()
    download.value.save_as(str(output/'edited.pdf'))
    page.get_by_role('button',name='复制方向稿',exact=True).click()
    page.get_by_role('button',name='打开已复制的方向稿',exact=True).click(timeout=30000)
    expect(page.get_by_label('姓名',exact=True)).to_have_value('导入后继续编辑',timeout=30000)
    page.get_by_label('姓名',exact=True).fill('只修改方向副本')
    expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
    page.goto(original_url)
    expect(page.get_by_label('姓名',exact=True)).to_have_value('导入后继续编辑',timeout=30000)
    page.set_viewport_size({'width':360,'height':800})
    page.get_by_role('button',name='材料、导入与版本',exact=True).click()
    page.get_by_role('button',name='导入与原件',exact=True).click()
    expect(page.get_by_role('button',name='返回编辑',exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.screenshot(path=str(output/'import-mobile.png'))
    assert not errors,errors
    (output/'result.json').write_text(json.dumps({'renameReload':True,'uploadParseEdit':True,'twoSchoolsThreeInternships':True,'sourceBoundaryCorrection':True,'originalBytesIdentical':True,'deleteOriginalKeepsEditableContent':True,'immediatePdf':True,'copyIndependent':True,'mobile360NoHorizontalOverflow':True,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print('ORIGINAL_DOWNLOAD_IMMEDIATE_PDF_COPY_MOBILE',flush=True)
    browser.close()
