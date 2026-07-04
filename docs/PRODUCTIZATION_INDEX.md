# 产品化文档索引

当前 Cloudflare 版已上线，作为产品化路线的基准版本。后续按大包推进，每轮完成可运行骨架、自检、审计和提交。

## 文档入口

- [产品化路线图](./PRODUCTIZATION_ROADMAP_TO_2026-07-20.md)
- [v0.4 通用服务器部署架构](./SERVER_DEPLOYMENT_ARCHITECTURE_v0.4.md)
- [v0.6 Windows 部署向导 EXE](./WINDOWS_DEPLOY_WIZARD_v0.6.md)
- [v0.7 客户端与 PWA](./CLIENTS_AND_PWA_v0.7.md)
- [v0.8 服务端加密存储](./SERVER_SIDE_ENCRYPTION_v0.8.md)

## 部署骨架

- `deploy/linux/README.md`
- `deploy/linux/.env.example`
- `deploy/linux/docker-compose.yml`
- `deploy/linux/Caddyfile`
- `deploy/linux/install.sh`
- `deploy/linux/healthcheck.sh`
- `deploy/linux/backup.sh`
- `deploy/linux/restore.sh`
- `deploy/linux/upgrade.sh`
- `deploy/windows-wizard/README.md`
- `deploy/windows-wizard/package.json`

## 推进原则

- Cloudflare 线上版保持稳定。
- 通用服务器版先做 MVP。
- Windows / PWA / 客户端 EXE / Android APK 先做入口壳。
- 服务端加密先覆盖新消息。
- 高风险操作继续单独授权。

## Windows 部署向导状态

Windows 部署向导已进入 MVP scaffold：当前是独立 CLI/Tauri-ready package，可生成脱敏部署计划并运行 smoke；SSH 与 transfer 仍为 mock / 接口层，尚未打包真实 EXE。
