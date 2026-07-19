# ADR-0014：本地 MVP 使用可替换的后端 AI 配置来源

- 状态：accepted
- 日期：2026-07-19
- 决策者：coco
- 关联：[ADR-0013](0013-local-ai-recommendation-and-resume-tailoring.md)、[系统架构](../05-system-architecture.md)

## 背景

本地 MVP 需要快速填写 OpenAI-compatible 接口地址、模型和密钥，但不应要求维护者手工编辑多个环境变量，也不能把供应商配置提供给前端。当前只验证完整产品架构，不设计线上密钥设施。

## 决定

1. 增加 `pnpm ai:configure` 后端 CLI，作为本地 MVP 的配置入口。
2. 本地配置写入 Git 已忽略的 `.data/ai-provider.local.json`；前端没有配置读取或修改接口，用户侧优化结果也不返回接口地址、模型名或密钥状态。
3. `loadPlatformConfig` 是 AI 配置来源边界：存在本地文件时整组读取，不与零散环境变量混用；没有本地文件时仍可使用原有环境变量。AI provider、匹配和简历优化代码不直接依赖具体存储方式。
4. 本地 MVP 只有一个配置入口；重新运行 `pnpm ai:configure` 即可替换配置。`pnpm ai:smoke` 是 G2 验收工具，不是配置步骤。
5. 本地文件是单人开发阶段的便捷配置，不作为线上密钥方案，也不写入数据库、Git 或前端包。

## 后果

- 正向：coco 只需运行一个命令即可配置真实接口，MVP 不绑定云平台。
- 正向：未来上线时只替换 `loadPlatformConfig` 的来源，不改 AI 业务链路。
- 负向：本地文件对当前 Windows 账户是可读的，因此只能用于 coco 自己电脑上的 MVP 测试，不得复制、提交或用于多人服务器。

## 复审触发条件

- 开始远程部署、邀请他人使用或接入真实用户简历。
- 选择云平台、生产模型供应商或需要多环境密钥轮换。
