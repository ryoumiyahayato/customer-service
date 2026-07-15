# Android shell 检查清单

本目录记录 Android APK 壳 MVP 后续人工 / 自动检查项。

- 包名 / App ID：确认使用 `net.customerchat.app`，不包含个人姓名、邮箱或 handle。
- 权限：只申请 `INTERNET`，不申请通讯录、定位、短信、相机、录音等无关权限。
- URL policy：仅允许配置的 HTTPS 业务域名，HTTP 仅限本地开发地址，并阻止凭据、敏感查询参数和 fragment。
- 敏感信息：不包含真实 secret、token、cookie、password、SETUP_TOKEN、SESSION_SECRET、ENCRYPTION_KEY、生产服务器地址或生产数据。
- WebView：不启用 JS bridge，不扩大攻击面。
- 日志：URL 输出必须经过脱敏，不输出完整敏感 URL，不输出查询参数中的 token / session / cookie / password / secret / key。
- 网络：生产环境使用 HTTPS；localhost 和 `10.0.2.2` 明文仅用于开发占位。
- 构建：有 Android SDK 和 Gradle 时执行 `gradle tasks` 与 `gradle assembleDebug`；缺少环境时明确报告未执行。
- 签名：release keystore 和签名密码只能放在本机安全位置或 CI secret，不写入 git。
- 加载失败：只显示低信息量 Toast，不输出敏感 URL。
- 发布：真实签名、实机安装、上架检查后续单独完成。
