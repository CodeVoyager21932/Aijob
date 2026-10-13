"""Synthetic external text -> real isolated worker -> editable fields -> PDF."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import json

root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k2-20260912/credentials'
out.mkdir(parents=True,exist_ok=True)
source=out/'synthetic-research.txt'
source.write_text('林知夏\n论文与成果\n论文题目：人机协同任务研究\n作者：林知夏、王同学\n本人署名顺序：第二作者\n期刊：示例学报\n发表状态：已录用\n发表时间：2026.08\n尚未正式刊出，未填写影响因子。\n资格证书\n大学英语六级 2025.06\n计算机二级 2024.09\n颁发机构：示例考试中心\n语言能力\n英语 CET-6 520 分\n日语 JLPT N2\n使用说明：能够阅读实验文献，未承担口译。',encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.get_by_role('button',name='新建原生简历',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=30000)
    page.get_by_role('button',name='导入与原件',exact=True).click()
    page.get_by_text('粘贴已有简历文本',exact=True).click()
    page.get_by_label('简历文本',exact=True).fill(source.read_text(encoding='utf-8'))
    page.get_by_role('button',name='整理文本并开始编辑',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_have_value('林知夏',timeout=60000)
    for label,value in [('论文／成果名称','人机协同任务研究'),('作者','林知夏、王同学'),('本人署名顺序','第二作者'),('期刊／会议','示例学报'),('发表状态','已录用'),('发表时间','2026.08')]:
        expect(page.get_by_label(label,exact=True)).to_have_value(value)
    expect(page.get_by_label('证书名称',exact=True)).to_have_count(2)
    expect(page.get_by_label('语言名称',exact=True)).to_have_count(2)
    second=page.locator('details[data-native-item]').filter(has=page.locator('summary').filter(has_text='计算机二级'))
    assert not second.evaluate('(node)=>node.open')
    second.locator('summary').first.click()
    second.get_by_label('颁发机构',exact=True).fill('修正后的示例考试中心')
    second.locator('summary').first.click()
    expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=30000)
    assert not second.evaluate('(node)=>node.open')
    with page.expect_download(timeout=90000) as captured:
        page.get_by_role('button',name='下载 PDF',exact=True).click()
    captured.value.save_as(str(out/'research.pdf'))
    pdf=PdfReader(out/'research.pdf')
    text=''.join(''.join(sheet.extract_text().split()) for sheet in pdf.pages)
    for value in ['人机协同任务研究','第二作者','示例学报','已录用','2026.08','大学英语六级','计算机二级','2024.09','修正后的示例考试中心','CET-6520分','JLPTN2','未承担口译']:
        assert value in text,value
    page.screenshot(path=str(out/'research-editor.png'))
    (out/'result.json').write_text(json.dumps({'realWorker':True,'fields':12,'secondEntryCollapsed':True,'collapseKeepsSavedEdit':True,'pdfPages':len(pdf.pages)},indent=2),encoding='utf-8')
    browser.close()
    print('NATIVE_CREDENTIAL_IMPORT_EDIT_PDF_PASSED',flush=True)
