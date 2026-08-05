# Phase 2A-2 Resume Document V2 验收证据

- 日期：2026-08-05
- 分支：`codex/career-os-phase-1`
- 范围：Resume V2 contracts、migration 024、数据库类型/registry 与隔离集成测试
- 决定：继续进入 Phase 2A-3；不接 HTTP API、真实 AI、真实招聘来源、真实简历或服务器

## 交付内容

- `packages/contracts/src/resume-documents.ts`：base/case-derived 文档、V2 section/block/content、content/layout revision、V1 virtual read 与 strict create/update contracts。
- `packages/database/src/migrations/024_resume_document_v2_expand.ts`：新增 `profile.resume_documents`、`profile.resume_layout_revisions`，并 nullable additive 扩展既有 `profile.resume_document_revisions`。
- V1 行继续使用 `resume-document-v1`，`document_id/document_revision/base_document_revision_id` 保持 NULL；V2 使用独立文档内修订号，并以复合外键固定同 owner/document 的 base 修订。
- 文档固定 title、aggregate revision、创建幂等哈希、30 天 TTL、Case/job/version/requirement/evidence 引用；布局只允许两个模板、追加修订且禁止 UPDATE。
- 新增外键组合均有索引；web、match、ops、migrator 显式授权，collector 无 profile 新表权限；文档引用更新守卫拒绝改变已固定的 Case/岗位/基础文档引用。

## 验证命令与结果

所有数据库测试只使用 loopback 且名称匹配 `aijob_test*` 的临时 PostgreSQL 数据库；测试后使用 `DROP DATABASE ... WITH (FORCE)` 清理。未读取 `.claude/`、`.data/`、密钥、简历原文或下载产物。

```text
pnpm --filter @aijob/contracts typecheck       PASS
pnpm --filter @aijob/contracts test            PASS (28 tests)
pnpm --filter @aijob/database typecheck        PASS
pnpm --filter @aijob/database test -- 024...   PASS (4 tests)
pnpm test                                      PASS
  config 17 + contracts 28 + database 32 + web 91 + platform 433 = 601 tests
pnpm lint                                      PASS (367 files)
pnpm typecheck                                 PASS
pnpm build                                     PASS (web main chunk 517.87 kB; warning only)
pnpm audit:ci                                  PASS (1 high and 1 moderate advisory ignored by repository policy)
git diff --check                               PASS
```

024 专属隔离 PostgreSQL 测试覆盖：

- 空库 `001 -> 024` 与 migration registry 最新版本。
- V1 内容修订逐列兼容，旧 schema/hash/owner revision 不变。
- V2 首修订与后续同文档 base 修订链、当前内容/布局指针和不可变 trigger。
- base/derived 字段配对、owner/Case/job/version/requirement/evidence 外键、TTL、布局模板和 base 顺序约束。
- 文档固定引用更新拒绝、collector/web/match 角色权限。

## 未包含的 Gate

- `pnpm audit:ci` 报告 2 个已登记忽略 advisory（1 high、1 moderate），命令按仓库策略通过；本切片未引入新的依赖。
- 本切片没有浏览器变更；1920/1280/768/320 与键盘验收继续引用 Phase 1B 证据。
- 产品证据仍为 `E0`；可信供给仍为 22 岗 / 3 家企业，G2/G3、服务器、G0/G1/G4 均未改变。
