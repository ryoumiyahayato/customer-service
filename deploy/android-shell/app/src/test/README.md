# Android shell 检查清单

本目录记录 Android APK 壳 MVP 后续人工 / 自动检查项。

- 包名 / App ID：确认使用 `net.customerchat.app`，不包含个人姓名、邮箱或 handle。
- 权限：只申请 `INTERNET`，不申请通讯录、定位、短信、相机、录音等无关权限。
- URL scheme：只允许 http / https，阻止 javascript / file / data。
- 敏感信息：不包含真实 secret、token、cookie、password、生产服务器地址或生产数据。
- WebView：不启用 JS bridge，不扩大攻击面。
- 日志：URL 输出必须经过脱敏，不输出完整敏感 URL。
- 网络：生产环境使用 HTTPS；localhost 明文仅用于开发占位。
- 发布：真实签名、Gradle 构建验证、上架检查后续单独完成。
