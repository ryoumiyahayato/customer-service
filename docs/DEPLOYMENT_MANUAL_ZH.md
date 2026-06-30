# 轻量级在线客服系统：说明书式部署教程

> 适合没有太多代码经验的使用者。你可以把本项目理解为一个“网站程序文件夹”，上传到云服务器后运行。

## 1. 先搞清楚：最终交付形式是什么？

本系统不能只做成一个 `HTML` 文件，因为它不仅是页面，还要：

1. 保存聊天记录到 SQLite 数据库。
2. 处理管理员登录。
3. 上传并保存图片。
4. 用 Socket.io 做实时消息推送。
5. 让访客刷新网页、关闭网页后还能恢复历史会话。

因此最终推荐交付形式是一个完整文件夹：

```text
support-system/
├── app/                  网站页面和接口
├── lib/                  数据库、登录等通用代码
├── public/uploads/       图片上传目录
├── scripts/              启动、打包、创建管理员脚本
├── server.js             云端启动入口
├── package.json          项目依赖和命令
├── .env.example          环境变量模板
├── README.md             简要说明
└── START_HERE.md         小白快速说明
```

当前生产发布不再生成 release zip。发布前在本机运行：

```bash
npm.cmd run typecheck
npm.cmd run build
npx.cmd wrangler deploy
```

不要把 `.dev.vars`、`.env.production`、secret、cookie 或 Cloudflare token 写进仓库。

---

## 2. 云服务器需要准备什么？

推荐配置：

| 项目 | 建议 |
| --- | --- |
| 系统 | Ubuntu 22.04 或 24.04 |
| CPU | 1 核起步 |
| 内存 | 1GB 起步，推荐 2GB |
| 硬盘 | 20GB 起步 |
| Node.js | 20 或更高版本 |
| 并发规模 | 15~50 人同时在线 |

本项目不需要 Docker。

---

## 3. 第一次登录服务器

假设你的服务器 IP 是 `1.2.3.4`：

```bash
ssh root@1.2.3.4
```

如果你用的是云厂商控制台，也可以直接打开它提供的“远程终端”。

---

## 4. 安装 Node.js 20+

Ubuntu 上推荐使用 NodeSource：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

检查安装是否成功：

```bash
node -v
npm -v
```

只要能看到版本号即可。

---

## 5. 上传项目文件夹

### 方法 A：用压缩包上传

在本地项目目录运行：

```bash
npm.cmd run build
```

当前生产发布使用 Wrangler，不再上传旧 release zip 到云服务器。

Wrangler 会直接发布 Worker 和 `dist` 静态资源，不需要在云服务器上解压上传包。

### 方法 B：用 Git 拉取

如果你把代码放到了 Git 仓库：

```bash
cd /opt
git clone <你的仓库地址> support-system
cd support-system
```

---

## 6. 配置环境变量

复制模板：

```bash
cp .env.example .env
```

编辑：

```bash
nano .env
```

至少修改 `AUTH_SECRET`：

```text
AUTH_SECRET=换成一串很长的随机字符串
PORT=3000
DATA_DIR=./data
DATABASE_PATH=./data/support.sqlite
NODE_ENV=production
```

生成随机密钥可以用：

```bash
openssl rand -hex 32
```

把输出内容复制到 `AUTH_SECRET=` 后面。

---

## 7. 安装依赖并构建

在服务器项目目录执行：

```bash
npm install
npm run build
```

如果这两步成功，说明项目已经可以启动。

---

## 8. 启动系统

```bash
npm run start
```

第一次启动时，控制台会出现类似内容：

```text
Default admin created: username=admin password=xxxxxxxxxxxx
Support system ready on http://localhost:3000
```

请立刻记下这个密码。

访问地址：

```text
访客端：http://你的服务器IP:3000/
客服后台：http://你的服务器IP:3000/admin
```

后台默认账号：

```text
账号：admin
密码：控制台输出的随机密码
```

---

## 9. 让程序后台长期运行

直接 `npm run start` 会占用当前终端。生产环境建议用 PM2。

安装 PM2：

```bash
sudo npm install -g pm2
```

启动：

```bash
pm2 start server.js --name support-system
```

设置开机自启：

```bash
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs support-system
```

重启：

```bash
pm2 restart support-system
```

停止：

```bash
pm2 stop support-system
```

---

## 10. 绑定域名和 Nginx 反向代理

如果你有域名，例如：

```text
support.example.com
```

安装 Nginx：

```bash
sudo apt-get install -y nginx
```

创建配置：

```bash
sudo nano /etc/nginx/sites-available/support-system
```

填入：

```nginx
server {
    listen 80;
    server_name support.example.com;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/support-system /etc/nginx/sites-enabled/support-system
sudo nginx -t
sudo systemctl reload nginx
```

现在可以访问：

```text
http://support.example.com
```

---

## 11. 配置 HTTPS

推荐使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d support.example.com
```

完成后访问：

```text
https://support.example.com
```

---

## 12. 日常维护

### 查看运行日志

```bash
pm2 logs support-system
```

### 查看数据库文件

默认数据库在：

```text
data/support.sqlite
```

### 备份数据库和图片

```bash
mkdir -p backup
cp data/support.sqlite backup/support-$(date +%F).sqlite
cp -r public/uploads backup/uploads-$(date +%F)
```

### 更新代码后重新发布

```bash
git pull
npm install
npm run build
pm2 restart support-system
```

如果是压缩包方式：

1. 停止 PM2。
2. 备份 `data/` 和 `public/uploads/`。
3. 上传新代码。
4. 恢复 `data/` 和 `public/uploads/`。
5. 运行 `npm install && npm run build`。
6. 重启 PM2。

---

## 13. Windows 本地试用

安装 Node.js 20+ 后，在项目目录运行：

```bat
npm install
npm run dev
```

或者双击/运行：

```bat
scripts\start-windows.bat
```

本地访问：

```text
http://localhost:3000/
http://localhost:3000/admin
```

---

## 14. 常见问题

### 14.1 能不能做成一个 HTML？

不能。单个 HTML 没有数据库、登录、实时通信、图片上传能力。

### 14.2 能不能做成 exe？

理论上可以做本地演示版，但不适合云端部署。云端部署应该运行 Node.js 服务。

### 14.3 为什么打开 `/admin` 没有账号？

第一次启动 `npm run start` 时，控制台会输出默认账号和随机密码。如果错过了，可以查看启动日志：

```bash
pm2 logs support-system
```

### 14.4 图片上传失败怎么办？

检查：

1. 图片是否是 jpg/jpeg/png/webp。
2. 图片是否超过 5MB。
3. `public/uploads` 是否存在并有写入权限。
4. Nginx 是否设置了 `client_max_body_size 10m;`。

### 14.5 访问不了 Socket.io 或消息不实时？

如果用了 Nginx，必须保留：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

否则 WebSocket 可能无法正常工作。

---

## 15. 一句话总结

当前生产发布不是上传旧 release zip，而是通过 Wrangler 发布 Cloudflare Worker 和 `dist` 静态资源。发布前运行 `npm.cmd run typecheck`、`npm.cmd run build`，确认后再运行 `npx.cmd wrangler deploy`。

## Current Production Admin And Database Operations

The current production system uses Cloudflare Worker + Vite + D1. Do not use legacy Postgres initialization or admin-creation scripts for production accounts.

Administrator creation and password changes should be handled through the admin UI or a controlled D1/Worker operations process. Do not document or store real usernames, passwords, session secrets, tokens, or cookies in this repository.


## Current Worker Deployment Flow

The current production deployment path is Cloudflare Worker + Vite + D1 + Wrangler.

Use this sequence before production deployment:

```powershell
npm.cmd run typecheck
npm.cmd run build
npx.cmd wrangler deploy
```

Do not commit or document `.dev.vars`, `.env.production`, secrets, cookies, or Cloudflare tokens. `wrangler.toml` uses `[assets]` with `run_worker_first = true` so visitor/admin host requests pass through the Worker gate before static assets.
