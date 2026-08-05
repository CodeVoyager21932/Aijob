# Career OS 2.0 Phase 2A-1 ApplicationCase Core 验收

> 日期：2026-08-05
>
> 分支：`codex/career-os-phase-1`
>
> 结论：migration 023 Gate 通过，决定为“继续”；下一唯一切片为 Phase 2A-2 Resume Document V2 contracts + additive migration 024

## 1. 验收范围

本切片只实现 ApplicationCase 公共契约和 additive migration 023：

- 固定 `CaseStage`、`CaseOutcome`、`RequirementEvidenceState`、`ResumeSuggestionDecision`、`InterviewMode` 五个公共枚举。
- 增加 ApplicationCase、阶段迁移、岗位版本升级、要求状态、证据集合和问题的 strict Zod contracts；客户端不能提交 server-owned owner/TTL 字段。
- 创建 `application` schema 与 `application_cases`、`case_events`、`case_requirement_states`、`case_requirement_evidence_links`、`case_questions`。
- 给稳定岗位与岗位版本增加复合归属约束，复用岗位版本与要求集复合归属约束。
- 落实 owner 复合外键、活动 Case 部分唯一索引、30 天 TTL、keyset/到期/FK 索引、追加式事件和显式角色权限。
- 同步 Kysely Database types 和迁移 registry。

明确没有注册 HTTP API、实现业务写服务、修改旧决定双写、开始 Resume V2/Interview、访问真实招聘来源或调用真实 AI。

排除项：`.claude/`、`.data/`、密钥、令牌、真实简历、本地业务数据库、下载产物和服务器。

## 2. 契约结果

| 检查 | 结果 |
|---|---|
| 五个公共枚举只接受固定值 | 通过 |
| create/update body 为 strict object | 通过；额外 `ownerId/expiresAt` 被拒绝 |
| ApplicationCase stage/outcome/endedAt 配对 | 通过；仅 resolved 可且必须带 outcome/endedAt |
| 所有更新携带正整数 `expectedRevision` | 通过 |
| evidence ID 集合去重 | 通过 |
| question status/answer 配对 | 通过；只有 answered 可带 answer |
| keyset cursor 完整排序列 | 通过；必须同时包含 `updatedAt/id` |

Contracts 共 22 项通过，其中本切片新增 6 项。

## 3. PostgreSQL Gate

测试只连接 loopback 且名称匹配 `aijob_test*` 的隔离数据库。测试自身创建两个随机临时数据库，完成后使用 `DROP DATABASE ... WITH (FORCE)` 清除；没有连接或迁移项目业务库。

| Gate | 实际结果 |
|---|---|
| 空库 `001 -> 023` | 通过；最后迁移为 `023_application_case_core_expand`，五张新表为空 |
| 022 fixture 升级 | 通过；先写入 Resume V1、Resume Evidence V1、旧 `saved` 决定和 owner `match_run` task，再升级 023 |
| 旧行兼容 | 通过；旧决定状态/修订、task 类型/状态/payload、V1 schema/content hash 均保持 |
| stable job/version 固定 | 通过；错误稳定岗位与版本组合由复合 FK 返回 `23503` |
| 活动 Case 唯一 | 通过；同 owner/稳定岗位第二个未结束 Case 返回 `23505` |
| TTL | 通过；超过创建后 30 天返回 `23514` |
| owner 隔离 | 通过；跨 owner Case event 和 evidence revision link 返回 `23503` |
| 追加式事件 | 通过；更新事件触发 `IMMUTABLE_CASE_EVENT` |
| 运行角色 | 通过；collector 无 application 访问权，match 只读/删除 Case 且不能写 question，web 不能更新 event |
| 索引 | 通过；活动、keyset、到期、岗位版本/要求集和所有非覆盖 FK 索引均存在 |

`@aijob/database` 全包结果：8 个 test files、28 项测试全部通过。

## 4. 全仓工程门

```text
git diff --check
  -> passed；只有仓库既有 LF/CRLF 提示

pnpm lint
  -> 363 files checked，0 errors

pnpm typecheck
  -> contracts / config / database / platform / web passed

AIJOB_TEST_DATABASE_URL=postgresql://.../aijob_test_phase2a1 pnpm test
  -> 591 tests passed
  -> contracts 22、config 17、database 28、web 91、platform 433

pnpm build
  -> passed
  -> 既有主包 514.81 kB warning；Case workspace 继续懒加载 24.61 kB

pnpm audit:ci
  -> exit 0；1 moderate，1 high 已被现有审计配置忽略
```

本切片没有 UI 变化，因此不重复 Phase 1B 的浏览器视觉 Gate。

## 5. 风险、回退与决定

- migration 023 是 expand-only；`down` 保持前向修复，避免删除不可变个人历史。
- Case 写事务、状态机服务、Idempotency-Key 路由校验、owner retention 最小值和删除服务接线尚未实现；本 Gate 只证明契约与数据库基础，不表示 Phase 2 或产品闭环完成。
- 事件 JSONB 的无正文 allowlist 将由后续服务输入 schema 落实；本轮没有可调用的事件写 API。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家，迁移通过不构成用户价值或供给证据。
- 决定：**继续**。Phase 2A-1 已关闭；下一唯一切片为 Phase 2A-2，只实现 Resume Document V2 contracts、V1 只读转换契约与 additive migration 024，不接 API 或真实数据。
