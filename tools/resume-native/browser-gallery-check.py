"""Native gallery uses real owner preferences and real autosave, no mock API."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json

root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k4-20260913/gallery-browser'
out.mkdir(parents=True,exist_ok=True)
catalog=json.loads((root/'docs/evidence/resume-native-template-catalog.json').read_text(encoding='utf-8'))
expected_count=len(catalog['catalog'])
assert expected_count == catalog['count'] and expected_count > 0
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.get_by_role('button',name='新建原生简历',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=30000)
    page.get_by_label('姓名',exact=True).fill('林知夏')
    page.get_by_role('button',name='模板',exact=True).click()
    gallery=page.get_by_role('dialog')
    expect(gallery.locator('article')).to_have_count(expected_count)
    for card in gallery.locator('article').all():
        card.scroll_into_view_if_needed()
        expect(card.locator('img')).to_be_visible()
        expect(card.locator('img')).to_have_js_property('complete',True)
        assert card.locator('img').evaluate('(img)=>img.naturalWidth>0'), 'Missing template thumbnail'
    favorite=gallery.get_by_role('button',name='收藏清楚横眉',exact=True)
    expect(favorite).to_be_enabled(timeout=15000)
    favorite.click()
    expect(gallery.get_by_role('button',name='取消收藏清楚横眉',exact=True)).to_be_visible()
    gallery.get_by_label('查看',exact=True).select_option('favorites')
    expect(gallery.locator('article')).to_have_count(1)
    gallery.get_by_label('栏位',exact=True).select_option('2')
    expect(gallery.get_by_text('没有符合条件的模板，可调整筛选后继续浏览。')).to_be_visible()
    gallery.get_by_label('栏位',exact=True).select_option('all')
    gallery.locator('article').get_by_role('button').first.click()
    expect(gallery.get_by_role('button',name='应用这套模板',exact=True)).to_be_in_viewport()
    gallery.get_by_role('button',name='应用这套模板',exact=True).click()
    expect(page.get_by_text('已保存',exact=True)).to_be_visible(timeout=20000)
    page.reload()
    page.get_by_role('button',name='模板',exact=True).click()
    gallery=page.get_by_role('dialog')
    expect(gallery.get_by_role('button',name='取消收藏清楚横眉',exact=True)).to_be_visible(timeout=15000)
    gallery.get_by_label('查看',exact=True).select_option('recent')
    expect(gallery.locator('article').first.locator('strong')).to_have_text('清楚横眉')
    gallery.get_by_label('查看',exact=True).select_option('all')
    last=gallery.locator('article').last
    last.get_by_role('button').first.click()
    expect(gallery.locator('article')).to_have_count(expected_count)
    expect(last).to_be_in_viewport()
    expect(gallery.get_by_role('button',name='应用这套模板',exact=True)).to_be_in_viewport()
    page.screenshot(path=str(out/'desktop.png'))
    page.set_viewport_size({'width':360,'height':800})
    expect(gallery.get_by_role('button',name='应用这套模板',exact=True)).to_be_in_viewport()
    assert gallery.evaluate('(node)=>node.scrollWidth<=node.clientWidth+2')
    expect(gallery.get_by_role('status').filter(has_text='纸张已更新')).to_be_visible(timeout=60000)
    page.screenshot(path=str(out/'mobile.png'))
    gallery.get_by_role('button',name='浏览模板',exact=True).click()
    expect(gallery.locator('article')).to_have_count(expected_count)
    expect(gallery.locator('article').last).to_be_in_viewport()
    gallery.get_by_role('button',name='查看预览',exact=True).click()
    expect(gallery.get_by_role('button',name='应用这套模板',exact=True)).to_be_in_viewport()
    gallery.get_by_role('button',name='返回编辑',exact=True).click()
    assert not errors,errors
    (out/'result.json').write_text(json.dumps({'favorites':'PASS','recentAfterSavedApply':'PASS','filters':'PASS','allCandidatesReachable':'PASS','360':'PASS','errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print('Native gallery browser PASS')
