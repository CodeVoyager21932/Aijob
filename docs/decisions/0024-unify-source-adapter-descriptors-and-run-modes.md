# ADR-0024：统一来源适配器描述与运行模式

- 状态：proposed
- 日期：2026-07-29
- 决策者：待 coco 在对应阶段确认
- 关联：[ADR-0010](0010-ingestion-network-policy.md)、[ADR-0016](0016-manual-browser-assisted-source-import.md)、[R1 架构审视](../evidence/r1/architecture-review-2026-07-29.md)

## 背景

当前新增来源需要同步适配器版本表、probe 分派、manual 白名单和来源专属选项；人工浏览器导入在业务语义上是 `manual`，但数据库 `crawl_runs.run_mode` 只允许 `probe/scheduled`，实现只能记录为 `probe`。手工快照幂等键也没有包含 normalizer 与 pipeline 版本。随着企业扩到 20–30 家，这些分散事实容易漂移。

## 决策标准

- 来源的 acquisition mode、adapter/normalizer/pipeline 版本和 handler 只有一个注册真源。
- `browser_required` 不可能通过配置或运行时分派触发网络采集。
- 运行模式准确表达 probe、scheduled、manual，历史记录可兼容读取。
- normalizer 升级可以安全重放同一快照，又不会生成伪修订。
- 来源主体、官方域名变化必须显式失败并留下版本决策。

## 选项

### A：继续维护分散注册点

- 优点：不需要迁移或重构。
- 缺点：新增来源的漏配与语义漂移会随规模增加。

### B：引入通用抓取框架或插件系统

- 优点：扩展能力强。
- 缺点：超出本地 MVP，需要新的执行和供应链边界。

### C：建立仓库内静态 adapter descriptor

- 优点：保持模块化单体和显式代码，同时统一版本、模式、handler 与选项校验。
- 缺点：需要渐进迁移现有适配器和历史 run mode。

## 提议决定

建议选择 C：

1. descriptor 固定 `adapterKey`、adapter/normalizer/pipeline 版本、`acquisitionMode`、probe/manual handler 与选项 schema。
2. source config 注册时必须与 descriptor 交叉校验；`browser_required` descriptor 不暴露 probe handler。
3. 新迁移将 `crawl_runs.run_mode` 扩为 `manual`，保留旧 `probe` 人工导入记录并通过兼容视图或读取映射标记历史语义。
4. 手工快照幂等键纳入 snapshot hash、adapter、normalizer、pipeline 版本；内容语义未变化仍由 revision hash 防止伪修订。
5. organization slug 命中时默认严格校验名称与官方域名；确需更名或换域时使用显式证据和版本化变更。

## 后果

- 正向：新增来源的漏配面减少，人工与网络运行语义可审计，normalizer 升级可控。
- 负向：需要迁移、兼容测试和逐适配器搬迁；短期内 descriptor 与旧分派会共存。
- 暂不做：不动态加载第三方插件，不引入生产浏览器采集，不放宽来源白名单。

## 复审触发条件

- 开始下一来源批次前决定是否先迁移 descriptor。
- 首次 normalizer 版本升级或需要重放人工快照时。
- 准备将 manual run 纳入运营统计或 G3 证据时。
