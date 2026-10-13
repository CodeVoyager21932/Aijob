# 中文 PDF 与解析运行检查

使用合成中文材料，未使用真实简历。Windows 测试使用本机黑体，不随运行包分发；Linux 镜像使用 Debian Noto CJK，提取简体中文 OTF。

初次视觉检查发现 `keep_sections` 对超过一页的章节仍强制保持整体，造成首页只有标题。已增加排版后的章节高度检查：仅超过可用 A4 高度的章节允许跨页；浏览器打印和后台 PDF 复用相同处理。未改写用户正文或历史布局修订。

修复后的 [合成 PDF](materials-chinese-fixture.pdf) 共 3 页，已逐页渲染、检查：中文无缺字、正文不断行溢出、页边距清楚，首尾段落完整。文本提取测试通过；输入中的 HTML 字符串按正文显示，不执行、不访问外网。

- [第 1 页](screenshots/pdf-corrected-first.png)
- [第 2 页](screenshots/pdf-corrected-2.png)
- [第 3 页](screenshots/pdf-corrected-3.png)
- [Linux Noto 字体第 1 页](screenshots/linux-pdf-first.png)
- [Linux Noto 字体第 2 页](screenshots/linux-pdf-2.png)
- [Linux Noto 字体第 3 页](screenshots/linux-pdf-3.png)

旧 `pdf-page-*.png` 是修复前的证据，不能当作当前输出。Linux 实际镜像中保持 Chromium sandbox 开启、非 root、只读根目录、移除宿主 capabilities；调整 seccomp 允许子命名空间需要的 `chroot` 后，中文 PDF 渲染和文本解析通过。独立解析容器另以固定 digest、无网络、资源限制完成检查，见 [parser-container-smoke.json](parser-container-smoke.json)。

这些检查不代表生产服务器已经配置；生产仍需以实际服务账号验证字体、浏览器 sandbox 和 rootless 解析器。
