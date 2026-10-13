"""Exercise legacy material creation, one-way native reuse and source independence."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json

root = Path(__file__).resolve().parents[2]
out = root / '.data/resume-native-k3-20260912/legacy-material-browser'
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width':1440, 'height':1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:5194/materials')
    page.get_by_role('button', name='新增经历', exact=True).click()
    form = page.get_by_role('dialog')
    form.get_by_label('经历名称', exact=True).fill('已有校园调研项目')
    form.get_by_label('自己的角色', exact=True).fill('访谈与分析')
    form.get_by_label('组织 / 企业 / 学校', exact=True).fill('示例学校研究小组')
    form.get_by_label('开始时间', exact=True).fill('2025.03')
    form.get_by_label('结束时间', exact=True).fill('2025.06')
    form.get_by_role('textbox', name='经历完整描述', exact=True).fill('完成 18 次访谈，记录问题、行动与分析结果。')
    form.get_by_role('button', name='保存完整经历', exact=True).click()
    expect(form).not_to_be_visible(timeout=20000)
    page.get_by_label('选择已有校园调研项目', exact=True).check()
    page.get_by_role('button', name='用所选经历写简历（1）', exact=True).click()
    expect(page).to_have_url(__import__('re').compile(r'/resumes/native/'), timeout=30000)
    expect(page.get_by_label('项目名称', exact=True)).to_have_value('已有校园调研项目')
    expect(page.get_by_label('本人角色', exact=True)).to_have_value('访谈与分析')
    expect(page.get_by_role('textbox', name='项目背景、行动与成果', exact=True)).to_contain_text('18 次')
    page.get_by_role('textbox', name='项目背景、行动与成果', exact=True).fill('当前简历改写为 20 次访谈。')
    page.get_by_role('button', name='经历与材料', exact=True).click()
    modal = page.get_by_role('dialog')
    modal.locator('summary').filter(has_text='取用完整经历').click()
    page.screenshot(path=str(out/'opened-materials.png'))
    card = modal.locator('article').filter(has_text='已有校园调研项目').filter(has_text='18 次')
    expect(card).to_be_visible(timeout=20000)
    expect(card.get_by_role('button', name='用当前条目更新这份原稿', exact=True)).to_be_disabled()
    card.get_by_role('button', name='插入完整经历', exact=True).click()
    expect(page.get_by_label('项目名称', exact=True)).to_have_count(2)
    expect(page.get_by_role('textbox', name='项目背景、行动与成果', exact=True).last).to_contain_text('18 次')
    page.get_by_role('button', name='撤销', exact=True).click()
    expect(page.get_by_label('项目名称', exact=True)).to_have_count(1)
    expect(page.get_by_role('textbox', name='项目背景、行动与成果', exact=True)).to_contain_text('20 次')
    page.get_by_role('link', name='经历与材料', exact=True).click()
    legacy = page.locator('.experience-library-card').filter(has=page.get_by_label('选择已有校园调研项目', exact=True))
    expect(legacy).to_contain_text('18 次', timeout=20000)
    page.screenshot(path=str(out/'source-preserved.png'))
    assert not errors, errors
    (out/'result.json').write_text(json.dumps({'legacyToNative':'PASS','completeContext':'PASS','reuseAndUndo':'PASS','legacyOriginalUnchanged':'PASS','errors':errors}, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
print('Legacy experience browser PASS')
