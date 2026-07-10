# 产品化路线图：v1.0 首版闭环

## 目标

在保持 Cloudflare 生产基准稳定的前提下，完成统一状态机、自托管核心业务一致性、部署恢复验证和客户端能力边界说明。

本路线不再以“目录或 scaffold 已存在”作为完成标准。模块必须具备明确安全边界、自动化验证和可重复验收，才能标记完成。

状态机唯一决策见：

- `docs/ADR-001-session-lifecycle-and-backend-parity.md`
- `docs/V1_REMEDIATION_STATUS.md`

## 模块范围

1. Cloudflare 线上版
2. 通用 Linux 自托管版
3. Linux 部署、健康检查、备份、恢复和升级
4. Windows 部署向导
5. PWA
6. 桌面客户端
7. Android 壳
8. 服务端加密存储
9. 自动化测试和发布验收
10. 最终封板文档

## 当前优先级

### P0：业务与数据一致性

- 保持 Cloudflare 生命周期、客服禁用和附件绑定修复稳定。
- 统一 `active -> archived -> trash -> purged` 状态机。
- 自托管邀请必须持久化、哈希保存、过期、可撤销、单次消费。
- 文本消息必须支持发送者维度 `clientMessageId` 幂等。
- WebSocket 必须在升级阶段鉴权并绑定固定房间。
- 已读更新和广播必须使用相同消息 ID 集合。

### P1：自托管生产缺口

- 完成 multipart 图片上传、显示、下载和权限验证。
- 完成自托管归档、回收、恢复、purge 和自动 lifecycle runner。
- 增加高风险管理写操作审计日志。
- 完成客服分配和私有会话权限模型。
- 完成 PostgreSQL、storage 和 encryption key 联合备份恢复测试。

### P2：包装层与发布

- Windows 部署向导 GUI/EXE。
- 桌面客户端安装包、托盘和更新策略。
- Android 签名、文件选择、下载和实机验证。
- PWA 浏览器矩阵和更新缓存验收。

## 当前状态

### Cloudflare 生产基准

已具备核心聊天、D1、R2、Durable Objects WebSocket、管理员、邀请和 Scheduled Trigger。已修复：

- 生命周期时间格式比较。
- 回收站清理资格认领和真实数据清理。
- 客服禁用导致会话误删问题。
- 图片附件按上传者原子认领。
- 图片消息幂等重试。

Cloudflare 远程 migration、deploy、生产 purge 和 R2 操作仍必须单独授权。

### server-generic 预览后端

已具备：

- Node + PostgreSQL。
- setup、管理员认证和 visitor token hash。
- 持久邀请表、token hash、过期、撤销和单次消费。
- PostgreSQL 行锁保护并发邀请消费。
- 访客文本、管理员回复和 `clientMessageId` 幂等。
- `(created_at, id)` 稳定消息排序。
- 基础 read receipt。
- WebSocket 升级鉴权、固定房间、心跳和载荷上限。
- 本地 Docker Compose E2E。

仍缺少图片前端闭环、完整 lifecycle write runner、审计日志、完整客服权限和备份恢复故障注入，因此继续标记为测试/预览，不是生产替代方案。

### Linux 部署

已有 Docker Compose、Caddy、PostgreSQL、安装、健康检查、备份、恢复、升级和只读 preflight。CI 会在临时环境执行本地 PostgreSQL migration 和 E2E。

尚未执行真实 VPS、真实 Caddy HTTPS、资源限制和生产恢复演练。

### Windows / PWA / 桌面 / Android

- Windows 部署向导：CLI/Tauri-ready scaffold，有 mock、dry-run 和显式 real SSH adapter；未完成正式 GUI/EXE。
- PWA：有 manifest、service worker、offline page 和敏感请求排除；未完成推送和完整浏览器验收。
- 桌面客户端：CLI/Tauri-ready 启动壳；未完成正式安装包、托盘、通知和自动更新。
- Android：Gradle/Kotlin/WebView scaffold；未完成签名、附件选择、下载和实机发布验收。

### 加密存储

`server-generic` 支持新消息正文和附件展示文件名 AES-256-GCM 加密。旧数据迁移、附件本体加密和密钥轮换尚未完成。备份必须同时保护数据库、storage 和密钥恢复说明。

## 完成标准

### Cloudflare

- 生产路径 CI 全绿。
- 状态机行为测试覆盖边界、幂等和部分失败。
- 远程 migration/deploy 在备份和维护窗口中单独授权。

### server-generic

只有以下条件全部满足后，才允许评估生产级别：

- 邀请、WebSocket、消息、附件、read receipt、状态机和权限与 Cloudflare 核心语义一致。
- 自动 lifecycle runner 可重试且只输出聚合日志。
- Docker E2E 覆盖并发邀请、幂等消息、越权、关闭后写入失败和真实 purge。
- 备份恢复同时覆盖 PostgreSQL、storage 和 encryption key。
- 真实 Ubuntu VPS 和 HTTPS 验收通过。

### 客户端

只有生成正式安装包、完成签名、更新策略和目标设备验收后，才可称为正式客户端。scaffold 或 CLI 不等于已发布产品。

## 推进方式

每轮只围绕一个可验证闭环推进，但跨文件架构调整可以使用独立大 PR。所有 PR 必须说明：

- 修改的业务不变量。
- 新增迁移和回滚边界。
- 自动化与人工验收结果。
- 未完成能力。
- 是否执行过远程或生产操作。

## 高风险操作

以下操作必须单独授权，不与普通代码审计同时执行：

- Cloudflare deploy。
- 远程 D1/PostgreSQL migration。
- R2 或生产 storage 删除。
- 生产 lifecycle/purge/restore。
- Secret 或 encryption key 修改。
- SSH/VPS 变更。
- 真实 setup initialize。
- 正式 EXE/APK 签名和发布。
