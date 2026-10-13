from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import json
root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k3-20260912/fields';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chrome',headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000})
 page.goto('http://127.0.0.1:5194/resumes/native')
 page.get_by_role('button',name='新建原生简历',exact=True).click()
 expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=20000)
 page.get_by_label('姓名',exact=True).fill('字段核验同学')
 page.get_by_role('button',name='添加项目经历',exact=True).click()
 page.get_by_label('项目名称',exact=True).fill('校园观察项目')
 page.get_by_role('textbox',name='项目背景、行动与成果',exact=True).fill('整理 18 份材料，保留完整分析报告。')
 entry=page.locator('details[data-native-item]').filter(has=page.get_by_label('项目名称',exact=True))
 entry.get_by_text('链接与补充信息',exact=True).click()
 entry.get_by_label('相关链接',exact=True).fill('https://example.com/research-report')
 entry.get_by_label('链接显示文字',exact=True).fill('完整研究报告')
 page.get_by_role('button',name='添加技能与工具',exact=True).click()
 page.get_by_label('技能名称／分类',exact=True).fill('数据处理')
 skill=page.locator('details[data-native-item]').filter(has=page.get_by_label('技能名称／分类',exact=True))
 skill.get_by_text('链接与补充信息',exact=True).click()
 skill.get_by_role('button',name='添加具体项目／工具',exact=True).click()
 skill.get_by_label('具体项目／工具 1',exact=True).fill('SQL')
 page.get_by_role('button',name='添加个人链接',exact=True).click()
 page.get_by_label('作品平台／主页类型',exact=True).fill('作品集')
 page.get_by_label('账号／展示名称',exact=True).fill('校园观察')
 page.get_by_role('button',name='添加兴趣',exact=True).click()
 page.get_by_label('兴趣与特长',exact=True).fill('纪实摄影')
 page.get_by_role('button',name='添加推荐人',exact=True).click()
 page.get_by_label('推荐人姓名',exact=True).fill('示例导师')
 page.get_by_label('推荐人职位',exact=True).fill('课程指导教师')
 with page.expect_download(timeout=120000) as capture:
  page.get_by_role('button',name='下载 PDF',exact=True).click()
 download=capture.value;download.save_as(str(out/'all-fields.pdf'))
 text=''.join(p.extract_text() or '' for p in PdfReader(out/'all-fields.pdf').pages)
 normalized=''.join(text.split())
 for field in ['字段核验同学','校园观察项目','18','完整研究报告','数据处理','SQL','作品集','校园观察','纪实摄影','示例导师','课程指导教师']:
  assert ''.join(field.split()) in normalized, field
 urls=[]
 for sheet in PdfReader(out/'all-fields.pdf').pages:
  for annot in sheet.get('/Annots',[]):
   action=annot.get_object().get('/A',{}); urls.append(str(action.get('/URI','')))
 assert 'https://example.com/research-report' in urls
 page.reload()
 expect(page.get_by_label('推荐人姓名',exact=True)).to_have_value('示例导师',timeout=20000)
 expect(page.locator('.native-paper canvas').first).to_be_visible(timeout=30000)
 separator=page.get_by_role('separator',name='调整编辑与预览宽度')
 separator.focus();separator.press('ArrowRight')
 expect(separator).to_have_attribute('aria-valuenow','44')
 page.screenshot(path=str(out/'editable-fields.png'))
 page.set_viewport_size({'width':360,'height':800})
 expect(separator).not_to_be_visible()
 assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
 page.screenshot(path=str(out/'fields-360.png'))
 (out/'result.json').write_text(json.dumps({'fieldsReadBack':12,'projectLink':True,'reloadRetained':True,'realPdf':True},indent=2),encoding='utf-8')
 browser.close()
 print('NATIVE_FIELDS_PDF_PASSED',flush=True)
