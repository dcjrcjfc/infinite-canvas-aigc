window.Workspace = {
    landingEntry: new URLSearchParams(location.search).get('entry') === 'canvas',
    projectId:'project_main', revision: 0, ready: false, saving: false, dirty: false, timer: null, pending: new Map(), config: { models: [] },
    status(text, error = false) {
        const target = document.getElementById('project-status');
        if (target.textContent !== text) target.textContent = text;
        target.classList.toggle('is-error', error);
    },
    scheduleSave() {
        if (!this.ready) return;
        this.dirty = true;
        this.status('有未保存的修改');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.save(), 650);
    },
    project() {
        return { format: ProjectStore.FORMAT, version: 1, id:this.projectId, name: document.getElementById('project-name').value.trim() || '未命名项目', updatedAt: new Date().toISOString(), scene: Interaction.captureScene(), history: State.history.slice(0, 20) };
    },
    async save() {
        clearTimeout(this.timer);
        if (!this.ready) return false;
        if (this.saving) {
            try { await this.savePromise; return !this.dirty && this.ready; } catch { return false; }
        }
        if (Interaction.isPanning || Interaction.dragNode || Interaction.dragNodes.length || Interaction.touchActive || (State.linking.active && window.CanvasNavigation?.gesture)) {
            this.timer = setTimeout(() => this.save(), 650); return false;
        }
        this.saving = true; this.dirty = false;
        this.status('正在保存…');
        try {
            this.savePromise = ProjectStore.save(this.project(), this.revision);
            this.revision = await this.savePromise;
            this.lastSaveError = null;
            this.status('已保存到此浏览器');
            return true;
        } catch (error) {
            this.lastSaveError = error;
            this.dirty = true;
            this.status(error.name === 'QuotaExceededError' ? '空间不足，请导出项目备份' : error.message, true);
            // Never silently overwrite a newer revision from another tab.
            if (error.message.includes('另一个页面')) this.ready = false;
            return false;
        } finally {
            this.saving = false;
            if (this.dirty && this.ready && !document.getElementById('project-status').classList.contains('is-error')) this.scheduleSave();
        }
    },
    async flushSave() {
        while (this.saving) { try { await this.savePromise; } catch {} }
        if (!await this.save() || this.dirty || !this.ready) throw this.lastSaveError || new Error(document.getElementById('project-status').textContent || '当前画布保存失败，请先导出备份');
    },
    captureWorkspace() {
        return { scene:Interaction.captureScene(), name:document.getElementById('project-name').value, history:structuredClone(State.history) };
    },
    restoreWorkspace(snapshot) {
        Interaction.restoreScene(snapshot.scene);
        State.history = structuredClone(snapshot.history);
        document.getElementById('project-name').value = snapshot.name;
        const brand = document.querySelector('.brand-name'); if (brand) brand.textContent = snapshot.name;
        Interaction.renderHistory();
        window.Creative?.layout();
    },
    async request(route, body, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        const timer = setTimeout(() => controller.abort(), 195000);
        try {
            const response = await fetch(`${API_PROXY_BASE}${route}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 401) { this.config.authenticated = false; this.openSettings(); }
                throw new Error(result.error?.message || `请求失败（${response.status}）`);
            }
            return result;
        } catch (error) {
            if (controller.signal.aborted && !signal?.aborted) throw new Error('请求超时，请检查供应商任务记录后再操作');
            if (error instanceof TypeError) throw new Error('无法连接代理服务，请使用 npm start 启动后访问本地地址');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
    async loadConfig() {
        try {
            this.config = await this.request('/api/config');
            this.configError = '';
            const select = document.getElementById('agent-llm-select');
            for (const option of select.options) {
                const capability = this.config.models.find((item) => item.id === option.value);
                option.textContent = `${AGENT_LLM_LABELS[option.value]}${capability?.available ? '' : ' · 未配置'}`;
            }
            const available = this.config.models.find((item) => item.type === 'text' && item.available);
            if (available && !this.config.models.find((item) => item.id === select.value)?.available) select.value = available.id;
            this.renderServices();
            window.Creative?.applyCapabilities();
        } catch (error) { this.configError = error.message; document.getElementById('service-summary').textContent = error.message; }
    },
    modelAvailable(id) {
        if (this.config.authenticationRequired && !this.config.authenticated) { this.openSettings(); return false; }
        const item = this.config.models.find((model) => model.id === id);
        if (!item?.available) {
            Interaction.toast(`${item?.label || '模型'}：${item?.reason || '无法读取服务状态，请检查本地代理'}`, 'warn', 5000);
            this.openSettings(); return false;
        }
        return true;
    },
    renderServices() {
        const summary = document.getElementById('service-summary');
        const available = this.config.models.filter((item) => item.available).length;
        summary.textContent = this.configError || `已配置 ${available} 个模型。${this.config.authenticationRequired ? (this.config.authenticated ? '访问已解锁。' : '需要访问密码。') : '仅限本机访问。'}`;
        const list = document.getElementById('service-models'); list.replaceChildren();
        for (const model of this.config.models) {
            const row = document.createElement('li');
            row.textContent = `${model.label}：${model.available ? '可调用（尚需供应商账户权限）' : model.reason}`;
            list.appendChild(row);
        }
        document.getElementById('access-form').hidden = !this.config.authenticationRequired || this.config.authenticated;
        document.getElementById('lock-access-btn').hidden = !this.config.authenticationRequired || !this.config.authenticated;
    },
    openSettings() { this.renderServices(); document.getElementById('settings-dialog').showModal(); },
    cancelAll() {
        window.Production?.cancelQueue();
        for (const [id, controller] of [...this.pending]) {
            if (this.pending.get(id) === controller) this.pending.delete(id);
            controller.abort();
        }
    },
    finishTask(id, controller) {
        const current = this.pending.get(id);
        if (current === controller) this.pending.delete(id);
        // A cancelled task may release its own UI, but never a newer task's UI.
        return !current || current === controller;
    },
    async createVideo(node, payload, signal) {
        const task = await this.request('/api/videos', payload, signal);
        if (task.url) return task;
        node.dataset.videoTask = JSON.stringify({ id: task.id });
        if (task.warning) Interaction.toast(task.warning, 'warn', 6000);
        this.scheduleSave();
        await this.save();
        return this.pollVideo(node, task.id, signal);
    },
    async pollVideo(node, id, signal) {
        const started = Date.now();
        while (Date.now() - started < 20 * 60000) {
            if (signal?.aborted || !node.isConnected) throw new DOMException('已取消等待', 'AbortError');
            let task;
            try { task = await this.request(`/api/videos/${encodeURIComponent(id)}`, undefined, signal); }
            catch (error) { throw new Error(`${error.message}。任务已保留，点击节点生成按钮继续查询`); }
            if (task.status === 'failed') { delete node.dataset.videoTask; throw new Error(task.error || '视频任务失败'); }
            if (task.status === 'completed') return task;
            Interaction.updateNodeStatus(node, task.status === 'queued' ? '排队中' : `生成中${task.progress ? ` ${task.progress}%` : ''}`);
            await new Promise((resolve, reject) => {
                const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
                const timer = setTimeout(done, 3000);
                const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('已取消等待', 'AbortError')); };
                signal?.addEventListener('abort', abort, { once: true });
            });
        }
        throw new Error('视频仍未完成，任务已保存；稍后点击生成按钮继续查询');
    },
    async resumeVideo(node) {
        const btn = node.querySelector('.send-btn');
        if (btn.disabled) return;
        const controller = new AbortController();
        this.pending.set(node.dataset.nodeId, controller); btn.disabled = true;
        try {
            const task = JSON.parse(node.dataset.videoTask);
            const result = await this.pollVideo(node, task.id, controller.signal);
            if (!node.isConnected || controller.signal.aborted) return;
            const before = Interaction.captureScene();
            const generationInput = node._production?.pendingFingerprint || window.Production?.fingerprint(node);
            const container = node.querySelector('.media-container'); container.replaceChildren();
            const video = document.createElement('video'); video.src = result.url; video.controls = true; container.appendChild(video);
            delete node.dataset.videoTask;
            window.Production?.recordResult(node, before.nodes.find(n => n.id === node.dataset.nodeId), result, generationInput, node._production?.pendingParameters);
            Interaction.updateNodeStatus(node, '已生成');
            Interaction.pushCommand(before, Interaction.captureScene());
            Interaction.pushHistory('generate', '视频任务完成', { nodeId: node.dataset.nodeId, scene: Interaction.captureScene() });
            Interaction.refreshDownstreamReferences(node);
        } catch (error) {
            if (node.isConnected) Interaction.updateNodeStatus(node, '待查询');
            Interaction.toast(error.message, 'error', 5000);
        } finally { if (this.finishTask(node.dataset.nodeId, controller)) btn.disabled = false; this.scheduleSave(); }
    },
    download(name, blob) {
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async exportProject() {
        if (this.recoveryProject) return this.exportRecovery();
        const button = document.getElementById('project-export-btn'); button.disabled = true;
        try {
            const project = await ProjectStore.portable(this.project());
            this.download(`${project.name.replace(/[<>:"/\\|?*]/g, '_')}.canvas.json`, new Blob([JSON.stringify(project)], { type: 'application/json' }));
            Interaction.toast('项目已导出，请保留文件作为备份', 'success');
        } catch (error) { Interaction.toast(error.message, 'error', 5000); }
        finally { button.disabled = false; }
    },
    exportRecovery() {
        if (!this.recoveryProject) return;
        this.download('画布原始备份.canvas.json', new Blob([JSON.stringify(this.recoveryProject)], { type:'application/json' }));
        Interaction.toast('原始备份已导出，请保留文件后再整理或修复项目', 'success', 5000);
    },
    async importProject(file, guard = () => {}) {
        if (!file) return;
        if (this.importing) throw new Error('正在导入项目，请稍候');
        if (file.size > 256 * 1024 * 1024) throw new Error('项目文件超过 256MB');
        this.importing = true;
        const projectId = this.projectId, wasInert = document.body.inert;
        let committing = false;
        try {
            const project = await ProjectStore.portable(ProjectStore.validate(JSON.parse(await file.text())));
            guard();
            if (this.projectId !== projectId) throw new Error('当前画布已切换，请重新导入');
            if (this.pending.size) throw new Error('请先停止等待当前生成或导出任务，再导入项目');
            // Freeze only the short commit phase; all file reading happens first.
            document.body.inert = true;
            await this.flushSave();
            guard();
            const before = this.captureWorkspace();
            const candidate = { ...this.project(), name:project.name, scene:project.scene, history:project.history };
            this.saving = true; committing = true;
            this.status('正在导入项目…');
            this.savePromise = ProjectStore.save(candidate, this.revision);
            const revision = await this.savePromise;
            // Publish the imported view only after the database transaction commits.
            this.revision = revision;
            this.restoreWorkspace({scene:project.scene,name:project.name,history:project.history});
            const after = this.captureWorkspace();
            Interaction.pushCommand(before.scene, after.scene, { beforeWorkspace:before, afterWorkspace:after });
            this.lastSaveError = null;
            this.status('已保存到此浏览器');
            Interaction.toast('已导入项目；可撤销恢复原画布', 'success');
        } catch (error) {
            if (committing) {
                this.lastSaveError = error;
                this.status(error.message, true);
                if (error.message.includes('另一个页面')) this.ready = false;
            }
            throw error;
        } finally {
            if (committing) this.saving = false;
            this.importing = false; document.body.inert = wasInert;
        }
    },
    openTemplate(id) {
        document.getElementById('template-kind').value = id || 'character';
        document.getElementById('template-append-row').hidden = State.nodes.length === 0;
        document.getElementById('template-append').checked = false;
        document.getElementById('template-dialog').showModal();
    },
    createTemplate() {
        const id = document.getElementById('template-kind').value;
        if (State.nodes.length && !document.getElementById('template-append').checked) return Interaction.toast('请勾选“追加到当前画布”或先创建新项目', 'warn');
        const theme = document.getElementById('template-theme').value.trim();
        const ratio = document.getElementById('template-ratio').value;
        const count = Number(document.getElementById('template-count').value);
        if (!Number.isInteger(count) || count < 1 || count > 8) return Interaction.toast('图片节点数量须在 1 到 8 之间', 'warn');
        const original = TEMPLATE_PRESETS[id];
        const viewport = document.getElementById('viewport');
        const center = Engine.screenToCanvas(viewport.clientWidth * 0.45, viewport.clientHeight * 0.48);
        const offset = State.nodes.length ? Math.max(...State.nodes.map((node) => node.x)) + 620 - center.x : 0;
        const nodes = [{ ...original.nodes[0], key: 'brief', dx: offset, text: theme ? `主题：${theme}\n${original.nodes[0].text}` : original.nodes[0].text }];
        for (let index = 0; index < count; index++) {
            const source = original.nodes[Math.min(index + 1, original.nodes.length - 1)];
            nodes.push({ ...source, key: `image${index}`, dx: offset + (index + 1) * 580, dy: nodes[0].dy, ratio, name: count > 2 ? `${source.name} ${index + 1}` : source.name, prompt: theme ? `主题：${theme}\n${source.prompt}` : source.prompt });
        }
        TEMPLATE_PRESETS[id] = { ...original, nodes, links: nodes.slice(1).map((node, index) => [nodes[index].key, node.key]) };
        this.allowTemplateAppend = true;
        try { Interaction.createTemplateFlow(id); }
        finally { TEMPLATE_PRESETS[id] = original; this.allowTemplateAppend = false; }
        document.getElementById('template-dialog').close();
        this.fitCanvas();
    },
    fitCanvas() {
        if (!State.nodes.length) return Interaction.resetView();
        const left = Math.min(...State.nodes.map((node) => node.x));
        const top = Math.min(...State.nodes.map((node) => node.y));
        const right = Math.max(...State.nodes.map((node) => node.x + node.el.offsetWidth));
        const bottom = Math.max(...State.nodes.map((node) => node.y + node.el.offsetHeight));
        const panelWidth = document.body.classList.contains('agent-open') ? document.querySelector('.agent-panel').offsetWidth + 20 : 0;
        const width = Math.max(200, window.innerWidth - panelWidth - 180), height = Math.max(200, window.innerHeight - 200);
        State.canvas.scale = Engine.clamp(Math.min(width / (right - left), height / (bottom - top), 1), Interaction.minScale, Interaction.maxScale);
        const cx = 100 + width / 2, cy = 125 + height / 2;
        State.canvas.x = SUPPORTS_CSS_ZOOM ? cx / State.canvas.scale - (left + right) / 2 : cx - (left + right) / 2 * State.canvas.scale;
        State.canvas.y = SUPPORTS_CSS_ZOOM ? cy / State.canvas.scale - (top + bottom) / 2 : cy - (top + bottom) / 2 * State.canvas.scale;
        Interaction.requestRender({ canvas: true, lines: true });
    },
    async init() {
        document.getElementById('project-save-btn').onclick = () => this.save();
        document.getElementById('project-export-btn').onclick = () => this.exportProject();
        document.getElementById('project-recover-btn').onclick = () => this.exportRecovery();
        document.getElementById('project-import-btn').onclick = () => document.getElementById('project-file').click();
        document.getElementById('project-file').onchange = async (event) => {
            try { await this.importProject(event.target.files[0]); } catch (error) { Interaction.toast(error.message, 'error', 5000); }
            event.target.value = '';
        };
        document.getElementById('project-new-btn').onclick = () => document.getElementById('new-project-dialog').showModal();
        document.getElementById('new-project-confirm').onclick = async () => {
            if (this.dirty) await this.save();
            Interaction.runSceneCommand({}, () => Interaction.restoreScene({ nodes: [], links: [], canvas: { x: -4500, y: -4500, scale: 1 } }));
            document.getElementById('project-name').value = '未命名项目';
            document.getElementById('new-project-dialog').close(); this.scheduleSave();
        };
        document.getElementById('fit-canvas-btn').onclick = () => this.fitCanvas();
        document.getElementById('stop-generation-btn').onclick = () => { this.cancelAll(); Interaction.toast('已停止等待，上游可能继续处理；视频任务可继续查询', 'warn', 5000); };
        document.getElementById('help-btn').onclick = () => document.getElementById('help-dialog').showModal();
        document.querySelectorAll('[data-close-dialog]').forEach((button) => { button.onclick = () => button.closest('dialog').close(); });
        document.querySelectorAll('.empty-template-btn').forEach((button) => { button.onclick = (event) => { event.stopPropagation(); this.openTemplate(button.dataset.template); }; });
        const top = document.querySelectorAll('.top-chip');
        top[0].onclick = () => this.openTemplate('character'); top[1].onclick = () => this.openTemplate('storyboard');
        document.getElementById('template-form').onsubmit = (event) => { event.preventDefault(); this.createTemplate(); };
        document.getElementById('rail-profile-btn').onclick = () => this.openSettings();
        document.getElementById('access-form').onsubmit = async (event) => {
            event.preventDefault();
            const input = document.getElementById('access-password');
            try { await this.request('/api/session', { password: input.value }); input.value = ''; await this.loadConfig(); document.getElementById('access-error').textContent = ''; }
            catch (error) { document.getElementById('access-error').textContent = error.message; }
        };
        document.getElementById('lock-access-btn').onclick = async () => {
            try { this.cancelAll(); await fetch(`${API_PROXY_BASE}/api/session`, { method: 'DELETE', credentials: 'same-origin' }); await this.loadConfig(); }
            catch { Interaction.toast('锁定失败，请检查本地服务', 'error'); }
        };
        document.addEventListener('input', (event) => { if (event.target.closest('.node, .project-settings')) this.scheduleSave(); });
        document.addEventListener('change', (event) => { if (event.target.closest('.node')) this.scheduleSave(); });
        window.addEventListener('beforeunload', (event) => { if (this.dirty || this.saving || this.pending.size) { event.preventDefault(); event.returnValue = ''; } });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.dirty) this.save(); });
        try {
            let saved = await ProjectStore.load();
            this.recoveryProject = saved;
            let project = saved ? ProjectStore.validate(saved) : null;
            this.revision = saved?.revision || 0;
            if (this.landingEntry) {
                // Archive even legacy active-only records before publishing a new
                // canvas. Failed writes leave the previous record recoverable.
                if (project) this.revision = await ProjectStore.save(saved, this.revision);
                const fresh = ProjectStore.validate({
                    format: ProjectStore.FORMAT, version: 1,
                    id: `project_${crypto.randomUUID()}`, name: '未命名画布', updatedAt: new Date().toISOString(), history: [],
                    scene: { nodes: [], links: [], canvas: { x: -4500, y: -4500, scale: 1 }, view: {} }
                });
                const revision = await ProjectStore.save(fresh, this.revision);
                project = fresh; saved = { ...fresh, revision };
                const url = new URL(location.href); url.searchParams.delete('entry');
                history.replaceState(history.state, '', url.pathname + url.search + url.hash);
            }
            if (project) {
                this.projectId=project.id;
                this.revision = saved.revision;
                Interaction.restoreScene(project.scene);
                State.history = project.history; Interaction.renderHistory();
                document.getElementById('project-name').value = project.name;
            }
            this.recoveryProject = null;
            this.ready = true; this.status(saved ? '已恢复本地项目' : '自动保存已就绪');
        } catch (error) { document.getElementById('project-recover-btn').hidden = !this.recoveryProject; this.status(error.message, true); }
        await this.loadConfig();
        // Browsing the canvas is public; protected actions request access when used.
        document.body.classList.remove('workspace-loading');
    }
};
Workspace.init();
