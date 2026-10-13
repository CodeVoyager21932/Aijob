"""Actual PDF upload -> typed fields -> edit -> immediate download -> reopen."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader
import json

root = Path(__file__).resolve().parents[2]
out = root / '.data/resume-native-k2-20260913/browser-pdf-reimport'
out.mkdir(parents=True, exist_ok=True)
source = root / '.data/resume-native-k4-20260913/metadata-v9/gengar-cn-short.pdf'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.get_by_role('button', name='新建原生简历', exact=True).click()
    expect(page.get_by_label('姓名', exact=True)).to_be_visible(timeout=30000)
    page.get_by_role('button', name='导入与原件', exact=True).click()
    page.get_by_role('dialog').locator('input[type=file]').set_input_files(str(source))
    expect(page.get_by_label('姓名', exact=True)).to_have_value('林知夏', timeout=60000)
    expected = {
        '学校': '示例大学', '企业／组织': '示例科技', '项目名称': '校园访谈项目',
        '本人角色': '访谈与研究整理', '项目所属单位（选填）': '校级研究小组',
        '项目方法（选填）': '半结构化访谈',
    }
    for label, value in expected.items():
        expect(page.get_by_label(label, exact=True)).to_have_count(1)
        expect(page.get_by_label(label, exact=True)).to_have_value(value)
    expect(page.get_by_role('textbox', name='项目背景、行动与成果', exact=True)).not_to_contain_text('半结构化访谈')
    page.get_by_label('项目方法（选填）', exact=True).fill('访谈与观察对照')
    with page.expect_download(timeout=120000) as download:
        page.get_by_role('button', name='下载 PDF', exact=True).click()
    download.value.save_as(str(out / 'edited.pdf'))
    text = ''.join((sheet.extract_text() or '') for sheet in PdfReader(out / 'edited.pdf').pages)
    text = ''.join(text.split())
    for value in ['示例大学', '示例科技', '校园访谈项目', '校级研究小组', '访谈与观察对照', '12次访谈']:
        assert value in text, value
    assert '半结构化访谈' not in text
    page.reload()
    expect(page.get_by_label('项目方法（选填）', exact=True)).to_have_value('访谈与观察对照', timeout=30000)
    page.screenshot(path=str(out / 'reopened.png'), full_page=False)
    page.set_viewport_size({'width': 360, 'height': 800})
    field = page.get_by_label('项目方法（选填）', exact=True)
    field.scroll_into_view_if_needed()
    expect(field).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.screenshot(path=str(out / 'mobile.png'))
    assert not errors, errors
    (out / 'result.json').write_text(json.dumps({'realPdfUpload': 'PASS', 'typedFields': 6, 'immediateExportLatestEdit': 'PASS', 'reopened': 'PASS', '360': 'PASS', 'errors': errors}, indent=2), encoding='utf-8')
    browser.close()
    print('PDF_REIMPORT_EDIT_EXPORT_REOPEN_PASS', flush=True)
