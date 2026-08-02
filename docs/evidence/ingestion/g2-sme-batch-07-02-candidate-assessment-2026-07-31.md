# G2 SME 批次 07-02 候选核验记录

- 核验日期：2026-07-31
- 执行边界：只读公开页面；未使用登录、验证码、Cookie、CSRF、动态签名、代理、OCR 或浏览器快照。
- 规模口径：`small=1–199`、`medium=200–1999`、`large>=2000`；只接受企业官网、年报、招股书或政府材料中的明确人数。
- 结论：本批固定 5 家候选中，寒序科技 1 家满足接入硬门槛；广州智跃深空、北京清大科越、傲冠软件、丽声助听器 4 家按来源级 fail-closed 暂停。
- 状态边界：本记录仅完成候选准入核验；尚未执行寒序真实 `source:probe`、导入、幂等重放或目录物化。

## 通过并允许进入离线配置

| 候选 | 活动实习与申请链 | 规模证据 | 结论 |
| --- | --- | --- | --- |
| 寒序科技（北京）有限公司 | 浙江大学就业服务平台公开[政策研究助理实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCEE37BBB2DB309E0653A68DD0E9B18)和[战略与投融资部门实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE42B8467C9601E0653A68DD0E9B18)两条纯实习 JD；均包含完整职责、任职要求、`2026-12-31` 截止日期，并明示寒序官方 [Moka 校园招聘入口](https://app.mokahr.com/campus-recruitment/hanxu/144645?locale=zh-CN#/)。页面同时给出 `icycampus@icy.tech`，企业[官网联系页](https://icy.tech/cn/contact/)另列 `hr2024@icy.tech`，用于证明域名与主体关系 | [北京大学创新创业学院材料](https://sie.pku.edu.cn/xwgg/xwdt/09fd2cf34e034555949484ebe6a15177.htm)于 2026-03-17 明确披露寒序科技团队 20 余人，可归 `small` | 允许配置寒序确定性高校详情页来源；只纳入 2 条纯实习岗位，真实首批上限 2，尚未执行 |

### 寒序岗位排除边界

- [物理与器件工程师/实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE8EA3E451A370E0653A68DD0E9B18)、[财务专员/财务实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE422A877695FDE0653A68DD0E9B18)、[AI 大模型算法工程师/实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCE0F69898A8C86E0653A68DD0E9B18)、[量子启发算法工程师/实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4CCBD519D5AD2714E0653A68DD0E9B18)虽然标题包含“实习生”，但高校页面的工作性质均标为“全职”。
- 上述 4 条属于标题与工作性质冲突，不以标题猜测实习属性，不导入、不改写为实习，也不进入真实首批预算。
- “技术项目经理”和“战略与投融资分析师”为纯全职标题，不属于本批实习候选。

## 暂停

| 候选 | 已确认事实 | 硬暂停原因 |
| --- | --- | --- |
| 广州智跃深空人工智能科技有限公司 | 浙江大学就业服务平台的[产品运营实习生](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4685F27F292AAA20E0653A68DD0E9B18)包含完整职责、要求、3 人需求和 `2026-12-31` 截止日期；同一主体页面还列出前端开发、后端开发和 AI 运营实习岗位。企业[官网](https://zleap.ai/)当前可公开访问 | 未找到官网、年报、招股书或政府材料中的明确人数；高校企业档案“50 人以下”不能作为正式规模证据。高校页申请邮箱为 `wuyuanyuan@nebulads.cn`，与官网公开的 `zleap` 主体域名不一致，且未找到两域关系的一手证明；规模证据与申请主体链均未闭合 |
| 北京清大科越股份有限公司 | 西安电子科技大学[工程师实习页](https://job.xidian.edu.cn/job/view/id/1518764)发布于 2026-03-13，当前明确显示“已过期”；企业[官网招聘页](https://www.qctc.com.cn/content/zh/recruit.html)当前仅列全职社会招聘岗位 | 无当前活动实习；高校详情页公开正文未提供岗位级职责与任职要求，联系方式需登录后查看，不以过期页面或全职岗位补齐 |
| 珠海市傲冠软件股份有限公司 | 香港中文大学（深圳）[傲冠软件实习招聘](https://career.cuhk.edu.cn/job/view/id/468803)发布于 2026-07-17、截止 2026-08-14；[全国股转系统 2024 年年度报告](https://www.neeq.com.cn/disclosure/2025/2025-01-08/5a1129cc649b45ebb6fc9c1a1f62da89.pdf)披露员工总计 81 人，可归 `small` | 高校详情页的“工作内容描述”没有可确定读取的文本职责与要求，仅依赖招聘海报；本批不使用 OCR 或浏览器快照补录。企业[官网招聘页](https://www.skybility.com/about/joinUs.html)仅引导至综合招聘平台，无法形成允许范围内的官方 HTTPS 申请页或企业域名招聘邮箱 |
| 丽声助听器（福州）有限公司 | 西安电子科技大学公开[音频算法工程师](https://job.xidian.edu.cn/job/view/id/1519922)和[嵌入式算法工程师](https://job.xidian.edu.cn/job/view/id/1519923)两条实习岗位，均发布于 2026-06-24、各招 1 人，当前未显示过期 | 两条公开页的“职位详情”均为空，没有岗位职责和任职要求；“投递简历”依赖高校学生登录，联系人电话登录后才可见，未提供企业域名招聘邮箱；同时未找到合格的一手明确人数证据，高校档案“150–500 人”不能写入正式规模证据 |

## 契约读取

- 寒序只允许读取上表两条冻结的浙江大学详情页；不遍历高校职位列表，不扩展到其他岗位，不采集或逆向页面列出的动态 Moka 入口。
- 寒序申请链使用公开页面明确给出的官方 Moka URL；`icycampus@icy.tech` 只作同主体联系信息佐证。不触发高校“投递简历”，不依赖登录态、Cookie 或 CSRF。
- 广州智跃深空、北京清大科越、傲冠软件、丽声助听器保持暂停；不为其新增适配器、不执行真实探测，也不以第三方人数、过期岗位、海报 OCR 或综合招聘平台补齐缺口。
- 通过来源仍保持 `pending_review`、`local_mvp` only；本记录不构成公开聚合授权，公开 `/v1/jobs` 边界不变。
