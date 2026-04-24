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
    linking: { active: false, startEl: null }, uploadContext: null
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
    createNode(type, pos, url = null) {
        const node = document.createElement('div');
        node.className = 'node';
        node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px';
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

        // === 修改：在 ai-panel 内部增加了 ref-container ===
        node.innerHTML = `
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
    },

    toggleAgentPanel() {
        const panel = document.querySelector('.agent-panel');
        if (!panel) return;
        this.setAgentPanelOpen(panel.classList.contains('hidden'));
    },

    syncCanvasEmptyState() {
        const emptyState = document.getElementById('canvas-empty-state');
        if (!emptyState) return;
        emptyState.classList.toggle('hidden', State.nodes.length > 0);
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
                document.getElementById('nodeMenu').style.display='none';
                document.getElementById('ui-add-btn')?.classList.remove('active');
            }
        };
        window.onmousemove = (e) => {
            this.mouseScreen.x = e.clientX;
            this.mouseScreen.y = e.clientY;
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
            if (this.isPanning) {
                this.isPanning = false;
                view.style.cursor = 'grab';
                if (Math.abs(this.panVelocity.x) > 0.6 || Math.abs(this.panVelocity.y) > 0.6) this.startInertia();
            }
            if (this.dragNode) this.dragNode.el.classList.remove('dragging');
            this.dragNode = null;
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
                    const pos = Engine.screenToCanvas(window.innerWidth/2, window.innerHeight/2);
                    const el = UI.createNode(type, pos);
                    State.nodes.push({ el, x: pos.x, y: pos.y, type });
                    this.syncCanvasEmptyState();
                }
                document.getElementById('nodeMenu').style.display = 'none'; return;
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
                if (!State.linking.active) {
                    if (!connector.classList.contains('conn-right')) return;
                    State.linking.active = true; State.linking.startEl = connector; connector.classList.add('active');
                }
                else { this.completeLink(connector); } return;
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
            menu.style.display = visible ? 'none' : 'block';
            document.getElementById('ui-add-btn')?.classList.toggle('active', !visible);
        };
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomResetBtn = document.getElementById('zoom-reset-btn');
        const zoomSlider = document.getElementById('zoom-slider');
        const agentCollapseBtn = document.getElementById('agent-collapse-btn');
        const agentFabBtn = document.getElementById('agent-fab');
        const railFocusBtn = document.getElementById('rail-focus-btn');
        const railResetBtn = document.getElementById('rail-reset-btn');
        const railAgentBtn = document.getElementById('rail-agent-btn');

        if (zoomOutBtn) zoomOutBtn.onclick = () => this.setScaleByPercent(State.canvas.scale * 100 - 10);
        if (zoomInBtn) zoomInBtn.onclick = () => this.setScaleByPercent(State.canvas.scale * 100 + 10);
        if (zoomResetBtn) zoomResetBtn.onclick = () => this.resetView();
        if (railFocusBtn) railFocusBtn.onclick = () => this.focusCanvasCenter();
        if (railResetBtn) railResetBtn.onclick = () => this.resetView();
        if (railAgentBtn) railAgentBtn.onclick = () => this.toggleAgentPanel();
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
        this.syncCanvasEmptyState();

        document.body.onmousedown = (e) => {
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
                const el = UI.createNode(nodeType, pos, url);
                el._rawFile = file;
                State.nodes.push({ el, x: pos.x, y: pos.y, type: nodeType });
                this.syncCanvasEmptyState();
            } else if (State.uploadContext.kind === 'node') {
                const targetNode = State.uploadContext.node;
                targetNode.querySelector('.media-container').innerHTML = file.type.includes('video') ? `<video src="${url}" autoplay loop muted></video>` : `<img src="${url}">`;
                targetNode._rawFile = file;
                const img = targetNode.querySelector('img');
                if(img) img.onload = () => this.requestRender({ lines: true });
            } else if (State.uploadContext.kind === 'ref') {
                this.addManualReference(State.uploadContext.node, file);
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
        
        const startNodeEl = State.linking.startEl.closest('.node');
        const endNodeEl = endEl.closest('.node');

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute('class', 'line');
        const linkId = 'link_' + Date.now();
        line.dataset.id = linkId; // 绑定唯一ID

        document.getElementById('links-container').appendChild(line);
        State.links.push({ id: linkId, fromEl: State.linking.startEl, toEl: endEl, pathEl: line });
        
        // 核心：添加参考图
        this.addReferenceImage(startNodeEl, endNodeEl, linkId);

        this.requestRender({ lines: true });
        this.stopLinking();
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
