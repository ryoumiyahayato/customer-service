# Cloudflare MVP v0.1 项目状态快照

## 基本信息

- 项目类型：客服系统
- 本地路径：C:\Users\agcrf\Desktop\learntest
- 后台域名：https://denglu.kefuxitong.net/
- 访客根域：vx9qn7zr.org

## 当前 Cloudflare 运行形态

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare Assets
- Cloudflare Scheduled Trigger
- WebSocket

## D1 配置

- database_name = customer_chat_db
- binding = DB
- migrations_dir = migrations

## 当前 setup 状态

- /setup 已上线。
- 已有 admin 后自动关闭。
- SETUP_TOKEN 已删除。
- /api/setup/status 当前应返回 already_configured。
- 访客根域和访客 token 子域访问 setup API 应为 404。

## 当前 lifecycle 规则

- CLOSED 超 24h 自动归档，最多 20 条/小时。
- archived_at 超 24h 自动移入回收站，最多 20 条/小时。
- deleted_at 超 24h 且 history_cleared_at IS NULL 自动清空历史，最多 10 个 session/小时。
- 自动清空历史必须复用 clearSessionHistoryInternal。
- 不复制新的 R2 删除逻辑。

## 关键安全边界

- 包名、域名、App ID、namespace 不得包含个人姓名、邮箱、handle 等个人标识。
- SETUP_TOKEN 不得写入 wrangler.toml、.env.production、前端 .env、import.meta.env、git、聊天、日志、报告。
- 已有任意 admin 后 /setup 必须关闭。
- /api/setup/* 只允许后台域名和本地开发 host。
- 访客根域必须 fail-closed。
- 访客 token 子域必须在 invite 校验前 fail-closed。
- setup initialize 成功后不自动登录、不创建 admin session、不设置 support_admin cookie。
- 自动清空历史必须复用 clearSessionHistoryInternal。
- R2 NotFound / 404 / NoSuchKey 可视为成功。
- R2 删除失败时不得写 history_cleared_at。
- D1 删除失败时不得写 history_cleared_at。
- 完全成功后才写 history_cleared_at。
- 自动清空历史写 history_cleared_by='system'。
- 自动归档 archived_by 仍为 NULL。
- 自动回收 deleted_by 仍为 NULL。

## 后续推荐路线

- v0.2 UI 优化 / 使用体验打磨
- v0.3 代码整理 / 冗余清理
- v0.4 通用云服务器版架构设计
- v0.5 Linux 一键部署脚本
- v0.6 Windows 部署向导 EXE
- v0.7 PWA / 客户端 EXE / Android APK
- v0.8 服务端加密存储
