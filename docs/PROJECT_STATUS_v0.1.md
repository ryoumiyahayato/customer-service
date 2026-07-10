# Cloudflare MVP v0.1 项目状态快照（历史文档）

> 本文只记录早期 v0.1 阶段，不再作为当前架构、生命周期或发布验收依据。
>
> 当前唯一状态机决策见 `docs/ADR-001-session-lifecycle-and-backend-parity.md`；当前产品化状态见 `docs/PRODUCTIZATION_INDEX.md` 和 `docs/PRODUCTIZATION_ROADMAP_TO_2026-07-20.md`。

## 历史背景

v0.1 阶段的生产形态已经采用 Cloudflare Workers、D1、R2、Assets、Scheduled Trigger 和 WebSocket。该阶段完成了 setup、安全边界和早期生命周期设计，但生命周期后来已统一重构。

为避免文档携带个人本地路径、具体生产域名或已变化的运行状态，本历史快照不再保留这些环境细节。真实域名、数据库 ID、Secret 和部署状态必须从受控运维环境确认，不能以仓库历史文档为准。

## 已废弃的生命周期说明

下列旧四阶段时间链不再作为当前要求：

```text
CLOSED 超 24h -> archived -> 超 24h进入回收站 -> 超 24h清空历史
```

当前 v1 决策为：

```text
active(PENDING/OPEN) -> archived(ARCHIVED) -> trash -> purged
```

- `CLOSED` 只作为旧数据兼容状态。
- 新写入统一使用 `ARCHIVED`。
- `purged` 必须表示消息与附件内容已实际完成清理，而不是单纯隐藏。
- 回收站恢复回到 `ARCHIVED`，不回到进行中。

## 仍然有效的安全原则

- 包名、域名、App ID、namespace 不得包含个人姓名、邮箱、handle 等个人标识。
- `SETUP_TOKEN`、Cookie、会话 token、数据库密码和加密密钥不得写入 git、前端变量、日志或审计报告。
- 已有管理员后 `/setup` 必须关闭。
- setup API 必须按后台 host fail-closed。
- setup initialize 成功后不自动登录，不创建管理员会话。
- 文件清理失败时不得报告完全成功。
- R2/D1 与 PostgreSQL/本地文件系统的跨资源清理必须可重试并具备补偿策略。
- 自动任务日志只记录聚合计数，不记录消息正文、用户 ID、会话 ID、token 或附件 key。

## 历史路线说明

v0.1 文档曾将后续工作按 UI、代码整理、通用服务器、部署向导、PWA、桌面和 Android 分阶段。当前路线已改由产品化路线图管理，本文不再更新。
