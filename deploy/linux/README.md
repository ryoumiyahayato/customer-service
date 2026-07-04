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
- `Dockerfile`：构建通用服务器适配层并复制前端 `dist` 产物。
- `app.env.example`：容器内应用变量示例。
- `Caddyfile`：HTTPS 和反向代理草案。
- `install.sh`：v0.5 最小部署入口，执行 compose 配置检查、构建、启动和健康检查。
- `healthcheck.sh`：部署后健康检查。
- `backup.sh`：数据库和 storage 备份骨架。
- `restore.sh`：安全恢复流程骨架。
- `upgrade.sh`：升级流程骨架。

## 安全提示

不要把真实 `.env` 提交 git。不要把 secret、密码、token、cookie、生产数据明细或附件 key 写入日志、文档或聊天记录。

## 最小执行路径

1. 在服务器安装 Docker 和 Docker Compose 插件。
2. 复制本目录到服务器部署目录。
3. 复制 `.env.example` 为 `.env`，只在服务器本地填写真实部署变量。
4. 执行 `./install.sh`。
5. 健康检查通过后打开后台地址和 `/setup`。

当前通用服务器适配层只提供健康检查、setup 状态占位、静态文件服务和后续 WebSocket / PostgreSQL / 生命周期迁移接口骨架；完整客服业务迁移将在后续包继续推进。
