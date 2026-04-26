/**
 * [API 密钥填写]
 */
const T8STAR_API_KEY = "sk-tmGRpPqiFTHisGU1epRoHtkKv1W5xxtgmt4pIhqj2r1BNDTS"; // 请确保填入 sk- 开头的正确密钥
const GPT_IMAGE_2_API_KEY = "sk-OFBMv6xy7KXfTLCxA0vY9uQRmhjv4syRarkSdGseIzvE4790";

const MODEL_OPTIONS = [
    { id: "gemini-3.1-flash-image-preview-4k", label: "NanoBanana", icon: "🍌" },
    { id: "gpt-image-2", label: "gpt-image-2", icon: "🌀" }
];
const SUPPORTS_CSS_ZOOM = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("zoom", "1");
const HISTORY_STORAGE_KEY = "infinite_canvas_history_v1";

function getModelMeta(modelId) {
    return MODEL_OPTIONS.find((model) => model.id === modelId) || MODEL_OPTIONS[0];
}

function getApiKeyByModel(modelId) {
    if (modelId === "gpt-image-2") return GPT_IMAGE_2_API_KEY;
    return T8STAR_API_KEY;
}

const State = {
    canvas: { x: -4500, y: -4500, scale: 1 },
    nodes: [], links: [], selection: { type: null, item: null },
    linking: { active: false, startEl: null }, uploadContext: null, menuConnectorEl: null,
    history: []
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
    createNode(type, pos, url = null, options = {}) {
        const withPrompt = options.withPrompt !== false;
        const node = document.createElement('div');
        node.className = 'node';
        node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px';
        node.dataset.nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        node.dataset.model = MODEL_OPTIONS[0].id;
        node.dataset.ratio = "1:1";
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

        // withPrompt=false: 只保留图片框 + 左右连接点（用于上传素材节点）
        node.innerHTML = withPrompt ? `
            <div class="node-label">${type.toUpperCase()}</div>
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
            <div class="node-label">${type.toUpperCase()}</div>
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

    toast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
    },

    loadHistory() {
        try {
            const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
            State.history = raw ? JSON.parse(raw) : [];
        } catch {
            State.history = [];
        }
        this.renderHistory();
    },

    saveHistory() {
        try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(State.history.slice(0, 60)));
        } catch {}
    },

    pushHistory(type, text, meta = {}) {
        State.history.unshift({
            type,
            text,
            time: new Date().toLocaleString(),
            nodeId: meta.nodeId || null
        });
        State.history = State.history.slice(0, 60);
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
        list.innerHTML = State.history.map(item =>
            `<button class="history-item" type="button" data-node-id="${item.nodeId || ''}"><div>${item.text}</div><div style="opacity:.62;margin-top:2px;">${item.time}</div></button>`
        ).join('');
    },

    getSelectedImageNode() {
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
        img.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;
        const rotate = Number(img.dataset.rotateDeg || '0');
        const flipX = img.dataset.flipX === '1';
        img.style.transform = `${flipX ? 'scaleX(-1) ' : ''}rotate(${rotate}deg)`;
        this.pushHistory('edit', `图片编辑：亮度${brightness} 对比${contrast} 饱和${saturate}`, { nodeId: node.dataset.nodeId });
        this.toast('图片编辑已应用');
    },

    runAgentAction(type) {
        const agentInput = document.querySelector('.agent-input');
        const selectedNode = State.selection.type === 'node' ? State.selection.item : null;
        const selectedPromptInput = selectedNode?.querySelector('.ai-panel .ai-input');
        const presets = {
            idea: "给我 5 个可落地的视觉创意方向，并附每个方向的关键词。",
            role: "帮我写一个角色设定：身份、外观、性格、场景和镜头语言。",
            ref: "帮我列出这个主题的参考图检索词（中英文各 10 条）。"
        };
        const text = presets[type] || "";
        if (agentInput) agentInput.value = text;
        if (selectedPromptInput) selectedPromptInput.value = text;
        this.pushHistory('agent', `Agent动作：${type}`);
        this.toast('已填入 Agent / 节点输入');
    },

    submitAgentInput() {
        const input = document.querySelector('.agent-input');
        const text = input?.value.trim();
        if (!text) {
            this.toast('先输入内容');
            return;
        }
        if (State.selection.type === 'node' && State.selection.item?.querySelector('.ai-panel .ai-input')) {
            State.selection.item.querySelector('.ai-panel .ai-input').value = text;
            this.toast('已写入当前节点提示词');
        } else {
            const pos = Engine.screenToCanvas(window.innerWidth * 0.5, window.innerHeight * 0.3);
            const nodeEl = UI.createNode('text', pos);
            const node = { el: nodeEl, x: pos.x, y: pos.y, type: 'text' };
            State.nodes.push(node);
            nodeEl.querySelector('.text-node-input').value = text;
            this.syncCanvasEmptyState();
            this.toast('已创建文本节点');
        }
        this.pushHistory('agent', `Agent发送：${text.slice(0, 28)}`);
    },

    focusNode(nodeEl) {
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

    init() {
        const view = document.getElementById('viewport');
        view.onmousedown = (e) => {
            const isCanvasBg = (e.target === view || e.target.id === 'canvas');
            const startPan = e.button === 1 || (e.button === 0 && isCanvasBg);
            if (startPan) {
                this.stopInertia();
                this.isPanning = true;
                this.panVelocity.x = 0;
                this.panVelocity.y = 0;
                view.style.cursor = 'grabbing';
            }
            if (e.target === view || e.target.id === 'canvas') {
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
        window.onmousemove = (e) => {
            this.mouseScreen.x = e.clientX;
            this.mouseScreen.y = e.clientY;
            this.applyTapNowMotion(e.clientX, e.clientY);
            if (this.isPanning) {
                State.canvas.x += e.movementX;
                State.canvas.y += e.movementY;
                this.panVelocity.x = this.panVelocity.x * 0.6 + e.movementX * 0.4;
                this.panVelocity.y = this.panVelocity.y * 0.6 + e.movementY * 0.4;
                this.requestRender({ canvas: true, lines: true, tempLine: true });
            }
            if (this.dragNode) {
                this.dragNode.x += e.movementX / State.canvas.scale; this.dragNode.y += e.movementY / State.canvas.scale;
                this.dragNode.el.style.left = this.dragNode.x + 'px'; this.dragNode.el.style.top = this.dragNode.y + 'px';
                this.requestRender({ lines: true, tempLine: true });
            }
            if (State.linking.active) {
                this.requestRender({ tempLine: true });
            }
        };
        window.onmouseup = () => {
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
            if (this.dragNode) this.dragNode.el.classList.remove('dragging');
            this.dragNode = null;
        };
        window.onblur = () => this.resetTapNowMotion();
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
            const refRemoveBtn = e.target.closest('.ref-remove-btn');
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
                    const el = UI.createNode(type, pos);
                    State.nodes.push({ el, x: pos.x, y: pos.y, type });

                    if (startConnector) {
                        this.createLinkBetween(startConnector, el.querySelector('.conn-left'));
                        if (State.linking.active) this.stopLinking();
                    } else if (endConnector) {
                        this.createLinkBetween(el.querySelector('.conn-right'), endConnector);
                    }
                    this.syncCanvasEmptyState();
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
            if (refRemoveBtn && node) {
                const refId = refRemoveBtn.closest('.ref-thumb-wrapper')?.dataset.refId;
                if (refId) this.removeReferenceById(node, refId);
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
            if (line) { this.deselect(); State.selection = { type: 'line', item: line }; line.classList.add('selected'); return; }
            if (node) { this.deselect(); State.selection = { type: 'node', item: node }; node.classList.add('selected'); }
        };

        window.onkeydown = (e) => {
            if (['Escape','Delete','Backspace'].includes(e.key)) {
                if (document.activeElement.tagName === 'TEXTAREA') { if(e.key==='Escape') document.activeElement.blur(); return; }
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
        const agentHeaderBtns = Array.from(document.querySelectorAll('.agent-header-actions .agent-icon-btn'));
        const historyClearBtn = document.getElementById('history-clear-btn');
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
        if (historyClearBtn) {
            historyClearBtn.onclick = (e) => {
                e.stopPropagation();
                State.history = [];
                this.saveHistory();
                this.renderHistory();
                this.toast('历史已清空');
            };
        }
        if (historyList) {
            historyList.onclick = (e) => {
                const item = e.target.closest('.history-item');
                if (!item) return;
                const nodeId = item.dataset.nodeId;
                if (!nodeId) return;
                const nodeEl = document.querySelector(`.node[data-node-id="${nodeId}"]`);
                if (!nodeEl) {
                    this.toast('对应节点已不存在');
                    return;
                }
                this.focusNode(nodeEl);
                this.toast('已定位到历史节点');
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
                const current = Number(img.dataset.rotateDeg || '0');
                const next = (current + 90) % 360;
                img.dataset.rotateDeg = String(next);
                const flipX = img.dataset.flipX === '1';
                img.style.transform = `${flipX ? 'scaleX(-1) ' : ''}rotate(${next}deg)`;
                this.pushHistory('edit', `图片旋转：${next}°`, { nodeId: node.dataset.nodeId });
                this.toast('已旋转 90°');
            };
        }
        if (editorMirrorBtn) {
            editorMirrorBtn.onclick = (e) => {
                e.stopPropagation();
                const node = this.getSelectedImageNode();
                if (!node) return this.toast('请先选中图片节点');
                const img = node.querySelector('.media-container img');
                if (!img) return this.toast('当前节点没有图片');
                const rotate = Number(img.dataset.rotateDeg || '0');
                const nextFlip = img.dataset.flipX === '1' ? '0' : '1';
                img.dataset.flipX = nextFlip;
                img.style.transform = `${nextFlip === '1' ? 'scaleX(-1) ' : ''}rotate(${rotate}deg)`;
                this.pushHistory('edit', `图片镜像：${nextFlip === '1' ? '开' : '关'}`, { nodeId: node.dataset.nodeId });
                this.toast('镜像状态已切换');
            };
        }
        if (topChips.length) {
            topChips[0].onclick = () => this.toast('角色库入口已预留');
            if (topChips[1]) topChips[1].onclick = () => {
                this.focusCanvasCenter();
                this.openNodeMenuAt(window.innerWidth * 0.5, window.innerHeight * 0.35, null);
            };
            if (topChips[2]) topChips[2].onclick = () => window.open('https://github.com/dcjrcjfc/infinite-canvas-aigc', '_blank');
        }
        if (agentHeaderBtns.length) {
            if (agentHeaderBtns[0]) {
                agentHeaderBtns[0].onclick = () => {
                    const pos = Engine.screenToCanvas(window.innerWidth * 0.5, window.innerHeight * 0.35);
                    const el = UI.createNode('text', pos);
                    State.nodes.push({ el, x: pos.x, y: pos.y, type: 'text' });
                    this.syncCanvasEmptyState();
                    this.pushHistory('node', 'Agent新建文本节点', { nodeId: el.dataset.nodeId });
                    this.toast('已新建文本节点');
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
            if (agentChips[0]) agentChips[0].onclick = () => this.runAgentAction('idea');
            if (agentChips[1]) agentChips[1].onclick = () => this.runAgentAction('role');
            if (agentChips[2]) agentChips[2].onclick = () => this.runAgentAction('ref');
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
        this.loadHistory();
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
                this.dragNode = State.nodes.find(n => n.el === node);
                if (this.dragNode?.el) this.dragNode.el.classList.add('dragging');
            }
        };

        document.getElementById('file-input').onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            if (!State.uploadContext) return;
            if (State.uploadContext.kind === 'global') {
                const pos = Engine.screenToCanvas(window.innerWidth/2, window.innerHeight/2);
                const nodeType = file.type.includes('video') ? 'video' : 'image';
                const el = UI.createNode(nodeType, pos, url, { withPrompt: false });
                el._rawFile = file;
                State.nodes.push({ el, x: pos.x, y: pos.y, type: nodeType });
                this.syncCanvasEmptyState();
                this.pushHistory('upload', `上传素材：${file.name}`, { nodeId: el.dataset.nodeId });
            } else if (State.uploadContext.kind === 'node') {
                const targetNode = State.uploadContext.node;
                targetNode.querySelector('.media-container').innerHTML = file.type.includes('video') ? `<video src="${url}" autoplay loop muted></video>` : `<img src="${url}">`;
                targetNode._rawFile = file;
                const img = targetNode.querySelector('img');
                if(img) img.onload = () => this.requestRender({ lines: true });
                this.pushHistory('upload', `替换素材：${file.name}`, { nodeId: targetNode.dataset.nodeId });
            } else if (State.uploadContext.kind === 'ref') {
                this.addManualReference(State.uploadContext.node, file);
                this.pushHistory('upload', `添加参考图：${file.name}`, { nodeId: State.uploadContext.node?.dataset.nodeId });
            }
            State.uploadContext = null;
            e.target.value = '';
        };
    },

    async runAI(node) {
        const prompt = node.querySelector('.ai-panel .ai-input').value.trim();
        const ratio = node.dataset.ratio;
        const model = node.dataset.model || MODEL_OPTIONS[0].id;
        const apiKey = getApiKeyByModel(model);
        const btn = node.querySelector('.send-btn');
        if (!prompt) return alert("请输入指令");

        btn.classList.add('loading');

        try {
            let res;
            const sizeMap = { "1:1":"1024x1024", "16:9":"1792x1024", "9:16":"1024x1792" };
            const size = sizeMap[ratio] || "1024x1024";
            const refFiles = await this.getNodeReferenceFiles(node);

            if (refFiles.length) {
                const fd = new FormData();
                refFiles.forEach((file, index) => fd.append('image', file, file.name || `reference_${index}.png`));
                fd.append('prompt', prompt);
                fd.append('model', model);
                fd.append('image_size', '1K'); 
                
                res = await fetch("https://ai.t8star.cn/v1/images/edits", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}` },
                    body: fd
                });
            } else {
                res = await fetch("https://ai.t8star.cn/v1/images/generations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, prompt, n: 1, size: size, image_size: "1K" })
                });
            }
            
            const result = await res.json();
            console.log("API Result:", result); 
            if (result.data) {
                node.querySelector('.media-container').innerHTML = `<img src="${result.data[0].url}">`;
                // 远程 URL 无法直接映射本地文件对象，后续需要时会按 URL 转 File
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
                this.pushHistory('generate', `生成成功：${model} / ${ratio} / ${prompt.slice(0, 26)}`, { nodeId: node.dataset.nodeId });
            } else {
                alert("生成异常: " + JSON.stringify(result.error || result));
            }
        } catch (err) { alert("网络错误，请检查 API Key"); }
        finally { btn.classList.remove('loading'); }
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
                    file: sourceNode._rawFile || null
                };
            });
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
        this.createLinkBetween(State.linking.startEl, endEl);
        this.stopLinking();
    },

    createLinkBetween(fromConnectorEl, toConnectorEl) {
        if (!fromConnectorEl || !toConnectorEl) return;
        const startNodeEl = fromConnectorEl.closest('.node');
        const endNodeEl = toConnectorEl.closest('.node');
        if (!startNodeEl || !endNodeEl || startNodeEl === endNodeEl) return;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute('class', 'line');
        const linkId = 'link_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        line.dataset.id = linkId;

        document.getElementById('links-container').appendChild(line);
        State.links.push({ id: linkId, fromEl: fromConnectorEl, toEl: toConnectorEl, pathEl: line });

        // 自动把上游图片带到下游参考区
        this.addReferenceImage(startNodeEl, endNodeEl, linkId);
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
            file: sourceNode._rawFile
        });

        this.renderReferences(targetNode);
    },

    // === 新增：渲染参考图缩略图 ===
    renderReferences(node) {
        const container = node.querySelector('.ref-container');
        if (!container || !node._refs) return;

        container.innerHTML = '';
        node._refs.forEach(ref => {
            const thumb = document.createElement('div');
            thumb.className = 'ref-thumb-wrapper';
            thumb.dataset.refId = ref.id;
            if (ref.type === 'video') {
                thumb.innerHTML = `<video src="${ref.src}" muted></video>`;
            } else {
                thumb.innerHTML = `<img src="${ref.src}">`;
            }
            thumb.innerHTML += `<button class="ref-remove-btn" title="移除参考图">×</button>`;
            container.appendChild(thumb);
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
            file
        });
        this.renderReferences(node);
    },

    removeReferenceById(node, refId) {
        if (!node || !node._refs) return;
        node._refs = node._refs.filter(ref => ref.id !== refId);
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
        const refs = node._refs || [];
        const files = [];

        for (const ref of refs) {
            if (ref.type !== 'img') continue;
            if (ref.file) {
                files.push(ref.file);
                continue;
            }
            try {
                const file = await this.createFileFromImageUrl(ref.src);
                ref.file = file;
                files.push(file);
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
        const { type, item } = State.selection; if (!item) return;
        if (type === 'node') {
            State.links = State.links.filter(l => {
                const rel = l.fromEl.closest('.node') === item || l.toEl.closest('.node') === item;
                if (rel) {
                    const targetNode = l.toEl.closest('.node');
                    if (targetNode && targetNode._refs) {
                        targetNode._refs = targetNode._refs.filter(r => r.linkId !== l.id);
                        this.renderReferences(targetNode);
                    }
                    l.pathEl.remove(); 
                }
                return !rel;
            });
            State.nodes = State.nodes.filter(n => n.el !== item); item.remove();
        } else {
            State.links = State.links.filter(l => { 
                if (l.pathEl === item) { 
                    const targetNode = l.toEl.closest('.node');
                    if (targetNode && targetNode._refs) {
                        targetNode._refs = targetNode._refs.filter(r => r.linkId !== l.id);
                        this.renderReferences(targetNode);
                    }
                    l.pathEl.remove(); return false; 
                } 
                return true; 
            });
        }
        this.deselect();
        this.syncCanvasEmptyState();
    }
};

Interaction.init();
UI.updateCanvas();
UI.updateZoomUI();
document.oncontextmenu = e => e.preventDefault();
