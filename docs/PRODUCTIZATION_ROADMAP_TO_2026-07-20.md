# 产品化路线图：2026-07-20 前首版闭环

## 目标

在 2026-07-20 前完成客服系统全模块首版闭环。后续不砍模块，但每个模块先按 MVP / 首版可运行 / 首版可演示推进，避免在单一模块上反复打磨导致整体产品化路线失衡。

## 模块范围

1. Cloudflare 线上版
2. 通用 Linux 云服务器版
3. Linux 一键部署脚本
4. Windows 部署向导 EXE
5. PWA
6. 客户端 EXE
7. Android APK
8. 服务端加密存储
9. 备份 / 恢复 / 升级
10. 最终封板文档

## 压缩排期

- 7/4：通用部署架构 + Linux 骨架
- 7/5-7/6：Docker Compose + Caddy + PostgreSQL + 本地文件存储
- 7/7-7/8：通用服务器后端适配层
- 7/9：install.sh 最小可运行版
- 7/10：healthcheck / backup / restore
- 7/11-7/12：Windows 部署向导 EXE MVP
- 7/13：PWA + 客户端 EXE 壳
- 7/14-7/15：Android APK 壳
- 7/16：服务端加密存储 MVP
- 7/17：升级 / 回滚 / 备份恢复联调
- 7/18：全链路测试
- 7/19：修 bug
- 7/20：封板

## 推进方式

后续不再做低价值反复审计；每轮采用大包推进：先完成一个可运行骨架，再统一做自检、审计、提交。高风险操作仍必须单独授权，包括真实部署、数据库写入、迁移、R2 删除、secret 变更、生产数据修改和初始化操作。

## 阶段完成标准

- Cloudflare 线上版：保持现有线上能力稳定，作为产品化基准实现。
- 通用 Linux 云服务器版：具备明确架构、部署目录、环境变量和服务编排草案。
- Linux 一键部署脚本：能执行环境检查、目录准备、容器启动和健康检查。
- Windows 部署向导 EXE：能连接服务器、上传部署包、执行脚本并展示日志。
- PWA / 客户端 EXE / Android APK：能作为已部署系统入口壳使用。
- 服务端加密存储：新消息加密链路具备 MVP 设计，旧数据迁移单独处理。
- 备份 / 恢复 / 升级：具备可演示的安全流程和回滚预案。
- 最终封板文档：记录部署形态、能力边界、未完成项和后续路线。

## v0.5 第一包状态

- Linux 部署骨架已推进到可执行最小闭环：compose 配置、镜像构建、服务启动、健康检查、备份、恢复和升级脚本均有首版实现。
- 新增 `server-generic` 隔离适配层，先提供健康检查、setup status 占位、静态文件服务和后续迁移接口骨架。
- Cloudflare 线上逻辑保持不变，通用服务器版后续继续补齐 PostgreSQL 数据访问、WebSocket 适配和业务 API。

## server-generic 业务迁移第一包状态

- 通用服务器版已从占位骨架推进到最小 setup + admin auth + session + PostgreSQL migration 闭环。
- PostgreSQL 首版 schema 覆盖 admin、admin session、setup 状态、会话、消息、附件和客户备注基础表。
- `server-generic` 已具备 setup status、setup initialize、admin login、admin logout、auth/me 和 healthz 基础 API。
- 密码使用 Node 标准库 crypto 的 scrypt + random salt；admin session 使用随机 token，并只在数据库保存 token hash。
- Linux install 默认不执行 migration，必须由部署人员显式设置 opt-in 开关后运行。
- 当前仍未迁移完整访客聊天 API、WebSocket 房间协议、read receipt、归档/回收站/清空历史写入、附件清理和生产数据迁移。

## server-generic 客服会话第一包状态

- 通用服务器版已具备基础客服业务闭环：访客创建会话、访客发送文本消息、管理员查看会话、管理员回复消息、管理员关闭会话。
- 访客 token 使用随机值，数据库仅保存 hash；admin chat API 复用 admin session 鉴权。
- WebSocket 当前提供按 session id 订阅和基础广播，不在消息中携带 token、cookie 或密码字段。
- healthcheck 仍保持只读健康检查，不创建真实会话。
- 后续继续补齐附件上传、read receipt、归档/回收站/清空历史、WebSocket 鉴权增强和数据迁移工具。

## server-generic 附件与 lifecycle 第一包状态

- 通用服务器版已具备本地文件 storage helper、附件上传/下载 MVP、附件元数据记录和安全文件名处理。
- lifecycle 已具备手动 archive、recycle、clear-history API，以及只读 dry-run runner。
- clear-history 先通过统一 helper 删除本地附件文件，失败时不写 history_cleared_at。
- Linux 部署脚本已强化 storage 备份、恢复前人工确认、附件配置说明和只读 healthcheck 边界。
- 后续仍需补齐 multipart 上传、更完整附件预览、自动 runner 调度接线、read receipt 和生产数据迁移工具。

## Windows 部署向导 EXE MVP scaffold 状态

- `deploy/windows-wizard` 已新增独立 CLI/Tauri-ready scaffold。
- 当前支持配置校验、脱敏部署计划生成、远程命令生成、日志脱敏、SSH/transfer mock 接口和 smoke。
- CLI 支持 `--smoke` 与 `--plan <config.json>`。
- 当前不包含真实 GUI、EXE 打包、真实 SSH 上传执行和云厂商 API。

## PWA 与桌面客户端 EXE 壳 MVP 状态

- PWA 已具备 manifest、service worker、offline page、SVG 图标和生产环境注册入口。
- service worker 只缓存基础静态资源，明确不缓存 `/api/*`、非 GET 请求或 WebSocket。
- `deploy/desktop-client` 已新增独立 CLI/Tauri-ready scaffold。
- 桌面客户端支持配置校验、启动计划生成、敏感 URL 参数脱敏、mock launcher 和 smoke。
- 当前不包含真正 EXE 打包、Tauri/Electron GUI、系统托盘、原生通知和自动更新。

## Android APK 壳 MVP 状态

- `deploy/android-shell` 已新增独立 Gradle / Kotlin / WebView scaffold。
- Android package / App ID 为 `net.customerchat.app`，不包含个人姓名、邮箱、handle、项目成员标识或生产域名。
- 当前只声明 `INTERNET` 权限，不申请通讯录、定位、相机、录音、短信或存储权限。
- WebView 首版只作为已部署系统入口，默认使用占位 HTTPS URL，发布前由部署人员替换为实际后台地址。
- 当前安全边界包括 URL scheme 白名单、禁用 file/content access、不注入 JavaScript bridge、敏感查询参数日志脱敏和生产 cleartext 默认禁用。
- 当前不包含真实 APK 签名、应用商店分发、原生通知、文件选择器、下载管理和自动更新。

## 服务端加密存储 MVP 状态

- `server-generic` 已新增 AES-256-GCM 加密基础能力，使用 Node 标准库 crypto。
- `ENCRYPTION_ENABLED=1` 时，新消息正文写入密文字段，新附件展示文件名写入加密元数据字段。
- 读取路径优先解密密文字段，旧明文字段仍兼容读取；本轮不迁移旧数据。
- 当前不加密附件内容本体，附件内容加密、旧数据迁移和密钥轮换属于后续增强。
- `ENCRYPTION_KEY` 从服务器环境变量读取，不能写入 git、文档、日志、前端代码或构建产物；丢失 key 会影响已加密数据解密。
- 备份恢复必须同时保护数据库、storage 目录和密钥管理记录；数据库全文搜索能力会受加密影响。

## Linux 实机部署闭环强化状态

- `deploy/linux` 已从骨架可执行推进到接近真实 VPS 可运行的最小闭环：compose healthcheck、Caddy 反代、install self-check、显式 migration、只读 healthcheck、backup/restore/upgrade 安全边界均已强化。
- 当前验收口径是脚本逻辑强化、静态审计、Node 检查和 server-generic smoke；真实 Linux VPS 部署验证留到后续远程服务器环境执行。
- Windows 部署向导后续应复用这套脚本，不直接在向导内复制部署逻辑。

## Windows 部署向导真实 SSH MVP 状态

- `deploy/windows-wizard` 已新增真实 SSH / SFTP adapter MVP，同时保留 mock / dry-run 模式。
- 默认不真实部署；必须显式 `--real` 且计划文件 `mode=real`、`dryRun=false` 才允许连接服务器。
- 当前支持上传 `deploy/linux`、远程执行 `install.sh --self-check`、`install.sh --dry-run`、`install.sh` 和 opt-in `install.sh --migrate`。
- 当前不自动写远程真实 `.env`，不保存真实密码/私钥/secret，不自动 setup initialize。
- 真实 VPS 验证仍需后续单独执行。
