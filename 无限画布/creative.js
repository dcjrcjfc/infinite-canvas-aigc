/* Canvas interaction shell. It extends the existing graph and reversible commands. */
window.Creative = {
    contextIds: new Set(), manualContext:false, assetFilter: 'all', searchMode: 'focus', pendingLayout: false,
    icon(name) { return window.CanvasIcons?.icon(name) || document.createElement('span'); },
    buttonIcon(button, name) { if (!button) return; button.replaceChildren(this.icon(name)); },
    syncNodeHeading(node) {
        const label = node.querySelector('.node-label'); if (!label || label.classList.contains('editing')) return;
        const type = node.dataset.nodeType, name = node.dataset.nodeName || '', prefix = getNodeMeta(type).label;
        const automatic = name === prefix || (name.startsWith(`${prefix} `) && /^\d+$/.test(name.slice(prefix.length + 1)));
        label.textContent = automatic || !name ? ({ text:'Text', image:'Image', video:'Video', audio:'Audio', scene:'3D 片场' }[type] || type) : name;
    },
    selected() { return State.selection.type === 'node' && State.selection.item?.isConnected ? State.selection.item : null; },
    media(node) { return node?.querySelector('.media-container img, .media-container video, .media-container audio'); },
    floating(el, open) {
        if (!el?.showPopover) return false;
        el.setAttribute('popover', 'manual');
        if (open && !el.matches(':popover-open')) el.showPopover();
        if (!open && el.matches(':popover-open')) el.hidePopover();
        return true;
    },
    decorateNode(node) {
        const type = node.dataset.nodeType;
        for (const connector of node.querySelectorAll('.connector')) if (!connector.querySelector('.connector-glyph')) {
            const glyph = document.createElement('span'); glyph.className = 'connector-glyph';
            glyph.setAttribute('aria-hidden', 'true'); glyph.appendChild(this.icon('plus')); connector.replaceChildren(glyph);
        }
        const icon = { text: 'text', image: 'image', video: 'video', audio: 'audio-lines', scene: 'box' }[type] || 'box';
        const meta = node.querySelector('.node-type-meta');
        if (meta) { meta.replaceChildren(this.icon(icon)); meta.setAttribute('aria-hidden', 'true'); }
        const heading = node.querySelector('.node-head'), label = node.querySelector('.node-label');
        if (heading && label) heading.insertBefore(label, node.querySelector('.node-status-tag'));
        this.syncNodeHeading(node);
        const placeholder = node.querySelector('.media-placeholder');
        if (placeholder) placeholder.replaceWith(this.icon(icon));
        node.querySelectorAll('.send-btn').forEach((b) => this.buttonIcon(b, 'arrow-up'));
        node.querySelectorAll('.model-switch').forEach((b) => { b.textContent = getModelMeta(node.dataset.model, type).label; });
        node.querySelectorAll('.model-item-icon').forEach((el) => el.replaceChildren());
        node.querySelectorAll('.ai-input').forEach((el) => el.setAttribute('aria-label', el.classList.contains('text-node-input') ? '节点文本' : '生成提示词'));
        node.querySelector('.ai-panel')?.setAttribute('aria-label', '节点生成设置');
        const text = node.querySelector('.text-node-input');
        if (text && !text.dataset.editReady) {
            text.dataset.editReady = 'true'; text.readOnly = true;
            text.placeholder = '双击开始编辑…';
            const edit = () => { text.readOnly = false; text.focus({ preventScroll:true }); };
            node.querySelector('.node-box').addEventListener('dblclick', (e) => { e.stopPropagation(); edit(); });
            text.addEventListener('keydown', (e) => { if (text.readOnly && e.key === 'Enter') { e.preventDefault(); edit(); } });
            text.addEventListener('blur', () => { text.readOnly = true; });
        }
        if (type === 'scene') {
            node.querySelector('.ai-panel')?.remove(); node.querySelector('.node-upload-pill')?.remove();
            const container = node.querySelector('.media-container');
            const button = document.createElement('button'); button.type = 'button'; button.className = 'node-action-scene'; button.textContent = '进入 3D 片场';
            button.onclick = (event) => { event.stopPropagation(); window.SceneStudio?.open(node); };
            if (!container.querySelector('.node-action-scene')) container.appendChild(button);
        }
        node.querySelectorAll('.model-switch,.ratio-toggle').forEach((b) => { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); });
        node.querySelectorAll('.model-switch').forEach((b) => b.title = '选择生成模型');
        this.configureNode(node);
        node.querySelectorAll('.node-label').forEach((el) => {
            el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', '重命名节点');
            el.addEventListener('keydown', (event) => {
                if (event.target !== el || event.isComposing || !['Enter', ' '].includes(event.key)) return;
                event.preventDefault(); el.dispatchEvent(new MouseEvent('dblclick', { bubbles:true }));
            });
        });
    },
    configureNode(node) {
        if(node.dataset.nodeType!=='video'||!node.querySelector('.ai-panel'))return;
        const cap=Workspace.config.models.find((m)=>m.id===node.dataset.model);if(!cap?.durations?.length)return;
        const duration=node.querySelector('.video-duration'),previous=duration.value;
        duration.replaceChildren();for(const d of cap.durations){const option=document.createElement('option');option.value=d;option.textContent=`${d} 秒`;duration.appendChild(option);}duration.value=cap.durations.includes(Number(previous))?previous:String(cap.durations[0]);
        const grid=node.querySelector('.ratio-grid');grid.replaceChildren();
        for(const ratio of cap.ratios){const item=document.createElement('button');item.type='button';item.className='ratio-item';item.dataset.ratio=ratio;item.textContent=ratio;item.classList.toggle('active',ratio===node.dataset.ratio);grid.appendChild(item);}
        if(!cap.ratios.includes(node.dataset.ratio)){node.dataset.ratio=cap.ratios[0];node.querySelector('.ratio-toggle').textContent=`比例 ${node.dataset.ratio}`;}
        node.querySelector('.video-capabilities')?.remove();
        const row=document.createElement('div');row.className='video-capabilities audio-options';
        for(const [key,values,label,names] of [['inputMode',cap.inputModes,'输入',{ 'first-frame':'首帧','first-last-frame':'首尾帧','reference':'参考图' }],['resolution',cap.resolutions,'清晰度',{}]]){
            if(!values?.length)continue;const l=document.createElement('label');l.textContent=label+' ';const select=document.createElement('select');select.setAttribute('aria-label',`视频${label}`);
            for(const v of values){const option=document.createElement('option');option.value=v;option.textContent=names[v]||v;select.appendChild(option);}if(values.includes(node.dataset[key]))select.value=node.dataset[key];else node.dataset[key]=select.value;
            select.onchange=()=>{node.dataset[key]=select.value;Workspace.scheduleSave();};l.appendChild(select);row.appendChild(l);
        }
        const note=document.createElement('span');note.className='video-capability-note';note.textContent=`参考图上限 ${cap.maxReferences} 张`;row.appendChild(note);node.querySelector('.duration-label').after(row);
    },
    applyCapabilities() {State.nodes.forEach((n)=>this.configureNode(n.el));},
    onRestore() {
        State.nodes.forEach((n) => this.decorateNode(n.el));
        this.contextIds = new Set([...this.contextIds].filter((id) => State.nodes.some((n) => n.el.dataset.nodeId === id)));
        this.applyView(); this.renderConversations(); this.layout();
        window.Timeline?.restore();
    },
    applyView() {
        State.view ||= {};
        document.body.classList.toggle('hide-links', !!State.view.hideLinks);
        document.getElementById('hide-links-toggle').classList.toggle('active', !!State.view.hideLinks);
        document.getElementById('snap-toggle').classList.toggle('active', !!State.view.snap);
    },
    layout() {
        this.pendingLayout = true;
        if (Interaction.renderRAF || this.layoutRAF) return;
        this.layoutRAF = requestAnimationFrame(() => this.flushLayout());
    },
    flushLayout() {
        if (this.layoutRAF) cancelAnimationFrame(this.layoutRAF);
        this.layoutRAF = null; this.pendingLayout = false;
        this.positionEditor();
        this.updateContext();
    },
    positionEditor() {
        const node = State.multiSelection.length > 1 ? null : this.selected(), actions = document.getElementById('node-actions');
        actions.hidden = !node;
        const panel = node?.querySelector('.ai-panel');
        if (this.openEditor && this.openEditor !== panel) this.floating(this.openEditor, false);
        this.openEditor = panel || null;
        if (!node) return;
        // The editor belongs to the node, rather than to a screen edge. Its
        // CSS anchor follows the scene directly, including during gestures.
        const box = node.querySelector('.node-box').getBoundingClientRect(), scale = State.canvas.scale;
        actions.style.left = `${box.left + box.width / 2}px`;
        actions.style.top = `${box.top - 72}px`;
        if (!panel) return;
        const width = Math.min(680, window.innerWidth - 96);
        panel.style.setProperty('--editor-width', `${Math.max(220, width)}px`);
        panel.style.setProperty('--editor-scale', String(1 / scale));
        panel.style.setProperty('--editor-gap', `${12 / scale}px`);
        // Native top-layer placement keeps text at its real screen size instead
        // of rasterizing a scaled parent and inverse-scaled child. DOM ownership
        // stays with the node, so model inputs, focus and persistence keep working.
        panel.style.setProperty('--editor-screen-left', `${Engine.snapToDevicePixel(box.left + box.width / 2 - Math.max(220,width) / 2)}px`);
        panel.style.setProperty('--editor-screen-top', `${Engine.snapToDevicePixel(box.bottom + 12)}px`);
        if (this.floating(panel, true)) panel.dataset.screenOverlay = 'true';
    },
    openSearch(mode = 'focus') {
        this.searchMode = mode;
        const dialog = document.getElementById('search-dialog');
        dialog.querySelector('h2').textContent = mode === 'context' ? '引用画布节点' : mode === 'link' ? '选择连接目标' : '节点搜索';
        document.getElementById('node-search-input').value = ''; this.renderSearch();
        if (!dialog.open) dialog.showModal(); document.getElementById('node-search-input').focus();
    },
    renderSearch() {
        const query = document.getElementById('node-search-input').value.trim().toLowerCase(), list = document.getElementById('node-search-results'); list.replaceChildren();
        const rows = State.nodes.filter((n) => [n.el.dataset.nodeName, n.el.querySelector('.text-node-input')?.value, n.el.querySelector('.ai-panel .ai-input')?.value].join(' ').toLowerCase().includes(query));
        if (!rows.length) { list.textContent = '没有匹配节点。创建节点后可在这里快速定位。'; return; }
        for (const n of rows) {
            const b = document.createElement('button'); b.className = 'search-result'; b.type = 'button';
            b.appendChild(this.icon({ image:'image', text:'text', video:'video', audio:'audio-lines', scene:'box' }[n.type]));
            const label = document.createElement('span'); label.textContent = n.el.dataset.nodeName;
            const small = document.createElement('small'); small.textContent = `${getNodeMeta(n.type).label} · ${n.el.dataset.nodeStatus}`; label.appendChild(small); b.appendChild(label);
            b.onclick = () => {
                if (this.searchMode === 'context') { this.manualContext=true;this.contextIds.add(n.el.dataset.nodeId); this.updateContext(); }
                else if (this.searchMode === 'link') { const from = this.linkSource; if (from?.isConnected && from !== n.el) Interaction.runSceneCommand({}, () => Interaction.createLinkBetween(from.querySelector('.conn-right'), n.el.querySelector('.conn-left'))); }
                else Interaction.focusNode(n.el);
                document.getElementById('search-dialog').close(); this.layout();
            };
            list.appendChild(b);
        }
    },
    renderAssets() {
        const query = document.getElementById('asset-search').value.trim().toLowerCase(), grid = document.getElementById('asset-grid'); grid.replaceChildren();
        for (const n of State.nodes) {
            const media = this.media(n.el);
            if ((!media && n.type !== 'scene') || (this.assetFilter !== 'all' && this.assetFilter !== n.type) || !n.el.dataset.nodeName.toLowerCase().includes(query)) continue;
            const button = document.createElement('button'); button.className = 'asset-item'; button.title = '定位到画布素材';
            if (media && n.type !== 'audio') { const preview = media.cloneNode(); preview.removeAttribute('controls'); if (preview.tagName === 'VIDEO') { preview.muted = true; preview.preload = 'metadata'; } button.appendChild(preview); }
            else button.appendChild(this.icon(n.type === 'audio' ? 'audio-lines' : 'box'));
            const name = document.createElement('span'); name.textContent = n.el.dataset.nodeName; button.appendChild(name);
            button.onclick = () => { Interaction.focusNode(n.el); document.getElementById('asset-panel').hidden = true; this.layout(); };
            grid.appendChild(button);
        }
        if (!grid.children.length) grid.textContent = '暂无匹配素材。上传或生成后会自动显示在这里。';
    },
    openAssets() { document.getElementById('asset-panel').hidden = false; this.renderAssets(); },
    updateContext() {
        const target = document.getElementById('agent-context'); if (!target) return;
        const ids = this.manualContext ? [...this.contextIds] : Interaction.getSelectedNodeElements().map((el) => el.dataset.nodeId);
        const signature = `${this.manualContext}|`+ids.join('|') + State.nodes.map((n) => n.el.dataset.nodeName).join('|');
        if (signature === this.contextSignature) return; this.contextSignature = signature; target.replaceChildren();
        for (const id of ids) {
            const n = State.nodes.find((n) => n.el.dataset.nodeId === id); if (!n) continue;
            const b = document.createElement('button'); b.className = 'context-chip'; b.type = 'button'; b.textContent = n.el.dataset.nodeName; b.title = this.contextIds.size ? '移除此上下文' : '当前选中节点';
            b.onclick = () => { if(!this.manualContext)this.contextIds=new Set(ids);this.manualContext=true;this.contextIds.delete(id); this.contextSignature = ''; this.updateContext(); }; target.appendChild(b);
        }
        if(!ids.length){const b=document.createElement('button');b.type='button';b.className='context-chip';b.textContent=this.manualContext?'无节点上下文':'当前画布 · 最多 20 个节点';b.title=this.manualContext?'点击选择节点':'点击取消自动引用画布';b.onclick=()=>{if(this.manualContext)this.openSearch('context');else{this.manualContext=true;this.contextIds.clear();this.contextSignature='';this.updateContext();}};target.appendChild(b);}
    },
    activeConversation() {
        State.conversations ||= [];
        if (!State.conversations.length) State.conversations.push({ id: `chat_${Date.now()}`, name:'新建对话', messages:[] });
        return State.conversations.find((c) => c.id === this.chatId) || State.conversations.at(-1);
    },
    renderConversations() {
        if (!document.getElementById('chat-select')) return;
        const chat = this.activeConversation(); this.chatId = chat.id;
        const select = document.getElementById('chat-select'); select.replaceChildren();
        for (const c of State.conversations) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; select.appendChild(o); } select.value = chat.id;
        const list = document.getElementById('chat-messages'); list.replaceChildren();
        document.querySelector('.agent-welcome').hidden = chat.messages.length > 0;
        for (const m of chat.messages) {
            const row = document.createElement('div'); row.className = `chat-message ${m.role}`; row.textContent = m.text;
            if (m.role === 'assistant') { const b = document.createElement('button'); b.textContent = '加入画布为文本节点'; b.onclick = () => {
                const current = State.nodes.find((n) => n.el.dataset.nodeId === m.nodeId);
                if (current) return Interaction.focusNode(current.el);
                const el = this.addNode('text', m.text, 'Agent 创作建议'); if (!el) return; m.nodeId = el.dataset.nodeId; Workspace.scheduleSave(); b.textContent = '定位到文本节点';
            }; row.appendChild(b); }
            list.appendChild(row);
        }
        list.scrollTop = list.scrollHeight;
    },
    async submitAgent() {
        const button = document.getElementById('agent-send-btn'); if (button.disabled || Workspace.pending.has('agent')) return;
        const input = document.querySelector('.agent-input'), prompt = input.value.trim(); if (!prompt) return Interaction.toast('先描述你的创作需求', 'warn');
        const model = document.getElementById('agent-llm-select').value; if (!Workspace.modelAvailable(model)) return;
        const chat = this.activeConversation();
        const ids = this.manualContext ? this.contextIds : new Set(Interaction.getSelectedNodeElements().map((n) => n.dataset.nodeId));
        const nodes = this.manualContext||ids.size ? State.nodes.filter((n) => ids.has(n.el.dataset.nodeId)) : State.nodes.slice(0, 20);
        const context = nodes.map((n) => `${n.el.dataset.nodeName} [${n.type}]\n${Interaction.getUpstreamText(n.el)}\n${n.el.querySelector('.text-node-input')?.value || n.el.querySelector('.ai-panel .ai-input')?.value || ''}`).join('\n\n');
        const prior = chat.messages.slice(-12).map((m) => `${m.role}: ${m.text}`).join('\n');
        let images;
        try { images = nodes.filter((n) => n.type === 'image' || n.type === 'scene').slice(0, 4).map((n) => Interaction.getRenderedImageSource(n.el)).filter((src) => src?.startsWith('data:image/')); }
        catch(error) { Interaction.setAgentStatus(error.message, 'error'); return; }
        const message = { role:'user', text:prompt }; chat.messages.push(message);
        if (chat.name === '新建对话') chat.name = prompt.slice(0, 18); input.value = ''; this.renderConversations();
        const controller = new AbortController(); Workspace.pending.set('agent', controller); Interaction.setAgentBusy(true); Interaction.setAgentStatus('正在结合画布思考…', 'busy'); Workspace.scheduleSave();
        try {
            const result = await Workspace.request('/api/chat', { model, prompt, context:`对话记录：\n${prior}\n\n画布上下文：\n${context}`, images }, controller.signal);
            if (controller.signal.aborted || !State.conversations.includes(chat)) return;
            chat.messages.push({ role:'assistant', text:result.text }); this.renderConversations(); Interaction.setAgentStatus('回复已保存，可选择加入画布', 'success');
        } catch (error) { if (!controller.signal.aborted && (!Workspace.pending.has('agent') || Workspace.pending.get('agent') === controller)) { if (!input.value) input.value = prompt; Interaction.setAgentStatus(error.message, 'error'); } }
        finally {
            if (controller.signal.aborted && Workspace.pending.get('agent') === controller) {
                if (!input.value) input.value = prompt;
                Interaction.setAgentStatus('已停止等待，输入已保留', 'info');
            }
            if (Workspace.finishTask('agent', controller)) Interaction.setAgentBusy(false); Workspace.scheduleSave();
        }
    },
    addNode(type, value, name, sources=[]) {
        let el;
        const applied = Interaction.runSceneCommand({}, () => {
            const selected=this.selected();
            const start=selected?{x:parseFloat(selected.style.left)+(selected.offsetWidth||320)+160,y:parseFloat(selected.style.top)}:Engine.screenToCanvas(window.innerWidth * .35, window.innerHeight * .28);
            const pos=this.freePosition(start,type);
            el = UI.createNode(type, pos, type === 'text' ? null : value, { withPrompt:type === 'text', nodeName:name });
            if (type === 'text') el.querySelector('.text-node-input').value = value || '';
            State.nodes.push({ el, x:pos.x, y:pos.y, type }); Interaction.syncCanvasEmptyState();
            for(const source of sources)if(source?.isConnected&&source!==el)Interaction.createLinkBetween(source.querySelector('.conn-right'),el.querySelector('.conn-left'));
        });
        if (!applied) return null;
        Interaction.focusNode(el); this.layout(); return el;
    },
    freePosition(start,type='image',direction=0) {
        const pos={...start},width=type==='video'||type==='audio'?440:['text','image'].includes(type)?250:320,height=320;
        for(let attempt=0;attempt<500;attempt++) {
            const overlaps=State.nodes.some((n)=>pos.x<n.x+(n.el.offsetWidth||320)+70&&pos.x+width+70>n.x&&pos.y<n.y+(n.el.offsetHeight||280)+70&&pos.y+height+70>n.y);
            if(!overlaps)return pos;
            if(direction)pos.x+=(width+160)*direction;
            else {pos.y+=400;if(attempt%5===4){pos.x+=600;pos.y=start.y;}}
        }
        return pos;
    },
    async downloadNode(node) {
        const media = this.media(node); if (!media) return Interaction.toast('当前节点还没有可下载素材', 'warn');
        try { const response = await fetch(media.src, { credentials:'omit' }); if (!response.ok) throw new Error(); const blob = await response.blob(); Workspace.download(`${node.dataset.nodeName}.${({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/webm':'webm','audio/mp4':'m4a' })[blob.type] || 'bin'}`, blob); }
        catch { Interaction.toast('素材下载失败，请重新上传或检查素材地址', 'error'); }
    },
    fileData(file) { return ProjectStore.fileDataUrl(file); },
    commitScene(node, spec) {
        Interaction.runSceneCommand({}, () => { node.dataset.sceneSpec = JSON.stringify(spec); });
        Workspace.scheduleSave();
    },
    sceneSnapshot(source, image) {
        let output;
        Interaction.runSceneCommand({}, () => {
            const pos = this.freePosition({ x:parseFloat(source.style.left)+580, y:parseFloat(source.style.top) });
            output = UI.createNode('image', pos, image, {nodeName:'片场镜头',status:'片场拍摄'});
            State.nodes.push({el:output,x:pos.x,y:pos.y,type:'image'});
            const container=source.querySelector('.media-container'),old=container.querySelector('img');
            if(old)old.src=image;else {const preview=document.createElement('img');preview.src=image;preview.alt='3D 片场镜头预览';container.prepend(preview);}
            source.querySelector('.media-container>svg')?.remove();
            Interaction.createLinkBetween(source.querySelector('.conn-right'),output.querySelector('.conn-left'));
            Interaction.refreshDownstreamReferences(source);Interaction.syncCanvasEmptyState();
        });
        Interaction.focusNode(output);this.layout();
    },
    async flushProject() {
        await Workspace.flushSave();
    },
    async openProjects() {
        try {
            await this.flushProject();const list=document.getElementById('project-list');list.replaceChildren();
            for(const p of await ProjectStore.listProjects()) {
                const b=document.createElement('button');b.className='search-result';b.type='button';b.appendChild(this.icon('layers'));const label=document.createElement('span');label.textContent=p.name;const small=document.createElement('small');small.textContent=`${p.nodes} 个节点${p.id===Workspace.projectId?' · 当前画布':''}`;label.appendChild(small);b.appendChild(label);
                b.onclick=async()=>{try{await this.switchProject(p.id);document.getElementById('project-switcher-dialog').close();}catch(error){Interaction.toast(error.message,'error',5000);}};list.appendChild(b);
            }
            document.getElementById('project-switcher-dialog').showModal();
        }catch(error){Interaction.toast(error.message,'error',5000);}
    },
    async switchProject(id) {
        if(id===Workspace.projectId)return;
        if(Workspace.pending.size)throw new Error('请先停止等待当前生成或导出任务，再切换画布');
        await this.flushProject();const saved=await ProjectStore.loadProject(id);if(!saved)throw new Error('画布不存在');const project=ProjectStore.validate(saved);
        Workspace.projectId=id;Interaction.restoreScene(project.scene);State.history=project.history;State.undoStack=[];State.redoStack=[];Interaction.updateUndoRedoUI();Interaction.renderHistory();document.getElementById('project-name').value=project.name;document.querySelector('.brand-name').textContent=project.name;await Workspace.save();this.layout();
    },
    async newProject() {
        try {
            if(Workspace.pending.size)throw new Error('请先停止等待当前生成或导出任务，再创建画布');
            await this.flushProject();Workspace.projectId=`project_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
            Interaction.restoreScene({nodes:[],links:[],canvas:{x:-4500,y:-4500,scale:1}});State.history=[];State.undoStack=[];State.redoStack=[];Interaction.updateUndoRedoUI();Interaction.renderHistory();document.getElementById('project-name').value='未命名项目';document.querySelector('.brand-name').textContent='未命名项目';document.getElementById('new-project-dialog').close();await Workspace.save();
        }catch(error){Interaction.toast(error.message,'error',5000);}
    },
    installMenus() {
        const menu = document.getElementById('nodeMenu'), add = document.getElementById('ui-add-btn');
        const trigger = document.getElementById('scene-menu-trigger'), submenu = document.getElementById('scene-submenu');
        const preview = document.getElementById('menu-link-preview');
        const project = document.querySelector('.project-toolbar'), projectToggle = document.getElementById('project-menu-toggle');
        const closeProject = () => { this.floating(project, false); project.classList.remove('is-open'); projectToggle.setAttribute('aria-expanded', 'false'); };
        let submenuTimer, returnFocus;
        const closeSubmenu = () => {
            clearTimeout(submenuTimer); this.floating(submenu, false); submenu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
        };
        const openSubmenu = (keyboard = false) => {
            clearTimeout(submenuTimer); submenu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); this.floating(submenu, true);
            const anchor = trigger.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
            const width = submenu.offsetWidth, height = submenu.offsetHeight;
            const right = bounds.right + 6;
            submenu.style.left = `${Math.max(8, Math.min(right + width <= innerWidth - 8 ? right : bounds.left - width - 6, innerWidth - width - 8))}px`;
            submenu.style.top = `${Math.max(8, Math.min(anchor.top - 4, innerHeight - height - 8))}px`;
            if (keyboard) submenu.querySelector('button').focus({ preventScroll: true });
        };
        const scheduleClose = () => { clearTimeout(submenuTimer); submenuTimer = setTimeout(closeSubmenu, 180); };
        trigger.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') openSubmenu(); });
        trigger.addEventListener('pointerleave', scheduleClose);
        submenu.addEventListener('pointerenter', () => clearTimeout(submenuTimer));
        submenu.addEventListener('pointerleave', scheduleClose);
        trigger.onclick = (e) => { e.stopPropagation(); openSubmenu(e.detail === 0); };
        menu.addEventListener('pointerover', (e) => { if (e.target.closest('.menu-item') && !trigger.contains(e.target)) closeSubmenu(); });
        menu.addEventListener('scroll', closeSubmenu);

        const oldClose = Interaction.closeNodeMenu.bind(Interaction);
        Interaction.closeNodeMenu = () => {
            this.floating(menu, false); oldClose(); closeSubmenu(); preview.hidden = true; State.menuPosition = null; State.menuFromDrop = false;
            add.setAttribute('aria-expanded', 'false');
        };
        const oldOpen = Interaction.openNodeMenuAt.bind(Interaction);
        Interaction.openNodeMenuAt = (x, y, connector = null, options = {}) => {
            closeProject(); Interaction.closeRailPopups(); Interaction.closeAllNodePopovers(); closeSubmenu();
            returnFocus = options.anchor || connector || null;
            State.menuPosition = Engine.screenToCanvas(x, y);
            State.menuFromDrop = options.fromDrop === true;
            menu.dataset.mode = connector ? 'connect' : 'create';
            menu.dataset.anchor = options.anchor ? 'rail' : 'canvas';
            menu.querySelector('.menu-section-title').textContent = connector ? (connector.classList.contains('conn-left') ? '添加输入节点' : '引用该节点生成') : '添加节点';
            for (const item of menu.children) {
                item.hidden = !!connector && item !== menu.firstElementChild && !['text','image','video','audio'].includes(item.dataset.type);
            }
            for (const item of menu.querySelectorAll('[data-type]')) {
                const label = item.querySelector('.label');
                const name = { text:'文本', image:'图片', video:'视频', audio:'音频' }[item.dataset.type];
                label.firstChild.nodeValue = name + (connector && item.dataset.type !== 'audio' ? '生成' : '');
            }
            oldOpen(x, y, connector);
            this.floating(menu, true);
            const width = menu.offsetWidth, height = menu.offsetHeight;
            const anchor = options.anchor?.getBoundingClientRect();
            let left = anchor ? anchor.right + 14 : x + (connector ? 22 : 0);
            if (connector?.classList.contains('conn-left')) left = x - width - 22;
            const top = anchor ? anchor.top : y;
            menu.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
            menu.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
            add.setAttribute('aria-expanded', 'true');
            preview.hidden = !connector;
            if (connector) {
                const bounds = menu.getBoundingClientRect(), origin = connector.getBoundingClientRect();
                const sx = origin.left + origin.width / 2, sy = origin.top + origin.height / 2;
                const ex = bounds.left > sx ? bounds.left : bounds.right;
                const ey = Math.max(bounds.top + 16, Math.min(sy, bounds.bottom - 16)), mid = (sx + ex) / 2;
                preview.querySelector('path').setAttribute('d', `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ey}, ${ex} ${ey}`);
            }
            if (options.keyboard) menu.querySelector('button:not([hidden])')?.focus({ preventScroll: true });
        };
        add.onclick = (e) => {
            e.stopPropagation();
            if (menu.style.display === 'block') return Interaction.closeNodeMenu();
            const right = document.body.classList.contains('agent-open') ? document.querySelector('.agent-panel').getBoundingClientRect().left : innerWidth;
            Interaction.openNodeMenuAt(Math.max(180, right / 2 - 125), innerHeight / 2 - 125, null, { anchor:add, keyboard:e.detail === 0 });
        };
        projectToggle.onclick = (e) => {
            e.stopPropagation(); const open = !project.classList.contains('is-open');
            Interaction.closeNodeMenu(); Interaction.closeRailPopups(); Interaction.closeAllNodePopovers();
            project.classList.toggle('is-open', open); projectToggle.setAttribute('aria-expanded', String(open));
            this.floating(project, open);
        };
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('#nodeMenu,#scene-submenu,#ui-add-btn,.connector')) Interaction.closeNodeMenu();
            if (!e.target.closest('.project-toolbar,#project-menu-toggle')) closeProject();
            if (!e.target.closest('.model-popover,.ratio-popover,.model-switch,.ratio-toggle')) Interaction.closeAllNodePopovers();
        });
        document.getElementById('viewport').addEventListener('wheel', () => Interaction.closeNodeMenu(), { passive:true });
        window.addEventListener('resize', () => Interaction.closeNodeMenu());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!submenu.hidden) { e.preventDefault(); e.stopImmediatePropagation(); closeSubmenu(); trigger.focus({ preventScroll:true }); return; }
                if (menu.style.display === 'block') { e.preventDefault(); e.stopImmediatePropagation(); Interaction.closeNodeMenu(); returnFocus?.focus({ preventScroll:true }); return; }
                if (project.classList.contains('is-open')) { e.preventDefault(); closeProject(); projectToggle.focus({ preventScroll:true }); }
                Interaction.closeAllNodePopovers();
            }
            const surface = e.target.closest('#nodeMenu,#scene-submenu');
            if (!surface) return;
            if (e.key === 'ArrowRight' && e.target === trigger) { e.preventDefault(); openSubmenu(true); return; }
            if (e.key === 'ArrowLeft' && surface === submenu) { e.preventDefault(); closeSubmenu(); trigger.focus({ preventScroll:true }); return; }
            if (e.key === 'Tab') { Interaction.closeNodeMenu(); return; }
            if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
            e.preventDefault();
            const items = [...surface.querySelectorAll('button:not(:disabled)')].filter((b) => !b.hidden);
            let index = items.indexOf(document.activeElement);
            index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[index]?.focus({ preventScroll:true });
        }, true);
    },
    init() {
        window.CanvasIcons?.render();
        document.getElementById('project-menu-toggle').onclick = () => { const open = document.querySelector('.project-toolbar').classList.toggle('is-open'); document.getElementById('project-menu-toggle').setAttribute('aria-expanded', String(open)); };
        document.getElementById('share-project-btn').onclick = () => Workspace.exportProject();
        document.getElementById('project-switcher-btn').onclick=()=>this.openProjects();
        document.getElementById('new-project-confirm').onclick=()=>this.newProject();
        document.getElementById('service-top-btn').onclick = () => Workspace.openSettings();
        document.getElementById('node-search-btn').onclick = () => this.openSearch();
        document.getElementById('node-search-input').oninput = () => this.renderSearch();
        document.getElementById('node-search-input').onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector('.search-result')?.focus(); } };
        document.getElementById('asset-library-btn').onclick = () => this.openAssets();
        document.getElementById('asset-close').onclick = () => { document.getElementById('asset-panel').hidden = true; };
        document.getElementById('asset-search').oninput = () => this.renderAssets();
        document.getElementById('asset-upload').onclick = () => { State.uploadContext = {kind:'global'}; document.getElementById('file-input').click(); };
        document.querySelectorAll('[data-asset-filter]').forEach((b) => { b.onclick = () => { this.assetFilter = b.dataset.assetFilter; document.querySelectorAll('[data-asset-filter]').forEach((el) => el.classList.toggle('active',el===b)); this.renderAssets(); }; });
        document.getElementById('rail-agent-btn').onclick = () => { Interaction.toggleAgentPanel(); this.layout(); };
        document.getElementById('agent-fullscreen').onclick = () => { document.body.classList.toggle('agent-fullscreen'); this.layout(); };
        document.getElementById('agent-add-context').onclick = () => this.openSearch('context');
        document.getElementById('chat-list-btn').onclick = () => document.getElementById('chat-select').focus();
        document.getElementById('chat-select').onchange = (event) => { this.chatId=event.target.value; this.renderConversations(); };
        document.querySelector('.agent-header-actions .agent-icon-btn').onclick = () => { State.conversations ||= []; if (State.conversations.length >= 20) return Interaction.toast('最多保留 20 个对话，请导出项目备份后再整理', 'warn'); const chat={id:`chat_${Date.now()}`,name:'新建对话',messages:[]}; State.conversations.push(chat);this.chatId=chat.id;this.renderConversations();Workspace.scheduleSave(); };
        Interaction.submitAgentInput = () => this.submitAgent();
        const presets=['结合当前画布，判断最清晰的下一步创作方向，并给出可执行步骤。','结合当前项目，发散 5 个视觉方向，写明构图、色彩、光线和镜头语言。','结合当前画布，写一份完整角色设定：身份、外观、性格、场景、镜头语言。'];
        document.querySelectorAll('.agent-chip').forEach((b,i)=>{b.onclick=()=>{document.querySelector('.agent-input').value=presets[i]; document.querySelector('.agent-input').focus();};});
        document.querySelectorAll('[data-tool]').forEach((b)=>{b.addEventListener('click',(e)=>{e.stopPropagation();Interaction.closeNodeMenu();if(b.dataset.tool==='timeline')window.Timeline?.open();if(b.dataset.tool==='editor')Interaction.toggleRailPopup('editor');if(b.dataset.tool==='glb')window.SceneStudio?.importFromCanvas();});});
        document.querySelectorAll('[data-close-dialog]').forEach((b)=>{b.onclick=()=>b.closest('dialog').close();});
        for (const [id,key] of [['hide-links-toggle','hideLinks'],['snap-toggle','snap']]) document.getElementById(id).onclick=()=>{State.view ||= {};State.view[key]=!State.view[key];this.applyView();Workspace.scheduleSave();};
        document.getElementById('node-actions').onclick=(e)=>{const action=e.target.closest('[data-node-action]')?.dataset.nodeAction,node=this.selected();if(!action||!node)return;e.stopPropagation();if(action==='duplicate'){Interaction.copySelectedNodes();Interaction.pasteCopiedNodes();}if(action==='download')this.downloadNode(node);if(action==='timeline')window.Timeline?.addSelected();if(action==='connect'){this.linkSource=node;this.openSearch('link');}if(action==='delete')Interaction.deleteSelected();this.layout();};
        const status=document.getElementById('project-status'),name=document.getElementById('project-name');
        new MutationObserver(()=>{document.getElementById('save-indicator').textContent=status.textContent;}).observe(status,{childList:true,subtree:true});
        const syncName=()=>{document.querySelector('.brand-name').textContent=name.value||'未命名项目';};name.addEventListener('input',syncName);syncName();
        for(const [id,icon] of [['zoom-out-btn','minus'],['zoom-in-btn','plus'],['zoom-reset-btn','rotate-ccw'],['fit-canvas-btn','focus'],['stop-generation-btn','square']])this.buttonIcon(document.getElementById(id),icon);
        this.installMenus();
        document.addEventListener('click',()=>{this.layout();syncName();});
        window.addEventListener('resize',()=>this.layout());
        document.addEventListener('keydown',(event)=>{const edit=event.target.closest('input,textarea,select,[contenteditable]');if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();this.openSearch();}if(event.key==='Escape'){document.querySelector('.project-toolbar').classList.remove('is-open');document.getElementById('asset-panel').hidden=true;}if(!edit&&!document.querySelector('dialog[open]')&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();Workspace.save();}if(event.key==='Tab'&&document.getElementById('nodeMenu').style.display==='block'){const buttons=[...document.querySelectorAll('#nodeMenu button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(index===buttons.length-1&&!event.shiftKey){event.preventDefault();buttons[0].focus();}}});
        const mouseup=window.onmouseup;window.onmouseup=(event)=>{if(State.view?.snap&&Interaction.dragMoved){for(const n of Interaction.dragNodes.length?Interaction.dragNodes:Interaction.dragNode?[Interaction.dragNode]:[]){n.x=Math.round(n.x/24)*24;n.y=Math.round(n.y/24)*24;Interaction.movedNodes.add(n);}Interaction.requestRender({lines:true});}mouseup?.(event);this.layout();};
        this.installLinkDrag();
        this.installTouch();
        const oldSelect=Interaction.selectNodeModel.bind(Interaction);Interaction.selectNodeModel=(node,id)=>{oldSelect(node,id);node.querySelector('.model-switch').textContent=getModelMeta(node.dataset.model,node.dataset.nodeType).label;this.configureNode(node);this.layout();};
        const oldReferences=Interaction.renderReferences.bind(Interaction);Interaction.renderReferences=(node)=>{oldReferences(node);node.querySelectorAll('.ref-item').forEach((el)=>{el.tabIndex=0;el.setAttribute('aria-label','参考素材，聚焦后可设置主参考和排序');});this.layout();};
        const wait=()=>{if(!Workspace.ready){if(document.body.classList.contains('workspace-loading'))setTimeout(wait,50);return;}this.onRestore();syncName();};wait();
    },
    installLinkDrag() {
        let drag=null,suppress=false;
        Interaction.cancelLinkDrag = () => { drag=null; suppress=false; };
        document.addEventListener('visibilitychange',()=>{if(document.hidden)Interaction.stopLinking();});
        document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&(drag||State.linking.active||Interaction.connectorPressEl))Interaction.stopLinking();},true);
        document.addEventListener('mousedown',(event)=>{const c=event.target.closest('.connector');if(c&&event.button===0)drag={c,x:event.clientX,y:event.clientY,active:false};},true);
        document.addEventListener('mousemove',(event)=>{if(!drag||!(event.buttons&1))return;if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6){drag.active=true;clearTimeout(Interaction.connectorPressTimer);Interaction.closeNodeMenu();State.linking={active:true,startEl:drag.c};document.body.classList.add('is-linking');}if(drag.active){Interaction.mouseScreen={x:event.clientX,y:event.clientY};Interaction.requestRender({tempLine:true});}},true);
        document.addEventListener('mouseup',(event)=>{
            if(!drag?.active){drag=null;return;}
            const start=drag.c,hit=document.elementFromPoint(event.clientX,event.clientY),viewport=document.getElementById('viewport');
            let createAtDrop=false;
            if(hit&&viewport.contains(hit)){
                const connector=hit.closest('.connector'),node=hit.closest('.node');
                const control=hit.closest('button,input,textarea,select,a[href],.ai-panel');
                const readonlyText=control?.matches('textarea.text-node-input[readonly]')&&!hit.closest('.ai-panel');
                if(connector)Interaction.completeLink(connector);
                else if(node&&(!control||readonlyText)){
                    Interaction.completeLink(node.querySelector(start.classList.contains('conn-right')?'.conn-left':'.conn-right'));
                }else if(hit===viewport||hit.id==='canvas')createAtDrop=true;
                else if(node)Interaction.toast('请拖到节点主体或连接点', 'warn');
            }
            Interaction.stopLinking();
            if(createAtDrop)Interaction.openNodeMenuAt(event.clientX,event.clientY,start,{fromDrop:true});
            suppress=true;
        },true);
        document.addEventListener('click',(event)=>{if(suppress){suppress=false;event.stopImmediatePropagation();event.preventDefault();}},true);
    },
    installTouch() {
        const viewport=document.getElementById('viewport'),points=new Map();let gesture=null;
        const commit=()=>{Interaction.flushNodePositions();if(gesture?.before&&gesture.moved)Interaction.pushCommand(gesture.before,Interaction.captureScene());};
        const pinch=()=>{const [a,b]=[...points.values()];return {distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
        viewport.addEventListener('pointerdown',(e)=>{
            if(e.pointerType!=='touch'||e.target.closest('button,input,textarea,select,video,audio,.ai-panel'))return;
            e.preventDefault();Interaction.stopInertia();points.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture?.(e.pointerId);
            Interaction.touchActive=true; Interaction.setManipulating(true);
            if(points.size===2){commit();gesture={mode:'pinch',...pinch()};return;}
            if(points.size!==1)return;
            const node=e.target.closest('.node');
            if(node){const group=Interaction.getSelectedNodeElements();if(!group.includes(node)){Interaction.clearMultiSelection();Interaction.deselect();State.selection={type:'node',item:node};node.classList.add('selected');}const selected=new Set(Interaction.getSelectedNodeElements());gesture={mode:'nodes',x:e.clientX,y:e.clientY,before:Interaction.captureScene(),nodes:State.nodes.filter((n)=>selected.has(n.el))};}
            else{gesture={mode:'pan',x:e.clientX,y:e.clientY,moved:false};}
            Creative.layout();
        });
        viewport.addEventListener('pointermove',(e)=>{
            if(!points.has(e.pointerId)||!gesture)return;e.preventDefault();points.set(e.pointerId,{x:e.clientX,y:e.clientY});
            if(gesture.mode==='pinch'&&points.size>=2){const next=pinch();Interaction.zoomAt(gesture.x,gesture.y,next.distance/gesture.distance);const divisor=SUPPORTS_CSS_ZOOM?State.canvas.scale:1;State.canvas.x+=(next.x-gesture.x)/divisor;State.canvas.y+=(next.y-gesture.y)/divisor;gesture={mode:'pinch',...next};Interaction.requestRender({canvas:true});return;}
            const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture.x=e.clientX;gesture.y=e.clientY;
            if(gesture.mode==='nodes'){for(const n of gesture.nodes)Interaction.moveNode(n,dx/State.canvas.scale,dy/State.canvas.scale);gesture.moved ||= !!(dx||dy);Interaction.requestRender({lines:true,nodePositions:true});}
            else{const divisor=SUPPORTS_CSS_ZOOM?State.canvas.scale:1;State.canvas.x+=dx/divisor;State.canvas.y+=dy/divisor;gesture.moved ||= !!(dx||dy);Interaction.requestRender({canvas:true});}
        });
        const end=(e)=>{if(!points.has(e.pointerId))return;commit();if(gesture?.mode==='pan'&&!gesture.moved&&points.size===1&&e.type!=='pointercancel'){Interaction.clearMultiSelection();Interaction.deselect();}points.delete(e.pointerId);if(points.size===1){const p=[...points.values()][0];gesture={mode:'pan',...p,moved:true};}else gesture=null;Interaction.touchActive=points.size>0;Interaction.setManipulating(points.size>0);Creative.layout();};
        viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
    }
};
Creative.init();
