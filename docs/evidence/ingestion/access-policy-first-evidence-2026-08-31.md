# ADR-0033 首次取证：18 个已登记主机的 robots.txt 实测

日期：2026-08-31（Asia/Shanghai）。命令：`pnpm source:access-policy-probe -- --confirm-live`。
34 份来源配置去重后 **18 个不同主机，每主机一次 `GET /robots.txt`，共 18 次请求**。原文快照落在
`.data/access-policy/`（Git 忽略），本文件只记结论与哈希。

本次**未修改任何配置**：`accessPolicyEvidence` 的 `termsOfService` 半边要人读条款页、摘录原句、
判断有没有禁止聚合的条款，那半边不能由机器生成。

## 1. 逐主机结果

| 主机 | 结果 | 原因 | content-type | 引用来源数 |
|---|---|---|---|---:|
| `adaps-ph.zhiye.com` | fetched | — | `text/plain` | 1 |
| `huicecom.zhiye.com` | fetched | — | `text/plain` | 1 |
| `pudutech.zhiye.com` | fetched | — | `text/plain` | 1 |
| `shining3d.zhiye.com` | fetched | — | `text/plain` | 1 |
| `woanhome.zhiye.com` | fetched | — | `text/plain` | 1 |
| `jobs.bytedance.com` | fetched | — | `text/plain` | 1 |
| `join.fanruan.com` | fetched | — | `text/plain; charset=utf-8` | 1 |
| `campus.jd.com` | unavailable | `UPSTREAM_HTTP_404` | — | 1 |
| `career.cuhk.edu.cn` | unavailable | `UPSTREAM_HTTP_404` | — | 5 |
| `career.gdut.edu.cn` | unavailable | `UPSTREAM_HTTP_404` | — | 1 |
| `career.nankai.edu.cn` | unavailable | `UPSTREAM_HTTP_404` | — | 7 |
| `job.hust.edu.cn` | unavailable | `UPSTREAM_HTTP_404` | — | 3 |
| `talent.baidu.com` | unavailable | `UPSTREAM_HTTP_404` | — | 1 |
| `nwd4iy9rd2s.jobs.feishu.cn` | unavailable | `UPSTREAM_HTTP_404` | — | 1 |
| `career.sustech.edu.cn` | unavailable | `UPSTREAM_HTTP_403` | — | 1 |
| `www.career.zju.edu.cn` | unavailable | `ROBOTS_RESPONSE_IS_MARKUP` | `text/html; charset=utf-8` | 5 |
| `join.qq.com` | unavailable | `REDIRECT_NOT_ALLOWED` → `/404.html` | — | 1 |
| `zhaopin.meituan.com` | unavailable | `REDIRECT_NOT_ALLOWED` → `https://zhaopin.meituan.com/web/social` | — | 1 |

5 个北森租户 robots 内容完全相同（`User-agent: *` + `Allow: /`，`sha256 eaeaa8d3511d…`）。
`jobs.bytedance.com` 逐路径列白名单并 `Disallow: /referral`，已登记路径不在其中，判定通过。
`join.fanruan.com` 只 `Disallow: /wp-admin/`。

## 2. 来源级判定

**7 通过 / 27 不通过**（`ROBOTS_UNAVAILABLE`）。

通过的 7 个：`adaps-photonics-internships`、`huice-campus-internships`、`pudutech-internships`、
`shining3d-internships`、`onerobotics-internships`、`bytedance-campus-manual`、
`fanruan-trainee-internships`。

不通过的 27 个按**根因**分解——三类性质完全不同，不应混为一谈：

| 根因 | 主机数 | 来源数 | 站点是否表达过拒绝 |
|---|---:|---:|---|
| robots.txt 返回 404（站点从未发布该文件） | 7 | 19 | **没有** |
| `/robots.txt` 回 HTML 页面（软 404） | 1 | 5 | **没有** |
| `/robots.txt` 跳转到 404 或社招页 | 2 | 2 | **没有** |
| robots.txt 返回 403（WAF 拦我们） | 1 | 1 | 不明确 |

也就是说 **27 个不通过里有 26 个的根因是「站点没有 robots.txt」，而不是「站点禁止」**。

## 3. 需要决定的一点：404 是否等于禁止

ADR-0033 的 fail-closed 规则是「取不到 robots 即视为禁止」，理由是「技术上取不到不等于站点允许」。
该理由对超时、DNS 失败、403 成立——那些情况我们**确实不知道**站点的意思。

但对 404 不成立，且实测代价很具体：

- 404 是一个**明确的 HTTP 答复**，不是取回失败。RFC 9309 §2.3.1.3 的指引正好相反：服务器回 404 时
  爬虫可以认为不存在限制。
- 不发布 robots.txt 是绝大多数网站的**默认状态**，尤其是高校就业网。把它读成「禁止」等于用文件的
  缺席做否定推断——与 ADR-0035 撤销「`unknown` 学历不计入可投」时用的是同一条理由。
- 数量上：19/34 来源（56%）因此永久不通过，其中包含全部高校线与百度、京东、飞书。

ADR-0033 的其余义务（署名、回链、只保留决策必需原句、删除通道、异议即停、周期复核）与本条无关，
不受影响。软 404 与跳转到 404 页的两类（6 个来源）在性质上与 404 相同。

本文件只记录实测与冲突，不代表规则已改。规则变更需 coco 决定并更新 ADR-0033。

## 4. 实现上被本次实测纠正的三处假否决

第一轮全量跑出 8 个 `UNEXPECTED_CONTENT_TYPE` 与 1 个 `UPSTREAM_HTTP_406`，全部是**我们自己**判得
过严造成的，不是站点行为：

1. `Accept: text/plain` 被 `talent.baidu.com` 回 406。改为 `text/plain, */*;q=0.8`。
2. 按 content-type 从严（RFC 9309 §2.3 要求 `text/plain`）会把 MIME 不规范的站点记成禁止。改为
   **按内容判定**：正文明显是 HTML/XML 文档才算没拿到 robots.txt，其余交给 `parseRobots`（空文件与
   无适用组按 RFC 本就等于不设限）。
3. content-type 检查发生在状态码检查之前，于是 404 被报成 `UNEXPECTED_CONTENT_TYPE`——**真实原因被
   掩盖**。这一处最值得记：第一轮的 8 个「MIME 不对」里有 6 个其实是 404。

修正后同一轮请求给出的是第 1 节那张表。
