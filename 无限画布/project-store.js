/* IndexedDB stores complete portable snapshots, including uploaded media. No API keys are stored. */
const ProjectStore = (() => {
    const FORMAT = 'infinite-canvas-project';
    const MAX_NODES = 500, MAX_LINKS = 3000;
    let database;
    function open() {
        if (!database) database = new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('浏览器不支持本地项目保存，请使用最新版 Chrome 或 Edge'));
            const request = indexedDB.open('infinite_canvas_projects', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('本地存储被另一个页面占用，请关闭旧页面再试'));
            request.onsuccess = () => resolve(request.result);
        });
        return database;
    }
    async function load() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const request = db.transaction('workspaces').objectStore('workspaces').get('active');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }
    async function save(project, expectedRevision) {
        // Never replace the last usable revision with a snapshot that startup
        // or import would reject. Validation does not mutate the caller.
        validate(project);
        const db = await open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('workspaces', 'readwrite');
            const store = transaction.objectStore('workspaces');
            let failure, revision;
            const read = store.get('active');
            read.onsuccess = () => {
                const current = read.result?.revision || 0;
                if (current !== expectedRevision) {
                    failure = new Error('另一个页面已更新项目。请先导出当前内容，再刷新加载最新版本');
                    transaction.abort(); return;
                }
                revision = current + 1;
                const id = /^[\w-]{1,80}$/.test(project.id || '') ? project.id : 'project_main';
                const saved = { ...project, id, revision };
                store.put(saved, 'active');
                store.put(saved, `project:${id}`);
                const preview = project.scene.nodes.slice(0, 24).map(({ x, y, type }) => ({ x, y, type }));
                store.put({ id, name:project.name, updatedAt:project.updatedAt, nodes:project.scene.nodes.length, preview }, `meta:${id}`);
            };
            transaction.oncomplete = () => resolve(revision);
            transaction.onerror = () => reject(failure || transaction.error || new Error('本地保存失败'));
            transaction.onabort = () => reject(failure || transaction.error || new Error('本地保存被中止'));
        });
    }
    async function listProjects() {
        const db = await open();
        return new Promise((resolve, reject) => {
            const result = [], request = db.transaction('workspaces').objectStore('workspaces').openCursor();
            request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(result.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))); if (String(cursor.key).startsWith('meta:')) result.push(cursor.value); cursor.continue(); };
            request.onerror = () => reject(request.error);
        });
    }
    async function loadProject(id) {
        if (!/^[\w-]{1,80}$/.test(id)) throw new Error('画布 ID 无效');
        const db = await open();
        return new Promise((resolve, reject) => { const request=db.transaction('workspaces').objectStore('workspaces').get(`project:${id}`);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error); });
    }
    function fileDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('素材读取失败，请重新选择文件'));
            reader.readAsDataURL(file);
        });
    }
    function safeSource(src) {
        if (src == null || src === '') return null;
        if (typeof src !== 'string') throw new Error('素材地址无效');
        if (/^data:(image\/(png|jpeg|webp)|video\/(mp4|webm)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac|flac));base64,[a-z0-9+/=]+$/i.test(src)) return src;
        try { if (['http:', 'https:'].includes(new URL(src).protocol)) return src; } catch {}
        throw new Error('素材地址无效或已失效，请重新上传素材');
    }
    function sceneOf(scene) {
        if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(scene.links)) throw new Error('项目结构无效');
        if (scene.nodes.length > MAX_NODES || scene.links.length > MAX_LINKS) throw new Error(`画布最多支持 ${MAX_NODES} 个节点和 ${MAX_LINKS} 条连线`);
        const ids = new Set();
        const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(-100000, Math.min(100000, Number(value))) : fallback;
        const cleanId = (id) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
        const nodes = scene.nodes.map((node) => {
            if (!cleanId(node.id) || ids.has(node.id) || !['image', 'video', 'text', 'audio', 'scene'].includes(node.type)) throw new Error('项目包含重复或无效的节点');
            ids.add(node.id);
            let videoTask = '';
            if (node.videoTask) {
                let task;
                try { task = JSON.parse(node.videoTask); } catch { throw new Error('视频任务数据无效'); }
                if (!task || !/^[a-f0-9-]{36}$/.test(task.id)) throw new Error('视频任务 ID 无效');
                videoTask = JSON.stringify({ id: task.id });
            }
            return {
                id: node.id, type: node.type, x: number(node.x), y: number(node.y), name: String(node.name || '未命名节点').slice(0, 80),
                groupId: cleanId(node.groupId) ? node.groupId : '', groupName: cleanId(node.groupId) ? String(node.groupName || '分组').slice(0, 80) : '',
                status: node.status === '生成中' ? (videoTask ? '待查询' : '生成已中断') : String(node.status || '素材节点').slice(0, 30),
                withPrompt: node.withPrompt !== false, model: String(node.model || '').slice(0, 100), ratio: (node.type === 'video' ? ['21:9','16:9','4:3','1:1','3:4','9:16','9:21'] : ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2', '7:4', '4:7', '21:9']).includes(node.ratio) ? node.ratio : node.type === 'video' ? '16:9' : '1:1',
                prompt: String(node.prompt || '').slice(0, 30000), textValue: String(node.textValue || '').slice(0, 100000),
                media: { kind: ['img', 'video', 'audio'].includes(node.media?.kind) ? node.media.kind : 'none', src: safeSource(node.media?.src) },
                production: cleanProduction(node.production),
                voice: ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].includes(node.voice) ? node.voice : 'alloy', speed: Math.max(0.25, Math.min(4, number(node.speed, 1))),
                sceneSpec: cleanSceneSpec(node.sceneSpec),
                imageFilter: /^(brightness\(\d+%\) contrast\(\d+%\) saturate\(\d+%\))?$/.test(node.imageFilter || '') ? node.imageFilter || '' : '',
                rotateDeg: String(number(node.rotateDeg) % 360), flipX: node.flipX === '1' ? '1' : '0', videoTask, duration: Number.isInteger(Number(node.duration)) && Number(node.duration) >= 1 && Number(node.duration) <= 60 ? String(node.duration) : '4',
                inputMode: ['first-frame','first-last-frame','reference'].includes(node.inputMode) ? node.inputMode : 'first-frame', resolution: ['480p','720p','1080p'].includes(node.resolution) ? node.resolution : '',
                refs: (Array.isArray(node.refs) ? node.refs : []).slice(0, 16).map((ref, index) => ({
                    id: cleanId(ref.id) ? ref.id : `ref_import_${index}`, linkId: cleanId(ref.linkId) ? ref.linkId : null,
                    src: safeSource(ref.src), type: ref.type === 'video' ? 'video' : 'img', file: null, weight: 1, isPrimary: !!ref.isPrimary, order: index,
                    sourceType: ref.linkId ? 'link' : 'manual', sourceNodeId: cleanId(ref.sourceNodeId) ? ref.sourceNodeId : null, sourceNodeName: String(ref.sourceNodeName || '').slice(0, 80)
                }))
            };
        });
        const linkIds = new Set(), pairs = new Set();
        const links = scene.links.map((link) => {
            const pair = `${link.fromNodeId}:${link.toNodeId}`;
            if (!cleanId(link.id) || linkIds.has(link.id) || pairs.has(pair) || !ids.has(link.fromNodeId) || !ids.has(link.toNodeId) || link.fromNodeId === link.toNodeId) throw new Error('项目连线无效');
            linkIds.add(link.id); pairs.add(pair);
            return { id: link.id, fromNodeId: link.fromNodeId, toNodeId: link.toNodeId, fromConnector: 'conn-right', toConnector: 'conn-left' };
        });
        const visiting = new Set(), visited = new Set();
        const visit = (id) => {
            if (visiting.has(id)) throw new Error('项目包含循环连线');
            if (visited.has(id)) return;
            visiting.add(id);
            links.filter((link) => link.fromNodeId === id).forEach((link) => visit(link.toNodeId));
            visiting.delete(id); visited.add(id);
        };
        ids.forEach(visit);
        nodes.forEach((node) => { node.refs = node.refs.filter((ref) => !ref.linkId || linkIds.has(ref.linkId)); });
        const timeline = (Array.isArray(scene.timeline) ? scene.timeline : []).slice(0, 200).filter((clip) => ids.has(clip.nodeId)).map((clip, index) => ({ id: cleanId(clip.id) ? clip.id : `clip_${index}`, nodeId: clip.nodeId, trim: Math.max(0, number(clip.trim)), duration: Math.max(0.1, Math.min(3600, number(clip.duration, 4))), start: Math.max(0, number(clip.start)), volume: Math.max(0, Math.min(1, number(clip.volume, 1))) }));
        const conversations = (Array.isArray(scene.conversations) ? scene.conversations : []).slice(-20).map((chat, index) => ({ id: cleanId(chat.id) ? chat.id : `chat_${index}`, name: String(chat.name || '新建对话').slice(0, 80), messages: (Array.isArray(chat.messages) ? chat.messages : []).slice(-50).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || '').slice(0, 30000), nodeId: cleanId(m.nodeId) ? m.nodeId : null })) }));
        return { nodes, links, timeline, conversations, tasks: cleanTasks(scene.tasks, ids), view: { snap: !!scene.view?.snap, hideLinks: !!scene.view?.hideLinks, timelineRatio: ['16:9','9:16','1:1'].includes(scene.view?.timelineRatio) ? scene.view.timelineRatio : '16:9' }, canvas: { x: number(scene.canvas?.x, -4500), y: number(scene.canvas?.y, -4500), scale: Math.max(0.25, Math.min(2.6, number(scene.canvas?.scale, 1))) } };
    }
    function cleanTasks(tasks, ids) {
        return (Array.isArray(tasks) ? tasks : []).slice(-500).filter(t => ids.has(t.nodeId)).map(t => ({
            id: String(t.id || '').slice(0, 100), nodeId: t.nodeId, name: String(t.name || '').slice(0, 80),
            state: ['waiting','running','completed','failed','skipped','cancelled','interrupted'].includes(t.state) ? t.state : 'interrupted',
            error: String(t.error || '').slice(0, 500), startedAt: String(t.startedAt || '').slice(0, 40),
            endedAt: String(t.endedAt || '').slice(0, 40), dependencies: (Array.isArray(t.dependencies) ? t.dependencies : []).filter(id => ids.has(id)),
            estimate: Number.isFinite(t.estimate) && t.estimate >= 0 ? t.estimate : null, currency: String(t.currency || '').slice(0, 8)
        }));
    }
    function cleanProduction(value) {
        const p = value && typeof value === 'object' ? value : {};
        const str = (v, max = 30000) => String(v || '').slice(0, max);
        const result = { note: !!p.note, count: Math.max(1, Math.min(4, Number(p.count) || 1)), adoptedId: str(p.adoptedId,100), fingerprint: str(p.fingerprint,100), dismissed: str(p.dismissed,100), pendingFingerprint: str(p.pendingFingerprint,100) };
        const candidates = Array.isArray(p.candidates) ? p.candidates : [];
        result.candidates = (candidates.length > 24 ? [candidates[0], ...candidates.slice(-23)] : candidates).map(c => ({
            id: str(c.id,100), label: str(c.label,100), createdAt: str(c.createdAt,40), text: str(c.text,100000),
            media: { kind: ['img','video','audio'].includes(c.media?.kind) ? c.media.kind : 'none', src: safeSource(c.media?.src) },
            prompt: str(c.prompt), model: str(c.model,100), ratio: str(c.ratio,20), fingerprint: str(c.fingerprint,100),
            imageFilter: /^(brightness\(\d+%\) contrast\(\d+%\) saturate\(\d+%\))?$/.test(c.imageFilter || '') ? c.imageFilter || '' : '', rotateDeg:String((Number(c.rotateDeg)||0)%360),flipX:c.flipX==='1'?'1':'0',
            usage: c.usage && typeof c.usage === 'object' ? Object.fromEntries(Object.entries(c.usage).filter(([k,v]) => /^[\w_]{1,40}$/.test(k) && Number.isFinite(v) && v >= 0)) : null
        }));
        if (p.shot && typeof p.shot === 'object') result.shot = Object.fromEntries(Object.entries(p.shot).filter(([k]) => ['order','number','duration','description','dialogue','imagePrompt','videoPrompt','audio','lighting'].includes(k)).map(([k,v]) => [k, ['order','duration'].includes(k) ? Math.max(0, Math.min(100000, Number(v) || 0)) : str(v)]));
        if (p.asset?.id) result.asset = { id:str(p.asset.id,100), version:Math.max(1,Number(p.asset.version)||1) };
        if (p.pendingParameters) result.pendingParameters = {prompt:str(p.pendingParameters.prompt),model:str(p.pendingParameters.model,100),ratio:str(p.pendingParameters.ratio,20)};
        if (p.edit) result.edit = { mask: safeSource(p.edit.mask), source: safeSource(p.edit.source), prompt: str(p.edit.prompt), width: Math.max(0, Math.min(16384, Number(p.edit.width)||0)), height: Math.max(0, Math.min(16384, Number(p.edit.height)||0)), updatedAt: str(p.edit.updatedAt,40) };
        return result;
    }
    function cleanSceneSpec(spec) {
        if (!spec) return null;
        const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Math.max(-1000, Math.min(1000, Number(v))) : fallback;
        const vector = (v, fallback) => Array.isArray(v) && v.length === 3 ? v.map((n) => finite(n)) : fallback;
        const color = (v, fallback) => /^#[a-f0-9]{6}$/i.test(v) ? v : fallback;
        return { camera: vector(spec.camera, [6, 4, 7]), target: vector(spec.target, [0, 1, 0]), fov: Math.max(15, Math.min(100, finite(spec.fov, 45))), background: color(spec.background, '#17191c'), light: Math.max(0.1, Math.min(8, finite(spec.light, 3))), objects: (Array.isArray(spec.objects) ? spec.objects : []).slice(0, 100).map((o, index) => {
            const type = ['box', 'sphere', 'cylinder', 'actor', 'glb'].includes(o.type) ? o.type : 'box';
            if (type === 'glb' && (typeof o.asset !== 'string' || !/^data:model\/gltf-binary;base64,[a-z0-9+/=]+$/i.test(o.asset) || o.asset.length > 48 * 1024 * 1024)) throw new Error('3D 素材须为不超过 32MB 的内嵌 GLB');
            return { id: String(o.id || `object_${index}`).replace(/[^\w-]/g, '').slice(0, 80), name: String(o.name || type).slice(0, 80), type, position: vector(o.position, [0, 0, 0]), rotation: vector(o.rotation, [0, 0, 0]), scale: Math.max(0.05, Math.min(100, finite(o.scale, 1))), color: color(o.color, '#bfc2c9'), tint: !!o.tint, ...(type === 'glb' ? { asset: o.asset } : {}) };
        }) };
    }
    function validate(project) {
        if (!project || project.format !== FORMAT || project.version !== 1) throw new Error('请选择此应用导出的 .canvas.json 项目文件');
        return { format: FORMAT, version: 1, id: /^[\w-]{1,80}$/.test(project.id || '') ? project.id : 'project_main', name: String(project.name || '未命名项目').slice(0, 80), updatedAt: project.updatedAt || new Date().toISOString(), scene: sceneOf(project.scene), history: (Array.isArray(project.history) ? project.history : []).slice(0, 20).filter((item) => item.type === 'generate').map((item, index) => ({ id: `import_${index}`, type: 'generate', text: String(item.text || '').slice(0, 250), time: String(item.time || ''), nodeId: String(item.nodeId || ''), scene: item.scene ? sceneOf(item.scene) : null })) };
    }
    async function portable(project) {
        const copy = JSON.parse(JSON.stringify(project)), cache = new Map();
        const embed = async (src) => {
            if (!src || src.startsWith('data:')) return src;
            if (!cache.has(src)) cache.set(src, (async () => {
                try {
                    const response = await fetch(src, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
                    if (!response.ok) throw new Error();
                    const blob = await response.blob();
                    if (blob.size > 100 * 1024 * 1024) throw new Error();
                    return safeSource(await fileDataUrl(blob));
                } catch { throw new Error('项目中有无法读取的远程或旧版素材。请重新上传这些素材后再导入或导出'); }
            })());
            return cache.get(src);
        };
        const scenes = [copy.scene, ...(copy.history || []).map((item) => item.scene).filter(Boolean)];
        for (const scene of scenes) for (const node of scene.nodes) {
            if (node.media?.src) node.media.src = await embed(node.media.src);
            for (const ref of node.refs || []) if (ref.src) ref.src = await embed(ref.src);
            for (const candidate of node.production?.candidates || []) if (candidate.media?.src) candidate.media.src = await embed(candidate.media.src);
            if (node.production?.edit?.mask) node.production.edit.mask = await embed(node.production.edit.mask);
            if (node.production?.edit?.source) node.production.edit.source = await embed(node.production.edit.source);
        }
        return copy;
    }
    return { FORMAT, MAX_NODES, MAX_LINKS, load, save, listProjects, loadProject, fileDataUrl, validate, sceneOf, safeSource, portable, cleanProduction };
})();
