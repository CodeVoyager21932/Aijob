# 本轮核验与复现

研究基线：`f385ed5`。本轮修改仅限研究产物、独立演示和动态项目文档，没有生产业务代码、迁移、数据库或来源状态变更。

## 代码行为复现

在主目录`C:\Users\72998\Projects\Aijob`执行：

```powershell
pnpm --filter @aijob/platform exec tsx C:/Users/72998/Projects/Aijob/docs/reviews/product-core-research-2026-09-05/reproduce-audit.mts
```

脚本只调用既有纯函数与受版本管理的来源配置加载器，不访问数据库、真实招聘网站、环境密钥或个人数据。结果为[audit-results.json](audit-results.json)。输入为合成要求和岗位；sourceInventory是本地配置状态，不能当作真实来源本轮获准或新鲜度证明。

后续修改业务行为后，重新运行会得到不同结果；本次输出保留为研究时点证据，不把这些错误行为写成必须永久保持的测试断言。

## 独立示意浏览器核验

[verify-prototype.cjs](verify-prototype.cjs)使用已安装的Playwright模块和系统Chrome无头模式。Python环境无Playwright，默认Playwright自带浏览器也未安装，因此复用了本机已有运行时；未安装新依赖或浏览器。

本机实际执行方式：

```powershell
& 'C:/Users/72998/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' docs/reviews/product-core-research-2026-09-05/verify-prototype.cjs 'C:/Users/72998/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
```

脚本直接打开本地HTML，无需启动服务。检查筛选、两种统计分母、原句追溯、临时清单、单条/空样本、四个方向、窄屏及键盘操作，同时检查浏览器错误和外部网络请求。结果见[prototype-checks.json](prototype-checks.json)。桌面1440px与手机360px截图均已人工查看，无文字遮挡、主要内容截断或横向溢出。

这是对交互概念的核验，不是生产应用的端到端或性能验收。全部32条岗位与4家企业均为虚构，同一企业多个岗位保留；样本仅用于说明不同分母会产生不同数字。

## 文档与工程范围

新增脚本使用仓库Biome进行格式与静态检查；检查本轮Markdown相对链接和Git空白差异。既有949/949、类型与构建验收属于此前业务实现的证据，本轮没有重跑或冒充新结果。没有进行真实模型调用、岗位采集、数据恢复、上线部署或实际容量测试。

研究结论可直接作为下一开发任务依据；性能预算、AI语义层、浏览器采集和内部工作台仍属于设计建议，未声明已经落地或达成。
