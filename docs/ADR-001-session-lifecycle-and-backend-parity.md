# ADR-001：会话生命周期与双后端一致性

状态：Accepted  
日期：2026-07-10

## 背景

项目同时维护 Cloudflare Worker 生产路径和 `server-generic` 自托管适配路径。历史文档、Cloudflare 旧函数、自托管 lifecycle 骨架和前端分组曾使用不同的状态语义，导致 `CLOSED`、`ARCHIVED`、回收站和清空历史之间存在重叠。

本 ADR 冻结 v1.0 首版状态模型，并作为后续代码、迁移、UI、测试和部署文档的唯一验收依据。

## 决策

采用四个 bucket，其中前三个对用户可见，第四个仅保留最小审计壳：

| Bucket | 数据语义 | 允许写消息 | UI |
|---|---|---:|---|
| `active` | `PENDING` / `OPEN`，未归档、未删除、未清理 | 是 | 进行中 |
| `archived` | `status='ARCHIVED'`，写入 `closed_at` 与 `archived_at` | 否 | 已归档 |
| `trash` | `deleted_at IS NOT NULL`，内容仍可恢复 | 否 | 回收站 |
| `purged` | 消息与附件已完成清理，写入 `history_cleared_at` 与 `purged_at` | 否 | 不显示 |

`CLOSED` 只用于读取旧数据，不再作为新写入状态。读到旧 `CLOSED` 时按 `archived` 处理；下一次合法状态变更应归一化为 `ARCHIVED`。

## 状态转移

```text
PENDING / OPEN -> ARCHIVED -> trash -> purged
                              ^
                              |
                         restore to ARCHIVED
```

### active -> archived

- 写入 `status='ARCHIVED'`。
- 写入 `closed_at`、`archived_at`。
- 手动操作写 `archived_by`；自动任务保持 `NULL`。
- 必须检查实际受影响行数。

### archived -> trash

- 写入 `deleted_at`。
- 手动操作写 `deleted_by`；自动任务保持 `NULL`。
- 不删除消息、附件或历史操作人。

### trash -> archived

- 清除 `deleted_at`、`deleted_by`。
- 保留 `archived_at`、`closed_at`。
- 不恢复为 `OPEN`。

### trash -> purged

- 必须先原子认领仍符合条件的回收站会话。
- 删除 R2 或本地 storage 文件。
- 删除附件元数据。
- 删除消息。
- 写入 `history_cleared_at`。
- 最后完成 `purged_at` 状态。
- 任一步失败必须保持可重试，不得报告完全成功。

Cloudflare 的 D1 与 R2、自托管的 PostgreSQL 与本地文件系统都不是天然跨资源事务，因此清理必须依赖资格认领、幂等删除、补偿和重试，而不是宣称全局原子事务。

## 时间规则

- 自动归档：`active` 会话 24 小时无活动。
- 自动清理：`trash` 会话进入回收站 24 小时后。
- D1 使用 `datetime(column) <= datetime('now', '-24 hours')`。
- PostgreSQL 使用 `column <= now() - interval '24 hours'`。
- 所有边界测试覆盖 23h59m、24h、24h01m、重复执行和部分失败。

## 业务身份与权限

- 客服禁用不会物理删除历史主体。
- 禁用立即撤销管理员会话，并只清空当前分配关系。
- `last_operator_id`、历史消息、审计记录继续保留。
- 物理删除客服默认禁止；隐私要求应通过匿名化实现。

## 消息与邀请一致性

- 邀请仅保存 token hash；支持过期、撤销、单次消费和原浏览器恢复。
- 并发消费由数据库事务和行锁保证只有一次成功。
- 消息幂等键为 `session_id + sender_type + sender_id + client_message_id`。
- 消息历史按 `(created_at, id)` 稳定排序。
- WebSocket 在升级阶段鉴权，服务端按 URL 和身份绑定固定房间。
- 已读更新和广播必须使用同一组消息 ID。

## 双后端策略

### Cloudflare Worker

- 继续作为当前生产基准。
- D1、R2、Durable Objects 和 Scheduled Trigger 保持生产路径。
- 高风险修复必须先通过 CI，再单独授权迁移和部署。

### server-generic

- 只在能力对照表明确标记完成后提升生产级别。
- 当前即使补齐邀请、WebSocket、文本幂等和基础 read receipt，仍属于预览适配层。
- 在图片上传显示、完整 lifecycle runner、审计日志、备份恢复故障注入和真实 VPS 验收完成前，不得宣传为完整生产替代方案。

## 测试原则

CI 必须同时包含：

1. TypeScript/typecheck。
2. 静态安全边界检查。
3. 行为型数据库与 HTTP 集成测试。
4. 本地 Docker Compose E2E。
5. 清理、并发消费、幂等重试和鉴权失败测试。

字符串存在性检查只能防回退，不能替代状态机行为测试。

## 运维边界

普通代码审计不得执行：

- Cloudflare deploy。
- 远程 D1 migration 或写入。
- R2 删除。
- 生产 purge/restore。
- Secret 修改。
- SSH/VPS 操作。
- 真实 setup initialize。

以上操作必须在备份、维护窗口和单独授权下执行。
