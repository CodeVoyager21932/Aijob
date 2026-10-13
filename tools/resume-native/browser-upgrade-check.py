from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from PIL import Image, ImageDraw
from pypdf import PdfReader
import uuid, json, time
from urllib.request import urlopen

root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k2-20260912/upgrade-browser'
out.mkdir(parents=True,exist_ok=True)
photo=Image.new('RGB',(120,160),'#d5e4de')
draw=ImageDraw.Draw(photo);draw.ellipse((35,18,85,68),fill='#45675b');draw.rectangle((25,80,95,150),fill='#45675b')
photo.save(out/'synthetic-photo.png')
for _ in range(60):
    try:
        if urlopen('http://127.0.0.1:5194/v1/session',timeout=3).status==200:break
    except Exception:time.sleep(1)
else:raise RuntimeError('Isolated API unavailable')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.request.get('http://127.0.0.1:5194/v1/session')
    token=next(cookie['value'] for cookie in page.context.cookies() if cookie['name']=='aijob_csrf')
    def headers():return {'x-csrf-token':token,'Idempotency-Key':str(uuid.uuid4()),'Origin':'http://127.0.0.1:5194'}
    base='http://127.0.0.1:5194'
    uploaded=page.request.post(base+'/v1/resume-photos',headers=headers(),multipart={'file':{'name':'synthetic.png','mimeType':'image/png','buffer':(out/'synthetic-photo.png').read_bytes()}})
    assert uploaded.ok,uploaded.text()
    created=page.request.post(base+'/v1/resume-documents/studio',headers=headers(),data={'title':'浏览器旧稿转换夹具'})
    assert created.ok,created.text()
    draft=created.json();content=draft['content'];content['basics']['name']='旧稿转换同学';content['basics']['photoId']=uploaded.json()['id']
    entry={key:'' for key in ['title','organization','role','location','startDate','endDate','degree','major']}
    entry.update(id=str(uuid.uuid4()),title='完整课程项目',hidden=False,pageBreakBefore=False,experienceId=None,experienceRevision=None,body={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'完成 18 次访谈，保留全部过程。'}]}]})
    content['sections']=[{'id':str(uuid.uuid4()),'kind':'project','title':'项目经历','hidden':False,'pageBreakBefore':False,'column':'main','entries':[entry]}]
    saved=page.request.put(base+f"/v1/resume-documents/{draft['documentId']}/studio",headers=headers(),data={'expectedRevision':draft['revision'],'title':draft['title'],'content':content,'layout':draft['layout']})
    assert saved.ok,saved.text()
    old_before=saved.json()['content']
    page.get_by_role('button',name='从已有旧稿创建新版',exact=True).click()
    page.get_by_label('选择已有稿件',exact=True).select_option(draft['documentId'])
    page.get_by_role('button',name='创建并打开新版',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_have_value('旧稿转换同学',timeout=30000)
    expect(page.get_by_label('项目名称',exact=True)).to_have_value('完整课程项目')
    page.get_by_text('作品与个人链接',exact=True).click()
    page.get_by_label('个人网站名称',exact=True).fill('我的项目主页')
    page.get_by_label('个人网站地址',exact=True).fill('https://example.com/project')
    expect(page.get_by_text('纸张已更新',exact=True)).to_be_visible(timeout=60000)
    with page.expect_download(timeout=60000) as download:page.get_by_role('button',name='下载 PDF',exact=True).click()
    download.value.save_as(out/'converted-photo.pdf')
    reader=PdfReader(out/'converted-photo.pdf')
    assert '18' in ''.join(sheet.extract_text() or '' for sheet in reader.pages)
    assert sum(len(sheet.images) for sheet in reader.pages)>0,'photo missing from PDF'
    urls={str(a.get_object().get('/A',{}).get('/URI','')).rstrip('/') for sheet in reader.pages for a in sheet.get('/Annots',[])}
    assert 'https://example.com/project' in urls,'edited website missing from PDF'
    page.get_by_role('button',name='经历与材料',exact=True).click()
    materials=page.get_by_role('dialog')
    materials.get_by_text('将当前表达保存为材料',exact=True).click()
    materials.get_by_label('表达名称',exact=True).fill('项目短介绍夹具')
    materials.get_by_label('表达正文',exact=True).fill('复用的项目介绍：完成访谈并整理过程。')
    materials.get_by_role('button',name='保存常用表达',exact=True).click()
    expect(materials.get_by_role('heading',name='项目短介绍夹具',exact=True)).to_be_visible(timeout=15000)
    materials.get_by_role('button',name='追加到当前条目',exact=True).click()
    expect(page.locator('.tiptap').filter(has_text='复用的项目介绍')).to_have_count(1)
    page.get_by_role('button',name='撤销',exact=True).click()
    expect(page.locator('.tiptap').filter(has_text='复用的项目介绍')).to_have_count(0)
    page.get_by_role('button',name='简历助手',exact=True).click()
    assistant=page.get_by_role('dialog')
    expect(assistant.get_by_role('button',name='用我的 API 继续',exact=True)).to_be_disabled()
    assistant.get_by_label('希望怎样改进，或补充你的回答',exact=True).fill('帮助检查项目中的个人贡献')
    assistant.get_by_role('button',name='查看固定自检提示',exact=True).click()
    expect(assistant.get_by_text('固定自检提示',exact=True)).to_be_visible(timeout=15000)
    assistant.get_by_label('希望怎样改进，或补充你的回答',exact=True).fill('关闭后保留这段输入')
    assistant.get_by_role('button',name='返回编辑',exact=True).click()
    expect(assistant).not_to_be_visible()
    page.get_by_role('button',name='简历助手',exact=True).click()
    expect(assistant).to_be_visible(timeout=15000)
    expect(assistant.get_by_label('希望怎样改进，或补充你的回答',exact=True)).to_have_value('关闭后保留这段输入')
    assistant.get_by_role('button',name='返回编辑',exact=True).click()
    old_after=page.request.get(base+f"/v1/resume-documents/{draft['documentId']}/studio").json()['content']
    assert old_after==old_before
    page.screenshot(path=str(out/'converted-photo.png'))
    page.set_viewport_size({'width':360,'height':800})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    (out/'result.json').write_text(json.dumps({'explicitConversion':True,'oldContentUnchanged':True,'typedProjectEditable':True,'pdfTextPresent':True,'pdfPhotoPresent':True,'mobileNoOverflow':True,'fixedAssistantLabeled':True,'assistantInputPreserved':True,'materialAppendUndo':True},indent=2),encoding='utf-8')
    print('OLD_TO_NATIVE_PHOTO_PDF_VERIFIED',flush=True)
    browser.close()
