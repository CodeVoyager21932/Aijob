import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { nativeTemplateCatalog } from "../../packages/resume-core/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const upstream = "86a72bef138ae51771ea3bdeda9b2871a3a838c8";
const custom = {
"jp-designer-cn":{component:"JpDesignerCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"杂志式页首、珊瑚分隔带与独立经历卡片。 原生完整字段与自然续页；本地Noto中文字体、A4纸张，无外部资源。无照片时不保留空框，项目完整正文可续页。"},
"jp-ribbon-cn":{component:"JpRibbonCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"通栏缎带页首、折角分节标签与经历侧线。 原生完整字段与自然续页；本地Noto中文字体、A4纸张，无外部资源。无照片时不保留空框，项目完整正文可续页。"},
"jp-minimal-cn":{component:"JpMinimalCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"浅灰纸边、白色内页、日期时间轴与项目卡片。 原生完整字段与自然续页；本地Noto中文字体、A4纸张，无外部资源。无照片时不保留空框，项目完整正文可续页。"},
"rendercv-classic-cn":{component:"RenderClassicCnPage",reference:"rendercv",license:"MIT",changes:"居中蓝色页首、延伸细线与学历专业独立列。 原生完整字段与自然续页；本地Noto中文字体、A4纸张，无外部资源。中文学历专业列合并以保持原字段关系，边距由50.4pt适配为40pt；未添加更新日期占位。"},
"rendercv-engineering-cn":{component:"RenderEngineeringCnPage",reference:"rendercv",license:"MIT",changes:"衬线居中姓名、通栏分节线与企业优先条目。 原生完整字段与自然续页；本地Noto中文字体、A4纸张，无外部资源。中文学历专业列合并以保持原字段关系，边距由50.4pt适配为40pt；未添加更新日期占位。"},
"jp-scientist-cn":{component:"JpScientistCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留居中论文式身份、带编号分节与衬线层级；Georgia换为Noto Serif SC，省略无对应中文字体的伪斜体及重复条目编号，保持完整续页。"},
"jp-berlin-cn":{component:"JpBerlinCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留黑色页首、三种几何装饰、圆形分节及右侧黄色短条；正文保持原生语义列表和独立字段，不预设技能分数。"},
"jp-blocks-cn":{component:"JpBlocksCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留联系信息标签、三角分节、内收正文和浅色简介；不引入外链字体，完整原生模块自然分页。"},

"jp-classic-cn":{component:"JpClassicCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留居中照片/姓名组合、独立联系行、页首粗线与职位/组织/日期紧凑同排；本地中文字体，原生完整字段和自然分页。"},
"jp-ats-cn":{component:"JpAtsCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留有照片时页首并排、无照片时居中，黑线分节与职位/组织/日期同行；ATS是上游名称，不宣称第三方解析百分比。"},
"jp-academic-cn":{component:"JpAcademicCnPage",reference:"jobpilot",license:"Apache-2.0",changes:"保留学位专业优先、学校下一行与右上日期、细分节线和衬线阅读；使用Noto Serif SC替代Computer Modern，不伪造未提供的科研成果。"},

"magic-formal-cn":{component:"MagicFormalCnPage",reference:"magic-resume",license:"MIT",changes:"保留CenteredPhotoHeader居中身份、对称矩形照片、蓝色细线分节；双层条目在原生语义内呈现，角色与地点置于组织下方，补充字段不丢失。"},
"magic-product-cn":{component:"MagicProductCnPage",reference:"magic-resume",license:"MIT",changes:"保留标签两列联系信息、右侧矩形照片、组织/角色双层经历和绿色细线分节。中文正文10pt，页边距18pt代替原9pt，避免纸边过窄；保留完整自定义字段。"},
"magic-clean-cn":{component:"MagicCleanCnPage",reference:"magic-resume",license:"MIT",changes:"保留居中联系行与Header实际姓名层级，项目/证书/语言两列，技能/主页三列，细线模块。网格使用原生行列分页，用户非默认栏数保留；正文10pt中文适配。"},

 "magic-compact-cn":{component:"MagicCompactCnPage",reference:"magic-resume",license:"MIT",changes:"保留居中姓名/右侧矩形照片、黑色细分节线与企业学校/角色专业/日期三列。原生结构额外字段保留补充行；取消无照片空白占位，项目完整字段保留双层头部，链接与长内容完整。"},
 "magic-executive-cn":{component:"MagicExecutiveCnPage",reference:"magic-resume",license:"MIT",changes:"保留内收浅色页首名片及经历、教育、项目的时间轴；页首按Header组件实际14px姓名与40px圆照片转换，不误用配置xxl；采用原生时间轴原语，其他模块按完整类型输出，本地中文字体，不添加外部照片或图标。"},
  "euro-cn": { component: "EuroCnPage", reference: "jobpilot", license: "Apache-2.0", changes: "保留 Euro 左侧逐行联系方式、右侧照片、通栏蓝线及右对齐模块索引与竖分隔；标签中文化，不预设个人敏感字段，原生内容完整续页。" },
  "modern-cn": { component: "ModernCnPage", reference: "jobpilot", license: "Apache-2.0", changes: "保留 Modern 通栏照片/姓名/联系信息、前导短线分节和工作条目侧线/日期胶囊；渐变改纯色、本地中文字体，原生长内容连续分页。" },
  "visiky-single-cn": { component: "VisikySingleCnPage", reference: "visiky", license: "MIT", changes: "保留 Template2 左侧姓名和两列联系信息、右侧可选照片、标题尾随细线与连续单栏；中文字体和所有模块接入原生分页，不复制能力星级。" },
  "visiky-cn": { component: "VisikyCnPage", reference: "visiky", license: "MIT", changes: "保留 Template1 的40%左侧资料与60%浅底经历区域、可选照片和右侧色带标题；装饰外链图标不移入，字号按中文 A4 校准，原生续页保留所有模块。" },
  "swiss-cn": { component: "SwissCnPage", reference: "jobpilot", license: "Apache-2.0", changes: "参考 Swiss 左侧日期网格、职位优先与红色模块标记；中文日期列和补充字段在原生分页体系中呈现，未预设模块继续完整输出。" },
  "engineer-cn": { component: "EngineerCnPage", reference: "jobpilot", license: "Apache-2.0", changes: "保留深色三分区页首、右侧联系信息、测量线与蓝色分节；渐变改为纯色保证原生输出一致，中文经历保留组织/角色独立字段。" },
  "lapis-cn": { component: "LapisCnPage", reference: "lapiscv", license: "MIT", changes: "保留中文单栏、居中页首与条目行组织；在原生字段和分页体系中实现，固定为本地 Noto 字体。" },
  "billryan-cn": { component: "BillryanCnPage", reference: "billryan", license: "MIT", changes: "保留居中页首、细线分节、学校企业与角色分行；不运行上游 LaTeX 引擎。" },
  "deedy-cn": { component: "DeedyCnPage", reference: "deedy-cn", license: "Apache-2.0", changes: "保留30pt页首、16pt分节、25%教育侧栏；Source Han 字体替换为已登记 Noto Serif SC，长材料可自然续页，照片可选。" },
  "gengar-cn": { component: "GengarCnPage", license: "MIT", changes: "原生 Gengar 区域结构，补充中文长内容续页与本地字体。" },
} as const;
const catalog = [];
for (const template of nativeTemplateCatalog) {
  const detail = custom[template.id as keyof typeof custom];
  const component = detail ? `aijob/${detail.component}` : `${template.base}/${template.base[0].toUpperCase()}${template.base.slice(1)}Page`;
  const localPath = `vendor/reactive-resume/pdf/src/templates/${component}.tsx`;
  const text = await readFile(resolve(root, localPath));
  const reference = template.id === "lapis-cn"
    ? { repository: "BingyanStudio/LapisCV", commit: "c8ff9e0652c02f3aea7f7ac75c011168456d717d", files: ["vendor/resume-template-references/lapiscv/main.css", "vendor/resume-template-references/lapiscv/typora.css", "vendor/resume-template-references/lapiscv/LICENSE"] }
    : detail && "reference" in detail
    ? JSON.parse(await readFile(resolve(root, `vendor/resume-template-references/${detail.reference}/source.json`), "utf8"))
    : { repository: "reactive-resume/app", commit: upstream, path: `packages/pdf/src/templates/${template.base}/${template.base[0].toUpperCase()}${template.base.slice(1)}Page.tsx` };
  catalog.push({
    ...template, version: 1, localPath, localSha256: createHash("sha256").update(text).digest("hex"),
    nativeCore: { repository: "reactive-resume/app", commit: upstream, license: "MIT" },
    reference, referenceLicense: detail?.license ?? "MIT",
    adaptation: detail?.changes ?? (template.id === "azurill-cn" ? "沿用原生区域和时间轴；论文模块使用无时间轴文献列表，避免装饰线使标题孤立续页。本地Noto字体，关闭能力评分。" : "沿用对应原生模板组件与区域结构；中文字段、本地Noto字体、关闭能力评分与默认图标，保留自然续页。"),
    thumbnail: `/native-templates/${template.id}-v1.png?render=native-cn-v11`,
    acceptance: "local-candidate: three-length PDF/DOCX content checks and rendered PDF page review; scope and remaining conditions in resume-native-k4-k5-2026-09-13.md; not a pixel-identical upstream replica",
  });
}
const output = resolve(root, "docs/evidence/resume-native-template-catalog.json");
await mkdir(resolve(root, "docs/evidence"), { recursive: true });
await writeFile(output, JSON.stringify({ count: catalog.length, target: 40, catalog }, null, 2) + "\n");
console.log(`Recorded ${catalog.length} native candidates with source paths and hashes`);
