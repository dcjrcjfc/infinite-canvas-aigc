const MODEL_OPTIONS = [
    { id: "gemini-3.1-flash-image-preview-4k", label: "NanoBanana", icon: "🍌" },
    { id: "gpt-image-2", label: "gpt-image-2", icon: "🌀" }
];
const API_PROXY_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : window.location.origin;
const SUPPORTS_CSS_ZOOM = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1");
const HISTORY_STORAGE_KEY = "infinite_canvas_history_v1";
const MAX_HISTORY_ITEMS = 60;
const MAX_COMMAND_STACK = 40;
const API_MAX_RETRIES = 2;
const API_RETRY_DELAY_MS = 700;
const API_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const HISTORY_TYPE_LABELS = {
    node: "节点",
    link: "连线",
    edit: "编辑",
    upload: "上传",
    generate: "生成",
    agent: "Agent",
    misc: "其他"
};
const NODE_TYPE_META = {
    text: { label: "文本节点", icon: "📝" },
    image: { label: "图片节点", icon: "🖼️" },
    video: { label: "视频节点", icon: "🎬" }
};
const TEMPLATE_PRESETS = {
    character: {
        label: "角色设定流",
        nodes: [
            {
                key: "brief",
                type: "text",
                dx: -620,
                dy: -110,
                name: "角色设定",
                status: "输入节点",
                text: "角色关键词：年龄、身份、服装、性格、时代背景、镜头语言。"
            },
            {
                key: "style",
                type: "image",
                dx: -20,
                dy: -150,
                name: "风格探索",
                status: "生成节点",
                ratio: "3:4",
                prompt: "角色设定图，统一服装材质和配色，三视图参考，细节清晰。"
            },
            {
                key: "hero",
                type: "image",
                dx: 560,
                dy: -150,
                name: "主视觉输出",
                status: "生成节点",
                ratio: "3:4",
                prompt: "基于同一角色形象生成主视觉海报，电影质感，突出角色识别度。"
            }
        ],
        links: [["brief", "style"], ["style", "hero"]]
    },
    storyboard: {
        label: "分镜草案流",
        nodes: [
            {
                key: "script",
                type: "text",
                dx: -620,
                dy: 90,
                name: "剧情大纲",
                status: "输入节点",
                text: "三段式分镜：开场建立环境，中段冲突推进，结尾情绪收束。"
            },
            {
                key: "shotA",
                type: "image",
                dx: -20,
                dy: 60,
                name: "镜头 A",
                status: "生成节点",
                ratio: "16:9",
                prompt: "分镜镜头 A：建立场景关系，广角构图，明确主体和视线方向。"
            },
            {
                key: "shotB",
                type: "image",
                dx: 560,
                dy: 60,
                name: "镜头 B",
                status: "生成节点",
                ratio: "16:9",
                prompt: "分镜镜头 B：延续镜头 A 的光线与风格，表现冲突高潮。"
            }
        ],
        links: [["script", "shotA"], ["shotA", "shotB"]]
    },
    poster: {
        label: "海报概念流",
        nodes: [
            {
                key: "concept",
                type: "text",
                dx: -620,
                dy: 280,
                name: "概念文案",
                status: "输入节点",
                text: "主题、标语、受众、主色调、风格关键词、品牌语气。"
            },
            {
                key: "layout",
                type: "image",
                dx: -20,
                dy: 250,
                name: "构图草图",
                status: "生成节点",
                ratio: "2:3",
                prompt: "海报构图草图，明确主次信息层级、版式网格和视觉重心。"
            },
            {
                key: "final",
                type: "image",
                dx: 560,
                dy: 250,
                name: "终稿海报",
                status: "生成节点",
                ratio: "2:3",
                prompt: "基于构图草图输出终稿海报，强化标题可读性与品牌统一性。"
            }
        ],
        links: [["concept", "layout"], ["layout", "final"]]
    }
};

function getModelMeta(modelId) {
    return MODEL_OPTIONS.find((model) => model.id === modelId) || MODEL_OPTIONS[0];
}

function getNodeMeta(type) {
    return NODE_TYPE_META[type] || { label: "节点", icon: "◻" };
}

const State = {
    canvas: { x: -4500, y: -4500, scale: 1 },
    nodes: [], links: [], selection: { type: null, item: null },
    linking: { active: false, startEl: null }, uploadContext: null, menuConnectorEl: null,
    history: [],
    historySeq: 0,
    historyFilter: "all",
    undoStack: [],
    redoStack: [],
    multiSelection: [],
    clipboard: null,
    pasteSerial: 0,
    nodeCounters: { text: 0, image: 0, video: 0 }
};

const Engine = {
    clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },
    roundScale(v) { return Math.round(v * 1000) / 1000; },
    snapToDevicePixel(v) {
        const dpr = window.devicePixelRatio || 1;
        return Math.round(v * dpr) / dpr;
    },
    screenToCanvas(cx, cy) {
        if (SUPPORTS_CSS_ZOOM) {
            // CSS zoom mode maps as: screen = (world + translate) * scale
            return { x: cx / State.canvas.scale - State.canvas.x, y: cy / State.canvas.scale - State.canvas.y };
        }
        return { x: (cx - State.canvas.x) / State.canvas.scale, y: (cy - State.canvas.y) / State.canvas.scale };
    },
    getCurvePath(x1, y1, x2, y2) { const d = Math.abs(x2 - x1) * 0.4; return `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`; },
    getConnPos(el) {
        const r = el.getBoundingClientRect(), cr = document.getElementById('canvas').getBoundingClientRect();
        return { x: (r.left + r.width/2 - cr.left) / State.canvas.scale, y: (r.top + r.height/2 - cr.top) / State.canvas.scale };
    }
};

const UI = {
    updateCanvas() {
        const tx = Engine.snapToDevicePixel(State.canvas.x);
        const ty = Engine.snapToDevicePixel(State.canvas.y);
        const s = Engine.roundScale(State.canvas.scale);
        const canvas = document.getElementById('canvas');
        if (SUPPORTS_CSS_ZOOM) {
            // Native zoom usually keeps text/vector edges crisper than transform scale.
            canvas.style.transform = `translate(${tx}px, ${ty}px)`;
            canvas.style.zoom = String(s);
        } else {
            canvas.style.zoom = "";
            canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
        }
    },
    updateZoomUI() {
        const slider = document.getElementById('zoom-slider');
        const label = document.getElementById('zoom-label');
        if (!slider || !label) return;
        const value = Math.round(State.canvas.scale * 100);
        slider.value = String(value);
        label.textContent = `${value}%`;
    },
    getNextNodeName(type) {
        if (!Object.prototype.hasOwnProperty.call(State.nodeCounters, type)) State.nodeCounters[type] = 0;
        State.nodeCounters[type] += 1;
        const meta = getNodeMeta(type);
        return `${meta.label} ${State.nodeCounters[type]}`;
    },
    createNode(type, pos, url = null, options = {}) {
        const withPrompt = options.withPrompt !== false;
        const nodeMeta = getNodeMeta(type);
        const node = document.createElement('div');
        node.className = 'node';
        node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px';
        node.dataset.nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        node.dataset.model = MODEL_OPTIONS[0].id;
        node.dataset.ratio = "1:1";
        node.dataset.nodeType = type;
        node.dataset.nodeName = options.nodeName || this.getNextNodeName(type);
        node.dataset.nodeStatus = options.status || (withPrompt ? '生成节点' : '素材节点');
        const modelMeta = getModelMeta(node.dataset.model);

        const ratios = ["1:1","16:9","9:16","4:3","3:4","2:3","3:2","7:4","4:7","21:9"];
        const ratioGridHTML = ratios.map(r => {
            const ratioClass = `ratio-shape-${r.replace(':', '-')}`;
            return `<div class="ratio-item ${r==='1:1'?'active':''}" data-ratio="${r}"><div class="ratio-visual-box"><div class="ratio-shape ${ratioClass}"></div></div><div class="ratio-label">${r}</div></div>`;
        }).join('');
        const modelListHTML = MODEL_OPTIONS.map((model) => {
            const activeClass = model.id === node.dataset.model ? "active" : "";
            return `<button class="model-item ${activeClass}" data-model-id="${model.id}" type="button"><span class="model-item-icon">${model.icon}</span><span class="model-item-label">${model.label}</span></button>`;
        }).join('');

        let mediaHTML = `<span class="media-placeholder">${type==='video'?'🎬':'🖼️'}</span>`;
        if (url) mediaHTML = type==='video' ? `<video src="${url}" autoplay loop muted></video>` : `<img src="${url}">`;
        const nodeHeaderHTML = `
            <div class="node-head">
                <div class="node-type-meta"><span>${nodeMeta.icon}</span><span>${nodeMeta.label}</span></div>
                <span class="node-status-tag">${node.dataset.nodeStatus}</span>
            </div>
            <div class="node-label" title="双击重命名">${node.dataset.nodeName}</div>
        `;

        // withPrompt=false: 只保留图片框 + 左右连接点（用于上传素材节点）
        node.innerHTML = withPrompt ? `
            ${nodeHeaderHTML}
            <div class="box-wrapper">
                ${type !== 'text' ? `<div class="node-upload-pill">↑ 上传</div>` : ''}
                <div class="connector conn-left">＋</div>
                <div class="node-box"><div class="media-container">${type==='text'?`<textarea class="ai-input text-node-input" placeholder="开始创作..."></textarea>`:mediaHTML}</div></div>
                <div class="connector conn-right">＋</div>
            </div>
            <div class="ai-panel">
                <div class="ref-toolbar">
                    <div class="ref-container"></div>
                    <button class="ref-add-btn" title="添加参考图">＋</button>
                </div>
                <textarea class="ai-input" placeholder="输入指令..."></textarea>
                <div class="ai-footer">
                    <div class="footer-group"><div class="footer-btn model-switch">${modelMeta.icon} ${modelMeta.label}</div><div class="footer-btn ratio-toggle">⬜ ${node.dataset.ratio}</div></div>
                    <div class="send-btn">↑</div>
                </div>
                <div class="model-popover">${modelListHTML}</div>
                <div class="ratio-popover"><div class="ratio-title">输出比例</div><div class="ratio-grid">${ratioGridHTML}</div></div>
            </div>
        ` : `
            ${nodeHeaderHTML}
            <div class="box-wrapper">
                ${type !== 'text' ? `<div class="node-upload-pill">↑ 替换</div>` : ''}
                <div class="connector conn-left">＋</div>
                <div class="node-box"><div class="media-container">${type==='text'?`<textarea class="ai-input text-node-input" placeholder="开始创作..."></textarea>`:mediaHTML}</div></div>
                <div class="connector conn-right">＋</div>
            </div>
        `;
        document.getElementById('canvas').appendChild(node);
        return node;
    },
    updateLines() {
        State.links.forEach(l => {
            const p1 = Engine.getConnPos(l.fromEl), p2 = Engine.getConnPos(l.toEl);
            l.pathEl.setAttribute('d', Engine.getCurvePath(p1.x, p1.y, p2.x, p2.y));
        });
    }
};

const Interaction = {
    minScale: 0.25,
    maxScale: 2.6,
    isPanning: false,
    dragNode: null,
    dragNodes: [],
    dragSceneBefore: null,
    dragMoved: false,
    panVelocity: { x: 0, y: 0 },
    mouseScreen: { x: 0, y: 0 },
    renderRAF: null,
    inertiaRAF: null,
    dirtyCanvas: false,
    dirtyLines: false,
    dirtyTempLine: false,
    motionEnabled: !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    connectorPressTimer: null,
    connectorPressEl: null,
    connectorLongPressTriggered: false,
    isMarqueeSelecting: false,
    marqueeStart: null,

    requestRender({ canvas = false, lines = false, tempLine = false } = {}) {
        this.dirtyCanvas = this.dirtyCanvas || canvas;
        this.dirtyLines = this.dirtyLines || lines;
        this.dirtyTempLine = this.dirtyTempLine || tempLine;
        if (this.renderRAF) return;
        this.renderRAF = requestAnimationFrame(() => {
            if (this.dirtyCanvas) UI.updateCanvas();
            if (this.dirtyCanvas) UI.updateZoomUI();
            if (this.dirtyLines) UI.updateLines();
            if (this.dirtyTempLine) {
                if (State.linking.active && State.linking.startEl) {
                    const mouse = Engine.screenToCanvas(this.mouseScreen.x, this.mouseScreen.y);
                    const start = Engine.getConnPos(State.linking.startEl);
                    document.getElementById('temp-line').setAttribute('d', Engine.getCurvePath(start.x, start.y, mouse.x, mouse.y));
                } else {
                    document.getElementById('temp-line').setAttribute('d', '');
                }
            }
            this.dirtyCanvas = false;
            this.dirtyLines = false;
            this.dirtyTempLine = false;
            this.renderRAF = null;
        });
    },

    stopInertia() {
        if (!this.inertiaRAF) return;
        cancelAnimationFrame(this.inertiaRAF);
        this.inertiaRAF = null;
        this.panVelocity.x = 0;
        this.panVelocity.y = 0;
    },

    startInertia() {
        const decay = 0.9;
        const minSpeed = 0.1;
        const tick = () => {
            this.panVelocity.x *= decay;
            this.panVelocity.y *= decay;
            if (Math.abs(this.panVelocity.x) < minSpeed && Math.abs(this.panVelocity.y) < minSpeed) {
                this.stopInertia();
                return;
            }
            State.canvas.x += this.panVelocity.x;
            State.canvas.y += this.panVelocity.y;
            this.requestRender({ canvas: true, lines: true, tempLine: true });
            this.inertiaRAF = requestAnimationFrame(tick);
        };
        this.stopInertia();
        this.inertiaRAF = requestAnimationFrame(tick);
    },

    zoomAt(clientX, clientY, factor) {
        const oldScale = State.canvas.scale;
        const newScale = Engine.clamp(oldScale * factor, this.minScale, this.maxScale);
        if (Math.abs(newScale - oldScale) < 0.0001) return;
        let worldX;
        let worldY;
        if (SUPPORTS_CSS_ZOOM) {
            worldX = clientX / oldScale - State.canvas.x;
            worldY = clientY / oldScale - State.canvas.y;
        } else {
            worldX = (clientX - State.canvas.x) / oldScale;
            worldY = (clientY - State.canvas.y) / oldScale;
        }
        State.canvas.scale = newScale;
        if (SUPPORTS_CSS_ZOOM) {
            State.canvas.x = clientX / newScale - worldX;
            State.canvas.y = clientY / newScale - worldY;
        } else {
            State.canvas.x = clientX - worldX * newScale;
            State.canvas.y = clientY - worldY * newScale;
        }
        this.requestRender({ canvas: true, lines: true, tempLine: true });
    },

    setScaleByPercent(percent) {
        const nextScale = Engine.clamp(percent / 100, this.minScale, this.maxScale);
        const viewport = document.getElementById('viewport');
        const cx = viewport.clientWidth / 2;
        const cy = viewport.clientHeight / 2;
        const oldScale = State.canvas.scale;
        if (Math.abs(nextScale - oldScale) < 0.0001) return;
        let worldX;
        let worldY;
        if (SUPPORTS_CSS_ZOOM) {
            worldX = cx / oldScale - State.canvas.x;
            worldY = cy / oldScale - State.canvas.y;
        } else {
            worldX = (cx - State.canvas.x) / oldScale;
            worldY = (cy - State.canvas.y) / oldScale;
        }
        State.canvas.scale = nextScale;
        if (SUPPORTS_CSS_ZOOM) {
            State.canvas.x = cx / nextScale - worldX;
            State.canvas.y = cy / nextScale - worldY;
        } else {
            State.canvas.x = cx - worldX * nextScale;
            State.canvas.y = cy - worldY * nextScale;
        }
        this.requestRender({ canvas: true, lines: true, tempLine: true });
    },

    resetView() {
        State.canvas.x = -4500;
        State.canvas.y = -4500;
        State.canvas.scale = 1;
        this.requestRender({ canvas: true, lines: true, tempLine: true });
    },

    focusCanvasCenter() {
        const viewport = document.getElementById('viewport');
        const cx = viewport.clientWidth / 2;
        const cy = viewport.clientHeight / 2;
        const worldCenter = { x: 5000, y: 5000 };
        State.canvas.x = cx - worldCenter.x * State.canvas.scale;
        State.canvas.y = cy - worldCenter.y * State.canvas.scale;
        this.requestRender({ canvas: true, lines: true, tempLine: true });
    },

    setAgentPanelOpen(isOpen) {
        const panel = document.querySelector('.agent-panel');
        const fab = document.getElementById('agent-fab');
        const railBtn = document.getElementById('rail-agent-btn');
        if (!panel) return;
        panel.classList.toggle('hidden', !isOpen);
        if (fab) fab.classList.toggle('visible', !isOpen);
        if (railBtn) railBtn.classList.toggle('active', isOpen);
        document.body.classList.toggle('agent-open', isOpen);
        document.body.classList.toggle('agent-closed', !isOpen);
    },

    toggleAgentPanel() {
        const panel = document.querySelector('.agent-panel');
        if (!panel) return;
        this.setAgentPanelOpen(panel.classList.contains('hidden'));
    },

    syncCanvasEmptyState() {
        const emptyState = document.getElementById('canvas-empty-state');
        const menu = document.getElementById('nodeMenu');
        if (!emptyState) return;
        const menuVisible = !!menu && menu.style.display === 'block';
        emptyState.classList.toggle('hidden', State.nodes.length > 0 || menuVisible);
    },

    createTemplateFlow(templateId) {
        const preset = TEMPLATE_PRESETS[templateId];
        if (!preset) {
            this.toast('模板不存在或暂不可用', 'warn');
            return;
        }
        const viewport = document.getElementById('viewport');
        if (!viewport) return;

        let focusNodeEl = null;
        let createdNodeId = null;
        const created = this.runSceneCommand(
            { historyType: 'node', historyText: `模板创建：${preset.label}` },
            () => {
                const center = Engine.screenToCanvas(viewport.clientWidth * 0.45, viewport.clientHeight * 0.48);
                const nodeMap = {};
                preset.nodes.forEach((config) => {
                    const pos = {
                        x: center.x + Number(config.dx || 0),
                        y: center.y + Number(config.dy || 0)
                    };
                    const el = UI.createNode(config.type, pos, null, { nodeName: config.name || undefined });
                    State.nodes.push({ el, x: pos.x, y: pos.y, type: config.type });
                    nodeMap[config.key] = el;
                    if (!focusNodeEl) focusNodeEl = el;
                    if (!createdNodeId) createdNodeId = el.dataset.nodeId;

                    if (config.status) this.updateNodeStatus(el, config.status);
                    if (config.ratio && el.querySelector('.ratio-toggle')) {
                        el.dataset.ratio = config.ratio;
                        el.querySelector('.ratio-toggle').innerText = `⬜ ${config.ratio}`;
                        el.querySelectorAll('.ratio-item').forEach((item) => {
                            item.classList.toggle('active', item.dataset.ratio === config.ratio);
                        });
                    }

                    const textInput = el.querySelector('.text-node-input');
                    if (textInput && config.text) textInput.value = config.text;
                    const promptInput = el.querySelector('.ai-panel .ai-input');
                    if (promptInput && config.prompt) promptInput.value = config.prompt;
                });

                preset.links.forEach(([fromKey, toKey]) => {
                    const fromNode = nodeMap[fromKey];
                    const toNode = nodeMap[toKey];
                    if (!fromNode || !toNode) return;
                    const fromConnector = fromNode.querySelector('.conn-right');
                    const toConnector = toNode.querySelector('.conn-left');
                    this.createLinkBetween(fromConnector, toConnector);
                });
                this.syncCanvasEmptyState();
            }
        );
        if (!created) return;

        if (createdNodeId) {
            const latestHistory = State.history[0];
            if (latestHistory && latestHistory.type === 'node' && !latestHistory.nodeId) latestHistory.nodeId = createdNodeId;
            this.saveHistory();
            this.renderHistory();
        }

        this.closeNodeMenu();
        this.closeRailPopups();
        if (focusNodeEl) this.focusNode(focusNodeEl);
        this.setAgentStatus(`模板已创建：${preset.label}`, 'success');
        this.scheduleAgentReady(1800);
        this.toast(`已创建模板：${preset.label}`, 'success');
    },

    openNodeMenuAt(clientX, clientY, connectorEl = null) {
        const menu = document.getElementById('nodeMenu');
        if (!menu) return;
        const menuWidth = 260;
        const menuHeight = 260;
        const nextLeft = Math.max(12, Math.min(clientX + 10, window.innerWidth - menuWidth - 12));
        const nextTop = Math.max(12, Math.min(clientY + 10, window.innerHeight - menuHeight - 12));
        menu.style.left = `${nextLeft}px`;
        menu.style.top = `${nextTop}px`;
        menu.style.display = 'block';
        State.menuConnectorEl = connectorEl || null;
        document.getElementById('ui-add-btn')?.classList.add('active');
        this.syncCanvasEmptyState();
    },

    closeNodeMenu() {
        const menu = document.getElementById('nodeMenu');
        if (menu) menu.style.display = 'none';
        State.menuConnectorEl = null;
        document.getElementById('ui-add-btn')?.classList.remove('active');
        this.syncCanvasEmptyState();
    },

    closeRailPopups() {
        document.getElementById('rail-history-panel')?.classList.remove('show');
        document.getElementById('rail-editor-panel')?.classList.remove('show');
        document.getElementById('rail-profile-menu')?.classList.remove('show');
        document.getElementById('rail-history-btn')?.classList.remove('active');
        document.getElementById('rail-editor-btn')?.classList.remove('active');
        document.getElementById('rail-profile-btn')?.classList.remove('active');
    },

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    toast(message, type = 'info', duration = 1600) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        const tone = ['info', 'success', 'warn', 'error'].includes(type) ? type : 'info';
        toast.textContent = message;
        toast.className = `toast toast-${tone}`;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
    },

    setAgentStatus(message, state = 'info') {
        const statusEl = document.getElementById('agent-status');
        if (!statusEl) return;
        const tone = ['info', 'busy', 'success', 'warn', 'error'].includes(state) ? state : 'info';
        statusEl.textContent = message || '已就绪';
        statusEl.classList.remove('is-info', 'is-busy', 'is-success', 'is-warn', 'is-error');
        statusEl.classList.add(`is-${tone}`);
    },

    setAgentBusy(isBusy) {
        const sendBtn = document.getElementById('agent-send-btn');
        if (sendBtn) {
            sendBtn.disabled = isBusy;
            sendBtn.classList.toggle('loading', isBusy);
        }
        document.querySelectorAll('.agent-chip').forEach((chip) => {
            chip.disabled = isBusy;
        });
    },

    scheduleAgentReady(delay = 1400) {
        clearTimeout(this._agentStatusTimer);
        this._agentStatusTimer = setTimeout(() => this.setAgentStatus('已就绪', 'info'), delay);
    },

    classifyApiError(status, payload, fallback = '') {
        const raw = typeof payload === 'string'
            ? payload
            : (payload?.error?.message || payload?.error || payload?.message || fallback || '');
        const suffix = raw ? `（${String(raw).slice(0, 80)}）` : '';
        if (status === 401 || status === 403) {
            return {
                code: 'auth',
                message: `鉴权失败，请检查代理环境变量或模型权限${suffix}`
            };
        }
        if (status === 429) {
            return {
                code: 'rate',
                message: `请求过于频繁，已触发限流，请稍后重试${suffix}`
            };
        }
        if (status >= 500) {
            return {
                code: 'server',
                message: `服务暂时不可用（${status}），请稍后重试${suffix}`
            };
        }
        if (status >= 400) {
            return {
                code: 'request',
                message: `请求失败（${status}），请检查输入内容或模型配置${suffix}`
            };
        }
        return {
            code: 'network',
            message: '网络异常，请确认代理服务已启动（http://127.0.0.1:8787）后重试'
        };
    },

    async fetchWithRetry(requestFactory, options = {}) {
        const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : API_MAX_RETRIES;
        const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : API_RETRY_DELAY_MS;
        let retryCount = 0;
        while (true) {
            try {
                const response = await requestFactory();
                if (response.ok || !API_RETRYABLE_STATUS.has(response.status) || retryCount >= maxRetries) {
                    return { response, retryCount };
                }
                retryCount += 1;
                if (typeof options.onRetry === 'function') options.onRetry({ retryCount, status: response.status });
                await this.sleep(retryDelayMs * retryCount);
            } catch (error) {
                if (retryCount >= maxRetries) throw error;
                retryCount += 1;
                if (typeof options.onRetry === 'function') options.onRetry({ retryCount, error });
                await this.sleep(retryDelayMs * retryCount);
            }
        }
    },

    getSelectedNodeElements() {
        if (State.multiSelection.length) return [...State.multiSelection];
        if (State.selection.type === 'node' && State.selection.item) return [State.selection.item];
        return [];
    },

    clearMultiSelection() {
        State.multiSelection.forEach((nodeEl) => nodeEl.classList.remove('multi-selected'));
        State.multiSelection = [];
    },

    toggleNodeMultiSelection(nodeEl) {
        if (!nodeEl) return;
        const exists = State.multiSelection.includes(nodeEl);
        if (exists) {
            nodeEl.classList.remove('multi-selected');
            State.multiSelection = State.multiSelection.filter((item) => item !== nodeEl);
            if (State.selection.type === 'node' && State.selection.item === nodeEl) this.deselect();
            return;
        }
        if (State.selection.type === 'line') this.deselect();
        nodeEl.classList.add('multi-selected');
        State.multiSelection.push(nodeEl);
        if (!State.selection.item) {
            State.selection = { type: 'node', item: nodeEl };
            nodeEl.classList.add('selected');
        }
    },

    updateNodeStatus(nodeEl, status) {
        if (!nodeEl || !status) return;
        nodeEl.dataset.nodeStatus = status;
        const statusEl = nodeEl.querySelector('.node-status-tag');
        if (statusEl) statusEl.textContent = status;
    },

    applyNodeName(nodeEl, name, options = {}) {
        const { syncReferenceSource = true } = options;
        if (!nodeEl) return;
        const nextName = (name || '').trim() || nodeEl.dataset.nodeName || '未命名节点';
        nodeEl.dataset.nodeName = nextName;
        const label = nodeEl.querySelector('.node-label');
        if (label) {
            label.textContent = nextName;
            label.classList.remove('editing');
        }
        if (syncReferenceSource) this.refreshReferenceSourceMeta(nodeEl);
    },

    renameSelectedNode() {
        const nodeEl = State.selection.type === 'node' ? State.selection.item : State.multiSelection[0];
        if (!nodeEl) {
            this.toast('请先选中节点');
            return;
        }
        this.startRenameNode(nodeEl);
    },

    startRenameNode(nodeEl) {
        if (!nodeEl) return;
        const label = nodeEl.querySelector('.node-label');
        if (!label || label.classList.contains('editing')) return;
        const oldName = nodeEl.dataset.nodeName || label.textContent.trim() || '未命名节点';
        label.classList.add('editing');
        label.innerHTML = `<input class="node-rename-input" type="text" value="${this.escapeHtml(oldName)}" maxlength="48">`;
        const input = label.querySelector('.node-rename-input');
        if (!input) return;
        input.focus();
        input.select();

        let done = false;
        const commit = (confirm = true) => {
            if (done) return;
            done = true;
            const raw = input.value.trim();
            const nextName = confirm && raw ? raw : oldName;
            this.applyNodeName(nodeEl, oldName);
            if (nextName !== oldName) {
                this.runSceneCommand(
                    { historyType: 'node', historyText: `重命名：${oldName} -> ${nextName}`, nodeId: nodeEl.dataset.nodeId },
                    () => this.applyNodeName(nodeEl, nextName)
                );
                this.toast('节点名称已更新');
            }
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                commit(false);
            }
        };
        input.onblur = () => commit(true);
    },

    copySelectedNodes() {
        const selectedNodes = this.getSelectedNodeElements();
        if (!selectedNodes.length) {
            this.toast('请先选中节点');
            return;
        }
        const selectedIds = new Set(selectedNodes.map((nodeEl) => nodeEl.dataset.nodeId));
        const scene = this.captureScene();
        const nodes = scene.nodes.filter((node) => selectedIds.has(node.id));
        if (!nodes.length) {
            this.toast('当前选择没有可复制节点');
            return;
        }
        const links = scene.links.filter((link) => selectedIds.has(link.fromNodeId) && selectedIds.has(link.toNodeId));
        State.clipboard = { nodes, links };
        this.toast(`已复制 ${nodes.length} 个节点`);
    },

    instantiateNodeFromSnapshot(snapshot, options = {}) {
        const { preserveId = true, idOverride = null, offsetX = 0, offsetY = 0, includeLinkedRefs = true } = options;
        const pos = { x: Number(snapshot.x) + offsetX || 0, y: Number(snapshot.y) + offsetY || 0 };
        const mediaUrl = snapshot.media?.src || null;
        const nodeEl = UI.createNode(snapshot.type, pos, mediaUrl, {
            withPrompt: snapshot.withPrompt !== false,
            nodeName: snapshot.name || snapshot.nodeName || snapshot.id,
            status: snapshot.status || (snapshot.withPrompt !== false ? '生成节点' : '素材节点')
        });
        const nodeId = idOverride || (preserveId ? snapshot.id : null);
        if (nodeId) nodeEl.dataset.nodeId = nodeId;
        nodeEl.dataset.model = snapshot.model || MODEL_OPTIONS[0].id;
        nodeEl.dataset.ratio = snapshot.ratio || '1:1';
        this.updateNodeStatus(nodeEl, snapshot.status || nodeEl.dataset.nodeStatus);
        this.applyNodeName(nodeEl, snapshot.name || snapshot.nodeName || nodeEl.dataset.nodeName);

        const modelBtn = nodeEl.querySelector('.model-switch');
        if (modelBtn) {
            const modelMeta = getModelMeta(nodeEl.dataset.model);
            modelBtn.textContent = `${modelMeta.icon} ${modelMeta.label}`;
        }
        const ratioBtn = nodeEl.querySelector('.ratio-toggle');
        if (ratioBtn) ratioBtn.innerText = `⬜ ${nodeEl.dataset.ratio}`;

        const promptInput = nodeEl.querySelector('.ai-panel .ai-input');
        if (promptInput) promptInput.value = snapshot.prompt || '';
        const textInput = nodeEl.querySelector('.text-node-input');
        if (textInput) textInput.value = snapshot.textValue || '';

        const img = nodeEl.querySelector('.media-container img');
        if (img) {
            img.style.filter = snapshot.imageFilter || '';
            img.dataset.rotateDeg = snapshot.rotateDeg || '0';
            img.dataset.flipX = snapshot.flipX || '0';
            this.applyImageTransform(img);
        }

        const refsSource = Array.isArray(snapshot.refs) ? snapshot.refs : [];
        nodeEl._refs = refsSource
            .filter((ref) => includeLinkedRefs || !ref.linkId)
            .map((ref) => ({ ...ref, file: null }));
        this.renderReferences(nodeEl);
        const nodeModel = { el: nodeEl, x: pos.x, y: pos.y, type: snapshot.type };
        State.nodes.push(nodeModel);
        return nodeEl;
    },

    pasteCopiedNodes() {
        if (!State.clipboard?.nodes?.length) {
            this.toast('剪贴板为空');
            return;
        }
        const selectedAfterPaste = [];
        const shift = 48 + (State.pasteSerial % 4) * 18;
        State.pasteSerial += 1;
        this.runSceneCommand(
            { historyType: 'node', historyText: `粘贴 ${State.clipboard.nodes.length} 个节点` },
            () => {
                this.clearMultiSelection();
                this.deselect();
                const idMap = new Map();
                State.clipboard.nodes.forEach((snapshot) => {
                    const nodeEl = this.instantiateNodeFromSnapshot(snapshot, {
                        preserveId: false,
                        offsetX: shift,
                        offsetY: shift,
                        includeLinkedRefs: false
                    });
                    idMap.set(snapshot.id, nodeEl.dataset.nodeId);
                    selectedAfterPaste.push(nodeEl);
                });
                State.clipboard.links.forEach((linkSnapshot) => {
                    const fromId = idMap.get(linkSnapshot.fromNodeId);
                    const toId = idMap.get(linkSnapshot.toNodeId);
                    if (!fromId || !toId) return;
                    const fromNode = document.querySelector(`.node[data-node-id="${fromId}"]`);
                    const toNode = document.querySelector(`.node[data-node-id="${toId}"]`);
                    if (!fromNode || !toNode) return;
                    const fromConnector = fromNode.querySelector(`.${linkSnapshot.fromConnector || 'conn-right'}`);
                    const toConnector = toNode.querySelector(`.${linkSnapshot.toConnector || 'conn-left'}`);
                    if (!fromConnector || !toConnector) return;
                    this.createLinkBetween(fromConnector, toConnector);
                });
                this.syncCanvasEmptyState();
                this.requestRender({ lines: true, tempLine: true });
            }
        );
        selectedAfterPaste.forEach((nodeEl) => {
            nodeEl.classList.add('multi-selected');
            State.multiSelection.push(nodeEl);
        });
        if (selectedAfterPaste[0]) {
            State.selection = { type: 'node', item: selectedAfterPaste[0] };
            selectedAfterPaste[0].classList.add('selected');
            this.focusNode(selectedAfterPaste[0], { keepMulti: true });
        }
        this.toast(`已粘贴 ${selectedAfterPaste.length} 个节点`);
    },

    nextHistoryId() {
        State.historySeq += 1;
        return `h_${Date.now()}_${State.historySeq}`;
    },

    escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
    },

    getHistoryTypeLabel(type) {
        return HISTORY_TYPE_LABELS[type] || HISTORY_TYPE_LABELS.misc;
    },

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('history-undo-btn');
        const redoBtn = document.getElementById('history-redo-btn');
        if (undoBtn) undoBtn.disabled = State.undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = State.redoStack.length === 0;
    },

    loadHistory() {
        try {
            const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            State.history = Array.isArray(parsed) ? parsed.map((item, index) => ({
                id: item.id || `legacy_${Date.now()}_${index}`,
                type: item.type || 'misc',
                text: item.text || '',
                time: item.time || new Date().toLocaleString(),
                nodeId: item.nodeId || null,
                scene: item.scene || null
            })) : [];
        } catch {
            State.history = [];
        }
        State.history = State.history.slice(0, MAX_HISTORY_ITEMS);
        State.historySeq = State.history.reduce((max, item) => {
            const seq = Number(String(item.id || '').split('_').pop());
            return Number.isFinite(seq) ? Math.max(max, seq) : max;
        }, 0);
        this.renderHistory();
    },

    saveHistory() {
        try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(State.history.slice(0, MAX_HISTORY_ITEMS)));
        } catch {}
    },

    pushHistory(type, text, meta = {}) {
        const scene = meta.scene ? JSON.parse(JSON.stringify(meta.scene)) : null;
        State.history.unshift({
            id: this.nextHistoryId(),
            type: type || 'misc',
            text: text || '',
            time: new Date().toLocaleString(),
            nodeId: meta.nodeId || null,
            scene
        });
        State.history = State.history.slice(0, MAX_HISTORY_ITEMS);
        this.saveHistory();
        this.renderHistory();
    },

    renderHistory() {
        const list = document.getElementById('history-list');
        if (!list) return;
        if (!State.history.length) {
            list.innerHTML = `<div class="rail-popup-body">暂无历史记录</div>`;
            return;
        }
        const filtered = State.historyFilter === 'all' ? State.history : State.history.filter((item) => item.type === State.historyFilter);
        if (!filtered.length) {
            list.innerHTML = `<div class="rail-popup-body">当前筛选条件下暂无记录</div>`;
            return;
        }
        list.innerHTML = filtered.map((item) => {
            const replayDisabled = item.scene ? "" : "disabled";
            return `
                <div class="history-item" data-history-id="${this.escapeHtml(item.id)}" data-node-id="${this.escapeHtml(item.nodeId || '')}">
                    <div class="history-item-head">
                        <span class="history-type">${this.escapeHtml(this.getHistoryTypeLabel(item.type))}</span>
                        <span class="history-time">${this.escapeHtml(item.time)}</span>
                    </div>
                    <div class="history-text">${this.escapeHtml(item.text)}</div>
                    <div class="history-item-actions">
                        <button class="history-act-btn history-focus-btn" type="button">定位</button>
                        <button class="history-act-btn history-replay-btn" type="button" ${replayDisabled}>回放</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    findHistoryItemById(historyId) {
        if (!historyId) return null;
        return State.history.find((item) => item.id === historyId) || null;
    },

    focusHistoryItem(item) {
        if (!item?.nodeId) {
            this.toast('该记录没有关联节点');
            return;
        }
        const nodeEl = document.querySelector(`.node[data-node-id="${item.nodeId}"]`);
        if (!nodeEl) {
            this.toast('对应节点已不存在');
            return;
        }
        this.focusNode(nodeEl);
        this.toast('已定位到历史节点');
    },

    replayHistoryItem(item) {
        if (!item?.scene) {
            this.toast('该记录暂不支持回放');
            return;
        }
        const beforeScene = this.captureScene();
        this.restoreScene(item.scene);
        const afterScene = this.captureScene();
        if (JSON.stringify(beforeScene) !== JSON.stringify(afterScene)) {
            this.pushCommand(beforeScene, afterScene);
        }
        if (item.nodeId) {
            const nodeEl = document.querySelector(`.node[data-node-id="${item.nodeId}"]`);
            if (nodeEl) this.focusNode(nodeEl);
        }
        this.toast('已回放并还原到该状态');
    },

    captureScene() {
        const nodes = State.nodes.map((node) => {
            const nodeEl = node.el;
            const imageEl = nodeEl.querySelector('.media-container img');
            const videoEl = nodeEl.querySelector('.media-container video');
            const promptInput = nodeEl.querySelector('.ai-panel .ai-input');
            const textInput = nodeEl.querySelector('.text-node-input');
            const media = imageEl ? { kind: 'img', src: imageEl.src } : (videoEl ? { kind: 'video', src: videoEl.src } : { kind: 'none', src: null });
            return {
                id: nodeEl.dataset.nodeId,
                type: node.type,
                x: node.x,
                y: node.y,
                name: nodeEl.dataset.nodeName || nodeEl.querySelector('.node-label')?.textContent?.trim() || '',
                status: nodeEl.dataset.nodeStatus || '',
                withPrompt: !!nodeEl.querySelector('.ai-panel'),
                model: nodeEl.dataset.model || MODEL_OPTIONS[0].id,
                ratio: nodeEl.dataset.ratio || '1:1',
                prompt: promptInput ? promptInput.value : '',
                textValue: textInput ? textInput.value : '',
                media,
                imageFilter: imageEl?.style.filter || '',
                rotateDeg: imageEl?.dataset.rotateDeg || '0',
                flipX: imageEl?.dataset.flipX || '0',
                refs: Array.isArray(nodeEl._refs) ? nodeEl._refs.map((ref) => ({ ...ref, file: null })) : []
            };
        });
        const links = State.links.map((link) => ({
            id: link.id,
            fromNodeId: link.fromEl.closest('.node')?.dataset.nodeId || null,
            toNodeId: link.toEl.closest('.node')?.dataset.nodeId || null,
            fromConnector: link.fromEl.classList.contains('conn-left') ? 'conn-left' : 'conn-right',
            toConnector: link.toEl.classList.contains('conn-left') ? 'conn-left' : 'conn-right'
        }));
        return {
            canvas: { ...State.canvas },
            nodes,
            links
        };
    },

    restoreScene(scene) {
        if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(scene.links)) return;
        this.closeNodeMenu();
        this.closeAllNodePopovers();
        this.stopLinking();
        this.deselect();

        State.links.forEach((link) => link.pathEl.remove());
        State.nodes.forEach((node) => node.el.remove());
        State.links = [];
        State.nodes = [];
        this.clearMultiSelection();

        const nodeMap = new Map();
        scene.nodes.forEach((snapshot) => {
            const nodeEl = this.instantiateNodeFromSnapshot(snapshot, { preserveId: true });
            if (!nodeEl.dataset.nodeId) nodeEl.dataset.nodeId = snapshot.id || `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            nodeMap.set(nodeEl.dataset.nodeId, nodeEl);
        });

        scene.links.forEach((snapshot) => {
            const fromNodeEl = nodeMap.get(snapshot.fromNodeId);
            const toNodeEl = nodeMap.get(snapshot.toNodeId);
            if (!fromNodeEl || !toNodeEl) return;
            const fromConnectorEl = fromNodeEl.querySelector(`.${snapshot.fromConnector || 'conn-right'}`);
            const toConnectorEl = toNodeEl.querySelector(`.${snapshot.toConnector || 'conn-left'}`);
            if (!fromConnectorEl || !toConnectorEl) return;
            this.createLinkBetween(fromConnectorEl, toConnectorEl, { linkId: snapshot.id, syncReference: false });
        });

        State.canvas.x = Number(scene.canvas?.x ?? -4500);
        State.canvas.y = Number(scene.canvas?.y ?? -4500);
        State.canvas.scale = Number(scene.canvas?.scale ?? 1);
        this.requestRender({ canvas: true, lines: true, tempLine: true });
        this.syncCanvasEmptyState();
        this.updateUndoRedoUI();
    },

    pushCommand(beforeScene, afterScene) {
        State.undoStack.push({ before: beforeScene, after: afterScene });
        if (State.undoStack.length > MAX_COMMAND_STACK) State.undoStack.shift();
        State.redoStack = [];
        this.updateUndoRedoUI();
    },

    runSceneCommand({ historyType = 'misc', historyText = '', nodeId = null } = {}, mutator) {
        const beforeScene = this.captureScene();
        mutator();
        const afterScene = this.captureScene();
        if (JSON.stringify(beforeScene) === JSON.stringify(afterScene)) return false;
        this.pushCommand(beforeScene, afterScene);
        if (historyText) this.pushHistory(historyType, historyText, { nodeId, scene: afterScene });
        return true;
    },

    undo() {
        if (!State.undoStack.length) {
            this.toast('没有可撤销操作');
            return;
        }
        const command = State.undoStack.pop();
        State.redoStack.push(command);
        if (State.redoStack.length > MAX_COMMAND_STACK) State.redoStack.shift();
        this.restoreScene(command.before);
        this.updateUndoRedoUI();
        this.toast('已撤销');
    },

    redo() {
        if (!State.redoStack.length) {
            this.toast('没有可重做操作');
            return;
        }
        const command = State.redoStack.pop();
        State.undoStack.push(command);
        if (State.undoStack.length > MAX_COMMAND_STACK) State.undoStack.shift();
        this.restoreScene(command.after);
        this.updateUndoRedoUI();
        this.toast('已重做');
    },

    applyImageTransform(img) {
        if (!img) return;
        const rotate = Number(img.dataset.rotateDeg || '0');
        const flipX = img.dataset.flipX === '1';
        img.style.transform = `${flipX ? 'scaleX(-1) ' : ''}rotate(${rotate}deg)`;
    },

    ensureReferenceDefaults(node) {
        if (!node) return;
        if (!Array.isArray(node._refs)) node._refs = [];
        node._refs = node._refs.map((ref, index) => {
            const sourceType = ref.sourceType || (ref.linkId ? 'link' : 'manual');
            const sourceNodeName = ref.sourceNodeName || (sourceType === 'manual' ? '手动上传' : '上游节点');
            const weightRaw = Number(ref.weight);
            const weight = Number.isFinite(weightRaw) ? Math.max(0.5, Math.min(2, Math.round(weightRaw * 4) / 4)) : 1;
            return {
                ...ref,
                order: Number.isFinite(Number(ref.order)) ? Number(ref.order) : index,
                sourceType,
                sourceNodeName,
                sourceNodeId: ref.sourceNodeId || null,
                sourceLinkId: ref.sourceLinkId || ref.linkId || null,
                isPrimary: !!ref.isPrimary,
                weight
            };
        });
        let primaryFound = false;
        node._refs.forEach((ref) => {
            if (ref.isPrimary && !primaryFound) {
                primaryFound = true;
                return;
            }
            ref.isPrimary = false;
        });
        if (!primaryFound && node._refs[0]) node._refs[0].isPrimary = true;
    },

    getReferenceSourceText(ref) {
        if (!ref) return '未知来源';
        if (ref.sourceType === 'manual') return '手动上传';
        const sourceName = ref.sourceNodeName || '上游节点';
        return `链路: ${sourceName}`;
    },

    setPrimaryReference(node, refId) {
        if (!node || !refId) return;
        const changed = this.runSceneCommand(
            { historyType: 'edit', historyText: '设置主参考图', nodeId: node.dataset.nodeId },
            () => {
                this.ensureReferenceDefaults(node);
                let hit = false;
                node._refs.forEach((ref) => {
                    const active = ref.id === refId;
                    if (active) hit = true;
                    ref.isPrimary = active;
                });
                if (!hit && node._refs[0]) node._refs[0].isPrimary = true;
                this.renderReferences(node);
            }
        );
        if (changed) this.toast('主参考图已更新');
    },

    adjustReferenceWeight(node, refId, delta) {
        if (!node || !refId || !delta) return;
        const changed = this.runSceneCommand(
            { historyType: 'edit', historyText: '调整参考图权重', nodeId: node.dataset.nodeId },
            () => {
                this.ensureReferenceDefaults(node);
                const ref = node._refs.find((item) => item.id === refId);
                if (!ref) return;
                const next = Math.max(0.5, Math.min(2, Math.round((ref.weight + delta) * 4) / 4));
                if (Math.abs(next - ref.weight) < 0.001) return;
                ref.weight = next;
                this.renderReferences(node);
            }
        );
        if (changed) this.toast('参考图权重已调整');
    },

    moveReference(node, refId, offset) {
        if (!node || !refId || !offset) return;
        const changed = this.runSceneCommand(
            { historyType: 'edit', historyText: '调整参考图顺序', nodeId: node.dataset.nodeId },
            () => {
                this.ensureReferenceDefaults(node);
                const index = node._refs.findIndex((item) => item.id === refId);
                if (index < 0) return;
                const nextIndex = index + offset;
                if (nextIndex < 0 || nextIndex >= node._refs.length) return;
                const [current] = node._refs.splice(index, 1);
                node._refs.splice(nextIndex, 0, current);
                node._refs.forEach((ref, orderIndex) => { ref.order = orderIndex; });
                this.renderReferences(node);
            }
        );
        if (changed) this.toast('参考图顺序已更新');
    },

    focusReferenceSource(node, refId) {
        if (!node || !refId) return;
        this.ensureReferenceDefaults(node);
        const ref = node._refs.find((item) => item.id === refId);
        if (!ref) return;
        if (!ref.sourceNodeId) {
            this.toast('该参考图是手动上传来源');
            return;
        }
        const sourceNode = document.querySelector(`.node[data-node-id="${ref.sourceNodeId}"]`);
        if (!sourceNode) {
            this.toast('来源节点已不存在');
            return;
        }
        this.focusNode(sourceNode);
        this.toast('已定位到来源节点');
    },

    refreshReferenceSourceMeta(sourceNode) {
        if (!sourceNode) return;
        State.links.forEach((link) => {
            if (link.fromEl.closest('.node') !== sourceNode) return;
            const targetNode = link.toEl.closest('.node');
            if (!targetNode || !targetNode._refs) return;
            targetNode._refs = targetNode._refs.map((ref) => {
                if (ref.linkId !== link.id) return ref;
                return {
                    ...ref,
                    sourceType: 'link',
                    sourceNodeId: sourceNode.dataset.nodeId || null,
                    sourceNodeName: sourceNode.dataset.nodeName || '上游节点',
                    sourceLinkId: link.id
                };
            });
            this.ensureReferenceDefaults(targetNode);
            this.renderReferences(targetNode);
        });
    },

    getSelectedImageNode() {
        if (State.multiSelection.length) {
            const picked = State.multiSelection.find((nodeEl) => nodeEl.querySelector('.media-container img'));
            if (picked) return picked;
        }
        if (State.selection.type === 'node' && State.selection.item?.querySelector('.media-container img')) {
            return State.selection.item;
        }
        return State.nodes.find(n => n.el.querySelector('.media-container img'))?.el || null;
    },

    applyImageEditor({ brightness, contrast, saturate }) {
        const node = this.getSelectedImageNode();
        if (!node) {
            this.toast('请先选中一个图片节点');
            return;
        }
        const img = node.querySelector('.media-container img');
        if (!img) {
            this.toast('当前节点没有图片可编辑');
            return;
        }
        const applied = this.runSceneCommand(
            {
                historyType: 'edit',
                historyText: `图片编辑：亮度${brightness} 对比${contrast} 饱和${saturate}`,
                nodeId: node.dataset.nodeId
            },
            () => {
                img.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;
                this.applyImageTransform(img);
            }
        );
        this.toast(applied ? '图片编辑已应用' : '参数未变化');
    },

    async runAgentAction(type, triggerEl = null) {
        const sendBtn = document.getElementById('agent-send-btn');
        if (sendBtn?.disabled && sendBtn.classList.contains('loading')) return;
        const agentInput = document.querySelector('.agent-input');
        const selectedNode = State.selection.type === 'node' ? State.selection.item : null;
        const selectedPromptInput = selectedNode?.querySelector('.ai-panel .ai-input');
        const presets = {
            idea: "给我 5 个可落地的视觉创意方向，并附每个方向的关键词。",
            role: "帮我写一个角色设定：身份、外观、性格、场景和镜头语言。",
            ref: "帮我列出这个主题的参考图检索词（中英文各 10 条）。"
        };
        const text = presets[type] || "";
        if (!text) return;
        this.setAgentBusy(true);
        this.setAgentStatus('Agent 正在整理建议...', 'busy');
        if (triggerEl) triggerEl.classList.add('is-running');
        try {
            await this.sleep(220);
            if (agentInput) agentInput.value = text;
            if (selectedPromptInput) selectedPromptInput.value = text;
            this.pushHistory('agent', `Agent动作：${type}`);
            this.setAgentStatus('建议已填入，可直接发送', 'success');
            this.toast('已填入 Agent / 节点输入', 'success');
        } finally {
            this.setAgentBusy(false);
            if (triggerEl) triggerEl.classList.remove('is-running');
            this.scheduleAgentReady();
        }
    },

    async submitAgentInput() {
        const sendBtn = document.getElementById('agent-send-btn');
        if (sendBtn?.disabled && sendBtn.classList.contains('loading')) return;
        const input = document.querySelector('.agent-input');
        const text = input?.value.trim();
        if (!text) {
            this.setAgentStatus('请先输入内容', 'warn');
            this.toast('先输入内容', 'warn');
            return;
        }
        this.setAgentBusy(true);
        this.setAgentStatus('正在发送到画布...', 'busy');
        try {
            if (State.selection.type === 'node' && State.selection.item?.querySelector('.ai-panel .ai-input')) {
                State.selection.item.querySelector('.ai-panel .ai-input').value = text;
                this.setAgentStatus('已写入当前节点', 'success');
                this.toast('已写入当前节点提示词', 'success');
            } else {
                let createdNodeId = null;
                const created = this.runSceneCommand(
                    { historyType: 'node', historyText: 'Agent发送创建文本节点' },
                    () => {
                        const pos = Engine.screenToCanvas(window.innerWidth * 0.5, window.innerHeight * 0.3);
                        const nodeEl = UI.createNode('text', pos);
                        const node = { el: nodeEl, x: pos.x, y: pos.y, type: 'text' };
                        State.nodes.push(node);
                        nodeEl.querySelector('.text-node-input').value = text;
                        createdNodeId = nodeEl.dataset.nodeId;
                        this.syncCanvasEmptyState();
                    }
                );
                if (created) {
                    this.setAgentStatus('已创建文本节点', 'success');
                    this.toast('已创建文本节点', 'success');
                }
                if (createdNodeId) {
                    const latestHistory = State.history[0];
                    if (latestHistory && latestHistory.type === 'node' && !latestHistory.nodeId) latestHistory.nodeId = createdNodeId;
                    this.saveHistory();
                    this.renderHistory();
                }
            }
            this.pushHistory('agent', `Agent发送：${text.slice(0, 28)}`);
        } finally {
            this.setAgentBusy(false);
            this.scheduleAgentReady();
        }
    },

    focusNode(nodeEl, options = {}) {
        const { keepMulti = false } = options;
        if (!nodeEl) return;
        const viewport = document.getElementById('viewport');
        const cx = viewport.clientWidth / 2;
        const cy = viewport.clientHeight / 2;
        const nodeX = parseFloat(nodeEl.style.left || '0');
        const nodeY = parseFloat(nodeEl.style.top || '0');
        const nodeW = nodeEl.offsetWidth || 420;
        const nodeH = nodeEl.offsetHeight || 280;
        const worldCenterX = nodeX + nodeW / 2;
        const worldCenterY = nodeY + nodeH / 2;
        State.canvas.x = cx / State.canvas.scale - worldCenterX;
        State.canvas.y = cy / State.canvas.scale - worldCenterY;
        if (!keepMulti) this.clearMultiSelection();
        this.deselect();
        State.selection = { type: 'node', item: nodeEl };
        nodeEl.classList.add('selected');
        this.requestRender({ canvas: true, lines: true, tempLine: true });
    },

    positionRailOverlay(anchorEl, panelEl, shiftY = 0) {
        if (!anchorEl || !panelEl) return;
        const rect = anchorEl.getBoundingClientRect();
        panelEl.style.top = `${Math.max(12, rect.top + shiftY)}px`;
    },

    toggleRailPopup(type) {
        const historyBtn = document.getElementById('rail-history-btn');
        const editorBtn = document.getElementById('rail-editor-btn');
        const profileBtn = document.getElementById('rail-profile-btn');
        const historyPanel = document.getElementById('rail-history-panel');
        const editorPanel = document.getElementById('rail-editor-panel');
        const profileMenu = document.getElementById('rail-profile-menu');

        const map = {
            history: { btn: historyBtn, panel: historyPanel, offset: -10 },
            editor: { btn: editorBtn, panel: editorPanel, offset: -10 },
            profile: { btn: profileBtn, panel: profileMenu, offset: -220 }
        };
        const current = map[type];
        if (!current.btn || !current.panel) return;
        const willOpen = !current.panel.classList.contains('show');
        this.closeRailPopups();
        if (!willOpen) return;
        this.positionRailOverlay(current.btn, current.panel, current.offset);
        current.panel.classList.add('show');
        current.btn.classList.add('active');
    },

    getMotionTargets() {
        const selector = [
            '.node',
            '.top-chip',
            '.brand-pill',
            '.rail-main-btn',
            '.rail-btn',
            '.canvas-ctl-btn',
            '.agent-chip',
            '.agent-send-btn',
            '.agent-icon-btn',
            '.agent-fab.visible'
        ].join(', ');
        return Array.from(document.querySelectorAll(selector));
    },

    applyTapNowMotion(clientX, clientY) {
        if (!this.motionEnabled) return;
        const radius = 260;
        this.getMotionTargets().forEach((el) => {
            if (el.classList.contains('dragging')) return;
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = clientX - cx;
            const dy = clientY - cy;
            const dist = Math.hypot(dx, dy);
            const strength = Math.max(0, 1 - dist / radius);

            if (strength <= 0.01) {
                el.style.transform = '';
                return;
            }

            const nx = Math.max(-1, Math.min(1, dx / Math.max(1, rect.width)));
            const ny = Math.max(-1, Math.min(1, dy / Math.max(1, rect.height)));
            const rotateY = nx * 10 * strength;
            const rotateX = -ny * 10 * strength;
            const translateX = nx * 8 * strength;
            const translateY = ny * 6 * strength;
            const scale = 1 + 0.025 * strength;
            el.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
        });
    },

    resetTapNowMotion() {
        this.getMotionTargets().forEach((el) => {
            el.style.transform = '';
        });
    },

    beginMarqueeSelection(clientX, clientY) {
        const marquee = document.getElementById('selection-marquee');
        if (!marquee) return;
        this.isMarqueeSelecting = true;
        this.marqueeStart = { x: clientX, y: clientY };
        marquee.style.left = `${clientX}px`;
        marquee.style.top = `${clientY}px`;
        marquee.style.width = '0px';
        marquee.style.height = '0px';
        marquee.classList.add('show');
    },

    updateMarqueeSelection(clientX, clientY) {
        if (!this.isMarqueeSelecting || !this.marqueeStart) return;
        const marquee = document.getElementById('selection-marquee');
        if (!marquee) return;
        const left = Math.min(this.marqueeStart.x, clientX);
        const top = Math.min(this.marqueeStart.y, clientY);
        const width = Math.abs(clientX - this.marqueeStart.x);
        const height = Math.abs(clientY - this.marqueeStart.y);
        marquee.style.left = `${left}px`;
        marquee.style.top = `${top}px`;
        marquee.style.width = `${width}px`;
        marquee.style.height = `${height}px`;

        this.clearMultiSelection();
        State.nodes.forEach((node) => {
            const rect = node.el.getBoundingClientRect();
            const intersect = !(rect.right < left || rect.left > left + width || rect.bottom < top || rect.top > top + height);
            if (intersect) {
                node.el.classList.add('multi-selected');
                State.multiSelection.push(node.el);
            }
        });
        if (State.multiSelection.length) {
            this.deselect();
            State.selection = { type: 'node', item: State.multiSelection[0] };
            State.multiSelection[0].classList.add('selected');
        }
    },

    finishMarqueeSelection() {
        const marquee = document.getElementById('selection-marquee');
        if (marquee) marquee.classList.remove('show');
        if (!this.isMarqueeSelecting) return;
        this.isMarqueeSelecting = false;
        this.marqueeStart = null;
        if (!State.multiSelection.length) this.deselect();
    },

    init() {
        const view = document.getElementById('viewport');
        view.onmousedown = (e) => {
            const isCanvasBg = (e.target === view || e.target.id === 'canvas');
            if (e.button === 0 && isCanvasBg && e.shiftKey) {
                this.stopInertia();
                this.beginMarqueeSelection(e.clientX, e.clientY);
                return;
            }
            const startPan = e.button === 1 || (e.button === 0 && isCanvasBg && !e.shiftKey);
            if (startPan) {
                this.stopInertia();
                this.isPanning = true;
                this.panVelocity.x = 0;
                this.panVelocity.y = 0;
                view.style.cursor = 'grabbing';
            }
            if (e.target === view || e.target.id === 'canvas') {
                this.clearMultiSelection();
                this.deselect();
                this.closeNodeMenu();
            }
        };
        view.ondblclick = (e) => {
            if (
                e.target.closest('.node') ||
                e.target.closest('.agent-panel') ||
                e.target.closest('.canvas-controls') ||
                e.target.closest('.left-rail') ||
                e.target.closest('.app-topbar')
            ) return;
            this.openNodeMenuAt(e.clientX, e.clientY, null);
            e.preventDefault();
        };
        document.body.addEventListener('dblclick', (e) => {
            const label = e.target.closest('.node-label');
            if (!label) return;
            const nodeEl = label.closest('.node');
            if (!nodeEl) return;
            e.preventDefault();
            e.stopPropagation();
            this.startRenameNode(nodeEl);
        });
        window.onmousemove = (e) => {
            this.mouseScreen.x = e.clientX;
            this.mouseScreen.y = e.clientY;
            this.applyTapNowMotion(e.clientX, e.clientY);
            if (this.isMarqueeSelecting) {
                this.updateMarqueeSelection(e.clientX, e.clientY);
                return;
            }
            if (this.isPanning) {
                State.canvas.x += e.movementX;
                State.canvas.y += e.movementY;
                this.panVelocity.x = this.panVelocity.x * 0.6 + e.movementX * 0.4;
                this.panVelocity.y = this.panVelocity.y * 0.6 + e.movementY * 0.4;
                this.requestRender({ canvas: true, lines: true, tempLine: true });
            }
            if (this.dragNodes.length) {
                this.dragNodes.forEach((dragNode) => {
                    dragNode.x += e.movementX / State.canvas.scale;
                    dragNode.y += e.movementY / State.canvas.scale;
                    dragNode.el.style.left = `${dragNode.x}px`;
                    dragNode.el.style.top = `${dragNode.y}px`;
                });
                if (e.movementX || e.movementY) this.dragMoved = true;
                this.requestRender({ lines: true, tempLine: true });
            }
            if (this.dragNode) {
                this.dragNode.x += e.movementX / State.canvas.scale; this.dragNode.y += e.movementY / State.canvas.scale;
                this.dragNode.el.style.left = this.dragNode.x + 'px'; this.dragNode.el.style.top = this.dragNode.y + 'px';
                if (e.movementX || e.movementY) this.dragMoved = true;
                this.requestRender({ lines: true, tempLine: true });
            }
            if (State.linking.active) {
                this.requestRender({ tempLine: true });
            }
        };
        window.onmouseup = () => {
            this.finishMarqueeSelection();
            if (this.connectorPressTimer) {
                clearTimeout(this.connectorPressTimer);
                this.connectorPressTimer = null;
            }
            this.connectorPressEl = null;
            if (this.isPanning) {
                this.isPanning = false;
                view.style.cursor = 'grab';
                if (Math.abs(this.panVelocity.x) > 0.6 || Math.abs(this.panVelocity.y) > 0.6) this.startInertia();
            }
            if (this.dragNodes.length) this.dragNodes.forEach((node) => node.el.classList.remove('dragging'));
            if (this.dragNode) this.dragNode.el.classList.remove('dragging');
            if (this.dragSceneBefore && this.dragMoved) {
                const afterScene = this.captureScene();
                if (JSON.stringify(this.dragSceneBefore) !== JSON.stringify(afterScene)) {
                    this.pushCommand(this.dragSceneBefore, afterScene);
                    const targetNode = this.dragNodes[0] || this.dragNode;
                    this.pushHistory('node', this.dragNodes.length > 1 ? `批量移动 ${this.dragNodes.length} 个节点` : '移动节点', {
                        nodeId: targetNode?.el?.dataset.nodeId || targetNode?.dataset?.nodeId || null,
                        scene: afterScene
                    });
                }
            }
            this.dragSceneBefore = null;
            this.dragMoved = false;
            this.dragNodes = [];
            this.dragNode = null;
        };
        window.onblur = () => {
            this.resetTapNowMotion();
            this.finishMarqueeSelection();
        };
        view.onwheel = (e) => {
            if (e.target.closest('.ai-panel') || e.target.closest('.agent-panel') || e.target.closest('.canvas-controls')) return;
            this.stopInertia();
            if (e.ctrlKey) {
                e.preventDefault();
                const factor = Math.pow(1.08, -e.deltaY / 70);
                const cx = view.clientWidth / 2;
                const cy = view.clientHeight / 2;
                this.zoomAt(cx, cy, factor);
                return;
            }

            e.preventDefault();
            const panSpeed = 0.9;
            State.canvas.y -= e.deltaY * panSpeed;
            State.canvas.x -= e.deltaX * panSpeed;
            this.requestRender({ canvas: true, lines: true, tempLine: true });
        };

        document.body.onclick = (e) => {
            if (!e.target.closest('.rail-btn') && !e.target.closest('.rail-popup-panel') && !e.target.closest('.profile-menu')) {
                this.closeRailPopups();
            }
            const node = e.target.closest('.node');
            const ratioToggle = e.target.closest('.ratio-toggle');
            const ratioItem = e.target.closest('.ratio-item');
            const sendBtn = e.target.closest('.send-btn');
            const modelSwitchBtn = e.target.closest('.model-switch');
            const modelItem = e.target.closest('.model-item');
            const connector = e.target.closest('.connector');
            const nodeUpload = e.target.closest('.node-upload-pill');
            const refAddBtn = e.target.closest('.ref-add-btn');
            const refDeleteBtn = e.target.closest('.ref-delete-btn');
            const refPrimaryBtn = e.target.closest('.ref-primary-btn');
            const refWeightDecBtn = e.target.closest('.ref-weight-dec-btn');
            const refWeightIncBtn = e.target.closest('.ref-weight-inc-btn');
            const refMoveLeftBtn = e.target.closest('.ref-move-left-btn');
            const refMoveRightBtn = e.target.closest('.ref-move-right-btn');
            const refSourceBtn = e.target.closest('.ref-source-btn');
            const menuItem = e.target.closest('.menu-item');
            const line = e.target.closest('.line');

            if (menuItem) {
                if (menuItem.id === 'global-upload-btn') { State.uploadContext = { kind: 'global' }; document.getElementById('file-input').click(); }
                else {
                    const type = menuItem.dataset.type;
                    let sourceNodeEl = null;
                    let startConnector = null;
                    let endConnector = null;
                    if (State.menuConnectorEl?.classList.contains('conn-right')) {
                        startConnector = State.menuConnectorEl;
                        sourceNodeEl = startConnector.closest('.node');
                    } else if (State.menuConnectorEl?.classList.contains('conn-left')) {
                        endConnector = State.menuConnectorEl;
                        sourceNodeEl = endConnector.closest('.node');
                    } else if (State.linking.active && State.linking.startEl?.classList.contains('conn-right')) {
                        startConnector = State.linking.startEl;
                        sourceNodeEl = startConnector.closest('.node');
                    } else if (State.selection.type === 'node' && State.selection.item) {
                        const possibleConnector = State.selection.item.querySelector('.conn-right');
                        if (possibleConnector) {
                            startConnector = possibleConnector;
                            sourceNodeEl = State.selection.item;
                        }
                    }

                    let pos = Engine.screenToCanvas(window.innerWidth/2, window.innerHeight/2);
                    if (sourceNodeEl) {
                        pos = {
                            x: parseFloat(sourceNodeEl.style.left || '0') + (endConnector ? -520 : 520),
                            y: parseFloat(sourceNodeEl.style.top || '0')
                        };
                    }
                    let createdNodeId = null;
                    const created = this.runSceneCommand(
                        { historyType: 'node', historyText: `新建${type.toUpperCase()}节点` },
                        () => {
                            const el = UI.createNode(type, pos);
                            State.nodes.push({ el, x: pos.x, y: pos.y, type });
                            createdNodeId = el.dataset.nodeId;

                            if (startConnector) {
                                this.createLinkBetween(startConnector, el.querySelector('.conn-left'));
                                if (State.linking.active) this.stopLinking();
                            } else if (endConnector) {
                                this.createLinkBetween(el.querySelector('.conn-right'), endConnector);
                            }
                            this.syncCanvasEmptyState();
                        }
                    );
                    if (createdNodeId) {
                        const latestHistory = State.history[0];
                        if (latestHistory && latestHistory.type === 'node' && !latestHistory.nodeId) latestHistory.nodeId = createdNodeId;
                        this.saveHistory();
                        this.renderHistory();
                    }
                    if (created) this.toast('节点已创建');
                }
                this.closeNodeMenu();
                return;
            }
            if (!modelSwitchBtn && !modelItem && !ratioToggle && !ratioItem) this.closeAllNodePopovers();
            if (modelSwitchBtn && node) {
                const pop = node.querySelector('.model-popover');
                if (pop) {
                    const visible = pop.style.display === 'block';
                    this.closeAllNodePopovers();
                    pop.style.display = visible ? 'none' : 'block';
                }
                return;
            }
            if (modelItem && node) {
                const modelId = modelItem.dataset.modelId;
                this.selectNodeModel(node, modelId);
                return;
            }
            if (ratioToggle) {
                const pop = node.querySelector('.ratio-popover');
                if (pop) {
                    const visible = pop.style.display === 'block';
                    this.closeAllNodePopovers();
                    pop.style.display = visible ? 'none' : 'block';
                }
                return;
            }
            if (ratioItem) {
                node.dataset.ratio = ratioItem.dataset.ratio;
                node.querySelector('.ratio-toggle').innerText = `⬜ ${node.dataset.ratio}`;
                node.querySelectorAll('.ratio-item').forEach(i => i.classList.remove('active'));
                ratioItem.classList.add('active');
                node.querySelector('.ratio-popover').style.display = 'none'; return;
            }
            if (nodeUpload) { State.uploadContext = { kind: 'node', node }; document.getElementById('file-input').click(); return; }
            if (refAddBtn && node) { State.uploadContext = { kind: 'ref', node }; document.getElementById('file-input').click(); return; }
            if ((refDeleteBtn || refPrimaryBtn || refWeightDecBtn || refWeightIncBtn || refMoveLeftBtn || refMoveRightBtn || refSourceBtn) && node) {
                const refId = e.target.closest('.ref-item')?.dataset.refId;
                if (!refId) return;
                if (refDeleteBtn) {
                    const changed = this.runSceneCommand(
                        { historyType: 'edit', historyText: '移除参考图', nodeId: node.dataset.nodeId },
                        () => this.removeReferenceById(node, refId)
                    );
                    if (changed) this.toast('参考图已移除');
                    return;
                }
                if (refPrimaryBtn) { this.setPrimaryReference(node, refId); return; }
                if (refWeightDecBtn) { this.adjustReferenceWeight(node, refId, -0.25); return; }
                if (refWeightIncBtn) { this.adjustReferenceWeight(node, refId, 0.25); return; }
                if (refMoveLeftBtn) { this.moveReference(node, refId, -1); return; }
                if (refMoveRightBtn) { this.moveReference(node, refId, 1); return; }
                if (refSourceBtn) { this.focusReferenceSource(node, refId); return; }
                return;
            }
            if (sendBtn) { this.runAI(node); return; }
            if (connector) {
                if (this.connectorLongPressTriggered) {
                    this.connectorLongPressTriggered = false;
                    return;
                }
                if (State.linking.active) { this.completeLink(connector); return; }
                const r = connector.getBoundingClientRect();
                this.openNodeMenuAt(r.left + r.width / 2, r.top + r.height / 2, connector);
                return;
            }
            if (line) {
                this.clearMultiSelection();
                this.deselect();
                State.selection = { type: 'line', item: line };
                line.classList.add('selected');
                return;
            }
            if (node) {
                if (e.shiftKey) {
                    this.toggleNodeMultiSelection(node);
                    return;
                }
                this.clearMultiSelection();
                this.deselect();
                State.selection = { type: 'node', item: node };
                node.classList.add('selected');
            }
        };

        window.onkeydown = (e) => {
            const key = e.key.toLowerCase();
            const isModifier = e.ctrlKey || e.metaKey;
            const activeTag = document.activeElement?.tagName || '';
            const isTextEditing = activeTag === 'TEXTAREA' || activeTag === 'INPUT';

            if (isModifier && key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
                return;
            }
            if (isModifier && key === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }
            if (isModifier && key === 'c') {
                if (isTextEditing) return;
                e.preventDefault();
                this.copySelectedNodes();
                return;
            }
            if (isModifier && key === 'v') {
                if (isTextEditing) return;
                e.preventDefault();
                this.pasteCopiedNodes();
                return;
            }
            if (e.key === 'F2') {
                if (isTextEditing) return;
                e.preventDefault();
                this.renameSelectedNode();
                return;
            }
            if (e.key === 'Escape') {
                if (isTextEditing) {
                    document.activeElement.blur();
                    return;
                }
                this.closeNodeMenu();
                this.closeRailPopups();
                if (State.linking.active) this.stopLinking();
                return;
            }
            if (['Delete', 'Backspace'].includes(e.key)) {
                if (isTextEditing) return;
                this.deleteSelected();
                if (State.linking.active) this.stopLinking();
            }
        };

        document.getElementById('ui-add-btn').onclick = (e) => {
            e.stopPropagation();
            const menu = document.getElementById('nodeMenu');
            const visible = menu.style.display === 'block';
            if (visible) this.closeNodeMenu();
            else this.openNodeMenuAt(88, 110, null);
        };
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomResetBtn = document.getElementById('zoom-reset-btn');
        const zoomSlider = document.getElementById('zoom-slider');
        const agentCollapseBtn = document.getElementById('agent-collapse-btn');
        const agentFabBtn = document.getElementById('agent-fab');
        const agentSendBtn = document.getElementById('agent-send-btn');
        const agentInputEl = document.querySelector('.agent-input');
        const agentHeaderBtns = Array.from(document.querySelectorAll('.agent-header-actions .agent-icon-btn'));
        const historyClearBtn = document.getElementById('history-clear-btn');
        const historyUndoBtn = document.getElementById('history-undo-btn');
        const historyRedoBtn = document.getElementById('history-redo-btn');
        const historyFilter = document.getElementById('history-filter');
        const historyList = document.getElementById('history-list');
        const editorApplyBtn = document.getElementById('editor-apply-btn');
        const editorResetBtn = document.getElementById('editor-reset-btn');
        const editorRotateBtn = document.getElementById('editor-rotate-btn');
        const editorMirrorBtn = document.getElementById('editor-mirror-btn');
        const profileNotifyBtn = document.getElementById('profile-notify-btn');
        const profileHomeBtn = document.getElementById('profile-home-btn');
        const profileAccountBtn = document.getElementById('profile-account-btn');
        const profileTutorialBtn = document.getElementById('profile-tutorial-btn');
        const profileLogoutBtn = document.getElementById('profile-logout-btn');
        const topChips = Array.from(document.querySelectorAll('.top-chip'));
        const emptyTemplateBtns = Array.from(document.querySelectorAll('.empty-template-btn'));
        const agentChips = Array.from(document.querySelectorAll('.agent-chip'));
        const railHistoryBtn = document.getElementById('rail-history-btn');
        const railEditorBtn = document.getElementById('rail-editor-btn');
        const railProfileBtn = document.getElementById('rail-profile-btn');

        if (zoomOutBtn) zoomOutBtn.onclick = () => this.setScaleByPercent(State.canvas.scale * 100 - 10);
        if (zoomInBtn) zoomInBtn.onclick = () => this.setScaleByPercent(State.canvas.scale * 100 + 10);
        if (zoomResetBtn) zoomResetBtn.onclick = () => this.resetView();
        if (railHistoryBtn) railHistoryBtn.onclick = (e) => { e.stopPropagation(); this.toggleRailPopup('history'); };
        if (railEditorBtn) railEditorBtn.onclick = (e) => { e.stopPropagation(); this.toggleRailPopup('editor'); };
        if (railProfileBtn) railProfileBtn.onclick = (e) => { e.stopPropagation(); this.toggleRailPopup('profile'); };
        if (agentSendBtn) agentSendBtn.onclick = () => this.submitAgentInput();
        if (agentInputEl) {
            agentInputEl.onkeydown = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    this.submitAgentInput();
                }
            };
            agentInputEl.onfocus = () => this.setAgentStatus('可用 Ctrl+Enter 快速发送', 'info');
        }
        if (historyClearBtn) {
            historyClearBtn.onclick = (e) => {
                e.stopPropagation();
                State.history = [];
                this.saveHistory();
                this.renderHistory();
                this.toast('历史已清空');
            };
        }
        if (historyUndoBtn) {
            historyUndoBtn.onclick = (e) => {
                e.stopPropagation();
                this.undo();
            };
        }
        if (historyRedoBtn) {
            historyRedoBtn.onclick = (e) => {
                e.stopPropagation();
                this.redo();
            };
        }
        if (historyFilter) {
            historyFilter.onchange = (e) => {
                State.historyFilter = e.target.value || 'all';
                this.renderHistory();
            };
        }
        if (historyList) {
            historyList.onclick = (e) => {
                const row = e.target.closest('.history-item');
                if (!row) return;
                const historyId = row.dataset.historyId;
                const item = this.findHistoryItemById(historyId);
                if (!item) return;
                if (e.target.closest('.history-replay-btn')) {
                    this.replayHistoryItem(item);
                    return;
                }
                this.focusHistoryItem(item);
            };
        }
        if (editorApplyBtn) {
            editorApplyBtn.onclick = (e) => {
                e.stopPropagation();
                this.applyImageEditor({
                    brightness: Number(document.getElementById('edit-brightness')?.value || 100),
                    contrast: Number(document.getElementById('edit-contrast')?.value || 100),
                    saturate: Number(document.getElementById('edit-saturate')?.value || 100)
                });
            };
        }
        if (editorResetBtn) {
            editorResetBtn.onclick = (e) => {
                e.stopPropagation();
                const b = document.getElementById('edit-brightness');
                const c = document.getElementById('edit-contrast');
                const s = document.getElementById('edit-saturate');
                if (b) b.value = '100';
                if (c) c.value = '100';
                if (s) s.value = '100';
                this.applyImageEditor({ brightness: 100, contrast: 100, saturate: 100 });
            };
        }
        if (editorRotateBtn) {
            editorRotateBtn.onclick = (e) => {
                e.stopPropagation();
                const node = this.getSelectedImageNode();
                if (!node) return this.toast('请先选中图片节点');
                const img = node.querySelector('.media-container img');
                if (!img) return this.toast('当前节点没有图片');
                const applied = this.runSceneCommand(
                    { historyType: 'edit', historyText: '图片旋转：+90°', nodeId: node.dataset.nodeId },
                    () => {
                        const current = Number(img.dataset.rotateDeg || '0');
                        const next = (current + 90) % 360;
                        img.dataset.rotateDeg = String(next);
                        this.applyImageTransform(img);
                    }
                );
                if (applied) this.toast('已旋转 90°');
            };
        }
        if (editorMirrorBtn) {
            editorMirrorBtn.onclick = (e) => {
                e.stopPropagation();
                const node = this.getSelectedImageNode();
                if (!node) return this.toast('请先选中图片节点');
                const img = node.querySelector('.media-container img');
                if (!img) return this.toast('当前节点没有图片');
                const applied = this.runSceneCommand(
                    { historyType: 'edit', historyText: '图片镜像切换', nodeId: node.dataset.nodeId },
                    () => {
                        img.dataset.flipX = img.dataset.flipX === '1' ? '0' : '1';
                        this.applyImageTransform(img);
                    }
                );
                if (applied) this.toast('镜像状态已切换');
            };
        }
        if (emptyTemplateBtns.length) {
            emptyTemplateBtns.forEach((btn) => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.createTemplateFlow(btn.dataset.template || '');
                };
            });
        }
        if (topChips.length) {
            topChips[0].onclick = () => this.createTemplateFlow('character');
            if (topChips[1]) topChips[1].onclick = () => {
                this.createTemplateFlow('storyboard');
            };
            if (topChips[2]) topChips[2].onclick = () => window.open('https://github.com/dcjrcjfc/infinite-canvas-aigc', '_blank');
        }
        if (agentHeaderBtns.length) {
            if (agentHeaderBtns[0]) {
                agentHeaderBtns[0].onclick = () => {
                    let createdNodeId = null;
                    const created = this.runSceneCommand(
                        { historyType: 'node', historyText: 'Agent新建文本节点' },
                        () => {
                            const pos = Engine.screenToCanvas(window.innerWidth * 0.5, window.innerHeight * 0.35);
                            const el = UI.createNode('text', pos);
                            State.nodes.push({ el, x: pos.x, y: pos.y, type: 'text' });
                            createdNodeId = el.dataset.nodeId;
                            this.syncCanvasEmptyState();
                        }
                    );
                    if (createdNodeId) {
                        const latestHistory = State.history[0];
                        if (latestHistory && latestHistory.type === 'node' && !latestHistory.nodeId) latestHistory.nodeId = createdNodeId;
                        this.saveHistory();
                        this.renderHistory();
                    }
                    if (created) this.toast('已新建文本节点');
                };
            }
            if (agentHeaderBtns[1]) {
                agentHeaderBtns[1].onclick = () => this.toggleRailPopup('history');
            }
        }
        if (profileNotifyBtn) profileNotifyBtn.onclick = () => this.toast('暂无新通知');
        if (profileHomeBtn) profileHomeBtn.onclick = () => window.open('https://github.com/dcjrcjfc/infinite-canvas-aigc', '_blank');
        if (profileAccountBtn) profileAccountBtn.onclick = () => this.toast('账户管理入口预留');
        if (profileTutorialBtn) profileTutorialBtn.onclick = () => this.toast('教程功能即将上线');
        if (profileLogoutBtn) profileLogoutBtn.onclick = () => this.toast('已执行登出占位动作');
        if (agentChips.length) {
            if (agentChips[0]) agentChips[0].onclick = () => this.runAgentAction('idea', agentChips[0]);
            if (agentChips[1]) agentChips[1].onclick = () => this.runAgentAction('role', agentChips[1]);
            if (agentChips[2]) agentChips[2].onclick = () => this.runAgentAction('ref', agentChips[2]);
        }
        if (zoomSlider) {
            zoomSlider.oninput = (e) => {
                const next = Number(e.target.value);
                this.setScaleByPercent(next);
            };
        }
        if (agentCollapseBtn) {
            agentCollapseBtn.onclick = (e) => {
                e.stopPropagation();
                this.setAgentPanelOpen(false);
            };
        }
        if (agentFabBtn) {
            agentFabBtn.onclick = (e) => {
                e.stopPropagation();
                this.setAgentPanelOpen(true);
            };
        }
        const panel = document.querySelector('.agent-panel');
        if (panel) this.setAgentPanelOpen(!panel.classList.contains('hidden'));
        this.setAgentStatus('已就绪', 'info');
        this.loadHistory();
        if (historyFilter) historyFilter.value = State.historyFilter;
        this.updateUndoRedoUI();
        this.syncCanvasEmptyState();

        document.body.onmousedown = (e) => {
            const connector = e.target.closest('.connector');
            if (connector) {
                this.connectorLongPressTriggered = false;
                this.connectorPressEl = connector;
                if (this.connectorPressTimer) clearTimeout(this.connectorPressTimer);
                this.connectorPressTimer = setTimeout(() => {
                    // 长按加号进入连线（右侧连接点作为起点）
                    if (!this.connectorPressEl || !this.connectorPressEl.classList.contains('conn-right')) return;
                    this.closeNodeMenu();
                    State.linking.active = true;
                    State.linking.startEl = this.connectorPressEl;
                    this.connectorPressEl.classList.add('active');
                    this.connectorLongPressTriggered = true;
                    this.requestRender({ tempLine: true });
                }, 260);
            }
            const node = e.target.closest('.node');
            if (node && !e.target.closest('.ai-panel') && !e.target.closest('.connector') && !e.target.closest('.node-upload-pill')) {
                this.stopInertia();
                this.dragSceneBefore = this.captureScene();
                this.dragMoved = false;
                const selectedNodeEls = this.getSelectedNodeElements();
                if (selectedNodeEls.length > 1 && selectedNodeEls.includes(node)) {
                    const selectedSet = new Set(selectedNodeEls);
                    this.dragNodes = State.nodes.filter((n) => selectedSet.has(n.el));
                    this.dragNode = null;
                    this.dragNodes.forEach((item) => item.el.classList.add('dragging'));
                } else {
                    this.dragNodes = [];
                    this.dragNode = State.nodes.find((n) => n.el === node) || null;
                    if (this.dragNode?.el) this.dragNode.el.classList.add('dragging');
                }
            }
        };

        document.getElementById('file-input').onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            if (!State.uploadContext) return;
            if (State.uploadContext.kind === 'global') {
                let createdNodeId = null;
                const created = this.runSceneCommand(
                    { historyType: 'upload', historyText: `上传素材：${file.name}` },
                    () => {
                        const pos = Engine.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
                        const nodeType = file.type.includes('video') ? 'video' : 'image';
                        const el = UI.createNode(nodeType, pos, url, { withPrompt: false });
                        el._rawFile = file;
                        State.nodes.push({ el, x: pos.x, y: pos.y, type: nodeType });
                        createdNodeId = el.dataset.nodeId;
                        this.syncCanvasEmptyState();
                    }
                );
                if (createdNodeId) {
                    const latestHistory = State.history[0];
                    if (latestHistory && latestHistory.type === 'upload' && !latestHistory.nodeId) latestHistory.nodeId = createdNodeId;
                    this.saveHistory();
                    this.renderHistory();
                }
                if (created) this.toast('素材节点已创建');
            } else if (State.uploadContext.kind === 'node') {
                const targetNode = State.uploadContext.node;
                targetNode.querySelector('.media-container').innerHTML = file.type.includes('video') ? `<video src="${url}" autoplay loop muted></video>` : `<img src="${url}">`;
                targetNode._rawFile = file;
                this.updateNodeStatus(targetNode, '已上传');
                const img = targetNode.querySelector('img');
                if(img) img.onload = () => this.requestRender({ lines: true });
                this.pushHistory('upload', `替换素材：${file.name}`, {
                    nodeId: targetNode.dataset.nodeId,
                    scene: this.captureScene()
                });
            } else if (State.uploadContext.kind === 'ref') {
                this.addManualReference(State.uploadContext.node, file);
                this.pushHistory('upload', `添加参考图：${file.name}`, {
                    nodeId: State.uploadContext.node?.dataset.nodeId,
                    scene: this.captureScene()
                });
            }
            State.uploadContext = null;
            e.target.value = '';
        };
    },

    async runAI(node) {
        const prompt = node.querySelector('.ai-panel .ai-input').value.trim();
        const ratio = node.dataset.ratio;
        const model = node.dataset.model || MODEL_OPTIONS[0].id;
        const btn = node.querySelector('.send-btn');
        if (!prompt) {
            this.toast('请输入指令', 'warn');
            return;
        }
        if (!btn || btn.classList.contains('loading')) return;

        const prevStatus = node.dataset.nodeStatus || '生成节点';
        const prevBtnText = btn.textContent;
        btn.classList.add('loading');
        btn.textContent = '…';
        this.updateNodeStatus(node, '生成中');

        try {
            const sizeMap = { "1:1":"1024x1024", "16:9":"1792x1024", "9:16":"1024x1792" };
            const size = sizeMap[ratio] || "1024x1024";
            const refFiles = await this.getNodeReferenceFiles(node);
            const requestFactory = () => {
                if (refFiles.length) {
                    const fd = new FormData();
                    refFiles.forEach((file, index) => fd.append('image', file, file.name || `reference_${index}.png`));
                    fd.append('prompt', prompt);
                    fd.append('model', model);
                    fd.append('image_size', '1K');
                    return fetch(`${API_PROXY_BASE}/api/images/edits`, {
                        method: "POST",
                        headers: { "x-model-id": model },
                        body: fd
                    });
                }
                return fetch(`${API_PROXY_BASE}/api/images/generations`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-model-id": model },
                    body: JSON.stringify({ model, prompt, n: 1, size: size, image_size: "1K" })
                });
            };

            const { response, retryCount } = await this.fetchWithRetry(requestFactory, {
                onRetry: ({ retryCount }) => {
                    this.toast(`网络波动，自动重试中（${retryCount}/${API_MAX_RETRIES}）`, 'warn', 1500);
                }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                const errMeta = this.classifyApiError(response.status, result);
                this.updateNodeStatus(node, prevStatus);
                this.toast(errMeta.message, 'error', 2600);
                return;
            }

            const imageUrl = result?.data?.[0]?.url;
            if (!imageUrl) {
                this.updateNodeStatus(node, prevStatus);
                this.toast('生成异常：服务未返回图片地址，请重试', 'error', 2400);
                return;
            }

            node.querySelector('.media-container').innerHTML = `<img src="${imageUrl}">`;
            this.updateNodeStatus(node, '已生成');
            node._rawFile = null;
            const img = node.querySelector('.media-container img');
            if (img) {
                img.onload = () => {
                    this.refreshDownstreamReferences(node);
                    this.requestRender({ lines: true });
                };
            } else {
                this.refreshDownstreamReferences(node);
                this.requestRender({ lines: true });
            }
            this.pushHistory('generate', `生成成功：${model} / ${ratio} / ${prompt.slice(0, 26)}`, {
                nodeId: node.dataset.nodeId,
                scene: this.captureScene()
            });
            if (retryCount > 0) this.toast(`生成成功（自动重试 ${retryCount} 次）`, 'success', 1900);
            else this.toast('生成成功', 'success');
        } catch (err) {
            this.updateNodeStatus(node, prevStatus);
            const errMeta = this.classifyApiError(0, null, err?.message || '');
            this.toast(errMeta.message, 'error', 2600);
        } finally {
            btn.classList.remove('loading');
            btn.textContent = prevBtnText || '↑';
        }
    },

    closeAllNodePopovers() {
        document.querySelectorAll('.model-popover').forEach((el) => { el.style.display = 'none'; });
        document.querySelectorAll('.ratio-popover').forEach((el) => { el.style.display = 'none'; });
    },

    selectNodeModel(node, modelId) {
        if (!node || !modelId) return;
        const modelMeta = getModelMeta(modelId);
        node.dataset.model = modelMeta.id;
        const modelBtn = node.querySelector('.model-switch');
        if (modelBtn) modelBtn.textContent = `${modelMeta.icon} ${modelMeta.label}`;
        node.querySelectorAll('.model-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.modelId === modelMeta.id);
        });
        const pop = node.querySelector('.model-popover');
        if (pop) pop.style.display = 'none';
    },

    refreshDownstreamReferences(sourceNode) {
        if (!sourceNode) return;
        const sourceMedia = sourceNode.querySelector('.media-container img') || sourceNode.querySelector('.media-container video');
        if (!sourceMedia) return;
        State.links.forEach((link) => {
            if (link.fromEl.closest('.node') !== sourceNode) return;
            const targetNode = link.toEl.closest('.node');
            if (!targetNode || !targetNode._refs) return;
            targetNode._refs = targetNode._refs.map((ref) => {
                if (ref.linkId !== link.id) return ref;
                return {
                    ...ref,
                    src: sourceMedia.src,
                    type: sourceMedia.tagName.toLowerCase(),
                    file: sourceNode._rawFile || null,
                    sourceType: 'link',
                    sourceNodeId: sourceNode.dataset.nodeId || null,
                    sourceNodeName: sourceNode.dataset.nodeName || '上游节点',
                    sourceLinkId: link.id
                };
            });
            this.ensureReferenceDefaults(targetNode);
            this.renderReferences(targetNode);
        });
    },

    // === 修改：连线完成逻辑 ===
    completeLink(endEl) {
        if (State.linking.startEl === endEl || State.linking.startEl.closest('.node') === endEl.closest('.node')) return;
        if (!State.linking.startEl.classList.contains('conn-right') || !endEl.classList.contains('conn-left')) {
            this.stopLinking();
            return;
        }
        const sourceNodeId = State.linking.startEl.closest('.node')?.dataset.nodeId || null;
        const applied = this.runSceneCommand(
            { historyType: 'link', historyText: '新增连线', nodeId: sourceNodeId },
            () => this.createLinkBetween(State.linking.startEl, endEl)
        );
        if (applied) this.toast('连线已创建');
        this.stopLinking();
    },

    createLinkBetween(fromConnectorEl, toConnectorEl, options = {}) {
        const { linkId = null, syncReference = true } = options;
        if (!fromConnectorEl || !toConnectorEl) return;
        const startNodeEl = fromConnectorEl.closest('.node');
        const endNodeEl = toConnectorEl.closest('.node');
        if (!startNodeEl || !endNodeEl || startNodeEl === endNodeEl) return;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute('class', 'line');
        const finalLinkId = linkId || ('link_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5));
        line.dataset.id = finalLinkId;

        document.getElementById('links-container').appendChild(line);
        State.links.push({ id: finalLinkId, fromEl: fromConnectorEl, toEl: toConnectorEl, pathEl: line });

        if (syncReference) {
            // 自动把上游图片带到下游参考区
            this.addReferenceImage(startNodeEl, endNodeEl, finalLinkId);
        }
        this.requestRender({ lines: true });
    },

    // === 新增：抓取源节点图片并存入目标节点 ===
    addReferenceImage(sourceNode, targetNode, linkId) {
        const mediaEl = sourceNode.querySelector('.media-container img') || sourceNode.querySelector('.media-container video');
        if (!mediaEl) return; 

        if (!targetNode._refs) targetNode._refs = [];
        targetNode._refs = targetNode._refs.filter(r => r.linkId !== linkId);

        targetNode._refs.push({ 
            id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            linkId: linkId, 
            src: mediaEl.src,
            type: mediaEl.tagName.toLowerCase(),
            file: sourceNode._rawFile,
            weight: 1,
            isPrimary: !targetNode._refs.some((ref) => ref.isPrimary),
            sourceType: 'link',
            sourceNodeId: sourceNode.dataset.nodeId || null,
            sourceNodeName: sourceNode.dataset.nodeName || '上游节点',
            sourceLinkId: linkId
        });
        this.ensureReferenceDefaults(targetNode);
        this.renderReferences(targetNode);
    },

    // === 新增：渲染参考图缩略图 ===
    renderReferences(node) {
        const container = node.querySelector('.ref-container');
        if (!container || !node._refs) return;
        this.ensureReferenceDefaults(node);

        container.innerHTML = '';
        node._refs.forEach((ref, index) => {
            const item = document.createElement('div');
            item.className = `ref-item ${ref.isPrimary ? 'is-primary' : ''}`;
            item.dataset.refId = ref.id;
            const sourceText = this.escapeHtml(this.getReferenceSourceText(ref));
            const weightText = `${(ref.weight || 1).toFixed(2).replace(/\.00$/, '')}x`;
            const canMoveLeft = index > 0 ? '' : 'disabled';
            const canMoveRight = index < node._refs.length - 1 ? '' : 'disabled';
            const mediaMarkup = ref.type === 'video'
                ? `<video src="${this.escapeHtml(ref.src)}" muted></video>`
                : `<img src="${this.escapeHtml(ref.src)}">`;
            item.innerHTML = `
                <div class="ref-thumb-wrapper">${mediaMarkup}</div>
                <div class="ref-meta">
                    <div class="ref-meta-head">
                        <button class="ref-primary-btn ${ref.isPrimary ? 'active' : ''}" type="button">主参考</button>
                        <button class="ref-source-btn" type="button" title="${sourceText}">${sourceText}</button>
                    </div>
                    <div class="ref-meta-actions">
                        <button class="ref-order-btn ref-move-left-btn" type="button" ${canMoveLeft}>←</button>
                        <button class="ref-order-btn ref-move-right-btn" type="button" ${canMoveRight}>→</button>
                        <button class="ref-weight-btn ref-weight-dec-btn" type="button">-</button>
                        <span class="ref-weight-value">${this.escapeHtml(weightText)}</span>
                        <button class="ref-weight-btn ref-weight-inc-btn" type="button">+</button>
                        <button class="ref-delete-btn" type="button">移除</button>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    },

    addManualReference(node, file) {
        if (!node || !file) return;
        if (!node._refs) node._refs = [];
        const src = URL.createObjectURL(file);
        const type = file.type.includes('video') ? 'video' : 'img';
        node._refs.push({
            id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            linkId: null,
            src,
            type,
            file,
            weight: 1,
            isPrimary: !node._refs.some((ref) => ref.isPrimary),
            sourceType: 'manual',
            sourceNodeId: null,
            sourceNodeName: '手动上传',
            sourceLinkId: null
        });
        this.ensureReferenceDefaults(node);
        this.renderReferences(node);
    },

    removeReferenceById(node, refId) {
        if (!node || !node._refs) return;
        node._refs = node._refs.filter(ref => ref.id !== refId);
        this.ensureReferenceDefaults(node);
        this.renderReferences(node);
    },

    async createFileFromImageUrl(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch image failed: ${resp.status}`);
        const blob = await resp.blob();
        const ext = blob.type.includes('jpeg') ? 'jpg' : 'png';
        return new File([blob], `reference_${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
    },

    async getNodeReferenceFiles(node) {
        this.ensureReferenceDefaults(node);
        const refs = (node._refs || [])
            .slice()
            .sort((a, b) => {
                if (a.isPrimary === b.isPrimary) return (a.order || 0) - (b.order || 0);
                return a.isPrimary ? -1 : 1;
            });
        const files = [];

        for (const ref of refs) {
            if (ref.type !== 'img') continue;
            if (ref.file) {
                const repeat = ref.weight >= 1 ? Math.min(4, Math.max(1, Math.round(ref.weight))) : 1;
                for (let i = 0; i < repeat; i += 1) files.push(ref.file);
                continue;
            }
            try {
                const file = await this.createFileFromImageUrl(ref.src);
                ref.file = file;
                const repeat = ref.weight >= 1 ? Math.min(4, Math.max(1, Math.round(ref.weight))) : 1;
                for (let i = 0; i < repeat; i += 1) files.push(file);
            } catch (err) {
                console.warn('reference image fetch failed', err);
            }
        }

        // 无流转参考图时，退化为当前节点自己的图片输入
        if (!files.length && node._rawFile && node._rawFile.type.includes('image')) {
            files.push(node._rawFile);
        }

        return files;
    },

    stopLinking() { if (State.linking.startEl) State.linking.startEl.classList.remove('active'); State.linking.active = false; document.getElementById('temp-line').setAttribute('d', ''); },
    deselect() { if(State.selection.item) State.selection.item.classList.remove('selected'); State.selection = {type:null, item:null}; },
    
    // === 修改：删除节点或连线时，同步清理参考图数据 ===
    deleteSelected() {
        const { type, item } = State.selection;
        const selectedNodes = State.multiSelection.length
            ? [...State.multiSelection]
            : (type === 'node' && item ? [item] : []);
        if (!item && !selectedNodes.length) return;

        if (selectedNodes.length > 1) {
            const deleted = this.runSceneCommand(
                { historyType: 'node', historyText: `批量删除 ${selectedNodes.length} 个节点`, nodeId: selectedNodes[0]?.dataset.nodeId || null },
                () => {
                    const nodeSet = new Set(selectedNodes);
                    State.links = State.links.filter((l) => {
                        const rel = nodeSet.has(l.fromEl.closest('.node')) || nodeSet.has(l.toEl.closest('.node'));
                        if (rel) {
                            const targetNode = l.toEl.closest('.node');
                            if (targetNode && targetNode._refs) {
                                targetNode._refs = targetNode._refs.filter((r) => r.linkId !== l.id);
                                this.renderReferences(targetNode);
                            }
                            l.pathEl.remove();
                        }
                        return !rel;
                    });
                    State.nodes = State.nodes.filter((n) => !nodeSet.has(n.el));
                    selectedNodes.forEach((nodeEl) => nodeEl.remove());
                    this.clearMultiSelection();
                    this.deselect();
                    this.syncCanvasEmptyState();
                }
            );
            if (deleted) this.toast(`已删除 ${selectedNodes.length} 个节点`);
            return;
        }

        const targetItem = selectedNodes[0] || item;
        const historyType = type === 'line' ? 'link' : 'node';
        const historyText = type === 'line' ? '删除连线' : '删除节点';
        const nodeId = type === 'line' ? (item.closest('.node')?.dataset.nodeId || null) : (targetItem?.dataset?.nodeId || null);
        const deleted = this.runSceneCommand({ historyType, historyText, nodeId }, () => {
            if (type === 'line' && item) {
                State.links = State.links.filter((l) => {
                    if (l.pathEl === item) {
                        const targetNode = l.toEl.closest('.node');
                        if (targetNode && targetNode._refs) {
                            targetNode._refs = targetNode._refs.filter((r) => r.linkId !== l.id);
                            this.renderReferences(targetNode);
                        }
                        l.pathEl.remove();
                        return false;
                    }
                    return true;
                });
            } else {
                State.links = State.links.filter((l) => {
                    const rel = l.fromEl.closest('.node') === targetItem || l.toEl.closest('.node') === targetItem;
                    if (rel) {
                        const targetNode = l.toEl.closest('.node');
                        if (targetNode && targetNode._refs) {
                            targetNode._refs = targetNode._refs.filter((r) => r.linkId !== l.id);
                            this.renderReferences(targetNode);
                        }
                        l.pathEl.remove();
                    }
                    return !rel;
                });
                State.nodes = State.nodes.filter((n) => n.el !== targetItem);
                targetItem?.remove();
            }
            this.clearMultiSelection();
            this.deselect();
            this.syncCanvasEmptyState();
        });
        if (deleted) this.toast(type === 'line' ? '连线已删除' : '节点已删除');
    }
};

Interaction.init();
UI.updateCanvas();
UI.updateZoomUI();
document.oncontextmenu = e => e.preventDefault();
