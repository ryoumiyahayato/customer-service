# 产品化文档索引

当前 Cloudflare Worker 版是生产基准；`server-generic` 是正在补齐一致性的自托管预览后端。目录或 scaffold 存在不代表产品能力已经完成，实际状态以自动化验收和下列文档为准。

## 当前权威文档

- [v1 生命周期与双后端一致性 ADR](./ADR-001-session-lifecycle-and-backend-parity.md)
- [v1 整改状态](./V1_REMEDIATION_STATUS.md)
- [产品化路线图](./PRODUCTIZATION_ROADMAP_TO_2026-07-20.md)
- [通用服务器部署架构](./SERVER_DEPLOYMENT_ARCHITECTURE_v0.4.md)
- [Windows 部署向导边界](./WINDOWS_DEPLOY_WIZARD_v0.6.md)
- [客户端与 PWA 边界](./CLIENTS_AND_PWA_v0.7.md)
- [服务端加密存储](./SERVER_SIDE_ENCRYPTION_v0.8.md)
- [产品化最终审计](./PRODUCTIZATION_FINAL_AUDIT.md)

`PROJECT_STATUS_v0.1.md` 仅是历史快照，不再作为状态机或发布验收依据。

## 架构基线

### Cloudflare 生产路径

- React + Vite 前端。
- Cloudflare Worker API。
- D1 数据库。
- R2 附件对象。
- Durable Objects + WebSocket。
- Scheduled Trigger 生命周期任务。

已经完成的高风险修复包括：

- SQLite 时间比较统一使用 `datetime()`。
- purge 先原子认领资格，再执行 R2、附件和消息清理，并支持重试。
- 禁用客服撤销会话并解除当前分配，不删除客户会话或历史主体。
- 物理删除客服默认拒绝。
- 图片附件按会话、上传者和未绑定状态认领。
- 图片消息相同 `clientMessageId` 重试保持幂等。

Cloudflare deploy、远程 D1 migration、R2 删除和生产 lifecycle 仍必须单独授权。

### server-generic 自托管预览路径

当前具备：

- Node.js + PostgreSQL。
- setup、管理员认证和 visitor token hash。
- 持久邀请表，数据库只保存 token hash。
- 邀请创建人、来源客服、有效期、撤销、单次消费和原浏览器恢复。
- PostgreSQL 事务与 `FOR UPDATE` 保护并发邀请消费。
- 访客文本消息和管理员回复。
- 发送者维度 `clientMessageId` 幂等。
- `(created_at, id)` 稳定消息排序。
- 基础 read receipt。
- WebSocket 升级鉴权、URL 固定房间、心跳和载荷上限。
- 本地 Docker Compose PostgreSQL migration 与 E2E。
- 新消息正文和附件展示文件名 AES-256-GCM 加密基础。

当前仍缺少：

- 与现有前端完整兼容的图片上传、显示和下载。
- 自动 lifecycle write runner 与完整归档、回收、恢复、purge 对齐。
- 高风险管理操作审计日志。
- 完整客服分配和私有会话权限模型。
- PostgreSQL、storage 与 encryption key 联合备份恢复故障测试。
- 真实 VPS、Caddy HTTPS 和资源限制验收。

因此 `server-generic` 仍不得宣传为 Cloudflare 生产版的完整替代。

## 会话生命周期

唯一状态模型：

| Bucket | 数据语义 | UI |
|---|---|---|
| `active` | `PENDING` / `OPEN`，未归档、未删除、未清理 | 进行中 |
| `archived` | `status='ARCHIVED'`，有 `closed_at`、`archived_at` | 已归档 |
| `trash` | `deleted_at IS NOT NULL`，内容尚可恢复 | 回收站 |
| `purged` | 消息和附件已实际完成清理，只保留最小审计壳 | 不显示 |

`CLOSED` 只作为旧数据兼容状态，不再作为新写入状态。

核心规则：

1. `active -> archived` 写入 `ARCHIVED`、`closed_at` 和 `archived_at`。
2. `archived -> trash` 只写入删除标记，不立即删除内容。
3. `trash -> archived` 清除删除标记，保留归档时间，不恢复为进行中。
4. `trash -> purged` 必须先认领资格，再清理文件、附件元数据和消息；任一步失败都保持可重试，不能报告完全成功。
5. 已 purged 会话不能恢复、发送消息、上传或下载附件。

## 部署资产

Linux：

- `deploy/linux/docker-compose.yml`
- `deploy/linux/docker-compose.local.yml`
- `deploy/linux/Caddyfile`
- `deploy/linux/install.sh`
- `deploy/linux/healthcheck.sh`
- `deploy/linux/preflight.sh`
- `deploy/linux/backup.sh`
- `deploy/linux/restore.sh`
- `deploy/linux/upgrade.sh`
- `deploy/linux/VPS_ACCEPTANCE.md`

自托管服务：

- `server-generic/src/`
- `server-generic/migrations/`
- `server-generic/scripts/e2e-local-smoke.mjs`

客户端与包装层：

- `deploy/windows-wizard/`
- `deploy/desktop-client/`
- `deploy/android-shell/`
- PWA manifest、service worker 和 offline page

## 包装层当前边界

- Windows 部署向导：CLI/Tauri-ready scaffold，有 mock、dry-run 和显式 real SSH adapter；未完成正式 GUI/EXE。
- PWA：有安装与离线基础，不缓存 API、WebSocket 或敏感查询；未完成推送和完整浏览器矩阵。
- 桌面客户端：启动壳和 package check；未完成正式安装包、托盘、通知和更新。
- Android：Gradle/Kotlin/WebView scaffold；未完成签名、附件选择、下载和实机发布验收。

## CI 验证

`.github/workflows/productization-validation.yml` 当前覆盖：

- root 依赖、typecheck、doctor、build。
- 管理端消息竞态、生命周期、高风险业务闭环和 obvious checks。
- `server-generic` typecheck、build、smoke。
- Linux shell 语法和 Docker Compose 静态配置。
- Windows 向导 dry-run。
- 桌面客户端 package check。
- Android shell 静态检查。
- 临时 PostgreSQL migration、本地 app 启动、healthz 和 self-host E2E。

这些检查不等同于真实 Cloudflare、真实 VPS、生产 migration、生产 purge、正式 EXE 或 APK 验收。

## 高风险操作边界

普通审计和代码 PR 不执行：

- Cloudflare deploy。
- 远程 D1/PostgreSQL migration。
- R2 或生产 storage 删除。
- 生产 lifecycle、purge 或 restore。
- Secret、Cookie、Token 或 encryption key 修改。
- SSH/VPS 操作。
- 真实 setup initialize。
- 正式 EXE/APK 签名和发布。

以上操作必须有备份、维护窗口和单独授权。
