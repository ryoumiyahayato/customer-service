# 客服系统 v1.0 整改状态

更新时间：2026-07-10

## 结论

Cloudflare Worker 继续作为当前生产基准。`server-generic` 已从“任意 token 的文本聊天占位层”推进到具备持久邀请、单次消费、消息幂等和基础已读回执的预览后端，但仍未达到生产替代标准。

生命周期与双后端语义以 `ADR-001-session-lifecycle-and-backend-parity.md` 为准。旧 v0.1 状态快照已标记为历史资料。

## 已完成

### Cloudflare 主线

- 生命周期时间比较统一使用 SQLite `datetime()`。
- 回收站清理先认领会话，再执行 R2、附件和消息清理，并支持失败重试。
- 禁用客服会撤销管理员会话并解除当前分配，不删除客户会话和历史主体。
- 客服物理删除默认拒绝。
- 图片消息按上传者、会话和附件状态进行认领。
- 相同 `clientMessageId` 的图片消息重试保持幂等。
- 自托管 WebSocket 在升级阶段鉴权并固定绑定房间。

### 本次架构调整

- 新增生命周期与双后端一致性 ADR。
- 将旧项目状态文档改为历史文档，移除本地路径和具体环境状态。
- 新增 PostgreSQL `invite_links` 持久邀请表。
- 邀请数据库只保存 token hash。
- 邀请支持创建人、来源客服、有效期、撤销、单次消费和消费会话。
- 邀请消费使用 PostgreSQL 事务和 `FOR UPDATE`，防止并发重复消费。
- 已消费邀请只允许持有原 visitor token 的浏览器恢复。
- 新增消息 `client_message_id` 和发送者维度唯一索引。
- 文本消息重试返回原消息，不重复广播；相同 ID 不同正文返回冲突。
- 消息列表稳定按 `(created_at, id)` 排序。
- 会话已关闭、归档、删除、清理后拒绝继续发送文本。
- 管理员和访客读取消息时写入 read receipt，并广播同一组 message IDs。
- 本地 Docker E2E 增加邀请单次消费、原浏览器恢复、撤销、消息幂等和 read receipt 验证。

## 当前 server-generic 能力

| 能力 | 状态 |
|---|---|
| setup / admin auth | 已具备 |
| 持久邀请 | 已具备首版 |
| 邀请并发单次消费 | 已具备首版 |
| 访客文本聊天 | 已具备 |
| 管理员文本回复 | 已具备 |
| clientMessageId 幂等 | 已具备首版 |
| WebSocket 升级鉴权 | 已具备 |
| 基础 read receipt | 已具备首版 |
| 图片上传与当前前端展示 | 未完成 |
| 自动 lifecycle write runner | 未完成 |
| 完整归档/回收/恢复/purge 对齐 | 未完成 |
| 管理操作审计日志 | 未完成 |
| 完整客服分配权限模型 | 未完成 |
| PostgreSQL + storage + key 恢复故障测试 | 未完成 |
| 真实 VPS 验收 | 未执行 |

## 发布阻断项

在以下项目完成前，`server-generic` 必须继续显示“测试/预览”，不得宣传为 Cloudflare 生产版的完整替代：

1. 前端兼容的 multipart 图片上传、显示、下载和权限检查。
2. 自动 lifecycle runner，以及归档、回收、恢复、purge 的完整状态机行为测试。
3. 高风险管理写操作审计日志。
4. 客服分配、私有会话和越权测试。
5. PostgreSQL、storage 和 encryption key 的备份恢复联合验收。
6. 真实 Ubuntu VPS、Caddy HTTPS 和资源限制验收。
7. 真实并发、失败注入和重试测试。

## 客户端边界

- Windows 部署向导仍是 CLI/Tauri-ready scaffold，不是正式 GUI EXE。
- 桌面客户端仍是启动壳，不是正式安装客户端。
- Android 仍是 WebView scaffold，未完成签名、附件选择、下载和实机发布验收。
- PWA 已具备基础安装与离线页，但没有推送通知和完整浏览器矩阵验收。

## 运维边界

本次整改不执行 Cloudflare deploy、远程 D1 migration、R2 删除、生产 lifecycle、Secret 修改、SSH/VPS、真实 setup initialize 或生产 restore。迁移仅由 CI 在临时 PostgreSQL 容器中验证。
