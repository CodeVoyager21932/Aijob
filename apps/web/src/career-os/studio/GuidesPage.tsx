import { Link, useSearchParams } from "react-router-dom";
import "./studio.css";

const cards=[
  {id:"first-resume",title:"第一次写简历，从可回忆的小事开始",scene:"还没有实习，不知道有什么能写",body:"先列出课程、社团、科研、比赛、个人作品中的具体任务。选一件自己能讲清楚的事，写下任务、自己的动作和留下的产物。没有结果数字时，可以说明过程、范围、反馈或限制。",example:"“参与课程项目” → “在课程小组中整理访谈记录，按问题归类，并把共同意见写入项目报告。”前提是你确实做过这些工作。",to:"/materials",action:"写下一段经历"},
  {id:"contribution",title:"把团队成果与自己的贡献讲清楚",scene:"简历里经常出现“参与”“协助”“负责”",body:"这些词本身没有问题。读者还需要知道你具体处理了什么、怎样处理、交给了谁。可以保留团队背景，同时划清自己参与的范围。",example:"“负责新媒体运营”可以补充你实际负责的是选题、资料、排版、发布还是反馈整理；没有负责的环节不必写成自己的工作。",to:"/assistant?task=experience",action:"和助手补充细节"},
  {id:"selection",title:"围绕方向选材，保留真实经历",scene:"经历不少，但简历缺少重点",body:"先读岗位的工作内容，再决定哪些经历放在前面。相同经历可以针对不同方向突出不同工作。方向稿保留各自表达，经历原稿用于持续积累。",example:"同一项目在研究方向可以突出问题、方法与局限；在产品方向可以突出需求整理、取舍与交付。不要只堆岗位关键词。",to:"/resumes",action:"打开我的简历"},
  {id:"layout",title:"先让内容读得清楚，再微调版式",scene:"字太小、空白过大，或分页把项目拆开",body:"用模块和记录组织内容，日期放在对应字段里。导出前查看实际 PDF 页面，检查标题、跨页、联系方式和链接。科研与成果较多时允许多页，不必为了单页牺牲可读性。",example:"先删重复句，再调整模块间距和页边距。用空格凑对齐会在换模板时失效。",to:"/resumes",action:"检查排版与实际页面"},
  {id:"interview",title:"练习讲出一个能追问的故事",scene:"简历写好了，但一开口就只会照念",body:"试着讲清为什么做、你处理了什么、如何取舍、结果或局限。被追问时可以说明没有负责或暂时不知道。一次回答不完整，可以保留原题重答。",example:"遇到“你具体做了什么”时，从自己执行的一个动作讲起，再补背景。结构服务于这段经历，不要求所有故事套同一种写法。",to:"/interviews",action:"开始一次练习"},
  {id:"follow-up",title:"记录实际提交的版本和下一次安排",scene:"投递多了，记不清给哪家公司发了什么",body:"在申请中记录当时的简历与提交时间。收到笔试或面试安排时加入日程；没有回复时记录跟进时间即可，不需要自动判断为拒绝。",example:"面试准备优先使用实际投递稿，后续修改自己的简历不会改变已经提交的版本。",to:"/applications",action:"打开投递管理"},
];
export function GuidesPage(){const [params]=useSearchParams(),focus=params.get("topic");return <section className="resume-studio guides-workspace"><header className="career-page-heading"><div><p>随时参考，用得上再看</p><h1>求职指南</h1><p>把卡住的一步变成可操作的小任务。这里的提示可以直接回到材料、简历和练习中使用。</p></div></header><div className="guides-grid">{[...cards].sort((a,b)=>a.id===focus?-1:b.id===focus?1:0).map((card)=><article className="guide-card" key={card.id} id={card.id}><p className="guide-scene">适用情境 · {card.scene}</p><h2>{card.title}</h2><p>{card.body}</p><blockquote>{card.example}</blockquote><Link className="career-button" to={card.to}>{card.action} →</Link><small>来源：Aijob 编辑整理 · 示例用于说明写法，请按自己的实际情况表达。</small></article>)}</div></section>;}
