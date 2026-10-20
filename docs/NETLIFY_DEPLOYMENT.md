# Netlify 发布

## 当前发布状态（2026-10-20）

已新建独立站点 `infinite-canvas-studio`，site ID 为 `bfbb2393-4a66-4eac-b4c7-ba7fcc05757c`，在线地址为 https://infinite-canvas-studio.netlify.app/zh-CN/login 。未关联 Git 持续部署，当前由官方 CLI 手工发布。原 Sites 和其他报价站点未修改。

当前生产部署 ID：`6ad7252efad406500082b568`，原生部署状态 `ready`；部署日志：https://app.netlify.com/projects/infinite-canvas-studio/deploys/6ad7252efad406500082b568 。

登录页、画布及公开配置接口的线上 HTTP 验证通过，Functions 已发布；未登录访问共享接口返回 401。当前 `APP_PASSWORD` 和模型密钥未配置。完整 CLI 构建后的运行环境检测到数据库连接变量（`cloudStorageAvailable: true`），但数据库管理接口仍返回空正文 HTTP 400，生产分支 CLI 查询失败；原因未确定，不能将其归因于套餐。额外诊断部署被服务端拒绝，未形成新部署，当前生产站点仍为上述 `ready` 版本。临时诊断路由已从未发布源码中移除。

`cloudStorageAvailable` 仅表示运行环境存在连接变量，不能替代真实云端读写验收。浏览器本地编辑/保存可用；云共享和生成未启用、未验收。登录密码和模型配置完成后，仍须验证数据库迁移及实际读写，再宣称云端能力可用。

本轮完整 162 项回归及语法检查通过。线上浏览器验收受限：Edge 连接不可用，Codex 内置浏览器打开超时，因此线上结果依据 HTTP 和部署 API，未声称已完成浏览器端渲染验收。

本项目保留本地 Node 服务，同时支持独立的 Netlify 部署。

## 构建与入口

- 构建：`npm run build:netlify`
- 发布目录：`.local/netlify-publish`
- Functions：`netlify/functions`
- 登录首页：`/zh-CN/login`、`/login`
- 无限画布：`/`，新空白画布入口 `/?entry=canvas`

`.netlify/` 已加入忽略规则。该目录仅用于 CLI 链接状态和生成物，不应提交。源码、本地项目、`.env` 和验收记录均不在发布目录内。

## 云端接口与数据

现代 Netlify Function 接管 `/api/*`。公开配置接口只返回模型可用性；云端写入和生成接口仍要求访问密码建立的签名 Cookie 会话，拒绝跨站请求和伪造的用户身份 Header。会话在无状态函数的不同实例间仍可验证，12 小时过期，修改密码会让旧会话失效。

`@netlify/database` 使用 Netlify Postgres 保存共享元数据、版本号、邀请权限、任务及限流记录；`@netlify/blobs` 仅保存不可变画布快照。并发保存通过数据库条件更新检测版本和权限变化。数据库迁移位于 `netlify/database/migrations/`，由部署应用，禁止对生产执行 schema push 或手工重放。

访客可编辑并保存在当前浏览器。未配置 `APP_PASSWORD` 时，云端写入默认关闭；登录表单会明确说明管理员尚未配置访问密码。原 Sites、原本机 IndexedDB 和新 Netlify 站点是独立数据来源，画布可显式导出/导入，本次部署不自动迁移用户数据。

## 运行环境

在 Netlify 的 Functions 环境变量中设置 `APP_PASSWORD`；模型密钥、模型 ID 和供应商地址沿用根目录 `.env.example` 的变量名。修改后重新部署。不要将本机 `.env` 上传为静态文件，也不要在 `netlify.toml` 中写密钥。

公开访问和公网连通性是两件事。本站部署完成并验证后，仍需要在目标用户的实际网络下测试直连情况。
