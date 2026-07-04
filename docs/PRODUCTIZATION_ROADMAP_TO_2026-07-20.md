# 产品化路线图：2026-07-20 前首版闭环

## 目标

在 2026-07-20 前完成客服系统全模块首版闭环。后续不砍模块，但每个模块先按 MVP / 首版可运行 / 首版可演示推进，避免在单一模块上反复打磨导致整体产品化路线失衡。

## 模块范围

1. Cloudflare 线上版
2. 通用 Linux 云服务器版
3. Linux 一键部署脚本
4. Windows 部署向导 EXE
5. PWA
6. 客户端 EXE
7. Android APK
8. 服务端加密存储
9. 备份 / 恢复 / 升级
10. 最终封板文档

## 压缩排期

- 7/4：通用部署架构 + Linux 骨架
- 7/5-7/6：Docker Compose + Caddy + PostgreSQL + 本地文件存储
- 7/7-7/8：通用服务器后端适配层
- 7/9：install.sh 最小可运行版
- 7/10：healthcheck / backup / restore
- 7/11-7/12：Windows 部署向导 EXE MVP
- 7/13：PWA + 客户端 EXE 壳
- 7/14-7/15：Android APK 壳
- 7/16：服务端加密存储 MVP
- 7/17：升级 / 回滚 / 备份恢复联调
- 7/18：全链路测试
- 7/19：修 bug
- 7/20：封板

## 推进方式

后续不再做低价值反复审计；每轮采用大包推进：先完成一个可运行骨架，再统一做自检、审计、提交。高风险操作仍必须单独授权，包括真实部署、数据库写入、迁移、R2 删除、secret 变更、生产数据修改和初始化操作。

## 阶段完成标准

- Cloudflare 线上版：保持现有线上能力稳定，作为产品化基准实现。
- 通用 Linux 云服务器版：具备明确架构、部署目录、环境变量和服务编排草案。
- Linux 一键部署脚本：能执行环境检查、目录准备、容器启动和健康检查。
- Windows 部署向导 EXE：能连接服务器、上传部署包、执行脚本并展示日志。
- PWA / 客户端 EXE / Android APK：能作为已部署系统入口壳使用。
- 服务端加密存储：新消息加密链路具备 MVP 设计，旧数据迁移单独处理。
- 备份 / 恢复 / 升级：具备可演示的安全流程和回滚预案。
- 最终封板文档：记录部署形态、能力边界、未完成项和后续路线。

## v0.5 第一包状态

- Linux 部署骨架已推进到可执行最小闭环：compose 配置、镜像构建、服务启动、健康检查、备份、恢复和升级脚本均有首版实现。
- 新增 `server-generic` 隔离适配层，先提供健康检查、setup status 占位、静态文件服务和后续迁移接口骨架。
- Cloudflare 线上逻辑保持不变，通用服务器版后续继续补齐 PostgreSQL 数据访问、WebSocket 适配和业务 API。

## server-generic 业务迁移第一包状态

- 通用服务器版已从占位骨架推进到最小 setup + admin auth + session + PostgreSQL migration 闭环。
- PostgreSQL 首版 schema 覆盖 admin、admin session、setup 状态、会话、消息、附件和客户备注基础表。
- `server-generic` 已具备 setup status、setup initialize、admin login、admin logout、auth/me 和 healthz 基础 API。
- 密码使用 Node 标准库 crypto 的 scrypt + random salt；admin session 使用随机 token，并只在数据库保存 token hash。
- Linux install 默认不执行 migration，必须由部署人员显式设置 opt-in 开关后运行。
- 当前仍未迁移完整访客聊天 API、WebSocket 房间协议、read receipt、归档/回收站/清空历史写入、附件清理和生产数据迁移。

## server-generic 客服会话第一包状态

- 通用服务器版已具备基础客服业务闭环：访客创建会话、访客发送文本消息、管理员查看会话、管理员回复消息、管理员关闭会话。
- 访客 token 使用随机值，数据库仅保存 hash；admin chat API 复用 admin session 鉴权。
- WebSocket 当前提供按 session id 订阅和基础广播，不在消息中携带 token、cookie 或密码字段。
- healthcheck 仍保持只读健康检查，不创建真实会话。
- 后续继续补齐附件上传、read receipt、归档/回收站/清空历史、WebSocket 鉴权增强和数据迁移工具。

## server-generic 附件与 lifecycle 第一包状态

- 通用服务器版已具备本地文件 storage helper、附件上传/下载 MVP、附件元数据记录和安全文件名处理。
- lifecycle 已具备手动 archive、recycle、clear-history API，以及只读 dry-run runner。
- clear-history 先通过统一 helper 删除本地附件文件，失败时不写 history_cleared_at。
- Linux 部署脚本已强化 storage 备份、恢复前人工确认、附件配置说明和只读 healthcheck 边界。
- 后续仍需补齐 multipart 上传、更完整附件预览、自动 runner 调度接线、read receipt 和生产数据迁移工具。

## Windows 部署向导 EXE MVP scaffold 状态

- `deploy/windows-wizard` 已新增独立 CLI/Tauri-ready scaffold。
- 当前支持配置校验、脱敏部署计划生成、远程命令生成、日志脱敏、SSH/transfer mock 接口和 smoke。
- CLI 支持 `--smoke` 与 `--plan <config.json>`。
- 当前不包含真实 GUI、EXE 打包、真实 SSH 上传执行和云厂商 API。
