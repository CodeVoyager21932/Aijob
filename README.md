# 可信岗位聚合与 AI 匹配平台

这是一个面向学生和应届生优先、其他求职者为辅的可信求职项目。平台只从经过审核的企业官方招聘网站、高校就业网站和企业公开招聘页面获取岗位信息，并帮助用户理解岗位要求、识别自身证据、判断是否值得投递。

## 核心链路

```text
可信官方来源
  -> 公开岗位采集
  -> 标准化、分类、去重、时效验证
  -> 简历与求职偏好解析
  -> 硬条件过滤、证据匹配、AI 解释
  -> 推荐值得投递的岗位
  -> 跳转官方页面完成投递
```

## 项目原则

- 目标优先：竞品和开源项目只能帮助验证问题，不能决定产品架构。
- 来源可追溯：每个岗位都必须保留官方来源、原始链接和最后验证时间。
- 规则先于 AI：确定性字段和硬性条件不交给模型猜测。
- 证据先于分数：推荐必须指出岗位要求和用户经历之间的具体对应关系。
- 隐私与安全默认开启：采集服务不能接触用户简历，抓取内容一律视为不可信输入。
- MVP 只验证一个闭环：先证明问题真实且证据式推荐能促进行动，再自动化来源并扩展岗位和功能。

## 设计文档

- [从 0 到 1 统一生命周期](docs/08-zero-to-one-lifecycle.md)
- [方法与工程调研依据](docs/07-method-research.md)
- [产品定义](docs/00-product-definition.md)
- [PRD v0.1](docs/01-prd-v0.1.md)
- [来源、岗位数据与采集设计](docs/02-data-and-ingestion.md)
- [简历解析与可解释匹配设计](docs/03-matching-design.md)
- [安全威胁模型与依赖准入](docs/04-security-threat-model.md)
- [系统架构](docs/05-system-architecture.md)
- [MVP 路线与验收标准](docs/06-mvp-roadmap.md)
- [产品发现与实验](docs/09-product-discovery.md)
- [工程交付规范](docs/10-engineering-delivery.md)
- [合规与公开上线门](docs/11-compliance-and-public-launch.md)
- [验证与质量策略](docs/12-validation-and-quality-strategy.md)
- [架构决策记录](docs/decisions/README.md)
- [项目模板](docs/templates/README.md)

## 当前状态

当前处于产品发现与设计基线阶段。尚未下载、安装或运行任何第三方招聘项目，也没有确定具体技术依赖。下一阶段先完成目标用户访谈和人工礼宾实验；价值假设达到阶段门后，再验证 3 个代表性官方来源并搭建最小纵向工程切片。
