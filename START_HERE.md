# 小白部署说明：这不是一个单独 HTML，也不建议做成 exe

这个项目是“在线客服系统”，不是静态网页。它需要：

- 一个网页前端：访客聊天窗口、客服后台。
- 一个后端服务：登录、上传图片、保存聊天记录。
- 一个实时连接服务：Socket.io，用来实时收发消息。
- 一个数据库文件：SQLite，用来保存用户、会话、消息和管理员。

所以它不能只打包成一个 `index.html` 后直接双击运行；如果做成 Windows `exe`，也只适合本地电脑运行，不适合云服务器长期部署。

## 推荐交付形态

最终给服务器部署时，把它当作一个“完整项目文件夹”部署：

```text
support-system/
├── app/
├── lib/
├── public/uploads/
├── scripts/
├── server.js
├── package.json
├── next.config.js
├── tsconfig.json
└── README.md
```

服务器上只需要执行：

```bash
npm install
npm run build
npm run start
```

然后访问：

- 访客端：`http://服务器IP:3000/`
- 客服后台：`http://服务器IP:3000/admin`

## 最简单的云端部署流程

1. 买一台 Ubuntu VPS。
2. 安装 Node.js 20 或更高版本。
3. 上传整个项目文件夹。
4. 进入项目目录。
5. 复制环境变量模板：

```bash
cp .env.example .env
```

6. 修改 `.env` 里的 `AUTH_SECRET`。
7. 安装依赖并构建：

```bash
npm install
npm run build
```

8. 启动：

```bash
npm run start
```

第一次启动时，控制台会输出默认管理员：

```text
Default admin created: username=admin password=随机密码
```

请保存这个密码，然后登录 `/admin`。

## 想要“一键启动”怎么办？

项目里提供了两个启动脚本：

- Windows 本地开发：双击或运行 `scripts/start-windows.bat`
- Ubuntu/Linux：运行 `bash scripts/start-linux.sh`

它们本质上仍然是帮你执行 `npm install`、`npm run build`、`npm run start`。
