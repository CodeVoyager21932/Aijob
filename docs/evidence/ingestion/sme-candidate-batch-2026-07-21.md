# 中小企业岗位优先发现批次 01（2026-07-22 修订）

> 历史快照：本页保留 2026-07-22 当时的发现判断，不再作为当前活动状态事实源。2026-07-26 起以 [1000 家实习公司审查台账](internship-company-universe-2026-07-26.md)及其 [CSV](internship-company-universe.csv) 为准；其中已把过期、当天待复核和非岗位活动分别标记。

## 1. 本次纠偏

2026-07-21 的初版先列公司、再核验岗位，导致小鹅通、观远数据和袋鼠云在没有当前活动实习证据时也进入待审批公司名单。coco 指出该顺序会产生无效审查。本批现改为：

```text
只读搜索当前活动实习岗位
  -> 核验官方页面和实际投递入口
  -> 核验企业主体、来源结构、访问政策和公司规模
  -> 每批最多 5 家交 coco 审批真实低频探测
  -> 少量导入、人工抽检、再逐步扩大
```

没有至少 1 条当前活动实习岗位的公司，不进入来源审批包。本批只使用 Exa 读取公开页面，没有运行 `source:probe`、访问登录态、登记可运行来源或写入岗位。

## 2. 扩大后的岗位发现池

2026-07-22 继续从企业官网、企业 ATS、南开大学、吉林大学、香港中文大学（深圳）和东华大学就业网的公开页面检索。发现池由 5 家扩大为 **36 家**，覆盖 SaaS、AI/机器人、智能制造、游戏内容、生物医药、消费科技、航运、金融科技和专业服务。发现数量不是导入数量；最终仍需筛成 20–30 家，并满足中小企业占比目标。

### 2.1 已同时发现实习和企业投递入口：21 家

这里的“企业投递入口”只表示公开原文已经给出企业官网/ATS 或企业自有域名邮箱，仍需继续核验主体关联、活动状态、稳定岗位 ID、访问政策和规模证据。

| 企业 | 当前实习证据 | 已发现的投递链 | 待核验重点 |
|---|---|---|---|
| 帆软 | [官方招聘首页](https://join.fanruan.com/)及[新媒体运营实习生](https://join.fanruan.com/trainee/detail?id=9798)等当前 JD | 企业官方域名详情和投递入口 | 实习列表结构、稳定 ID、访问政策 |
| 千寻智能 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116118.html)和[港中深就业网](https://career.cuhk.edu.cn/job/view/id/468454)均显示当前校招实习 | 企业 Feishu ATS 与 `campus@spirit-ai.com` | ATS 租户关联、岗位级详情、规模证据 |
| 普渡机器人 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116156.html)显示 2028 届实习、即日起投递和 7–10 月滚动面试 | `pudutech.zhiye.com` | 实习/校招分离、稳定 ID、活动状态 |
| DTL 量化 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116147.html)显示 2026 秋季实习、3–6 个月 | [企业 Careers](https://www.dytechlab.com/careers)与 `careers_cn@dytechlab.com` | 岗位明细、新鲜度、规模证据 |
| 先临三维 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/467090)显示 2027/2028 届算法、软硬件实习，结束时间 2026-08-31 | 企业北森 ATS | ATS 活动状态、岗位明细、规模证据 |
| 易思维 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/113876.html)显示测试开发等实习 | 企业 Moka ATS 与 `hr@isv-tech.com` | 再确认当前 ATS 仍有活动实习 |
| 地平线 | [吉林大学就业网](https://jdjyw.jlu.edu.cn/portal/jyzp/recruit/details?id=1881ef4a713e4c029eb4363e6755ad60)显示实习岗位 | `horizon-campus.hotjob.cn` 与 `dream@horizon.auto` | 当前活动岗位数、规模口径 |
| 拓竹科技 | [东华大学就业网](https://ejob.dhu.edu.cn/pros_wjdc/s/cms/DongHua/single/2026/06/24/26062414433759990760)显示 2026-06-24 实习批次 | [企业加入页](https://bambulab.com/zh/join-us)与企业 Feishu ATS | ATS 当前活动状态、岗位级链接 |
| 深圳锐圳科技 | [AI 工作流实习生](https://career.cuhk.edu.cn/job/view/id/468767)、[出海营销实习生](https://career.cuhk.edu.cn/job/view/id/468765)等结束于 2026-10-01 或 2026-12-31 | `hr@fuzetrix.com` | 企业主体与 `fuzetrix.com` 关联、规模证据 |
| 溯简科技 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468796)显示 2027 届暑期实习，结束时间 2026-07-26 | `chenxueping@surzen.com` | 临近截止，先确认仍可投递及岗位原图结构化可行性 |
| 纳睿雷达 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468817)显示 2027 届实习，结束时间 2026-07-26 | `hr@naruida.com` | 临近截止、附件岗位表解析、规模证据 |
| 开源证券研究所 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468848)显示 2027 届暑期实习，结束时间 2026-07-31 | `liwenlin@kysec.cn` | 主体归属、岗位是否仅面向特定院校 |
| 前海新型互联网交换中心 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468449)显示 AI 项目实习，结束时间 2026-08-31 | `liyq@cnix.cn` | 企业主体、邮箱域名、岗位活动状态 |
| 分享成长投资 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/467309)显示基金投后助理实习，结束时间 2026-12-31 | `hr@sharecapital.cn` | 当前岗位是否仍开放、规模证据 |
| 喜岳投资 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/467817)显示量化研究、AI 开发等多类实习，结束时间 2026-12-31 | 企业钉钉招聘页 | 企业与租户关联、稳定岗位 ID |
| Flab | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/465828)显示量化研究实习，结束时间 2026-12-31 | `career@flab.ai` | 主体全称、邮箱域名和规模证据 |
| 湖南高阳通联 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468693)显示技术实习，结束时间 2026-07-24 | `chen_cheng@hisuntech.com` | 临近截止、集团主体关联 |
| 汉腾生物 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468662)显示人力资源实习，结束时间 2026-07-31 | `xueqin.tan@cantonbio.com` | 公司域名关联、规模证据 |
| 诗悦网络 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468683)显示游戏 UI 动效实习，结束时间 2026-07-24 | 企业 Moka 投递页 | 临近截止、ATS 租户关联 |
| 宝盈基金 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116244.html)显示通过实习考察留用的研究、数据岗位 | `zhaopin@byfunds.com` | 岗位是否属于实习、当前可投状态 |
| 上海津洋航运 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116208.html)显示航运业务实习 | `hr@joinocean.com` | 官方主体、城市字段和招聘新鲜度 |

### 2.2 当前实习已发现，但投递链尚未过关：15 家

这组不能进入来源审批包。需要先确认企业 HTTPS 申请页或企业自有域名邮箱；高校站内“申请职位”、图片、附件、公众号文章或联系方式本身不能替代这一门槛。

| 企业 | 当前实习证据 | 尚缺内容 |
|---|---|---|
| 神策数据 | [企业官方招聘页](https://www.sensorsdata.cn/about/joinus.html)当前显示后端研发实习生等 JD | 投递按钮真实目标、稳定岗位 ID |
| 授客 AI | [企业 Careers](https://www.soke.cn/careers)当前显示数据分析师（实习） | “立即投递”的真实 HTTPS/邮箱目标 |
| 爱波瑞 | [南开就业网](https://career.nankai.edu.cn/correcruit/content/id/116211.html)于 2026-07-03 发布实习培养留用项目 | 企业官方申请入口和主体关联 |
| 觉物科技 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468734)显示实习计划，结束时间 2026-07-26 | 附件内岗位明细和企业投递入口 |
| 雅可比机器人 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468819)显示 2027 届实习，结束时间 2026-07-26 | Feishu 文档是否给出可核验申请入口 |
| 麦高证券 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468857)显示 2027 届暑期实习，结束时间 2026-08-02 | 附件岗位表和企业投递入口 |
| 玄元私募 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468827)显示 2027 届暑期实习，结束时间 2026-07-31 | 企业申请页或企业域名邮箱 |
| 波克科技 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468697)显示暑期实习，结束时间 2026-07-24 | PDF 内实际投递方式和当前可投状态 |
| 沐瞳科技 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468675)显示实习岗位，结束时间 2026-07-31 | 企业官方申请目标、岗位原句 |
| 龙岗数据集团 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468659)显示实习，结束时间 2026-07-31 | 当前只有公众号原文，需企业 HTTPS/邮箱入口；否则仅能按公众号人工导入边界处理 |
| MetaApp | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468653)显示 7 月实习，结束时间 2026-07-24 | 当前只有图片，需岗位原文和企业投递入口 |
| 中国标准药物集团 | [港中深实习列表](https://career.cuhk.edu.cn/job/search?d_category=102&domain=careercuhk&page=3)显示实习，结束时间 2026-07-24 | 企业主体、岗位明细和申请入口 |
| 安博电子亚洲 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/468704)显示销售实习，结束时间 2027-07-31 | 企业申请入口和公司规模证据 |
| 今日投资数据科技 | [港中深就业网](https://career.cuhk.edu.cn/job/view/id/467797)显示量化研究实习，结束时间 2026-12-31 | 企业申请入口、主体和规模证据 |
| 珠海横乐医疗 | [港中深实习列表](https://career.cuhk.edu.cn/job/search/d_category/102)显示算法实习，结束时间 2026-08-14 | 详情页、企业申请入口和岗位原句 |

“当前”只表示 2026-07-22 的公开页面仍呈现活动实习或明确滚动开放信息，不等于岗位尚未招满。36 家均未获准真实探测，也不能在补齐规模证据前计为中小企业。临近 2026-07-24/26 截止的岗位如果未能及时完成核验，将保留为历史发现证据但不进入活动目录。

## 3. 已从候选批次移除

| 企业 | 处理 | 原因 |
|---|---|---|
| 小鹅通 | 暂停 | 只确认招聘入口，未确认当前活动实习岗位和可核验投递方式 |
| 观远数据 | 淘汰本批 | 只有历史校招页，不能作为当前活动岗位证据 |
| 袋鼠云 | 淘汰本批 | 只有招聘文化/加入页面，未发现当前职位列表或官方申请入口 |

后续公开检索如果发现它们出现新的当前实习岗位，可以重新进入新的岗位发现批次，但不得沿用本批旧结论。

## 4. 从发现池进入审批包的硬门槛

每家公司必须逐项通过，任何一项失败就暂停或淘汰：

1. 至少 1 条当前活动岗位明确标注为实习，并有岗位标题、职责/要求或可进入的官方详情页。
2. 投递方式为企业官方 HTTPS 页面，或官方原文明示的企业自有域名招聘邮箱；拒绝个人邮箱、个人微信、二维码-only 和无法核验表单。
3. 企业主体与官网、ATS 租户、高校/政府招聘页之间存在可追溯关联。
4. 明确来源结构、访问政策、稳定岗位 ID、活动状态和精确网络白名单；需要登录、验证码、动态绕过或政策不允许时停止。
5. 公司规模证据可以为 `unknown`，但不得猜测；规模未知不阻止来源审查，也不能计入中小企业比例。

## 5. 与产品 Gate 的关系

- 本批是岗位发现证据，不是来源准入、人工抽检、分类金标或用户价值证据。
- 当前没有任何一家获得真实低频探测批准，也没有向数据库新增岗位。
- 只有完成上述筛选后，才把最多 5 家合格来源交给 coco 一次性审批；批准后仍按少量岗位导入和 `min(5, 岗位总数)` 人工抽检逐步扩大。
- 当前目录仍为 61 条，产品证据仍为 `E0`，G0/G1 未开始，G3 仍为 0/3。
