# G2 SME 批次 07 固定队列核验记录

- 核验日期：2026-07-30
- 执行边界：只读公开页面；未使用登录、验证码、Cookie、CSRF、动态签名、代理或浏览器快照。
- 规模口径：`small=1–199`、`medium=200–1999`、`large>=2000`；只接受企业官网、年报或政府材料中的明确人数。
- 结论：固定 20 家队列中 3 家满足全部接入硬门槛，1 家与现有来源重复，16 家按来源级 fail-closed 暂停。

## 通过并进入离线配置

| 候选 | 活动实习与申请链 | 规模证据 | 结论 |
| --- | --- | --- | --- |
| 卧安机器人（深圳）股份有限公司 | [中国地质大学就业页](https://cug.91wllm.cn/en/campus/view/id/996609)显示 2027 届实习已启动并指向官方 `woanhome.zhiye.com/intern/jobs`；企业官网招聘页与官方北森租户相互印证 | [港交所 2025 年年报](https://www.hkexnews.hk/listedco/listconews/sehk/2026/0429/2026042904445_c.pdf)披露 644 名雇员，`medium` | 配置 `onerobotics-internships`；真实首批上限 5 |
| 深圳一清创新科技有限公司 | 南开就业网公开[定位算法](https://career.nankai.edu.cn/correcruit/content/id/115887.html)、[规控算法](https://career.nankai.edu.cn/correcruit/content/id/115886.html)、[感知算法](https://career.nankai.edu.cn/correcruit/content/id/115885.html)三条完整实习 JD，均使用 `yangshuo@unity-drive.com` | [企业官网公司简介](https://www.unity-drive.com/about.html)当前源码显示团队总人数 180+，`small` | 配置 `unity-drive-internships`；真实首批上限 3 |
| 广东三石园科技有限公司 | [南开就业网详情页](https://career.nankai.edu.cn/correcruit/content/id/116046.html)明确 2027/2028 届、2026 年 7–8 月实习、主要工作内容、对象与公司域名邮箱；企业[加入我们](https://www.triple-stone.cn/join-us/)同步保留实习招聘 | [企业官网公司简介](https://www.triple-stone.cn/about-us/)显示员工总数 1400+，`medium` | 配置 `triple-stone-internships`；真实首批上限 1 |

## 暂停或拒绝

| 候选 | 已确认事实 | 暂停/拒绝原因 |
| --- | --- | --- |
| 上海孝庸 | 企业官网当前招聘页仅见全职岗位 | 无当前活动实习，且无明确人数证据 |
| 上海津洋 | [天津工业大学岗位页](https://jobs.tiangong.edu.cn/correcruit/content/id/54713.html)有当前完整实习 JD | 仅检索到第三方规模估计，无官网、年报或政府明确人数 |
| 上海思勰 | [企业官网](https://www.sixiecapital.com/)披露团队 100+，可归 `small` | [最新高校页面](https://career.cuhk.edu.cn/en/job/view/id/468812)截止 2026-07-26，已过期 |
| 易思维 | 上交所材料披露 570 人，可归 `medium` | 官网招聘入口未提供当前岗位级完整职责与要求；不采用第三方招聘页补齐 |
| 进迭时空 | [浙江政府材料](https://www.zjsjw.gov.cn/toutiao/202602/t20260219_23955871.shtml)披露团队近 300 人，可归 `medium`；官方论坛有当前实习 | [官方论坛服务条款](https://forum.spacemit.com/tos)明确禁止非搜索引擎自动访问 |
| 熵旋芯智 | [企业官网](https://spinentropy.com/news)显示实习招聘已启动，高校页面有公司域名邮箱 | 官网、年报和政府材料均未给出明确人数 |
| 玉衡星 | [南开岗位页](https://career.nankai.edu.cn/correcruit/content/id/115517.html)有当前实习与企业域名邮箱 | 无合格明确人数证据 |
| 原力灵机 | [南开岗位页](https://career.nankai.edu.cn/correcruit/content/id/115084.html)有当前完整实习 JD 与企业域名邮箱 | 无合格明确人数证据 |
| 思谋科技 | [企业官网](https://cn.smartmore.com/tech.html)披露近 1000 人，可归 `medium` | 官方 Moka 入口当前依赖动态页面，无法冻结匿名稳定岗位明细契约 |
| 宇泛智能 | [企业官网招聘页](https://www.uniubi.com/about/join)当前列出 2026 第一季度全职热招 | 未发现当前明确实习，且无合格明确人数证据 |
| 武汉华瑾 | [华中科技大学页面](https://job.hust.edu.cn/zpinfo1/2406951.htm)有两条完整实习 JD 与企业域名邮箱 | 无合格明确人数证据 |
| 独立说 | [南开岗位页](https://career.nankai.edu.cn/correcruit/content/id/115848.html)有当前实习与企业域名邮箱 | 政府人数材料为 2021 年旧数据，无法证明当前规模区间 |
| 天津易迪思 | 高校页面有当前实习；政府材料可证明科技型中小企业身份 | “中小企业”称号不能替代明确人数，缺少合格规模证据 |
| 微步在线 | [企业官网招聘页](https://www.threatbook.cn/about/join)与高校招聘简章可证明申请链和实习机会 | 无合格明确人数证据 |
| 掌上先机 | 当前实习和大规模证据均存在 | 与已配置 `huice-campus-internships` 为同一慧策主体，拒绝重复新增公司 |
| 湖南斗安 | [湖南工商大学页面](https://job.hutb.edu.cn/detail/online?id=3516870)有完整测试实习 JD，并标注少于 50 人 | 人数仅为高校平台企业档案字段，不属于官网、年报或政府证据 |
| 广州头文 | 高校页面有完整岗位职责、要求和 `topwin.tech` 企业邮箱 | 150–500 人仅为高校平台企业档案字段，缺少合格明确人数证据 |

## 契约读取

- 卧安官方北森入口 `https://woanhome.zhiye.com/intern/jobs`：匿名 `GET 200`，无 Cookie 依赖；`robots.txt` 为 `User-agent: * / Allow: /`。
- 卧安固定 `PortalId=8db50333-7ab7-4960-8f87-ddd9468f4766`、`Category=3`，列表端点复用现有北森确定性适配器。
- 一清、三石园只读取上表冻结的南开详情页，禁止遍历列表、搜索扩展或跟随其他页面。
- 三个来源均保持 `pending_review`、`local_mvp` only；本记录不构成公开聚合授权。
