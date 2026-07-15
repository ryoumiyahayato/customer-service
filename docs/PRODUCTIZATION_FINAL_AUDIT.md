# 产品化与安全复审

复审日期：2026-07-15

审计基线：`cd759ec8fca2f172d818108803f1f33ad4915f53` 加当前工作区修复

审计方式：按用户要求由主任务直接完成，未使用 subagent；未连接或修改任何生产环境。

## 结论

本轮已修复最初确认的 5 类漏洞，并在修复后复审中继续修复对象级授权遗漏、初始化竞态、并发限流绕过、GET 已读状态 CSRF、无长度上传体内存消耗、备份伪造/恶意归档、恢复失败一致性、SSH 主机冒充、秘密日志泄漏、客户端危险 URL/WebView 边界及依赖锁定问题。

在本机可静态验证和可执行的路径中，未发现仍未处理的已确认高危或中危直接利用漏洞。`server-generic` 仍是实验性后端，存在下文列出的跨实例限流、跨资源事务一致性和未完成加密能力，不能据此声明已经完成公开生产验收。

## 本轮已完成的安全修复

1. `server-generic` 管理员会话、消息、附件、关闭、归档、回收、清历史和 WebSocket 全部执行对象级授权；普通客服只能访问分配给自己的会话，超级管理员保留全局权限；兼容旧 `admin` 角色。
2. 普通客服创建、查看和撤销邀请时受创建人/来源客服范围约束，不能借邀请给其他客服分配会话。
3. Cloudflare 和 PostgreSQL 首次管理员初始化均串行化，阻止并发创建多个初始超级管理员。
4. Cloudflare 的三层 D1 限流从“先读后写”改为条件更新，阻止并发请求同时越过阈值；匿名 generic 会话创建纳入 bootstrap 限流。
5. Cookie 鉴权 API 与 WebSocket 增加同源校验；读取消息产生的已读写操作也受保护；无 Origin/Referer 的公网 WebSocket 默认拒绝。
6. 非上传 API 和上传 API 均对实际请求流进行上限检查，不再信任可省略或伪造的 `Content-Length`；审计分类只在上限检查后启动。
7. Worker 与 generic 服务增加 HSTS、nosniff、禁止 framing、Referrer/Permissions Policy 和 CSP；Caddy 同步设置传输与浏览器安全头。
8. Worker token 必须是严格两段格式并使用常量时间签名比较。
9. Windows 真实 SSH/SFTP 必须配置并校验 OpenSSH `SHA256:` 主机指纹；错误或缺失指纹均拒绝连接。
10. SSH 输出改为完整缓冲后一次脱敏，避免秘密跨数据块被拆分后泄漏；补充 `BACKUP_SIGNING_KEY` 脱敏。
11. Linux 安装的 Compose 校验使用 `--quiet`，不再把解析后的秘密环境值打印到日志。
12. 备份拒绝符号链接和特殊文件，使用独立 `BACKUP_SIGNING_KEY` 对校验清单做 HMAC；恢复先验证 HMAC、精确清单、校验和、归档路径和文件类型。
13. 恢复在停止 app 前完成验证和预解压；恢复前创建 PostgreSQL 快照，数据库恢复使用单事务；后续失败会回滚数据库和 storage，回滚失败则保持 app 停止。
14. 升级失败自动恢复旧 app 镜像；拉取 PostgreSQL/Caddy 失败不再静默继续。
15. 桌面配置拒绝公网 HTTP、URL 用户名/密码、fragment 和敏感查询，日志会脱敏嵌入 URL。
16. Android WebView 只允许配置的业务域名，生产版禁用明文、混合内容、文件/内容访问、多窗口和非调试 WebView 调试；HTTP 仅在 debug 资源中允许本地开发地址。
17. 不支持的客服物理删除从 UI 移除且后端继续拒绝；客服禁用操作会等待列表刷新完成。
18. 根项目新增并提交 npm lockfile，CI 固定使用 `npm ci` 并执行依赖审计。

## 已实现功能

### Cloudflare 主线

- React/Vite SPA、D1、R2、Durable Objects/WebSocket 和 Wrangler dry-run/deploy 基础。
- 首次 setup、管理员登录/注销/会话、超级管理员与客服账号创建/禁用。
- 访客邀请、游客/注册访客入口、会话分配、关闭、归档、删除/恢复及生命周期任务。
- 文本和 JPG/PNG/WebP 图片消息、5 MB 上传、附件权限、消息幂等、已读回执、撤回和图片清理。
- 客服内部聊天、会话实时事件、定时生命周期、审计日志和应用层限流。

### `server-generic` 自托管预览

- PostgreSQL migrations、setup、管理员 session、持久邀请、一次性消费和同浏览器恢复。
- 访客/管理员文本消息、`clientMessageId` 幂等、稳定排序、基础 read receipt。
- 按分配客服隔离的会话、消息、附件、生命周期和 WebSocket 对象授权。
- 本地附件底层 API、AES-256-GCM 消息正文与附件展示文件名加密、静态文件服务。
- HTTP/WebSocket 同源保护、安全响应头、实验性公网启动确认和基础 abuse guard。

### 部署与客户端骨架

- Docker Compose、PostgreSQL、Caddy HTTPS、安装/健康检查、HMAC 备份、受控恢复和 app 镜像回滚升级脚本。
- Windows 部署 CLI 的 mock/dry-run 与显式 real SSH/SFTP 流程，含主机指纹固定和秘密脱敏。
- PWA manifest、service worker、离线页及敏感/API/WS 不缓存策略。
- 桌面客户端配置、URL 校验、脱敏、启动计划和 package check 骨架。
- Android Kotlin/WebView 壳、admin/visitor 启动模式和生产/调试网络边界。

## 仍存在的相关 Bug 与安全缺口

1. **P2，`server-generic` 多实例限流**：当前 abuse guard 保存在单个 Node 进程内；横向扩容或多进程会形成独立计数器。公开部署前应迁移到 PostgreSQL/Redis 等共享原子限流，并在入口配置 WAF/CDN。
2. **P2，generic 清历史跨资源一致性**：附件文件先删除，随后 PostgreSQL 事务删除元数据；数据库事务失败时消息可能暂时保留而文件已经不存在。重试可以完成清理，但尚未实现 filesystem quarantine/outbox。
3. **P2，升级回滚不是全栈事务**：`upgrade.sh` 自动回滚 app 镜像，但 PostgreSQL migration、PostgreSQL/Caddy 新镜像和配置变更仍需经过备份、down migration 或人工 runbook 回滚。
4. **P3，静态加密范围未完整**：自托管版附件内容本体仍是明文文件；旧明文消息迁移、密钥轮换和 KMS 接入尚未实现。
5. **P3，基础设施防护未验证**：WAF/Bot/DDoS、DNS、证书续期、磁盘/内存压力和日志告警属于外部部署状态，本仓库无法单独证明已启用。

## 完整未完成内容清单

### `server-generic`

- 前端兼容的 multipart 图片上传、显示和下载闭环；当前兼容层 `POST /api/upload` 明确返回 unsupported。
- 自动 lifecycle runner 的调度接线、聚合告警、失败注入和完整 archive/trash/restore/purge 状态机验收。
- 高风险管理操作审计日志与 Cloudflare 主线等价。
- 完整客服分配/转接 API、私有会话策略及管理 UI 对齐；当前已完成对象隔离，但没有完整业务操作面。
- 消息分页、delivery acknowledgement、离线补偿和大历史性能验收。
- 共享/持久限流、上游 WAF/DDoS 接入及真实并发压测。
- 文件与数据库清理的 outbox/quarantine 一致性机制。
- 旧明文数据迁移、附件本体加密、密钥轮换和 KMS。
- PostgreSQL、storage、密钥丢失/错误、磁盘满、进程中断等真实故障恢复演练。
- 真实 Ubuntu VPS、Caddy HTTPS、资源限制、备份保留和公开生产验收；在此之前继续保留实验性启动门槛。

### 部署工具

- `upgrade.sh` 的数据库 migration、PostgreSQL/Caddy 镜像和配置全栈自动回滚。
- Windows 部署向导正式 GUI/EXE、安装包签名、图形日志/错误恢复、云厂商 API 集成和真实 VPS E2E。
- 自动创建/核验云资源、DNS、Cloudflare D1/R2/routes/secrets 的受控流程；当前安全部署脚本不会创建这些资源。

### 客户端与发布

- 桌面 Tauri/Electron GUI、真正连接业务站点的窗口、托盘、原生通知、签名安装包和自动更新。
- Android Gradle wrapper/CI assemble、签名 APK、实机安装、附件选择、下载管理、原生通知、自动更新和商店发布。
- PWA 推送通知、完整浏览器/设备矩阵、安装/升级/离线/重连验收。
- 客户端统一的附件选择、下载和原生通知体验。

### Cloudflare 与发布门槛

- 真实 Cloudflare Worker/D1/R2/DO 部署、迁移、WebSocket 代理、附件清理和生命周期写入 E2E。
- Visitor/Core Worker 拆分方案中的真实 WebSocket proxy 验证；当前仍使用单一部署 Worker。
- GitHub Actions 远端绿灯确认、正式签名产物、发布说明、版本 tag 和上线后监控。

## 本地验证结果

- 根项目：`npm ci`、`typecheck`、obvious/admin-race/business-closure/lifecycle/deployment security checks、Vite build、Wrangler dry-run、doctor 和 npm audit 通过。
- `server-generic`：typecheck/build/smoke、abuse guard、对象授权、HTTP/WS 安全和 npm audit 通过。
- Windows wizard、desktop client：typecheck、smoke 和 npm audit 通过。
- Android：静态安全回归通过。
- `git diff --check` 通过。

本机没有 Docker、Bash/WSL、Gradle/Android SDK，也没有连接 Cloudflare、D1、R2、SSH 或 VPS。因此未执行 Linux shell/容器实跑、Android 编译、真实迁移/恢复、生产 WebSocket、APK/EXE 打包或远端部署；这些是验证边界，不应被描述为已经通过。
