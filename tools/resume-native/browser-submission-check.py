from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import json
root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k3-20260912/submission';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chrome',headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000})
 page.goto('http://127.0.0.1:5194/resumes/native')
 page.get_by_role('button',name='新建原生简历',exact=True).click()
 expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=20000)
 page.get_by_label('姓名',exact=True).fill('投递浏览器同学')
 page.get_by_role('button',name='添加项目经历',exact=True).click()
 page.get_by_label('项目名称',exact=True).fill('投递留存项目')
 page.get_by_role('textbox',name='项目背景、行动与成果',exact=True).fill('投递时完成 15 次访谈。')
 expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=20000)
 doc_url=page.url;doc_id=doc_url.rsplit('/',1)[-1]
 case=page.evaluate("""async()=>{const {apiRequest,createIdempotencyKey}=await import('/src/api/client.ts');return apiRequest('/v1/application-cases',{method:'POST',idempotencyKey:createIdempotencyKey(),body:{jobContext:{kind:'private_input',title:'合成产品实习',companyName:'浏览器夹具企业',contentText:'负责用户调研与报告整理。本科及以上在读。',source:{kind:'unspecified'}}}});} """)
 case_url='http://127.0.0.1:5194/applications/'+case['applicationCase']['id']+'/application'
 page.goto(case_url)
 page.get_by_role('button',name='我已在官方页面完成投递',exact=True).click()
 try:
  page.get_by_label('投递简历',exact=True).select_option(doc_id,timeout=10000)
 except Exception:
  page.screenshot(path=str(out/'picker-failure.png'))
  (out/'picker-failure.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
  raise
 expect(page.get_by_label('实际使用的版本',exact=True)).to_be_visible(timeout=20000)
 page.get_by_role('button',name='确认已投递',exact=True).click()
 expect(page.get_by_role('button',name='查看实际正文',exact=True)).to_be_visible(timeout=20000)
 page.get_by_role('button',name='查看实际正文',exact=True).click()
 expect(page.get_by_role('dialog').locator('canvas').first).to_be_visible(timeout=30000)
 page.screenshot(path=str(out/'submitted-preview.png'))
 page.goto(doc_url)
 page.get_by_role('textbox',name='项目背景、行动与成果',exact=True).fill('后来补充为 99 次访谈。')
 expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=20000)
 page.goto(case_url)
 with page.expect_download(timeout=120000) as capture:
  page.get_by_role('button',name='下载 PDF',exact=True).click()
 capture.value.save_as(str(out/'submitted.pdf'))
 text=''.join(sheet.extract_text() or '' for sheet in PdfReader(out/'submitted.pdf').pages)
 assert '15' in text and '99' not in text
 (out/'result.json').write_text(json.dumps({'nativeVersionPicker':True,'nativeSubmittedPreview':True,'laterEditIndependent':True,'downloadOriginalBody':True},indent=2),encoding='utf-8')
 browser.close()
 print('NATIVE_SUBMISSION_BROWSER_PASSED',flush=True)
