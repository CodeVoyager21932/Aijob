# K0 原生简历核心接入记录

2026-09-11，实施目录 `C:/Users/72998/Projects/Aijob`。K0 进行中；本记录不代表 K1–K5 或 40 套中文模板完成。

## 已实现

- 固定 Reactive Resume v5.3.0 / `86a72bef138ae51771ea3bdeda9b2871a3a838c8`，保留五个原生包、MIT 声明及源文件哈希。补丁说明见 `vendor/reactive-resume/README.md`。
- 原生文档校验与正文/布局分离存储；沿用 PostgreSQL 草稿和幂等回执，拒绝旧编辑器写入原生文档。不改写旧历史，没有业务库迁移。
- 本地开发入口 `/resumes/native` 支持个人信息、教育、实习、富文本、自动保存、撤销重做、刷新恢复、失败重试。
- 浏览器 Worker 使用原生 React PDF，PDF.js 显示真实 PDF；服务器使用同一原生文档组件。本地字体哈希核对后加载，渲染不依赖在线字体。
- 原生语义树对外暴露稳定条目/字段关系；PDF 坐标定位、可访问文本层和点击纸张定位尚未完成。

## 验证结果

| 检查 | 实际结果 |
|---|---|
| 原生文档单元 | 5 项通过；包括未完成条目、不静默丢弃字段、独立默认值 |
| 渲染边界单元 | 4 项通过；资源、字体及语义接口 |
| 专属 PostgreSQL | 4 项通过；owner、幂等、并发修订、删除后迟到写入、旧新读取隔离 |
| 浏览器 Chrome | 新建、填写、自动保存、撤销/重做、真实 PDF、刷新恢复、503 后重试通过 |
| 窄屏 | 360px 无页面横向溢出；不等于实体手机软键盘或系统输入法验收 |
| 离线服务器 PDF | Onyx 工程基准，1 页、110617 字节；中文、邮箱及预定关键文本读回无缺项，Poppler 图片已检查 |
| 最新冷启动烟测 | 约 3446ms，包含生成和文本读回；不作为模板切换或容量达标证据 |
| 工程 | 核心/平台/Web 类型检查与 Web 构建已通过；未运行全部上游测试或完整生产镜像验收 |

复现入口：`pnpm --filter @aijob/resume-core test`、`pnpm --filter @aijob/resume-renderer test`、`pnpm --filter @aijob/resume-renderer smoke`；PG 测试为 `native-studio.integration.test.ts`，必须使用隔离测试库。浏览器脚本 `tools/resume-native/browser-check.py`，配套测试 API `tools/resume-native/test-server.mts`（3002），开发 Web 5194。合成输出仅在 `.data/resume-native-k0-20260911/output`。

## 接下来

K0 仍需收口中文字段扩展契约、依赖补丁清单和基线。随后 K1 完成全模块原生编辑、成对不可变修订、导出产物与下载、PDF 文本层/定位及首三套中文模板；K2 再接结构化导入。

当前原生合格中文模板计数为 **0/40**。Onyx 只是原生引擎接入基准，不能称为 LapisCV 或最终中文版式。正式主入口仍是历史实现，原生入口只在开发环境开放。导入、材料/AI 采用、实际投递、DOCX、完整图库和最终下载均未接入新核心。没有可用 BYOK 配置，真实模型未联调。
