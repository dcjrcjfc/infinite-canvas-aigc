# Sites 发布记录

## 当前状态：公开访问

用户随后要求公开。站点权限已更新为 `public`，权限修订号 2。未登录的独立 HTTP 请求已验证登录页和画布均为 200，`/api/config` 正常返回访客状态；访客不再收到配置接口 401 弹窗。云端读写及生成接口仍要求 Sites 身份认证，登录入口改用平台提供的 ChatGPT 登录流程。

本次更新构建、语法和 2 组 API 回归通过。当前 Sites 源码提交 `30964a8ab4b4cad9897a38e36d119512e2bc741a`，部署 `appgdep_6ad63327dba88191b338b55d8356afef`，版本 `appgprj_6ad62d671c2481919970a4b6ac5eec75~appgver_5c3420a19ca88191a791d36e26997802`，部署状态 `succeeded`。以下为首次私有发布的历史记录。

2026-10-19 发布成功。Sites 原生部署状态为 `succeeded`，访问范围保持新站默认的 owner-private。

- 在线站点：https://infinite-canvas-studio.whitelamb1025.chatgpt.site
- 登录首页：https://infinite-canvas-studio.whitelamb1025.chatgpt.site/zh-CN/login
- project_id：`appgprj_6ad62d671c2481919970a4b6ac5eec75`
- version_id：`appgprj_6ad62d671c2481919970a4b6ac5eec75~appgver_8c2342372dc48191a569f9267132e691`
- deployment_id：`appgdep_6ad631c9011881919f71de9d2b6a1c6e`
- Sites 源码提交：`4a35814313fe18ef1aa0b78631ce3ee3f6fbdd97`

## 源码与边界

Sites 独立源码仓库位于 `sites/infinite-canvas/`。该目录内 `.openai/hosting.json` 是站点身份的权威记录，后续更新复用此 ID，不创建重复站点。它是独立 Git 仓库；不要把它作为父项目的隐式 Git 子模块提交。父项目及 GitHub 本轮未提交或推送。

原前端构建产物复制到 Site 的 `public/`；`scripts/sync-canvas.mjs` 可从父项目刷新前端、供应商协议及项目校验器。托管适配使用 Vinext/Workers，保留 Sites 构建插件和身份认证：API 读取 dispatch 提供的用户 ID，D1 保存共享元数据、版本号、视频任务和限流记录，R2 保存共享画布快照。共享内容写入采用版本号和邀请权限原子比较，防止并发覆盖；共享能力链接仍受站点访问范围约束。

新站云数据为空，本地 IndexedDB 项目不会自动迁移。模型 API Key 和本机 `.env` 未上传；配置密钥前，生成模型显示不可用。未调用收费供应商验证生成。生成接口保留原供应商协议，生产供应商连通性尚未验证。

## 验证与发布

- Sites 构建通过，2 组新测试覆盖身份、跨站请求、未配置模型、共享权限、并发保存和撤销链接。
- 本地 Workers 模拟环境完成 D1 建表、登录配置读取、R2 写入和共享画布读回；登录页到空白画布的浏览器跳转通过。
- 浏览器直接打开本地模拟登录路由被 Edge 阻止；通过服务端 HTTP 测试验证模拟登录。未绕过浏览器安全提示。
- 原生部署工具返回成功；已请求 Codex 侧栏打开在线登录页。尚未完成线上登录后的浏览器交互验收。
- 发布包：`.local/sites-publication/infinite-canvas.tar.gz`，由 Sites source workflow 从上述推送提交打包。

当前 Windows 的 npm shim 被 Sites helper 错误定位；通过已安装 npm 的 JS 入口运行相同 install/build 脚本完成。打包时在当前进程 PATH 前置 Git Bash，设置 `TAR_OPTIONS=--force-local`，避免 WSL 缺失和 GNU tar 将 `D:` 误判为远程主机；未改变系统配置或插件源文件。
