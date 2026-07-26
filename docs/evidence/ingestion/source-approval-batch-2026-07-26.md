# 当前实习来源低频技术核验审批包 01（2026-07-26）

## 1. 审批目的

1000 家发现宇宙已经完成，但发现记录不等于可导入来源。本批从仍有当前实习证据、官方申请链清晰且优先覆盖产品/运营与电子信息技术的企业中收敛 5 家，请 coco 决定是否允许执行一次受控、低频、只读技术核验。

批准本批只代表允许检查公开列表和详情结构，不代表：

- 来源访问政策已经通过；
- 可以公开展示岗位；
- 可以启动定时采集；
- 可以写入生产或公开目录；
- 可以绕过登录、验证码、动态验证或任何访问限制。

若页面要求登录、验证码、浏览器脚本绕过，或不能形成确定性公开结构，该企业立即暂停。真实岗位仍只允许进入本机 `local_mvp`，所有来源继续保持 `pending_review`。

## 2. 为什么选择这 5 家

| 企业 | 当前实习证据 | 优先方向 | 申请链 | 规模证据与口径 |
|---|---|---|---|---|
| 帆软软件有限公司 | [企业实习列表](https://join.fanruan.com/trainee)仍显示日常实习、千帆实习及职位分类；[产品运营实习详情](https://join.fanruan.com/trainee/detail?id=174)可公开读取 | 产品/运营、电子信息技术 | 企业自有域名详情与投递按钮 | [企业官网招聘页](https://www.fanruan.com/recruit/)称员工超过 1800 人，但没有给出上界，可能跨过 2000 人分界，保守保持 `unknown` |
| 北京掌上先机网络科技有限公司（慧策） | [南开就业网 2027 校园/实习招聘](https://career.nankai.edu.cn/correcruit/content/id/114173.html)于 2026-07-17 发布，明确包含 Java、产品经理和数据分析等实习岗位 | 产品/运营、电子信息技术 | `https://huicecom.zhiye.com/Campus` 与 `hr@huice.com` | 同一高校原文称约 3000 人，按 Aijob 口径为 `large` |
| 杭州灵明光子科技有限公司（原深圳市灵明光子科技有限公司） | [浙江大学软件实习生详情](https://www.career.zju.edu.cn/jyxt/sczp/zpztgl/ckZpgwXq.zf?zpxxbh=4A83FF77EFE862A2E0653A68DD0E9B18)明确截止到 2027-03-31，并列出 STM32、MCU、C/C++/Python/C# | 电子信息技术 | `https://adaps-ph.zhiye.com/intern/jobs` 与 `hr@adaps-ph.com` | 高校页标为 50–200 人，横跨本项目 199/200 分界，保守保持 `unknown` |
| 深圳市普渡科技股份有限公司 | [南开就业网招聘简章](https://career.nankai.edu.cn/correcruit/content/id/116156.html)于 2026-06-26 发布，明确面向 2028 届实习生且即日起开放 | 产品/运营、电子信息技术 | `https://pudutech.zhiye.com/campus` | 没有找到满足本项目口径的官方或政府人数证据，保持 `unknown` |
| 万境千寻（北京）科技有限公司（千寻智能） | [南开就业网校招实习页](https://career.nankai.edu.cn/correcruit/content/id/116118.html)于 2026-06-17 发布，明确算法、软件、硬件、产品和技术运营实习 | 产品/运营、电子信息技术 | 企业飞书 ATS、`campus@spirit-ai.com` 与[企业招聘页](https://www.spirit-ai.com/career)相互印证 | 没有找到满足本项目口径的官方或政府人数证据，保持 `unknown` |

本批 5 家中 4 家同时覆盖产品/运营与电子信息技术，1 家覆盖电子信息技术；没有按企业行业或名称补写岗位方向。当前只有慧策可以按约 3000 人明确归为 `large`，其余 4 家规模仍为 `unknown`，因此本批不能用于证明中小企业占比，后续仍需补官方或政府人数证据。

## 3. 访问政策初筛

`robots.txt` 只能作为技术边界线索，不等于企业授权，也不能单独通过来源准入。

| 企业 | 公开政策线索 | 本批处理 |
|---|---|---|
| 帆软 | `https://join.fanruan.com/robots.txt` 仅明确禁止 `/wp-admin/`，未禁止 `/trainee` | 可申请低频结构核验；仍保持 `accessPolicyAccepted=false` |
| 慧策 | `https://huicecom.zhiye.com/robots.txt` 返回 `User-agent: *`、`Allow: /` | 可申请低频结构核验；仍保持 `accessPolicyAccepted=false` |
| 灵明光子 | `https://adaps-ph.zhiye.com/robots.txt` 返回 `User-agent: *`、`Allow: /` | 可申请低频结构核验；仍保持 `accessPolicyAccepted=false` |
| 普渡机器人 | `https://pudutech.zhiye.com/robots.txt` 返回 `User-agent: *`、`Allow: /` | 可申请低频结构核验；仍保持 `accessPolicyAccepted=false` |
| 千寻智能 | 企业飞书 ATS 的 `robots.txt` 返回 404，没有明确机器访问政策 | 只申请极低频入口与公开结构核验；若不能直接确定结构，立即暂停并改为人工快照候选 |

北京硕方信息技术有限公司虽然有 2026-07-06 的明确嵌入式实习和企业域名邮箱，但其官网 `robots.txt` 明确包含 `Disallow: /`，因此没有进入本次直接招聘站核验批次。高校页仍可保留为岗位发现证据，用户可自行打开官方申请页。

浙江精准学科技有限公司虽然有截止到 2026-12-31 的产品运营实习，但企业“加入我们”页实际导向 BOSS，联系邮箱也没有明确写成投递邮箱，因此已经从申请链候选中移除。

## 4. 精确网络范围与请求预算

只有 coco 明确批准后，才允许按下表执行一次人工触发的技术核验。不得自动扩展主机、路径或查询参数。

| sourceKey | adapter 候选 | 允许的首始目标 | 预算 |
|---|---|---|---|
| `fanruan_internship` | 企业确定性 HTML | `https://join.fanruan.com:443/trainee`、从该页直接链接的 `/trainee/detail`；详情只允许数字 `id` 查询参数 | `maxItems=30`、`maxPages=3`、`maxRequests=40`、`minimumIntervalMs=2000` |
| `huice_internship` | 北森 ATS | `https://huicecom.zhiye.com:443/Campus` 及该入口直接链接的同主机公开岗位详情 | `maxItems=30`、`maxPages=3`、`maxRequests=40`、`minimumIntervalMs=2000` |
| `adaps_photonics_internship` | 北森 ATS | `https://adaps-ph.zhiye.com:443/intern/jobs` 及该入口直接链接的同主机公开岗位详情 | `maxItems=30`、`maxPages=3`、`maxRequests=40`、`minimumIntervalMs=2000` |
| `pudutech_internship` | 北森 ATS | `https://pudutech.zhiye.com:443/campus` 及该入口直接链接、明确属于实习的同主机岗位详情 | `maxItems=30`、`maxPages=3`、`maxRequests=40`、`minimumIntervalMs=2000` |
| `spirit_ai_internship` | 飞书 ATS / 企业确定性 HTML 待判定 | `https://nwd4iy9rd2s.jobs.feishu.cn:443/campusofSpiritAI` 与 `https://www.spirit-ai.com:443/career`；不跟随到其他主机 | `maxItems=20`、`maxPages=2`、`maxRequests=10`、`minimumIntervalMs=3000` |

所有重定向默认拒绝并重新校验；只允许 `GET`，不提交表单，不调用登录接口，不加载用户 Cookie，不访问个人中心。结构核验失败或只得到部分列表时，不关闭现有岗位。

## 5. 批准后的验收顺序

1. 先核验主体与租户关联，不满足即暂停。
2. 再确认无需登录、验证码、动态签名绕过或生产浏览器。
3. 冻结公开列表、详情、稳定岗位 ID、实习标记、关闭状态和官方申请链接的确定性契约。
4. 只创建离线夹具并完成适配器测试；真实低频运行仍由 coco 单独人工触发。
5. 每家最多先导入 5 条活动实习，coco 逐条抽检；通过后才提高到单家公司最多 30 条。
6. 内容未变化不产生新岗位版本，失败或部分运行不关闭旧岗位。

## 6. 待 coco 决定

请 coco 对本批作一个明确决定：

- **批准本批 5 家低频技术核验**：按第 4 节预算逐家执行，任一家失败不影响其他家；
- **只批准其中部分企业**：请列出企业名；
- **暂不批准**：继续保持纯只读研究和现有 61 条目录。

在收到明确批准前，不运行 `source:probe`，不登记可运行来源，不写入岗位数据库。

## 7. 决定与执行结果（2026-07-26）

coco 于 2026-07-26 批准本批全部 5 家低频技术核验。执行结果：

- 帆软、慧策、灵明光子、普渡完成契约冻结、适配器实现与真实低频探测，各导入首批 5 条明确实习岗位，等待 coco 逐条抽检。
- 千寻智能命中第 1 节暂停条件：飞书 ATS 岗位接口需动态 CSRF 令牌与 Cookie 会话，不构成确定性无状态公开结构，已按预设暂停并转为人工浏览器快照候选。
- 落地的 sourceKey 使用连字符（`fanruan-trainee-internships`、`huice-campus-internships`、`adaps-photonics-internships`、`pudutech-internships`），修正了本文第 4 节草拟的下划线写法。
- 完整执行证据见[审批包 01 执行记录](approved-source-batch-01-2026-07-26.md)。
