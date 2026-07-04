# Android APK 壳 MVP

这是客服系统 Android APK 壳 MVP scaffold。第一包先提供 Android WebView shell 结构，不要求上架、不要求真实签名发布、不实现复杂原生推送。

## 定位

- 只负责打开已经部署好的客服系统。
- 不打包后端。
- 不部署服务器。
- 不执行 `install.sh`。
- 不接云厂商 API。
- 第一版使用 WebView。
- 后续可接原生通知、文件选择、下载管理和自动更新。

## 配置后台地址

默认地址只使用占位域名。修改入口位于：

`app/src/main/java/net/customerchat/app/AppConfig.kt`

生产环境应使用 HTTPS 地址，不要写入真实 token、cookie、secret 或生产数据。

## 当前未完成

- 真实 Gradle 构建验证。
- 签名。
- 安装包发布。
- 原生通知。
- 文件选择 / 下载增强。
- 自动更新。

## 安全边界

- 包名使用 `net.customerchat.app`，不包含个人姓名、邮箱或 handle。
- 只申请 `INTERNET` 权限。
- 不申请通讯录、定位、短信、相机或录音权限。
- WebView 不启用 JS bridge。
- WebView URL 只允许 http / https。
- 生产环境应使用 HTTPS。
