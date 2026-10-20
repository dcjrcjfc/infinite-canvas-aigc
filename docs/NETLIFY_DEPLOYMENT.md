# Netlify 发布

## 当前发布状态（2026-10-20）

已按用户要求切换到 `1115829648@qq.com`，在团队 `1115829648` 下创建独立站点 `infinite-canvas-studio-1115829648`。site ID：`ceca66a0-a54a-4dfb-b655-1fd9a3206a8d`；登录地址：https://infinite-canvas-studio-1115829648.netlify.app/zh-CN/login 。原 Sites、旧账号站点及其他报价站点未修改；本地 CLI 关联已切换到新站点，未关联 Git 持续部署。

当前生产部署 ID：`6ad751e39b0ec422a0bdb64d`，状态 `ready`；部署日志：https://app.netlify.com/projects/infinite-canvas-studio-1115829648/deploys/6ad751e39b0ec422a0bdb64d 。包含实现提交 `ae9358953771e2673ddcc40930940c907fdafe18` 的画布制作流程及登录入场修复。

新账号默认私有，新部署最初返回 Netlify 401 登录页；用户已在控制台改为 Public。此后匿名 HTTP 验收通过：登录路由 200，包含 `login-boot.js` 与首屏 `scene-loading` 守卫；80 个发布文件核对完成，其中 78 个字节哈希一致，两个 HTML 仅追加 Netlify 托管注释及公开 HUD 脚本，去除这两项平台注入后与发布包一致。公开配置返回 200，伪造身份访问共享接口返回 401，跨站请求返回 403。证据保留在本地 `.local/netlify-new-account-verification.json`。

实现提交已通过本地 164 项回归、语法检查、发布包构建及差异检查；GitHub Actions `39405124442` 的 Windows/Linux × Node 22/24 四组检查全部成功：https://github.com/dcjrcjfc/infinite-canvas-aigc/actions/runs/39405124442 。本轮使用官方 CLI `deploy --prod --no-build --skip-functions-cache` 发布，未购买额度或更改套餐。

新站点 `APP_PASSWORD`、模型密钥和数据库未配置。公开配置实测 `authenticated: false`、`sharedProjects: false`、`cloudStorageAvailable: false`。访客通过“先逛逛”可使用浏览器本地画布；云端登录、共享和 AI 生成未启用、未验收。旧账号环境变量、数据库及用户画布未自动迁移。

浏览器自动控制连接超时，本轮线上验证依据 HTTP、文件核对和部署 API，未宣称已完成新站点实际浏览器拖动或冷启动动画验收。本地相应行为的回归结果与线上发布证据分别记录。

## 旧账号发布历史

旧账号 `13719103923tx@gmail.com` 的站点为 `infinite-canvas-studio`，site ID：`bfbb2393-4a66-4eac-b4c7-ba7fcc05757c`，最后发布部署 `6ad7252efad406500082b568`。该版本不含入场顺序修复。后续部署曾返回 HTTP 403：`Account credit usage exceeded - new deploys are blocked until credits are added`。此阻断是用户要求切换账号前的历史状态，不代表新站点发布失败。

旧站曾检测到数据库连接变量，但管理接口及生产分支查询失败，未完成云端读写验收，原因未确定。新站未继承此连接变量。

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
