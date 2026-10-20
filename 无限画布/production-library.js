/* Storyboards, reusable assets and workflows share the existing scene commands. */
window.ProductionLibrary = (() => {
    let database, dialog, body, tab = 'storyboard', records = [], query = '', category = '', folder = '', tagFilter = '', referenceCounts = new Map(), lastImport = null, importing = false;
    const BACKUP_FORMAT = 'infinite-canvas-production-library';
    const FIELD_KEY = 'canvas.storyboard.fields';
    const optionalColumns = { number: '镜号', duration: '时长 / 秒', description: '剧情描述', dialogue: '对白', imagePrompt: '图片提示词', videoPrompt: '视频提示词' };
    const visibleColumns = Object.fromEntries(Object.keys(optionalColumns).map(key => [key, true]));
    const categories = ['角色', '场景', '道具', '风格', '其他'];
    const workflowCategories = ['通用', '人物', '产品', '视频', '其他'];
    const id = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const clone = value => structuredClone(value);
    const el = (tag, text, className) => { const item = document.createElement(tag); if (text != null) item.textContent = text; if (className) item.className = className; return item; };
    const button = (label, action) => { const item = el('button', label); item.type = 'button'; item.onclick = async () => { try { await action(); } catch (error) { Interaction.toast(error.message, 'error', 5000); } }; return item; };
    const field = (label, value, change, type = 'text') => { const item = el('input'); item.type = type; item.value = value ?? ''; item.setAttribute('aria-label', label); item.onchange = () => change(item.value); return item; };
    function select(label, options, value, change) { const item = el('select'); item.setAttribute('aria-label', label); for (const option of options) { const o = el('option', typeof option === 'string' ? option : option.label); o.value = typeof option === 'string' ? option : option.value; item.append(o); } item.value = value; item.onchange = () => change(item.value); return item; }
    function openDB() {
        if (!database) database = new Promise((resolve, reject) => {
            const request = indexedDB.open('infinite_canvas_production_library', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
            request.onsuccess = () => resolve(request.result); request.onerror = () => { database = null; reject(request.error); };
            request.onblocked = () => { database = null; reject(new Error('素材库被旧页面占用，请关闭旧页面后重试')); };
        });
        return database;
    }
    async function transaction(mode, action) {
        const db = await openDB();
        return new Promise((resolve, reject) => { const tx = db.transaction('items', mode); let request; try { request = action(tx.objectStore('items')); } catch (error) { reject(error); return; } tx.oncomplete = () => resolve(request?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('素材库保存失败')); });
    }
    const list = () => transaction('readonly', store => store.getAll());
    const get = key => transaction('readonly', store => store.get(key));
    const put = item => transaction('readwrite', store => store.put(item));
    const remove = key => transaction('readwrite', store => store.delete(key));
    function organization(value = {}) {
        const tags = Array.isArray(value.tags) ? value.tags : typeof value.tags === 'string' ? value.tags.split(/[,，]/) : [];
        return { folder: typeof value.folder === 'string' ? value.folder.replace(/[\x00-\x1f]/g, '').trim().slice(0, 120) : '', tags: [...new Set(tags.filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 20) };
    }
    function setFieldVisibility(key, visible) {
        if (!(key in optionalColumns)) return; visibleColumns[key] = !!visible;
        try { localStorage.setItem(FIELD_KEY, JSON.stringify(visibleColumns)); } catch {}
        body?.querySelectorAll(`[data-storyboard-column="${key}"]`).forEach(cell => cell.hidden = !visibleColumns[key]);
        const toggle = body?.querySelector(`[data-field-toggle="${key}"]`); if (toggle) toggle.checked = visibleColumns[key];
    }
    async function updateOrganization(key, changes) {
        const db = await openDB();
        const updated = await new Promise((resolve, reject) => { const tx = db.transaction('items', 'readwrite'), store = tx.objectStore('items'), request = store.get(key); let result;
            request.onsuccess = () => { if (!request.result) { tx.abort(); return; } const current = request.result; result = { ...current, ...organization({ ...current, ...changes }), updatedAt: Date.now() }; if (typeof changes.name === 'string') result.name = changes.name.trim().slice(0, 80) || current.name; if (changes.category && (current.kind === 'asset' ? categories : workflowCategories).includes(changes.category)) result.category = changes.category; store.put(result); };
            tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('库条目已删除，请刷新后重试'));
        }); const cached = records.find(item => item.id === key); if (cached) Object.assign(cached, updated); refreshOrganizationFilters(); applyLibraryFilters(); return updated;
    }
    function command(text, mutate) { if (window.Workspace && !Workspace.ready) throw new Error('画布仍在恢复，请稍候再操作'); const result = Interaction.runSceneCommand({ historyType: 'node', historyText: text }, mutate); window.Creative?.layout(); refresh(); return result; }
    function selectedNodes() { const selected = new Set(Interaction.getSelectedNodeElements()); return State.nodes.filter(node => selected.has(node.el)); }
    const nodeById = key => State.nodes.find(node => node.el.dataset.nodeId === key);
    function position() { const right = document.body.classList.contains('agent-open') ? document.querySelector('.agent-panel')?.getBoundingClientRect().left || innerWidth : innerWidth; return Engine.screenToCanvas(right / 2, innerHeight / 2); }
    function rows() { return State.nodes.filter(node => node.el._production?.shot).sort((a, b) => (a.el._production.shot.order || 0) - (b.el._production.shot.order || 0)); }
    function attachShots(nodes) { return command('加入分镜表', () => { let order = Math.max(0, ...rows().map(node => node.el._production.shot.order || 0)) + 1; for (const node of nodes) { node.el._production ||= {}; node.el._production.shot ||= { order, number: String(order++), duration: Number(node.el.querySelector('.video-duration')?.value) || 4, description: '', dialogue: '', imagePrompt: '', videoPrompt: '' }; } }); }
    function addShot(type = 'image') { let created; command('添加镜头', () => { const pos = position(), order = Math.max(0, ...rows().map(node => node.el._production.shot.order || 0)) + 1; const node = UI.createNode(type, pos, null, { nodeName: `镜头 ${order}` }); State.nodes.push({ el: node, type, ...pos }); node._production = { shot: { order, number: String(order), duration: 4, description: '', dialogue: '', imagePrompt: '', videoPrompt: '' } }; created = node; }); return created; }
    function updateShot(key, name, value) {
        const node = nodeById(key); if (!node?.el._production?.shot) return;
        command('修改分镜', () => { const shot = node.el._production.shot; shot[name] = name === 'duration' ? Math.max(1, Math.min(60, Number(value) || 4)) : String(value).slice(0, name === 'number' ? 40 : 30000);
            if (name === 'duration' && node.type === 'video') { const input = node.el.querySelector('.video-duration'); if (input) { if (![...input.options].some(o => Number(o.value) === shot.duration)) { const o = el('option', `${shot.duration} 秒`); o.value = shot.duration; input.append(o); } input.value = shot.duration; } }
            if ((name === 'imagePrompt' && node.type === 'image') || (name === 'videoPrompt' && node.type === 'video')) { const input = node.el.querySelector('.ai-panel .ai-input'); if (input) input.value = shot[name]; }
        });
    }
    function reorder(key, direction) { const all = rows(), index = all.findIndex(node => node.el.dataset.nodeId === key), next = index + direction; if (index < 0 || next < 0 || next >= all.length) return; command('调整镜头顺序', () => { [all[index], all[next]] = [all[next], all[index]]; all.forEach((node, i) => node.el._production.shot.order = i + 1); }); }
    function batch(fieldName, value, keys = rows().map(node => node.el.dataset.nodeId)) {
        const nodes = keys.map(nodeById).filter(Boolean); command(fieldName === 'ratio' ? '批量修改分镜比例' : '批量修改分镜模型', () => {
            nodes.forEach(node => { if (fieldName === 'ratio') { node.el.dataset.ratio = value; const control = node.el.querySelector('.ratio-toggle'); if (control) control.textContent = `比例 ${value}`; }
                else { const model = Workspace.config.models.find(model => model.id === value && model.type === node.type); if (!model) return; node.el.dataset.model = value; const control = node.el.querySelector('.model-switch'); if (control) control.textContent = model.label || model.id; node.el.querySelectorAll('.model-item').forEach(item => item.classList.toggle('active', item.dataset.modelId === value)); }
            });
        });
    }
    function renderStoryboard() {
        const tools = el('div', null, 'production-library-tools'); tools.append(button('添加图片镜头', () => addShot()), button('添加视频镜头', () => addShot('video')), button('选中节点加入分镜', () => { const nodes = selectedNodes(); if (!nodes.length) throw new Error('先在画布选中要加入的节点'); attachShots(nodes); }));
        const ratio = select('批量比例', ['16:9', '9:16', '1:1', '4:3', '3:4'], '16:9', () => {}); tools.append(ratio, button('应用全部镜头比例', () => batch('ratio', ratio.value)));
        const models = (window.Workspace?.config.models || []).filter(model => ['image', 'video'].includes(model.type)); if (models.length) { const model = select('批量模型', models.map(m => ({ value: m.id, label: m.label || m.id })), models[0].id, () => {}); tools.append(model, button('应用同类镜头模型', () => batch('model', model.value))); }
        const columns = el('details', null, 'production-column-menu'); columns.append(el('summary', '显示字段')); const choices = el('div', null, 'production-library-tools');
        for (const [key, label] of Object.entries(optionalColumns)) { const option = el('label', null, 'production-column-option'), toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = visibleColumns[key]; toggle.dataset.fieldToggle = key; toggle.setAttribute('aria-label', `显示${label}`); toggle.onchange = () => setFieldVisibility(key, toggle.checked); option.append(toggle, document.createTextNode(label)); choices.append(option); } columns.append(choices); tools.append(columns);
        body.append(tools); const all = rows(); if (!all.length) { body.append(el('p', '添加镜头，或将画布选中的节点加入分镜表。表格和画布使用同一份节点数据。', 'production-library-empty')); return; }
        const scroller = el('div', null, 'production-table-scroll'), table = el('table'), head = el('thead'), heading = el('tr'); [['order', '顺序'], ['number', '镜号'], ['preview', '画面'], ['duration', '时长 / 秒'], ['description', '剧情描述'], ['dialogue', '对白'], ['imagePrompt', '图片提示词'], ['videoPrompt', '视频提示词'], ['status', '状态'], ['actions', '操作']].forEach(([key, label]) => { const cell = el('th', label); cell.dataset.storyboardColumn = key; cell.hidden = visibleColumns[key] === false; heading.append(cell); }); head.append(heading); table.append(head); const tbody = el('tbody');
        all.forEach(node => { const key = node.el.dataset.nodeId, shot = node.el._production.shot, row = el('tr'); row.dataset.nodeId = key; row._nodeElement = node.el;
            const order = el('td'); order.append(button('↑', () => reorder(key, -1)), button('↓', () => reorder(key, 1))); row.append(order);
            const number = el('td'); number.dataset.storyboardColumn = 'number'; number.hidden = !visibleColumns.number; const shotNumber = field('镜号', shot.number, value => updateShot(key, 'number', value)); shotNumber.dataset.shotField = 'number'; number.append(shotNumber); row.append(number);
            const preview = el('td'); preview.dataset.storyboardColumn = 'preview'; const media = node.el.querySelector('.media-container img, .media-container video'); if (media) { const image = el(media.tagName.toLowerCase()); image.src = media.src; if (image.tagName === 'VIDEO') { image.muted = true; image.preload = 'metadata'; } preview.append(image); } else preview.textContent = node.el.dataset.nodeName; row.append(preview);
            const duration = el('td'); duration.dataset.storyboardColumn = 'duration'; duration.hidden = !visibleColumns.duration; const seconds = field('时长', node.type === 'video' ? node.el.querySelector('.video-duration')?.value || shot.duration : shot.duration, value => updateShot(key, 'duration', value), 'number'); seconds.dataset.shotField = 'duration'; seconds.min = 1; seconds.max = 60; duration.append(seconds); row.append(duration);
            ['description', 'dialogue', 'imagePrompt', 'videoPrompt'].forEach(name => { const cell = el('td'), input = el('textarea'); cell.dataset.storyboardColumn = name; cell.hidden = !visibleColumns[name]; input.dataset.shotField = name; input.setAttribute('aria-label', optionalColumns[name]); input.value = ((name === 'imagePrompt' && node.type === 'image') || (name === 'videoPrompt' && node.type === 'video')) ? node.el.querySelector('.ai-panel .ai-input')?.value || shot[name] || '' : shot[name] || ''; input.onchange = () => updateShot(key, name, input.value); cell.append(input); row.append(cell); });
            const status = el('td', node.el.dataset.nodeStatus || '待制作'); status.dataset.storyboardColumn = 'status'; row.append(status); const actions = el('td'); actions.dataset.storyboardColumn = 'actions'; actions.append(button('定位', () => { close(); Interaction.focusNode(node.el); }), button('移出表格', () => command('移出分镜表', () => delete node.el._production.shot)), button('删除节点', () => { Interaction.clearMultiSelection(); Interaction.deselect(); State.selection = { type: 'node', item: node.el }; Interaction.deleteSelected(); refresh(); })); row.append(actions); tbody.append(row);
        }); table.append(tbody); scroller.append(table); body.append(scroller);
    }
    function syncStoryboard() {
        const current = rows(), rendered = [...body.querySelectorAll('.production-table-scroll tbody tr')];
        if (!rendered.length || current.length !== rendered.length || current.some((node, index) => rendered[index]._nodeElement !== node.el)) return false;
        current.forEach((node, index) => { const row = rendered[index], shot = node.el._production.shot;
            row.querySelectorAll('[data-shot-field]').forEach(input => { if (input === document.activeElement) return; const name = input.dataset.shotField; let value = shot[name] ?? '';
                if ((name === 'imagePrompt' && node.type === 'image') || (name === 'videoPrompt' && node.type === 'video')) value = node.el.querySelector('.ai-panel .ai-input')?.value ?? value;
                if (name === 'duration' && node.type === 'video') value = node.el.querySelector('.video-duration')?.value ?? value;
                if (input.value !== String(value)) input.value = value;
            }); row.querySelector('[data-storyboard-column="status"]').textContent = node.el.dataset.nodeStatus || '待制作';
            const source = node.el.querySelector('.media-container img, .media-container video'), preview = row.querySelector('[data-storyboard-column="preview"]');
            if (source && preview.firstElementChild?.tagName === source.tagName) { if (preview.firstElementChild.src !== source.src) preview.firstElementChild.src = source.src; }
            else if (source) { const media = el(source.tagName.toLowerCase()); media.src = source.src; if (media.tagName === 'VIDEO') { media.muted = true; media.preload = 'metadata'; } preview.replaceChildren(media); }
            else if (preview.textContent !== node.el.dataset.nodeName || preview.firstElementChild) preview.textContent = node.el.dataset.nodeName;
        }); return true;
    }
    async function portableScene(scene) { const clean = ProjectStore.sceneOf(scene); const project = await ProjectStore.portable({ scene: clean, history: [] }); return project.scene; }
    function validateBackup(backup) {
        if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.items) || backup.items.length > 1000) throw new Error('请选择此应用导出的资源库 JSON 文件（最多 1000 条）');
        const ids = new Set();
        return backup.items.map(raw => {
            if (!raw || !['asset', 'workflow'].includes(raw.kind) || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id) || ids.has(raw.id)) throw new Error('资源库含有重复或无效条目');
            ids.add(raw.id); const scene = ProjectStore.sceneOf(raw.scene);
            if (!scene.nodes.length || raw.kind === 'asset' && (scene.nodes.length !== 1 || scene.links.length)) throw new Error('资产内容或工作流为空');
            // A backup restores authored content, never an old provider polling task.
            scene.nodes.forEach(node => { node.videoTask = ''; if (['生成中', '待查询'].includes(node.status)) node.status = '待制作'; });
            const allowed = raw.kind === 'asset' ? categories : workflowCategories, slotIds = new Set();
            if (raw.slots != null && (!Array.isArray(raw.slots) || raw.slots.length > 1000)) throw new Error('工作流输入插槽无效');
            const slots = raw.kind === 'workflow' ? (raw.slots || []).map(slot => {
                const slotId = slot?.id || slot?.nodeId;
                if (typeof slotId !== 'string' || !/^[\w-]{1,100}$/.test(slotId) || slotIds.has(slotId) || !scene.nodes.some(node => node.id === slot.nodeId)) throw new Error('工作流输入插槽无效');
                slotIds.add(slotId); return { id: slotId, nodeId: slot.nodeId, name: String(slot.name || '输入').slice(0, 160), required: !!slot.required };
            }) : [];
            return { id: raw.id, kind: raw.kind, name: String(raw.name || '未命名').slice(0, 80), category: allowed.includes(raw.category) ? raw.category : allowed[0], ...organization(raw), version: Math.max(1, Math.min(1000000, Math.floor(Number(raw.version) || 1))), updatedAt: Date.now(), scene, ...(raw.kind === 'workflow' ? { slots } : {}) };
        });
    }
    async function exportBackup() {
        const current = await list(), items = [];
        for (const item of current) items.push({ ...item, scene: await portableScene(item.scene) });
        return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), items };
    }
    async function downloadBackup() {
        const backup = await exportBackup(); const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
        const anchor = el('a'); anchor.href = url; anchor.download = `创作资源库-${new Date().toISOString().slice(0, 10)}.library.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        Interaction.toast(`已导出 ${backup.items.length} 个资产与工作流`, 'success');
    }
    async function importBackup(value) {
        if (importing) throw new Error('资源库正在导入，请稍候'); importing = true;
        try {
            const incoming = validateBackup(typeof value === 'string' ? JSON.parse(value) : value);
            const db = await openDB();
            const inserted = await new Promise((resolve, reject) => {
                const tx = db.transaction('items', 'readwrite'), store = tx.objectStore('items'), request = store.getAll(); let result;
                request.onsuccess = () => {
                    try {
                        const occupied = new Set(request.result.map(item => item.id)), mapping = new Map();
                        incoming.forEach(item => { let key = item.id; if (occupied.has(key)) { do { key = id(item.kind); } while (occupied.has(key)); } occupied.add(key); mapping.set(item.id, key); });
                        result = incoming.map(item => { const copy = clone(item); copy.id = mapping.get(item.id); if (copy.id !== item.id) copy.name = `${copy.name.slice(0, 72)}（导入副本）`; copy.scene.nodes.forEach(node => { const asset = node.production?.asset; if (asset && mapping.has(asset.id)) asset.id = mapping.get(asset.id); }); return copy; });
                        result.forEach(item => store.add(item));
                    } catch (error) { tx.abort(); reject(error); }
                };
                tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('资源库导入失败，原有条目已保留'));
            });
            lastImport = new Map(inserted.map(item => [item.id, JSON.stringify(item)])); await reload(); return inserted;
        } finally { importing = false; }
    }
    async function undoImport() {
        if (!lastImport?.size) throw new Error('没有可撤销的资源库导入'); const receipt = lastImport, db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('items', 'readwrite'), store = tx.objectStore('items'); let changed = false;
            for (const [key, expected] of receipt) { const request = store.get(key); request.onsuccess = () => { if (request.result && JSON.stringify(request.result) !== expected) { changed = true; tx.abort(); return; } store.delete(key); }; }
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(new Error(changed ? '导入条目已被修改，请先导出备份或逐项删除；未删除任何内容' : '撤销导入失败'));
        }); lastImport = null; await reload();
    }
    async function saveAsset(node, name, assetCategory = '其他', existingId, organizationalData) {
        if (window.Workspace && !Workspace.ready) throw new Error('画布仍在恢复，请稍候再操作');
        const key = node?.el?.dataset.nodeId; const snapshot = Interaction.captureScene().nodes.find(item => item.id === key); if (!snapshot) throw new Error('请选择一个节点保存为资产');
        if (!snapshot.media?.src && !snapshot.textValue && !snapshot.sceneSpec) throw new Error('请先为节点添加内容');
        const previous = existingId ? await get(existingId) : null; if (existingId && previous?.kind !== 'asset') throw new Error('资产已不存在');
        if (previous && previous.scene.nodes[0].type !== snapshot.type) throw new Error('更新资产须选择相同类型的节点');
        const scene = await portableScene({ nodes: [{ ...snapshot, groupId: '', groupName: '', videoTask: '', refs: (snapshot.refs || []).filter(ref => !ref.linkId), production: {} }], links: [] });
        const item = { id: previous?.id || id('asset'), kind: 'asset', name: String(name || snapshot.name).slice(0, 80), category: categories.includes(assetCategory) ? assetCategory : '其他', ...organization(organizationalData ?? previous ?? {}), version: (previous?.version || 0) + 1, updatedAt: Date.now(), scene };
        await put(item); if (nodeById(key)?.el === node.el) command('关联资产库', () => { node.el._production ||= {}; node.el._production.asset = { id: item.id, version: item.version }; }); await reload(); return item;
    }
    async function saveWorkflow(nodes, name, workflowCategory = '通用', existingId, organizationalData) {
        if (window.Workspace && !Workspace.ready) throw new Error('画布仍在恢复，请稍候再操作');
        if (!nodes.length) throw new Error('先选中要保存的工作流节点'); const keys = new Set(nodes.map(node => node.el.dataset.nodeId)), full = Interaction.captureScene(), incoming = full.links.filter(link => !keys.has(link.fromNodeId) && keys.has(link.toNodeId));
        const previous = existingId ? await get(existingId) : null; if (existingId && previous?.kind !== 'workflow') throw new Error('工作流已不存在');
        const left = Math.min(...nodes.map(node => node.x)), top = Math.min(...nodes.map(node => node.y)); const scene = await portableScene({ nodes: full.nodes.filter(node => keys.has(node.id)).map(node => ({ ...node, x: node.x - left, y: node.y - top, videoTask: '', refs: node.refs.filter(ref => !ref.linkId || full.links.some(link => link.id === ref.linkId && keys.has(link.fromNodeId))), production: { asset: node.production?.asset, shot: node.production?.shot, note: !!node.production?.note, count: node.production?.count || 1, edit: node.production?.edit } })), links: full.links.filter(link => keys.has(link.fromNodeId) && keys.has(link.toNodeId)) });
        const rootNodes = scene.nodes.filter(node => !scene.links.some(link => link.toNodeId === node.id) && !incoming.some(link => link.toNodeId === node.id));
        const slots = incoming.map(link => ({ id: link.id, nodeId: link.toNodeId, name: `${scene.nodes.find(node => node.id === link.toNodeId)?.name || '输入'} ← ${full.nodes.find(node => node.id === link.fromNodeId)?.name || '外部来源'}`, required: true }));
        rootNodes.forEach(node => slots.push({ id: node.id, nodeId: node.id, name: node.name, required: false }));
        const item = { id: previous?.id || id('workflow'), kind: 'workflow', name: String(name || '未命名工作流').slice(0, 80), category: workflowCategories.includes(workflowCategory) ? workflowCategory : '通用', ...organization(organizationalData ?? previous ?? {}), version: (previous?.version || 0) + 1, updatedAt: Date.now(), scene, slots }; await put(item); await reload(); return item;
    }
    function insert(item, bindings = {}) {
        const scene = ProjectStore.sceneOf(item.scene); if (State.nodes.length + scene.nodes.length > ProjectStore.MAX_NODES || State.links.length + scene.links.length + Object.values(bindings).filter(Boolean).length > ProjectStore.MAX_LINKS) throw new Error('超过画布容量，请新建画布');
        const binding = slot => bindings[slot.id || slot.nodeId] || bindings[slot.nodeId];
        for (const slot of item.slots || []) { if (!scene.nodes.some(node => node.id === slot.nodeId)) throw new Error('工作流输入插槽无效'); if (slot.required && !binding(slot)) throw new Error(`请选择「${slot.name}」的输入节点`); if (binding(slot) && !nodeById(binding(slot))) throw new Error('输入节点已不存在，请重新选择'); }
        const mapping = new Map(), groups = new Map(), pos = position(); let first;
        command(item.kind === 'asset' ? '放置资产' : '复用工作流', () => {
            scene.nodes.forEach(snapshot => { if (snapshot.groupId && !groups.has(snapshot.groupId)) groups.set(snapshot.groupId, id('group')); const production = clone(snapshot.production || {}); if (item.kind === 'asset') production.asset = { id: item.id, version: item.version };
                const node = Interaction.instantiateNodeFromSnapshot({ ...snapshot, x: item.kind === 'asset' ? 0 : snapshot.x, y: item.kind === 'asset' ? 0 : snapshot.y, groupId: groups.get(snapshot.groupId) || '', production, videoTask: '' }, { preserveId: false, offsetX: pos.x, offsetY: pos.y, includeLinkedRefs: false }); mapping.set(snapshot.id, node); first ||= node;
            });
            scene.links.forEach(link => Interaction.createLinkBetween(mapping.get(link.fromNodeId).querySelector('.conn-right'), mapping.get(link.toNodeId).querySelector('.conn-left')));
            for (const slot of item.slots || []) if (binding(slot)) Interaction.createLinkBetween(nodeById(binding(slot)).el.querySelector('.conn-right'), mapping.get(slot.nodeId).querySelector('.conn-left'));
        }); if (first) { close(); Interaction.focusNode(first); } return mapping;
    }
    async function countReferences() {
        const counts = new Map(), seen = new Set(); const add = (scene, projectId) => { for (const node of scene.nodes || []) { const key = node.production?.asset?.id; const token = `${projectId}:${node.id}`; if (key && !seen.has(token)) { seen.add(token); counts.set(key, (counts.get(key) || 0) + 1); } } };
        add(Interaction.captureScene(), Workspace.projectId); for (const project of await ProjectStore.listProjects()) { if (project.id === Workspace.projectId) continue; const saved = await ProjectStore.loadProject(project.id); if (saved?.scene) add(saved.scene, project.id); } referenceCounts = counts; return counts;
    }
    function updateReferences(item) {
        const snapshot = ProjectStore.sceneOf(item.scene).nodes[0]; const matches = State.nodes.filter(node => node.el._production?.asset?.id === item.id && node.el._production.asset.version !== item.version);
        if (!matches.length) return; command('更新当前画布资产引用', () => matches.forEach(node => {
            if (node.type !== snapshot.type) throw new Error('资产类型不一致'); const container = node.el.querySelector('.media-container'); if (container && snapshot.media.src) { const media = el(snapshot.media.kind === 'img' ? 'img' : snapshot.media.kind); media.src = snapshot.media.src; if (media.tagName !== 'IMG') { media.controls = true; media.preload = 'metadata'; } else media.alt = item.name; container.replaceChildren(media); }
            const image = node.el.querySelector('.media-container img'); if (image) { image.style.filter = snapshot.imageFilter || ''; image.dataset.rotateDeg = snapshot.rotateDeg || '0'; image.dataset.flipX = snapshot.flipX || '0'; Interaction.applyImageTransform(image); }
            const input = node.el.querySelector('.text-node-input'); if (input) input.value = snapshot.textValue; if (snapshot.sceneSpec) node.el.dataset.sceneSpec = JSON.stringify(snapshot.sceneSpec); node.el._production.asset.version = item.version; Interaction.refreshDownstreamReferences(node.el);
        }));
    }
    function refreshOrganizationFilters() {
        if (!body || tab === 'storyboard') return; const current = records.filter(item => item.kind === tab);
        const update = (selector, options, value) => { const control = body.querySelector(selector); if (!control) return; control.replaceChildren(); for (const [key, label] of options) { const item = el('option', label); item.value = key; control.append(item); } if (value && !options.some(([key]) => key === value)) { const item = el('option', value); item.value = value; control.append(item); } control.value = value; };
        update('[data-library-filter="folder"]', [['', '全部文件夹'], ['__unfiled__', '未归档'], ...[...new Set(current.map(item => item.folder).filter(Boolean))].sort().map(value => [value, value])], folder);
        update('[data-library-filter="tag"]', [['', '全部标签'], ...[...new Set(current.flatMap(item => item.tags || []))].sort().map(value => [value, value])], tagFilter);
    }
    function applyLibraryFilters() {
        if (!body || tab === 'storyboard') return; let shown = 0; const lookup = new Map(records.map(item => [item.id, item]));
        for (const card of body.querySelectorAll('.production-library-card')) { const item = lookup.get(card.dataset.itemId); if (!item) continue;
            const text = [item.name, item.folder || '', ...(item.tags || [])].join(' ').toLowerCase();
            card.hidden = !(text.includes(query.toLowerCase()) && (!category || item.category === category) && (!folder || (folder === '__unfiled__' ? !item.folder : item.folder === folder)) && (!tagFilter || (item.tags || []).includes(tagFilter))); if (!card.hidden) shown++;
            const summary = card.querySelector('[data-library-summary]'); if (summary) summary.textContent = item.kind === 'asset' ? `${item.category} · v${item.version} · ${referenceCounts.get(item.id) || 0} 个引用` : `${item.category} · ${item.scene.nodes.length} 个节点 · ${item.slots.length} 个输入插槽`;
        }
        const empty = body.querySelector('[data-library-empty]'); if (empty) empty.hidden = shown > 0;
    }
    function renderLibrary() {
        const tools = el('div', null, 'production-library-tools'); const search = field('搜索库', query, value => { query = value; applyLibraryFilters(); }); search.oninput = () => { query = search.value; applyLibraryFilters(); }; search.placeholder = '搜索名称、文件夹或标签…'; tools.append(search);
        const activeCategories = tab === 'asset' ? categories : workflowCategories;
        tools.append(select('分类筛选', [{ value: '', label: '全部分类' }, ...activeCategories.map(value => ({ value, label: value }))], category, value => { category = value; applyLibraryFilters(); }));
        const folderFilter = select('文件夹筛选', [], folder, value => { folder = value; applyLibraryFilters(); }); folderFilter.dataset.libraryFilter = 'folder'; const tagsFilter = select('标签筛选', [], tagFilter, value => { tagFilter = value; applyLibraryFilters(); }); tagsFilter.dataset.libraryFilter = 'tag'; tools.append(folderFilter, tagsFilter);
        const name = field('保存名称', '', () => {}); name.placeholder = tab === 'asset' ? '资产名称' : '工作流名称'; tools.append(name); let categoryInput;
        categoryInput = select('保存分类', activeCategories, activeCategories[0], () => {}); tools.append(categoryInput);
        const folderInput = field('保存到文件夹', '', () => {}); folderInput.placeholder = '文件夹，如 品牌 / 春季'; const tagsInput = field('保存标签', '', () => {}); tagsInput.placeholder = '标签，用逗号分隔'; tools.append(folderInput, tagsInput);
        tools.append(button(tab === 'asset' ? '选中节点存入资产库' : '选中节点保存为工作流', async () => { const nodes = selectedNodes(), metadata = { folder: folderInput.value, tags: tagsInput.value }; if (tab === 'asset') { if (nodes.length !== 1) throw new Error('请选择一个节点存入资产库'); await saveAsset(nodes[0], name.value, categoryInput.value, undefined, metadata); } else await saveWorkflow(nodes, name.value, categoryInput.value, undefined, metadata); })); body.append(tools);
        const grid = el('div', null, 'production-library-grid'); body.append(grid); const filtered = records.filter(item => item.kind === tab);
        const empty = el('p', '库中暂无匹配内容。选中画布节点后保存，可在其他画布复用。', 'production-library-empty'); empty.dataset.libraryEmpty = ''; grid.append(empty);
        for (const item of filtered) {
            const card = el('article', null, 'production-library-card'); card.dataset.itemId = item.id; const media = item.scene.nodes.find(node => node.media?.src)?.media;
            if (media) { const preview = el(media.kind === 'img' ? 'img' : media.kind); preview.src = media.src; if (preview.tagName !== 'IMG') { preview.controls = true; preview.preload = 'metadata'; } else preview.alt = item.name; card.append(preview); }
            const edit = async changes => { try { await updateOrganization(item.id, changes); } catch (error) { Interaction.toast(error.message, 'error'); } };
            card.append(field('重命名', item.name, value => edit({ name: value })));
            const summary = el('small'); summary.dataset.librarySummary = ''; card.append(summary);
            card.append(select('修改分类', activeCategories, item.category, value => edit({ category: value })));
            const folderLabel = el('label', '文件夹'), folderEdit = field('文件夹', item.folder || '', value => edit({ folder: value })); folderEdit.placeholder = '未归档'; folderLabel.append(folderEdit);
            const tagsLabel = el('label', '标签'), tagsEdit = field('标签', (item.tags || []).join(', '), value => edit({ tags: value })); tagsEdit.placeholder = '用逗号分隔，可添加多个标签'; tagsLabel.append(tagsEdit); card.append(folderLabel, tagsLabel);
            const bindings = {};
            if (item.kind === 'workflow') for (const slot of item.slots || []) { const label = el('label', `${slot.name}${slot.required ? '（必选输入）' : '（可选输入）'}`); label.append(select(`输入：${slot.name}`, [{ value: '', label: '请选择画布节点' }, ...State.nodes.map(node => ({ value: node.el.dataset.nodeId, label: node.el.dataset.nodeName || node.type }))], '', value => bindings[slot.id || slot.nodeId] = value)); card.append(label); }
            const actions = el('div', null, 'production-library-card-actions'); actions.append(button('添加到画布', () => insert(item, bindings)));
            if (item.kind === 'workflow') actions.append(button('用所选节点更新工作流', () => saveWorkflow(selectedNodes(), item.name, item.category, item.id)));
            if (item.kind === 'asset') {
                actions.append(button('用选中节点更新资产', async () => { const nodes = selectedNodes(); if (nodes.length !== 1) throw new Error('请选择一个同类型节点'); await saveAsset(nodes[0], item.name, item.category, item.id); }));
                const outdated = State.nodes.filter(node => node.el._production?.asset?.id === item.id && node.el._production.asset.version !== item.version).length; if (outdated) { card.append(el('p', `当前画布 ${outdated} 个引用仍使用旧版本`, 'production-library-warning')); actions.append(button('更新当前画布引用', () => updateReferences(item))); }
            }
            const deleteButton = button('删除库条目', async () => { if (deleteButton.dataset.confirm !== 'yes') { deleteButton.dataset.confirm = 'yes'; deleteButton.textContent = '再次点击删除（画布内容保留）'; return; } await remove(item.id); await reload(); }); actions.append(deleteButton); card.append(actions); grid.append(card);
        }
        refreshOrganizationFilters(); applyLibraryFilters();
    }
    async function reload() { records = await list(); await countReferences(); render(); }
    function render() { if (!body || !dialog.open) return; body.replaceChildren(); dialog.querySelectorAll('[data-library-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.libraryTab === tab)));
        const backups = el('div', null, 'production-library-tools'); const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.setAttribute('aria-label', '导入资源库备份');
        file.onchange = async () => { try { const selected = file.files?.[0]; if (!selected) return; if (selected.size > 100 * 1024 * 1024) throw new Error('资源库备份不能超过 100MB'); const imported = await importBackup(await selected.text()); Interaction.toast(`已导入 ${imported.length} 个条目；同名 ID 保留为副本`, 'success', 4000); } catch (error) { Interaction.toast(error.message, 'error', 5000); } finally { file.value = ''; } };
        backups.append(button('导出完整资源库', downloadBackup), button('导入资源库备份', () => file.click()), file); if (lastImport?.size) backups.append(button('撤销上次导入', undoImport)); body.append(backups);
        if (tab === 'storyboard') renderStoryboard(); else renderLibrary(); }
    function refresh() { if (!dialog?.open) return; if (tab === 'storyboard' && syncStoryboard()) return; if (dialog.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return; render(); }
    async function open(nextTab = 'storyboard') { if (nextTab !== tab) { query = ''; category = ''; folder = ''; tagFilter = ''; } tab = nextTab; if (!dialog) init(); if (!dialog.open) dialog.showModal(); render(); try { await reload(); } catch (error) { Interaction.toast(error.message, 'error', 5000); } }
    function close() { dialog?.close(); }
    function init() {
        if (dialog) return; try { const saved = JSON.parse(localStorage.getItem(FIELD_KEY) || '{}'); for (const key of Object.keys(optionalColumns)) if (typeof saved?.[key] === 'boolean') visibleColumns[key] = saved[key]; } catch {} dialog = el('dialog', null, 'production-library-dialog'); dialog.setAttribute('aria-label', '创作资源与分镜'); const header = el('header'); header.append(el('h2', '创作资源'));
        for (const [value, label] of [['storyboard', '分镜表'], ['asset', '资产库'], ['workflow', '工作流库']]) { const item = button(label, async () => { tab = value; query = ''; category = ''; folder = ''; tagFilter = ''; await reload(); }); item.dataset.libraryTab = value; header.append(item); }
        header.append(button('返回画布', close)); body = el('div', null, 'production-library-body'); dialog.append(header, body); dialog.addEventListener('mousedown', event => event.stopPropagation()); dialog.addEventListener('keydown', event => event.stopPropagation()); document.body.append(dialog);
        const entry = button('分镜 / 资源', () => open()); entry.className = 'production-library-entry'; document.querySelector('.top-actions')?.prepend(entry);
        const assets = document.getElementById('asset-panel'); if (assets) { const entry = button('打开跨画布资产库', () => open('asset')); entry.className = 'secondary-action'; assets.insertBefore(entry, assets.querySelector('#asset-grid')); }
    }
    return { init, open, close, refresh, rows, attachShots, addShot, updateShot, reorder, batch, saveAsset, saveWorkflow, insert, updateReferences, countReferences, list, get, remove, reload, exportBackup, importBackup, undoImport, validateBackup, setFieldVisibility, updateOrganization };
})();
