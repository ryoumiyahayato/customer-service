# Cloudflare MVP v0.1 封板说明

## 版本信息

- 版本名称：Cloudflare MVP v0.1
- 建议 tag 名称：v0.1.0-cloudflare-mvp
- 当前状态：已封板

## 当前状态

- main 分支稳定。
- 线上部署完成。
- 最终总体验收通过。
- 工作区 clean。
- /setup 已上线，但因已有 admin 自动关闭。
- SETUP_TOKEN 已删除。
- lifecycle 自动化已上线并验收通过。
- doctor / bootstrap 已覆盖 lifecycle 和 setup 检查。

## 已完成能力

- admin login / logout
- /api/auth/me
- admin session timeout
- 访客 invite
- WebSocket
- read receipt
- 客服会话
- 归档
- 回收站
- 手动清空历史
- R2 附件清理
- customer remarks
- lifecycle 自动归档
- lifecycle 自动移入回收站
- lifecycle 自动清空历史
- /setup 初始化向导
- doctor / bootstrap setup 检查
- doctor / bootstrap lifecycle 检查

## 最终验收结果

- typecheck：通过
- doctor：通过
- doctor lifecycle 检查：全部 pass
- doctor setup 检查：5 项全部 pass
- lifecycle:dry-run：通过
- doctor:online：通过
- /setup GET：200 text/html
- /api/setup/status：200
- reason=already_configured
- setupAvailable=false
- requiresSetupToken=false
- 访客根域 setup API：404
- 访客 token 子域 setup API：404
- D1 lifecycle 候选数量：全部 0
- git status：clean

## 封板说明

Cloudflare MVP v0.1 已封板。除非修 bug，不建议继续在 v0.1 上增加功能。

后续新需求应从 v0.2 或后续阶段继续，避免在已验收版本上扩大范围。
