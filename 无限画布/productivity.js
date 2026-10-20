/* Import, reference and navigation tools; graph mutations remain reversible commands. */
window.Productivity = {
    initialized: false, importToken: 0, previousView: null,
    fileType(file) {
        if (!file || file.size > 100 * 1024 * 1024 || file.size < 1) return null;
        if (/^image\/(png|jpeg|webp)$/.test(file.type)) return 'image';
        if (/^video\/(mp4|webm)$/.test(file.type)) return 'video';
        if (/^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac)$/.test(file.type)) return 'audio';
        return null;
    },
    isEditing(target) { return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"],dialog[open]'); },
    center() {
        const panel = document.querySelector('.agent-panel:not(.hidden)');
        const right = panel?.getBoundingClientRect().left || innerWidth;
        return Engine.screenToCanvas(Math.max(120, right / 2), innerHeight / 2);
    },
    importPosition(index, total, origin) {
        const columns = Math.min(4, Math.ceil(Math.sqrt(total)));
        const pos = { x: origin.x + (index % columns) * 310, y: origin.y + Math.floor(index / columns) * 340 };
        return window.Creative?.freePosition(pos, 'image') || pos;
    },
    showImport(rows, done = false) {
        const status = this.importStatus; if (!status) return;
        status.hidden = false;
        const completed = rows.filter(row => row.status !== '等待' && row.status !== '读取中').length;
        status.querySelector('strong').textContent = done ? '导入结果' : `导入素材 ${completed} / ${rows.length}`;
        status.querySelector('progress').max = Math.max(1, rows.length); status.querySelector('progress').value = completed;
        status.querySelector('[data-import-cancel]').hidden = done;
        status.querySelector('[data-import-close]').hidden = !done;
        const list = status.querySelector('ul'); list.replaceChildren();
        for (const row of rows) { const item = document.createElement('li'); item.textContent = `${row.name} · ${row.status}`; list.appendChild(item); }
    },
    async importFiles(files, origin = this.center()) {
        const batch = Array.from(files || []); if (!batch.length) return { created: 0, rows: [] };
        if (this.importing) { Interaction.toast('请等待当前导入完成，或先取消导入', 'warn'); return { created: 0, busy: true }; }
        this.importing = true;
        const token = ++this.importToken, projectId = Workspace.projectId, scene = State.nodes;
        const rows = batch.map(file => ({ name: file.name || '粘贴图片', status: '等待' })), ready = [];
        const valid = () => token === this.importToken && Workspace.projectId === projectId && State.nodes === scene;
        try {
            for (let index = 0; index < batch.length; index++) {
                if (!valid()) break;
                const file = batch[index], row = rows[index], type = this.fileType(file);
                if (!type) { row.status = '不支持的格式、空文件或超过 100MB'; this.showImport(rows); continue; }
                if (State.nodes.length + ready.length >= ProjectStore.MAX_NODES) { row.status = `超过 ${ProjectStore.MAX_NODES} 个节点上限`; this.showImport(rows); continue; }
                row.status = '读取中'; this.showImport(rows);
                try {
                    const url = await ProjectStore.fileDataUrl(file);
                    if (!valid()) break;
                    if (!url.startsWith(`data:${file.type};base64,`)) throw new Error('读取结果与素材类型不符');
                    ready.push({ file, url, type, row }); row.status = '准备就绪';
                } catch (error) { row.status = `读取失败：${error.message || '无法读取文件'}`; }
                this.showImport(rows);
            }
            if (!valid()) {
                for (const row of rows) if (['等待', '读取中', '准备就绪'].includes(row.status)) row.status = '已取消，未加入画布';
                this.showImport(rows, true); return { created: 0, cancelled: true, rows };
            }
            const remaining = Math.max(0, ProjectStore.MAX_NODES - State.nodes.length);
            const accepted = ready.slice(0, remaining);
            ready.slice(remaining).forEach(item => item.row.status = '画布容量不足');
            let created = 0;
            if (accepted.length) {
                const applied = Interaction.runSceneCommand({ historyType: 'upload', historyText: `批量导入 ${accepted.length} 个素材` }, () => {
                    accepted.forEach((item, index) => {
                        const position = this.importPosition(index, accepted.length, origin);
                        const el = UI.createNode(item.type, position, item.url, { withPrompt: false, nodeName: item.file.name || '粘贴图片', status: '已上传' });
                        el._rawFile = item.file; State.nodes.push({ el, ...position, type: item.type });
                    });
                    Interaction.syncCanvasEmptyState();
                });
                created = applied ? accepted.length : 0;
                accepted.forEach(item => item.row.status = applied ? '已导入' : '导入失败，已回滚');
                if (applied) { Interaction.refreshAllReferences(); Workspace.scheduleSave(); this.refresh(); Interaction.toast(`已导入 ${created} 个素材，可一次撤销`); }
            }
            this.showImport(rows, true); return { created, rows };
        } finally { this.importing = false; }
    },
    cancelImport() { ++this.importToken; },
    decorateNote(node) {
        if (!node?._production?.note) return;
        node.classList.add('production-note'); node.dataset.nodeStatus = '说明 · 不参与生成';
        node.querySelector('.ai-panel')?.remove();
        const text = node.querySelector('.text-node-input'); if (text) text.placeholder = '双击记录创作说明，不参与生成…';
        node.querySelectorAll('.connector').forEach(connector => { connector.hidden = true; connector.tabIndex = -1; });
        node.querySelector('.node-type-meta')?.setAttribute('aria-label', '说明');
    },
    addNote(position = this.center()) {
        let node;
        const applied = Interaction.runSceneCommand({ historyText: '添加说明节点' }, () => {
            const pos = Creative.freePosition(position, 'text');
            node = UI.createNode('text', pos, null, { withPrompt: false, nodeName: '创作说明', status: '说明 · 不参与生成' });
            node._production = { note: true }; this.decorateNote(node);
            State.nodes.push({ el: node, ...pos, type: 'text' }); Interaction.syncCanvasEmptyState();
        });
        if (applied) { Interaction.focusNode(node); this.refresh(); }
        return applied ? node : null;
    },
    contextReferences() {
        const ids = Creative.manualContext ? [...Creative.contextIds] : Interaction.getSelectedNodeElements().map(el => el.dataset.nodeId);
        const target = document.getElementById('agent-context'); if (!target || !ids.length) return;
        const nodes = ids.map(id => State.nodes.find(n => n.el.dataset.nodeId === id)).filter(Boolean);
        const refs = nodes.map(n => ({ node: n.el, name: n.el.dataset.nodeName, src: Creative.media(n.el)?.getAttribute('src') }));
        if (this.contextRefs?.length === refs.length && refs.every((ref, i) => ref.node === this.contextRefs[i].node && ref.name === this.contextRefs[i].name && ref.src === this.contextRefs[i].src) && target.querySelector('.reference-object')) return;
        this.contextRefs = refs; target.replaceChildren();
        for (const n of nodes) {
            const chip = document.createElement('span'); chip.className = 'reference-object';
            const locate = document.createElement('button'); locate.type = 'button'; locate.title = '定位到引用源节点'; locate.className = 'reference-locate';
            const media = Creative.media(n.el);
            if (media?.tagName === 'IMG') { const img = document.createElement('img'); img.src = media.src; img.alt = ''; locate.appendChild(img); }
            else locate.appendChild(Creative.icon({ text: 'text', image: 'image', video: 'video', audio: 'audio-lines', scene: 'box' }[n.type]));
            const label = document.createElement('span'); label.textContent = n.el.dataset.nodeName; locate.appendChild(label);
            locate.setAttribute('aria-label', `定位引用：${n.el.dataset.nodeName}`);
            locate.onclick = () => { if (!Creative.manualContext) { Creative.contextIds = new Set(ids); Creative.manualContext = true; } Interaction.focusNode(n.el); };
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `移除引用：${n.el.dataset.nodeName}`);
            remove.onclick = () => { Creative.contextIds = new Set(ids.filter(id => id !== n.el.dataset.nodeId)); Creative.manualContext = true; Creative.contextSignature = ''; Creative.updateContext(); };
            chip.append(locate, remove); target.appendChild(chip);
        }
    },
    widthBounds() { const max = Math.max(240, Math.min(760, innerWidth - 80)); return { min: Math.min(320, max), max }; },
    setAssistantWidth(value, persist = true) {
        const { min, max } = this.widthBounds();
        const width = Math.round(Engine.clamp(Number(value) || 420, min, max)); this.assistantWidth = width;
        document.documentElement.style.setProperty('--assistant-width', `${width}px`);
        this.separator?.setAttribute('aria-valuemin', String(min)); this.separator?.setAttribute('aria-valuemax', String(max)); this.separator?.setAttribute('aria-valuenow', String(width));
        if (persist) { try { localStorage.setItem('canvas.ui.assistant-width', String(width)); } catch {} }
        Creative.layout(); return width;
    },
    mainCluster() {
        const nodes = State.nodes; if (nodes.length < 2) return nodes;
        const buckets = new Map();
        for (const n of nodes) {
            const key = `${Math.floor(n.x / 700)},${Math.floor(n.y / 700)}`;
            if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(n);
        }
        const visited = new Set(), groups = [];
        for (const key of buckets.keys()) {
            if (visited.has(key)) continue;
            const queue = [key], group = []; visited.add(key);
            for (let i = 0; i < queue.length; i++) {
                const current = queue[i], [x, y] = current.split(',').map(Number); group.push(...buckets.get(current));
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    const next = `${x + dx},${y + dy}`;
                    if (buckets.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
                }
            }
            groups.push(group);
        }
        return groups.sort((a, b) => b.length - a.length)[0];
    },
    fit(nodes) {
        if (!nodes.length) return Interaction.toast('没有可定位的节点');
        this.previousView = { ...State.canvas, projectId: Workspace.projectId };
        const bounds = nodes.reduce((b, n) => {
            const box = n.el.querySelector('.node-box'); const width = box?.offsetWidth || 250, height = box?.offsetHeight || 250;
            return { left: Math.min(b.left, n.x), top: Math.min(b.top, n.y - 36), right: Math.max(b.right, n.x + width), bottom: Math.max(b.bottom, n.y + height) };
        }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const panel = document.querySelector('.agent-panel:not(.hidden)'); const right = panel?.getBoundingClientRect().left || innerWidth;
        const width = Math.max(180, right - 150), height = Math.max(180, innerHeight - 200);
        const scale = Engine.clamp(Math.min(width / (bounds.right - bounds.left + 80), height / (bounds.bottom - bounds.top + 80), 1.5), Interaction.minScale, Interaction.maxScale);
        State.canvas.scale = scale;
        const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2;
        State.canvas.x = SUPPORTS_CSS_ZOOM ? (right + 64) / 2 / scale - centerX : (right + 64) / 2 - centerX * scale;
        State.canvas.y = SUPPORTS_CSS_ZOOM ? innerHeight / 2 / scale - centerY : innerHeight / 2 - centerY * scale;
        Interaction.requestRender({ canvas: true, tempLine: true }); Workspace.scheduleSave(); this.refresh();
    },
    returnView() {
        if (!this.previousView || this.previousView.projectId !== Workspace.projectId) return Interaction.toast('没有可返回的视图');
        const { projectId: _, ...view } = this.previousView; this.previousView = null; Object.assign(State.canvas, view);
        Interaction.requestRender({ canvas: true, tempLine: true }); Workspace.scheduleSave(); this.refresh();
    },
    updateVisibility() {
        const a = Engine.screenToCanvas(-180, -180), b = Engine.screenToCanvas(innerWidth + 180, innerHeight + 180);
        const low = State.canvas.scale < .45;
        if (this.lowDetail !== low) { document.body.classList.toggle('canvas-low-detail', low); this.lowDetail = low; }
        this.visibilityState ||= new WeakMap();
        const selectedNodes = new Set(State.multiSelection); selectedNodes.add(State.selection.item); selectedNodes.add(document.activeElement?.closest('.node'));
        for (const n of State.nodes) {
            const selected = selectedNodes.has(n.el);
            const offscreen = !selected && (n.x + 500 < a.x || n.y + 500 < a.y || n.x > b.x || n.y > b.y);
            if (this.visibilityState.get(n.el) === offscreen) continue;
            this.visibilityState.set(n.el, offscreen); n.el.classList.toggle('productivity-offscreen', offscreen);
            if (offscreen) for (const media of n.el.querySelectorAll('video,audio')) if (!media.paused) media.pause();
        }
    },
    refresh() {
        if (!this.initialized) return;
        for (const n of State.nodes) this.decorateNote(n.el);
        this.updateVisibility(); this.contextReferences();
    },
    init() {
        if (this.initialized) return; this.initialized = true;
        const input = document.getElementById('file-input'), original = input.onchange;
        input.multiple = true;
        // The original handler exclusively retains node replacements and reference uploads.
        input.onchange = event => {
            if (State.uploadContext?.kind !== 'global') return original?.call(input, event);
            const files = Array.from(event.target.files || []); State.uploadContext = null; event.target.value = '';
            return this.importFiles(files);
        };
        input.addEventListener('click', () => { input.multiple = State.uploadContext?.kind === 'global'; });
        const viewport = document.getElementById('viewport');
        viewport.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; viewport.classList.add('productivity-drop-target'); } });
        viewport.addEventListener('dragleave', event => { if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('productivity-drop-target'); });
        viewport.addEventListener('drop', event => { viewport.classList.remove('productivity-drop-target'); const files = event.dataTransfer?.files; if (!files?.length) return; event.preventDefault(); event.stopPropagation(); this.importFiles(files, Engine.screenToCanvas(event.clientX, event.clientY)); });
        document.addEventListener('paste', event => {
            if (this.isEditing(event.target) || this.isEditing(document.activeElement) || document.querySelector('dialog[open]')) return;
            const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
            if (files.length) { event.preventDefault(); this.importFiles(files); }
            else if (State.clipboard?.nodes?.length) { event.preventDefault(); Interaction.pasteCopiedNodes(); }
        });
        // Let the browser deliver ClipboardEvent before choosing system images or
        // the internal node clipboard; the older keydown handler would suppress it.
        document.addEventListener('keydown', event => {
            if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !this.isEditing(event.target) && !this.isEditing(document.activeElement) && !document.querySelector('dialog[open]')) event.stopImmediatePropagation();
        }, true);
        const status = document.createElement('section'); status.className = 'productivity-import-status'; status.hidden = true; status.setAttribute('aria-label', '素材导入进度');
        status.innerHTML = '<header><strong role="status" aria-live="polite"></strong><button type="button" data-import-cancel>取消</button><button type="button" data-import-close hidden>关闭</button></header><progress></progress><ul></ul>';
        status.querySelector('[data-import-cancel]').onclick = () => this.cancelImport(); status.querySelector('[data-import-close]').onclick = () => status.hidden = true;
        document.body.appendChild(status); this.importStatus = status;
        const note = document.createElement('button'); note.type = 'button'; note.className = 'production-note-entry'; note.textContent = '说明 / 便签'; note.setAttribute('role', 'menuitem');
        note.onclick = event => { event.stopPropagation(); const position = State.menuPosition || this.center(); Interaction.closeNodeMenu(); this.addNote(position); }; document.getElementById('nodeMenu')?.appendChild(note);
        const separator = document.createElement('div'); separator.className = 'assistant-resizer'; separator.tabIndex = 0; separator.role = 'separator'; separator.setAttribute('aria-orientation', 'vertical'); separator.setAttribute('aria-label', '调整助手宽度');
        this.separator = separator; document.querySelector('.agent-panel')?.appendChild(separator);
        let drag = null;
        separator.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); drag = event.pointerId; separator.setPointerCapture?.(drag); document.body.classList.add('resizing-assistant'); });
        separator.addEventListener('pointermove', event => { if (drag !== event.pointerId) return; this.setAssistantWidth(innerWidth - event.clientX, false); });
        const finish = () => { if (drag === null) return; drag = null; document.body.classList.remove('resizing-assistant'); this.setAssistantWidth(this.assistantWidth); };
        separator.addEventListener('pointerup', finish); separator.addEventListener('pointercancel', finish); separator.addEventListener('lostpointercapture', finish);
        separator.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); const bounds = this.widthBounds();
            this.setAssistantWidth(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : this.assistantWidth + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 40 : 16));
        });
        let saved; try { saved = localStorage.getItem('canvas.ui.assistant-width'); } catch {} this.setAssistantWidth(saved || 420, false);
        window.addEventListener('resize', () => { this.setAssistantWidth(this.assistantWidth, false); this.refresh(); });
        const updateContext = Creative.updateContext.bind(Creative); Creative.updateContext = () => { updateContext(); this.contextReferences(); };
        const flushLayout = Creative.flushLayout.bind(Creative); Creative.flushLayout = () => { flushLayout(); this.updateVisibility(); };
        const onRestore = Creative.onRestore.bind(Creative); Creative.onRestore = () => { onRestore(); this.refresh(); };
        const fit = document.getElementById('fit-canvas-btn');
        fit?.addEventListener('click', event => {
            event.preventDefault(); event.stopImmediatePropagation();
            const selected = Interaction.getSelectedNodeElements();
            const chosen = selected.length ? State.nodes.filter(n => selected.includes(n.el)) : this.mainCluster();
            this.fit(chosen);
        }, true);
        if (fit) { fit.title = '适应选区；未选择时适应主要内容'; fit.setAttribute('aria-label', fit.title); }
        const controls = document.getElementById('canvas-controls');
        for (const [label, action, text] of [['返回上一视图', () => this.returnView(), '↶'], ['显示全部节点', () => this.fit(State.nodes), '全览']]) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-ctl-btn productivity-view-button'; button.textContent = text; button.title = label; button.setAttribute('aria-label', label); button.onclick = action; controls?.appendChild(button);
        }
        this.refresh();
    }
};
