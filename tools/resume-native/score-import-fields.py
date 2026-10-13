"""Additional field-level audit of the frozen synthetic corpus; does not tune inputs."""
from pathlib import Path
import json, re, unicodedata

root=Path(__file__).resolve().parents[2]/'.data/resume-native-k2-20260912/independent-corpus'
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
rows=[]
def normalize(value):
    value=re.sub(r'<[^>]+>', '', str(value or ''))
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC',value)).replace('—','-').replace('–','-')
for fixture in manifest:
    d=json.loads((root/f"parsed-{fixture['id']}.json").read_text(encoding='utf-8'))['parsed']['document']['data']
    index=fixture['id']-1
    def score(category, key, actual, expected, contains=False):
        a,e=normalize(actual),normalize(expected)
        okay=e in a if contains else a==e
        rows.append({'id':fixture['id'],'kind':fixture['kind'],'split':fixture['split'],
                     'category':category,'field':key,'tp':int(okay),'fp':int(bool(a) and not okay),
                     'fn':int(not okay)})
    for key,value in {'name':f'测试同学{index+1}','email':f'student{index+1}@example.com',
                      'phone':f'1380000{index:04d}','headline':'产品实习生'}.items():
        score('basics',key,d['basics'].get(key),value)
    for category,names in fixture['expected'].items():
        items=([item for section in d['customSections'] if section.get('aijobKind')=='research' for item in section['items']]
               if category=='research' else d['sections'][category]['items'])
        for number,name in enumerate(names):
            key={'education':'school','experience':'company','projects':'name','research':'name','volunteer':'organization'}[category]
            item=next((item for item in items if name in item.get(key,'')),{})
            score(category,key,item.get(key),name,category=='volunteer')
            if category=='education':
                for field,value in {'degree':'本科' if number==0 else '硕士','area':'信息管理' if number==0 else '管理科学',
                                    'period':'2023.09-2027.06' if number==0 else '2027.09-至今'}.items():
                    score(category,field,item.get(field),value)
                if number==0:score(category,'grade',item.get('grade'),'GPA 3.66/4')
            elif category=='experience':
                score(category,'position',item.get('position'),'产品实习生' if number==0 else '运营实习生')
                score(category,'period',item.get('period'),'2026.03-2026.06' if number==0 else '2025.07-2025.09')
                for value in (['完成 18 次用户访谈','参与 2 轮可用性测试'] if number==0 else ['未负责销售']):
                    score(category,'description',item.get('description'),value,True)
            elif category in ('projects','research'):
                score(category,'period',item.get('period'),'2025.10-2026.02')
                score(category,'role',item.get('role'),'项目负责人')
                score(category,'description',item.get('description'),'尚未上线，无营收数据',True)
            elif category=='volunteer':
                score(category,'rolePreservedInEntry',str(item.get('organization',''))+' '+str(item.get('description','')),'产品实习生' if number==0 else '运营实习生',True)
                score(category,'period',item.get('period'),'2026.03-2026.06' if number==0 else '2025.07-2025.09')
                for value in (['完成 18 次用户访谈','参与 2 轮可用性测试'] if number==0 else ['未负责销售']):
                    score(category,'description',item.get('description'),value,True)
        score(category,'itemCount',len(items),len(names))
    variant=index%5
    if variant<3:
        skills=d['sections']['skills']['items']
        score('skills','itemCount',len(skills),2)
        for name,usage in [('SQL','使用查询完成留存统计。'),('Python','清理 1200 条合成记录。')]:
            item=next((i for i in skills if i['name']==name),{})
            score('skills','name',item.get('name'),name)
            score('skills','proficiency',item.get('proficiency'),usage)
            score('skills','noInventedLevel',item.get('level'),0)
    elif variant==3:
        items=d['sections']['languages']['items']
        score('languages','itemCount',len(items),1)
        item=next((i for i in items if i['language']=='英语'),{})
        score('languages','language',item.get('language'),'英语')
        score('languages','fluency',item.get('fluency'),'CET-6 520 分')
        score('languages','noInventedLevel',item.get('level'),0)
    else:
        items=d['sections']['certifications']['items']
        score('certifications','itemCount',len(items),1)
        item=next((i for i in items if i['title']=='大学英语六级'),{})
        score('certifications','title',item.get('title'),'大学英语六级')
        score('certifications','date',item.get('date'),'2025.06')
        score('certifications','noInventedIssuer',item.get('issuer'),'')
    expected_categories=set(fixture['expected'])|({'skills'} if variant<3 else {'languages'} if variant==3 else {'certifications'})
    for category,section in d['sections'].items():
        if category not in expected_categories:
            score(category,'unexpectedItemCount',len(section['items']),0)
    score('summary','noInventedSummary',d['summary']['content'],'')
metrics=[]
for split in ('development','holdout'):
    for category,field in sorted({(r['category'],r['field']) for r in rows}):
        group=[r for r in rows if r['split']==split and r['category']==category and r['field']==field]
        tp,fp,fn=(sum(r[key] for r in group) for key in ('tp','fp','fn'))
        metrics.append({'split':split,'category':category,'field':field,'tp':tp,'fp':fp,'fn':fn,
                        'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None})
result={'scope':'Expanded audit of all categories present in the fixed synthetic corpus, counts and unexpected modules; absent field shapes and new blind inputs still need separate coverage',
        'splitCaveat':'Original holdouts were subsequently inspected; the label records origin, not a claim of a fresh blind evaluation.',
        'rows':rows,'metrics':metrics,'belowTarget':[m for m in metrics if any(m[k] is not None and m[k]<.95 for k in ('precision','recall'))]}
(root/'field-evaluation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'checks':len(rows),'belowTarget':result['belowTarget']},ensure_ascii=False))
