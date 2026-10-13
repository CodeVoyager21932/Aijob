import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GRAPH_GROUPS, JOB_SEMANTICS_V2 } from '@aijob/contracts';
import { interpretJobV2 } from '../catalog/job-semantics-v2.js';
import { SEMANTIC_V2_CORPUS, SEMANTIC_V2_HOLDOUT } from '../catalog/semantic-v2.corpus.js';
const rows = [
  ...SEMANTIC_V2_CORPUS.map(row => ({...row, split:'regression', duty:'duty' in row && row.duty})),
  ...SEMANTIC_V2_HOLDOUT.map(row => ({...row, split:'held-out', duty:true, no:[] as string[]})),
  {title:'产品实习生',text:'硕士优先，不要求985背景；掌握 Python、Java 任一语言',yes:['qualification:education:硕士','qualification:school:985','tool:python','tool:java'],no:['task:data_analysis'],split:'conditions',duty:false},
  {title:'产品实习生',text:'不要求相关实习经验；本科及以上学历',yes:['qualification:experience:实习经验','qualification:education:本科'],no:[],split:'conditions',duty:false},
  {title:'产品实习生',text:'具有沟通表达能力，善于团队协作；了解教育行业与学习场景',yes:['general:communication','general:collaboration','domain:education'],no:['tool:python'],split:'categories',duty:false},
  {title:'银行实习生',text:'了解银行业务，协助为本科学生整理活动指引',yes:['domain:finance'],no:['qualification:education:本科','domain:ecommerce'],split:'categories',duty:true},
  {title:'其他实习生',text:'协助整理馆藏标本',yes:['unclassified:协助整理馆藏标本'],no:['task:data_analysis','tool:excel'],split:'categories',duty:true},
];
const checks=rows.map(row=>{
  const parsed=interpretJobV2({jobVersionId:randomUUID(),title:row.title,requirements:row.duty?'':row.text,responsibilities:row.duty?row.text:''});
  const keys=parsed.atoms.map(a=>a.key);
  return {...row,identified:parsed.atoms.map(a=>({key:a.key,kind:a.kind,necessity:a.necessity,negated:a.negated,choiceGroup:a.choiceGroup})),missed:row.yes.filter(k=>!keys.includes(k)),falsePositiveAssertions:row.no.filter(k=>keys.includes(k))};
});
const kinds=GRAPH_GROUPS.map(group=>({kind:group.kind,title:group.title,positiveAssertions:checks.flatMap(r=>r.yes).filter(k=>k.startsWith(group.kind+':')).length,misses:checks.flatMap(r=>r.missed).filter(k=>k.startsWith(group.kind+':')).length,negativeAssertions:checks.flatMap(r=>r.no).filter(k=>k.startsWith(group.kind+':')).length,falsePositiveAssertions:checks.flatMap(r=>r.falsePositiveAssertions).filter(k=>k.startsWith(group.kind+':')).length}));
const output={at:new Date().toISOString(),extractionVersion:JOB_SEMANTICS_V2,source:'Authored synthetic fixtures, not live jobs or independent human annotations',method:'Only listed positive and negative assertions are scored. Unlabelled outputs are not assumed correct. Held-out examples were authored separately from dictionary entries, not an independent external gold set.',perKind:kinds,checks};
await writeFile(resolve(import.meta.dirname,'../../../../docs/evidence/direction-studio-upgrade-2026-09-09/semantic-quality.json'),JSON.stringify(output,null,2));
console.info(JSON.stringify(kinds));
if(checks.some(r=>r.missed.length||r.falsePositiveAssertions.length))process.exitCode=1;
