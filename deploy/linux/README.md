# 通用 Linux 云服务器部署骨架

这是客服系统通用 Linux 云服务器部署版的首版骨架，用于 v0.4-v0.5 产品化推进。

## 使用前准备

用户需要自行准备：

- Linux 云服务器或 VPS
- 域名和 DNS 解析
- SSH 访问权限
- 必要的备案或合规手续
- 可用的 80 / 443 端口

第一版不接云厂商 API，不自动购买服务器，不自动登录云账号。

## 文件说明

- `.env.example`：环境变量模板，不包含真实值。
- `docker-compose.yml`：app、postgres、caddy 三服务编排草案。
- `Caddyfile`：HTTPS 和反向代理草案。
- `install.sh`：后续 v0.5 的最小部署入口。
- `healthcheck.sh`：部署后健康检查。
- `backup.sh`：数据库和 storage 备份骨架。
- `restore.sh`：安全恢复流程骨架。
- `upgrade.sh`：升级流程骨架。

## 安全提示

不要把真实 `.env` 提交 git。不要把 secret、密码、token、cookie、生产数据明细或附件 key 写入日志、文档或聊天记录。
