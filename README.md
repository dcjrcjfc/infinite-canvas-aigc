# Infinite Canvas AIGC

节点式无限画布 AIGC 工作流原型项目。  
在一个可平移/缩放的画布中，通过节点连线组织图像生成流程，并支持参考图自动流转（Img2Img 条件输入）。

## 功能概览

- 无限画布：平移、缩放、节点拖拽、连线动态更新
- 节点系统：文本/图片/视频节点创建与删除
- AIGC 生成：文生图、图生图调用
- 参考图流转：上游节点图像自动传递到下游节点
- 参考图管理：手动添加、移除参考图
- 交互优化：更顺滑的缩放/拖拽/连线体验

## 项目结构

```text
无限画布项目/
├─ README.md
├─ 项目说明.md
├─ 参考资料/
│  ├─ *.png
└─ 无限画布/
   ├─ index.html   # 页面结构（只保留 DOM 与资源引用）
   ├─ style.css    # 视觉样式与动效
   └─ script.js    # 交互逻辑与业务逻辑
```

## 本地运行

这是纯前端项目，无需打包工具。

1. 打开 `无限画布/index.html`
2. 或使用本地静态服务器运行（推荐，避免部分浏览器限制）

## 配置说明

当前 `script.js` 中使用了 `T8STAR_API_KEY` 常量进行接口请求。  
建议后续改为后端代理或环境变量注入，避免前端明文密钥泄露。

## Git 工作流

```bash
git add .
git commit -m "feat: your update"
git push
```

## 仓库地址

https://github.com/dcjrcjfc/infinite-canvas-aigc

