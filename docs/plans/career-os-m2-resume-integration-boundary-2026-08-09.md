# M2 专业简历闭环：复用与集成边界

> 状态：M2-0 已完成的支持性设计记录
>
> 上位事实源：[MVP 路线与当前决策面板](../06-mvp-roadmap.md)、[Career OS 当前交付计划](career-os-current-delivery-plan.md)
>
> 本文只回答“现有能力如何进入 M2、哪些边界不能跨越”，不定义新的里程碑，也不得提供 M2 之后的下一任务。

## 1. 结论

M2 不需要新数据库、新 migration、第二套解析器、第二套事实库或通用富文本编辑器。现有 Resume V2 已经具备基础/Case 派生聚合、不可变内容与布局修订、稳定 section/block ID、两套中文模板、owner 隔离、乐观并发和删除覆盖；M2 的主要工作是把这些能力接入同一个真实文档工作台，并补两个当前界面必需的薄边界：

1. 为既有 Resume Review 表与契约提供 Case 派生简历的确定性生成、读取和逐条决策服务。
2. 让既有 DOCX renderer 接受 Resume V2 当前修订，并提供不落盘的 owner 保护导出。

旧 `matching.resume_tailoring_runs` 继续服务旧 `/resume-tailorings/:runId`。它固定的是旧 `resumeAnalysisId + publishedJobVersionId`，不能覆盖私有 JD，也不能把决定原子地生成 Resume V2 修订，因此不得成为 M2 的业务真源。可复用的是其确定性文案规则、受控 provider 边界和 DOCX renderer，不是旧聚合及旧页面状态。

## 2. 固定用户闭环

```text
旧 /resume 的隔离解析与事实确认
→ /resumes 发现只读 V1 来源
→ 用户显式初始化可编辑 Base Resume V2
→ 结构化编辑并保存不可变修订
→ 真实 Case 显式创建/打开 Derived Resume V2
→ 人工编辑或生成确定性 Review
→ 逐条接受、编辑后采用或拒绝
→ 切换中文模板
→ DOCX 下载或浏览器打印
```

打开页面、读取预览和切换选中区块不得隐式写入。所有正文、布局和 Review 决策写入都必须由用户明确触发。

## 3. 复用矩阵

| 能力 | 现有真源 | M2 处理 | 明确不做 |
|---|---|---|---|
| PDF/DOCX/文本输入 | `resume` routes、隔离解析子进程、PII 检测与加密临时正文 | 原样复用；`/resumes` 无资产时进入旧 `/resume` | 不复制上传表单，不引入 OCR 或第三方解析 API |
| 事实与证据确认 | `profile` facts/evidence revisions、旧 `/resume/confirm/:analysisId` | 原样复用；确认后返回 Career OS 简历资产入口 | 不把未确认候选写成事实，不建立新证据表 |
| V1 只读来源 | `profile.resume_document_revisions` 的 `resume-document-v1` | 通过既有 conversion 读取；用户首次编辑才生成 V2 | 不反向改写 V1，不批量静默迁移 |
| Base/Derived 文档 | `profile.resume_documents` 与不可变 content/layout revisions | 作为 `/resumes` 和 Case `resume` 的唯一写入模型 | 不继续扩展旧 `profile/document` 为第二套编辑模型 |
| 结构编辑 | `ResumeSemanticContent`、内容修订 API | 新建共享的结构化工作台；文本框、增删、上移/下移、证据引用 | 不引入 Tiptap、拖拽作为唯一排序方式或 HTML 正文 |
| Case 派生 | 既有 `case_derived` 创建事务与 Case event | 继续固定 Case、岗位版本、基础修订和证据修订 | 不在页面 GET 时自动创建，不因基础简历后续变化静默重建 |
| 专业建议 | `profile.resume_review_*` 表与 contracts | 新增薄 service/routes；首轮同步生成确定性 template Review，受控 AI 仍关闭 | 不把旧 tailoring run 当 V2 真源，不调用真实模型 |
| 建议决定 | 不可变 review decision + 新 content revision | 接受/编辑后采用时原子生成新正文修订；拒绝只写决定；保留原修订 | 不直接覆盖正文，不把已保存决定改回 `pending` |
| 模板 | 两个 Resume V2 layout keys | 通过布局修订切换，正文与 evidence IDs 不变 | 不复制第三套 renderer，不在 M2 增加模板市场 |
| A4 与打印 | Case M1 A4 预览、浏览器打印 | 抽成 Base/Derived 共用工作台并提供 print CSS | 不建服务器 PDF 服务 |
| DOCX | `createAtsResumeDocx` | 新增 Resume V2 DTO 适配和 owner 保护的即时 DOCX 响应；只在内存生成 | 不复用旧 tailoring export 聚合伪装 V2 导出历史，不落盘 |
| 删除 | owner 全量删除已覆盖 V1/V2/review/export | 沿用并增加 M2 路由的 owner/epoch/墓碑测试 | 不设倒计时催删，不恢复 30 天职业资产 TTL |

## 4. 当前契约能力与缺口

### 已足够，禁止重复建设

- `GET/POST /v1/resume-documents` 已支持 base、按 Case 查询 derived、稳定游标和幂等创建。
- content/layout revision API 已支持乐观修订、幂等收据、不可变历史和无变化拒绝。
- `ResumeSemanticContent` 已能表达 section/block 编辑、增删、排序和 evidence IDs。
- 第一笔 V1→V2 修订强制保留来源 section/block ID；后续修订才允许结构调整，能同时保证追溯与编辑自由。
- Derived Resume 已在同一事务内复制基础内容和布局，并推进 Case revision/event。
- 两个模板已固定为 `cn_classic_single_column` 与 `cn_compact_technical`。
- owner 全量删除已按依赖顺序覆盖 review、documents、revisions、evidence 和旧 tailoring/export。

### M2 必须补的最小边界

1. Web Career OS API 缺少文档详情、legacy conversion、content/layout 写入函数与对应 query keys。
2. `/resumes` 仍是占位页；Case Resume 仍为 M1 只读组件，两者需要复用同一个工作台内核。
3. `resume_review_*` 已有 Schema、强约束与删除链，但没有 Platform service/routes。
4. DOCX renderer 只有旧 tailoring 调用方，需要从 Resume V2 当前内容修订生成 DTO 的适配路由。
5. 旧解析/确认页仍写“结构化事实最长保留 30 天”，与当前默认长期保留政策冲突。

以上缺口都可在 migrations 001–030 上完成，不新增 migration。只有实现时出现可复现的数据库约束缺口，才允许最小 additive forward repair，并必须先更新本记录及隔离 PostgreSQL 证据。

## 5. Review 决策语义

- Review 必须固定一个 Case-derived document、其内容修订、Case 岗位上下文和 evidence revision。
- 模板 Review 只可引用该固定 evidence revision 中已确认的 evidence ID；无法引用已确认事实时只形成 finding，不生成虚构的改写建议。
- 接受与“编辑后采用”必须在同一事务中创建新的 Resume content revision，再插入不可变 decision；数据库投影把 suggestion 从 `pending` 推进到最终状态。
- 拒绝只插入不可变 decision，不创建伪正文修订。
- 用户在提交前可以取消界面草稿。决定一旦保存，不得改回 `pending`；若用户希望恢复文字，使用普通结构化编辑生成新的内容修订，历史 Review 决定仍可审计。
- 新正文修订会使旧 Review 只读；后续建议必须从当前修订显式创建新的 Review，不能把旧建议自动重放到已变化的文档。

## 6. 前端交互方向

M2 延续现有 Career OS 的“克制、安静、可核对的文档工作台”，不进行全站换肤：

- 左栏是结构和资产导航，中间是 A4 文档面，右栏是当前区块证据/建议检查器。
- Base 与 Derived 复用同一编辑器、焦点规则、URL `?block=`、模板 token 和保存状态；岗位语境只作为 Derived 的额外层。
- 编辑采用结构化文本域与明确按钮，不使用漂浮 AI 魔法按钮、匹配分数或自动改写。
- 320px 下结构和检查器进入抽屉；200% 缩放仍能完整操作，排序始终提供可访问的上移/下移按钮。
- `/resumes` 首屏只加载资产列表；选择文档后才 lazy-load 编辑工作台。岗位列表和 Case 列表不得加载编辑器或 Review 代码。

## 7. 隐私与保留对齐

- PDF/DOCX 原文件、粘贴原文和解析临时正文：确认后立即删除，异常路径最长 24 小时。
- 用户确认的事实、证据、Base/Derived Resume、Review 决定：默认长期保留，由用户主动单项或全部删除。
- M2 不使用删除倒计时催促用户，也不因为节省云容量静默删除职业资产。
- 私有 JD 与其派生简历只对当前 owner 可见，不进入公共目录、推荐供给或其他 owner 查询。

## 8. M2-0 基线证据

2026-08-09 使用随机命名的本机隔离 PostgreSQL，完成 migrations 001–030 后运行合成夹具：

- Contracts Resume Document：14/14 通过。
- Web Career OS/Resume focused：11/11 通过。
- Platform Resume/Resume Document/Tailoring focused：首次组合运行 26/27，一项隐私清理用例达到既有 15 秒超时；同一隔离库单文件复跑 2/2 通过，核心用例约 7.6 秒。该现象记录为测试时序基线，不修改产品代码掩盖。
- 临时数据库已按精确名称强制删除；未连接开发库或 Alpha 库。

M2-0 决定：**继续 M2-1**。本轮没有修改业务行为，没有访问真实简历、真实招聘来源或真实 AI。
