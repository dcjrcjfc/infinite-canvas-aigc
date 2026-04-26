# Infinite Canvas AIGC

节点式无限画布 AIGC 工作流原型项目。  
你可以在一个可平移/缩放的画布中创建节点、连线组织流程、管理参考图，并直接发起文生图/图生图生成。

仓库地址：<https://github.com/dcjrcjfc/infinite-canvas-aigc>

## 1. 项目目标

- 用无限画布表达多步骤创作链路（而不是单次 prompt）
- 把“输入、参考图、生成结果”放到同一可视化工作空间里
- 逐步向可产品化的创作工作台演进（UI、交互、稳定性、安全性）

## 2. 当前能力（截至最新 `main`）

### 2.1 画布与节点

- 无限画布平移与缩放
- 节点创建（文本/图片/视频）、拖拽、删除
- 节点间 SVG 连线与联动清理
- 空画布引导层（无节点显示，有节点自动隐藏）
- 空画布模板入口（一键生成角色/分镜/海报基础链路）

### 2.2 生成与参考图

- 文生图（无参考图）
- 图生图（有参考图时自动走 edits 请求）
- 参考图自动流转（上游节点媒体传递到下游）
- 参考图手动添加与移除
- 生成结果就地更新当前节点（不再自动新建结果节点）
- 生成请求自动重试（网络波动/429/5xx）
- 生成失败分级提示（鉴权/限流/服务错误/网络错误）

### 2.3 模型与鉴权

- 节点内模型下拉选择（当前支持 `NanoBanana` / `gpt-image-2`）
- 前端仅请求本地代理接口（不再持有 API Key）
- 代理服务按模型路由不同后端环境变量 Key

### 2.4 交互与 UI

- 普通滚轮：画布平移
- `Ctrl + 滚轮`：画布缩放
- 缩放中心漂移修复（避免放大后目标“跑丢”）
- 左侧工具栏（添加/居中/重置/Agent）
- 右侧 Agent 面板（可关闭）
- 右下角 Agent 小球入口（关闭后再打开）
- Agent 状态反馈（就绪/处理中/成功/警告/错误）
- Agent 输入支持 `Ctrl+Enter` 快速发送
- 顶部胶囊与空状态视觉收口（hover/active/层级细节统一）

## 3. 技术栈与架构

纯前端项目，无构建工具依赖：

- `HTML`：结构层
- `CSS`：样式与动效
- `Vanilla JavaScript`：交互与业务逻辑
- `Node.js` 原生 `http/https`：本地安全代理（`proxy-server.js`）

分层约束（开发时必须遵守）：

- `index.html` 只放 DOM 结构和资源引用
- `style.css` 只放样式
- `script.js` 只放行为逻辑

## 4. 目录结构

```text
无限画布项目/
├─ README.md
├─ PROJECT_STATUS.md
├─ CHANGELOG.md
├─ 项目说明.md
├─ proxy-server.js
├─ .env.example
├─ 参考资料/
│  └─ *.png
└─ 无限画布/
   ├─ index.html
   ├─ style.css
   └─ script.js
```

## 5. 本地运行

### 安全运行（推荐）

1. 配置环境变量（PowerShell 示例）：

```powershell
$env:NANOBANANA_API_KEY="sk-xxxxx"
$env:GPT_IMAGE_2_API_KEY="sk-xxxxx"
```

2. 启动代理服务：

```powershell
node proxy-server.js
```

3. 打开：

```text
http://127.0.0.1:8787
```

### 直接打开 HTML（仅预览）

直接打开 `无限画布/index.html` 只适合预览 UI。  
涉及生图请求时，请使用上面的代理服务方式。

## 6. API 配置说明

当前模式：前端调用同源代理接口，密钥只保存在后端环境变量。

- 前端请求：
  - `POST /api/images/generations`
  - `POST /api/images/edits`
  - 请求头需带 `x-model-id`
- 后端环境变量：
  - `NANOBANANA_API_KEY`
  - `GPT_IMAGE_2_API_KEY`

新增模型时建议同步更新：

1. `无限画布/script.js` 的 `MODEL_OPTIONS`
2. `proxy-server.js` 的 `MODEL_KEY_ENV`

## 7. 主要交互速查

- 添加节点：左侧 `+` 按钮 -> 选择节点类型
- 删除节点/连线：选中后按 `Delete` / `Backspace`
- 画布平移：拖动画布空白处或滚轮滚动
- 画布缩放：`Ctrl + 滚轮`
- 模型切换：节点底部模型按钮 -> 下拉选择
- 参考图：
  - 自动：连线后由上游传递
  - 手动：节点参考图区域 `+` 上传
- 模板流：
  - 空画布中点击模板卡片可一键建链路
  - 顶部胶囊支持快速创建模板（角色设定流 / 分镜草案流）

## 8. 已知限制与风险

- 代理服务环境变量泄露风险（需做好部署环境权限与日志脱敏）
- 网络波动会影响 API 请求与 Git 推送
- 模型可用性受平台分组/通道配置影响（无通道会报错）

## 9. 下一步规划（简版）

1. 模板扩展与可配置化（更多模板、模板参数编辑）
2. 真实 API 联调回归（生成成功率、错误文案、重试策略验证）
3. 代理服务生产化（鉴权校验、限流、审计日志）

## 10. 协作与提交规范

- 每次改动都更新 `CHANGELOG.md`，并写明：
  - 改动
  - 原因
  - 影响
- 重要阶段同步更新 `PROJECT_STATUS.md`
- 提交示例：

```bash
git add .
git commit -m "feat: xxx"
git push origin main
```

## 11. 交接建议

新接手开发时建议按顺序阅读：

1. `README.md`
2. `PROJECT_STATUS.md`
3. `CHANGELOG.md`
4. `项目说明.md`
