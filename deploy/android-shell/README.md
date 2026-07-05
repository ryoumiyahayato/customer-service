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

## 构建前检查

如果当前机器具备 Android SDK 和 Gradle，可在本目录运行：

```powershell
gradle tasks
gradle assembleDebug
```

如果后续引入 Gradle wrapper，可改为：

```powershell
.\gradlew tasks
.\gradlew assembleDebug
```

当前仓库不提交 Gradle wrapper 二进制。本机没有 Android SDK、Gradle 或 wrapper 时，不应声称 APK 构建通过；只报告未执行原因，并把真实 APK 构建留给 Android Studio、CI 或实机环境。

## release signing 占位

- release keystore、alias、store password 和 key password 只能放在本机安全位置或 CI secret。
- 不要把签名文件、签名密码、真实域名、token、cookie、password、secret、SETUP_TOKEN、SESSION_SECRET、ENCRYPTION_KEY 写入 git。
- 发布前应单独执行签名、安装、启动、WebView 加载和回退键检查。

## 当前未完成

- 当前环境未必具备真实 Gradle / Android SDK 构建验证。
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
- `network_security_config` 默认禁止明文流量，只为 localhost 和 `10.0.2.2` 开发占位保留例外。
- 不保存 secret，不把 token / cookie 写入日志或持久化存储。
