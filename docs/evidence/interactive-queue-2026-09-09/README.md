# 交互队列改进与验收（2026-09-09）

## 结论与范围

本轮处理 U5/U6 已复现的助手突发排队，以及等待状态不准确的问题。继续在 `C:\Users\72998\Projects\Aijob`，从 `a4ff514` 的既有未提交工作接续。无数据库迁移、无业务库写入、无真实模型或招聘站请求、未部署。

### Contract

- 助手轮次的旧 `status` 保持兼容，新增可选 `executionStatus: waiting | processing | null`，从当前有效任务租约计算；已完成历史不改写。
- 当前账户/epoch、会话、轮次全部匹配且租约有效时才显示处理中。过期租约回到等待；不会暴露其他用户的排队数量或材料。
- 暂时达到用户 API 并发上限不是失败：重新排队，保留回答，不扣调用预算、不消耗失败重试次数。预算耗尽、配置变化、真实请求失败继续区分并提示。

### Database / Platform

- `OWNER_TASK_INTERACTIVE_CONCURRENCY` 为每个长驻 worker 的配置，1–16，默认8；解析/后台各1，维护循环独立。空闲轮询仍默认500ms，不扩数据库连接池。
- 个人 API 调用仍通过数据库事务锁定当前连接，并原子检查各自预算与并发。达到并发上限时只把任务在原租约/fencing检查下延期1秒，释放当前槽位；未调用模型的等待不计费。
- 用户删除、迟到结果丢弃、不可变任务归属、旧 Case/简历关联与耗尽恢复保持。

### Web

- 排队：“回答已保存，正在排队等待处理。你可以先整理其他材料，回来后继续查看。”
- 领取处理后：“正在整理本轮材料并等待你的 API 返回…”；不虚构排位、倒计时或模型已经完成的进度。
- 真实 Chromium + 合成 HTTP 响应检查了6项：等待期间编辑、1440/360/320px、处理中轮询保留输入、完成后保留输入并恢复发送。`browser.json` 记录0页面错误；截图已目视检查320px。

## 突发负载对比

同一台 i5-12500H、约16GB内存、Windows Node22.16.0，PostgreSQL专属测试容器。每次新建独立空库；20个合成用户、120轮/12秒；普通模拟模型1秒，每第10轮3秒，同时8份合成PDF导入及单独账户删除取消。按 Node `performance.now()` 计时。三轮全部请求均已发出、全部完成、失败0、剩余0、采样断档0；三轮解析均8/8，删除后原账户剩余轮次0。

| 执行槽位 / 空闲轮询 | 排队 p95 | 完整回复 p95 | 全部任务清空 | 进程峰值 RSS | 删除到取消 |
|---|---:|---:|---:|---:|---:|
| 2 / 50ms | 63.39s | 64.53s | 79.42s | 202.17MiB | 200ms |
| 8 / 50ms | 7.35s | 8.84s | 28.45s | 209.04MiB | 178ms |
| 8 / **默认500ms** | 7.02s | 8.49s | 21.76s | 208.76MiB | 190ms |

同轮询设置下排队p95下降约88.4%；实际观察到的模型并行峰值分别2、8、8。默认轮询复测为独立运行，清空时间还包含解析与删除；不能据此推导500ms比50ms更快。三个原始JSON保留每一轮样本和队列采样，`comparison.json`提供可核对汇总。

**限制：** 这是开发机上的合成短时测试，不是生产响应承诺。真实模型慢请求、供应商限流、实际输出质量、数小时负载尚未验收；RSS为该Node进程，未包含整个Docker/浏览器和数据库资源。8个槽位尚不能证明任意生产主机的容量；多实例总容量相加，部署时需按主机监控调节。

## 验证与复现

- 配置28项通过；最终专属PostgreSQL回归21项通过，包括连续4次个人容量等待、另一用户独立完成、API连接检查排队后恢复、失效租约、不可变归属、预算、删除迟到结果、历史上下文及维护循环。
- 扩展测试最初试图改写任务owner，被既有`IMMUTABLE_TASK_CONTEXT`拒绝；已修正夹具并改为断言该约束存在，未削弱数据库保护。失败日志保留，新空库重跑通过。
- 浏览器Python运行库未安装，复用仓库已有`playwright-core`，未新增依赖；未将失败尝试计为通过。
- 最终全仓类型、lint、889项单元测试及Windows构建均通过；236项依赖特定环境的测试跳过，PostgreSQL21项另行实跑。lint仍有162条既有警告；新增测试/浏览器脚本0警告。详细结果见 `verification.json` 及 `logs/`。无环境变量的单元测试会跳过PostgreSQL项，不能与上述21项重复计算。

队列复现：在`apps/platform`设置`AIJOB_BENCH_DATABASE_URL`为全新回环`queue_benchmark_test`库，设置`AIJOB_QUEUE_PROFILE=saturation`、`OWNER_TASK_INTERACTIVE_CONCURRENCY=2或8`、`AIJOB_BENCH_WORKER_IDLE_MS=50或500`、新的`AIJOB_BENCH_OUTPUT`后执行`pnpm exec tsx src/performance/owner-queue.ts`。脚本拒绝有owner的旧库，不会重置业务数据。解析夹具使用既有合成PDF。

PostgreSQL专项：显式设置`AIJOB_TEST_DATABASE_URL`为全新专属测试库，运行`interactive-capacity`、`studio-task-recovery`、`owner-task-worker`、`owner-task-concurrency`、`owner-task-lease`、`user-ai`、`assistant`七个integration文件，`--no-file-parallelism`。

浏览器：在5190启动正式Vite前端，运行`node apps/web/scripts/interactive-queue-browser-gate.mjs`。该脚本拦截合成API，只检查交互；真正后端状态由PostgreSQL测试验证。

## 继续事项

本轮未重测目录和图谱；此前2槽位条件下首次目录2.67秒、持续助手与后台并行p95约1110/1113ms仍是未解决基线。下一轮优先在新并发设置下复测并处理首屏与混合负载，再做多用户长会话的综合检查。真实用户BYOK质量、服务器HTTPS/邮箱/rootless解析及公开来源准入/持续刷新仍未完成。OS-7、业务恢复和旧目录处置不重做。

本轮源码候选`.data/releases/interactive-20260909-v4/`须从源码重建；先前固定digest镜像不包含这次并发与等待界面改动，本轮未重新构建Linux镜像，也未发布。
