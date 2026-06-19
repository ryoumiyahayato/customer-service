# 轻量级在线客服系统（Web Customer Support System）

基于 Next.js、TypeScript、Socket.io、SQLite、bcrypt 的轻量级在线客服系统，适合 15~50 个同时在线用户。访客无需注册，系统会自动生成访客身份并恢复历史会话。

## 功能

- 访客发送文字和图片，自动保存历史记录。
- 访客身份保存到 LocalStorage 与 Cookie，再次访问自动恢复。
- 多客服后台 `/admin`，支持待接入、处理中、已关闭会话。
- 手动接单，优先保留 `last_operator_id` 用于后续固定客服恢复。
- Socket.io 实时消息、刷新后重新加入会话房间、断线自动重连。
- 上传限制：jpg/jpeg/png/webp，最大 5MB，保存到 `public/uploads`，数据库只保存路径。
- 管理员密码使用 bcrypt，登录使用 HttpOnly Cookie。
- 首次启动自动创建 `admin` 账号和随机密码，并输出到控制台，首次登录后应修改密码。


## 给代码小白的说明：最终交付不是单个 HTML 或 exe

本系统包含前端页面、后端 API、Socket.io 实时通信和 SQLite 数据库，因此不能像普通静态网页一样只部署一个 `index.html`。也不建议为了云端部署打包成 Windows `exe`，因为云服务器需要长期运行 Node.js 服务。

推荐方式是把整个项目作为一个完整文件夹部署到云服务器。更详细的一步一步说明见 [`START_HERE.md`](./START_HERE.md)。

如果你想生成一个方便上传/交付的压缩包，可以运行：

```bash
npm run make-release
```

生成结果：

```text
release/support-system/
release/support-system.zip   # 如果服务器或本机安装了 zip 命令
```

## 快速部署

```bash
npm install
npm run build
npm run start
```

默认监听 `http://localhost:3000`，可通过环境变量 `PORT=8080` 修改。

## 数据库初始化

数据库会在首次启动时自动初始化，默认位置：

```text
data/support.sqlite
```

也可以指定：

```bash
DATABASE_PATH=/var/lib/support/support.sqlite npm run start
```

## 管理员创建

首次启动会自动生成超级管理员：

```text
username=admin
password=<控制台随机输出>
```

创建额外客服账号：

```bash
npm run create-admin -- operator1 StrongPassword123 OPERATOR
npm run create-admin -- boss StrongPassword123 SUPER_ADMIN
```

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 服务端口 |
| `DATABASE_PATH` | `data/support.sqlite` | SQLite 数据库路径 |
| `DATA_DIR` | `data` | 默认数据库目录 |
| `AUTH_SECRET` | `dev-change-me` | 管理员登录 Cookie 签名密钥，生产环境必须修改 |
| `NODE_ENV` | `production` | 生产运行环境 |

环境变量模板已经放在 `.env.example`，部署时可以复制为 `.env` 后修改。

## 目录结构

```text
app/                 Next.js 页面与 API Routes
app/page.tsx         访客聊天窗口
app/admin/page.tsx   客服后台
app/api/             登录、上传、会话、消息 API
lib/                 数据库与认证工具
public/uploads/      图片上传目录
scripts/             数据库、账号、启动和打包脚本
server.js            Next.js + Socket.io 自定义服务
START_HERE.md         小白部署说明
.env.example          环境变量模板
```

## Ubuntu VPS 建议

1. 安装 Node.js 20+。
2. 设置 `AUTH_SECRET` 和 `DATABASE_PATH`。
3. 使用 `npm install && npm run build && npm run start` 启动。
4. 可用 systemd 或 pm2 守护 `npm run start`。
5. 使用 Nginx 反向代理到本服务端口，并确保 WebSocket 代理开启。

## Windows 本地开发

```bash
npm install
npm run dev
```

或者双击/运行：

```bat
scripts\start-windows.bat
```

如需测试 Socket.io 生产服务，请运行：

```bash
npm run build
npm run start
```
