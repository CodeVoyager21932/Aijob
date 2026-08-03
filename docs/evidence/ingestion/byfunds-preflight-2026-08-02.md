# 宝盈来源首批只读核验

核验日期：2026-08-02（Asia/Shanghai）

## 结果

- 来源：`byfunds-internships`
- 页面：`https://career.nankai.edu.cn/correcruit/content/id/116244.html`
- 请求：1 次匿名 HTTPS GET；未使用登录、Cookie、CSRF、验证码、代理或动态签名。
- 主体与申请链：页面主体和 `zhaopin@byfunds.com` 均指向宝盈基金，申请域名闭环通过。
- 结构：页面为校园招聘宣传页，现有高校详情适配器未识别明确的实习栏目、职责段和任职要求段。
- 结果：`0` 条岗位导入，错误码 `UNIVERSITY_EMPLOYMENT_NOT_INTERNSHIP_SECTION`。

按 fail-closed 规则，来源政策升级为 v2 `paused`，关闭本地探测和自动刷新。该来源不拆分宣传页文本，不影响其他来源继续执行；如后续出现逐岗详情或可验证官方 ATS，再重新评估。
