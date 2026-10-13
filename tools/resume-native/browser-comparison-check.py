"""Three real PDF candidates, bounded worker, and retained gallery on desktop/mobile."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json, time

root=Path(__file__).resolve().parents[2]
out=root/'.data/resume-native-k4-20260913/comparison-browser'
out.mkdir(parents=True,exist_ok=True)
catalog=json.loads((root/'docs/evidence/resume-native-template-catalog.json').read_text(encoding='utf-8'))
expected_count=len(catalog['catalog'])
assert expected_count == catalog['count'] and expected_count > 0
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page(viewport={'width':1600,'height':1000})
    errors=[]; workers=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('worker',lambda worker:workers.append(worker.url))
    page.goto('http://127.0.0.1:5194/resumes/native')
    page.get_by_role('button',name='新建原生简历',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_be_visible(timeout=30000)
    page.get_by_label('姓名',exact=True).fill('比较验证同学')
    page.get_by_role('button',name='模板',exact=True).click()
    gallery=page.get_by_role('dialog')
    cards=gallery.locator('.native-template-list article')
    expect(cards).to_have_count(expected_count)
    for index in range(3): cards.nth(index).get_by_role('checkbox').check()
    expect(cards.nth(3).get_by_role('checkbox')).to_be_disabled()
    gallery.get_by_label('用我的内容预览',exact=True).check()
    start=time.perf_counter()
    gallery.get_by_role('button',name='比较所选模板',exact=True).click()
    candidates=gallery.locator('.native-comparison-candidate')
    expect(candidates).to_have_count(3)
    for index in range(3):
        expect(candidates.nth(index).get_by_role('status')).to_have_text('纸张已更新',timeout=90000)
        expect(candidates.nth(index).locator('.native-pdf-text')).to_contain_text('比较验证同学')
    elapsed=time.perf_counter()-start
    native=[url for url in workers if 'native-preview.worker' in url]
    assert len(native)==1, native
    expect(cards).to_have_count(expected_count)
    page.screenshot(path=str(out/'desktop.png'))
    page.set_viewport_size({'width':360,'height':800})
    assert gallery.evaluate('(node)=>node.scrollWidth<=node.clientWidth+2')
    candidates.nth(2).get_by_role('button').scroll_into_view_if_needed()
    expect(candidates.nth(2).get_by_role('button')).to_be_in_viewport()
    page.screenshot(path=str(out/'mobile.png'))
    gallery.get_by_role('button',name='浏览模板',exact=True).click()
    expect(cards).to_have_count(expected_count)
    expect(cards.nth(0).get_by_role('checkbox')).to_be_checked()
    gallery.get_by_role('button',name='清空比较',exact=True).click()
    expect(cards.nth(3).get_by_role('checkbox')).to_be_enabled()
    gallery.get_by_role('button',name='返回编辑',exact=True).click()
    expect(page.get_by_label('姓名',exact=True)).to_have_value('比较验证同学')
    assert not errors, errors
    (out/'result.json').write_text(json.dumps({'threeRealPersonalPdfs':'PASS','singleNativeWorker':'PASS','fourthCandidatePrevented':'PASS','galleryRetained':'PASS','360':'PASS','elapsedSeconds':elapsed,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print('Native comparison browser PASS')
