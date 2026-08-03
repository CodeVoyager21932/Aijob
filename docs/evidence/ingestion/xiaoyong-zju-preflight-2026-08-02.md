# 上海孝庸浙江大学详情页首批预检（2026-08-02）

## 结论

- 允许进入本机 `local_mvp` 首批探测，不允许公开发布。
- 使用现有 `university-employment-detail-html` 适配器的 `zju-jyxt` 格式。
- 只读取两张合格详情页；不遍历列表、不跟随脚本、不执行高校站内投递。
- 企业规模页面显示 `50-200人`，跨越 Aijob `small/medium` 的 199/200 分界，保持 `unknown`。

## 页面与核验

| 页面 | HTTP | 核验字段 |
|---|---:|---|
| `https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=50802145F4D82C43E0653A68DD0E9B18` | 200 | 机构销售和服务；实习；职责；任职要求；2027-12-31；`hr@xyasset.cn` |
| `https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=50802145F4D92C43E0653A68DD0E9B18` | 200 | 关联岗位；实习；职责；任职要求；2027-12-31；`hr@xyasset.cn` |

页面列出的第三张关联页 `zpxxbh=50802145F4D72C43E0653A68DD0E9B18` 返回 200，但工作性质未明确包含实习，首批探测以 `UNIVERSITY_EMPLOYMENT_NOT_EXPLICIT_INTERNSHIP` 拒绝，不进入目录。

页面单位标题为“上海孝庸资产管理有限公司”，单位简介为“上海孝庸私募基金管理有限公司”；配置把前者作为页面别名，未将其拆成两个主体。

## 边界

- 来源策略保持 `pending_review`，岗位只进入 `local_mvp`。
- 申请链只保留原文出现的企业域名邮箱，不使用高校系统的登录投递动作。
- 任何主体、字段结构、实习标记、申请邮箱或日期变化都触发来源级暂停。
