/* Screenshot-led shell integration; all creation uses existing reversible graph commands. */
window.Workbench = {
    menu: null, trigger: null, suggestionSet: 0,
    suggestions: [
        [
            ['帮我按我的风格继续创作', '贴近我的画面气质和语言节奏推进。', '结合当前画布的画面气质、语言节奏与已有内容，归纳我的创作风格，并提出下一步可执行的创作建议。'],
            ['根据我的偏好创建专属 Skill', '按我的创作偏好设计专属 Skill 方向。', '根据当前画布总结我的创作偏好，起草一份可复用的创作 Skill：包括适用场景、输入、风格约束、操作步骤和完成标准。先给出草稿供我确认。']
        ],
        [
            ['梳理这个项目的创作脉络', '整理想法、素材、风格变化和下一步。', '梳理当前画布的创作脉络：已有想法、素材、角色、视觉风格和缺口，并给出下一步优先级。'],
            ['为这个想法设计一组分镜', '把故事拆成可以继续创作的镜头。', '结合当前画布，把创意整理成一组分镜草案。写出每个镜头的景别、主体、构图、光线和运动，先供我确认。']
        ]
    ],
    init() {
        window.CanvasIcons?.render();
        const $ = id => document.getElementById(id);
        this.installCanvasList();
        this.installComposer();
        this.makeMenu('conversation-menu', '对话列表');
        this.makeMenu('agent-more-menu', '助手操作');
        this.makeMenu('agent-tools-menu', '创作设置');
        this.installProfileMenu();
        $('chat-list-btn').onclick = () => { this.renderConversationMenu(); this.toggleMenu($('chat-list-btn'), $('conversation-menu')); };
        $('agent-more-btn').onclick = () => {
            this.fillMenu($('agent-more-menu'), '助手操作', [
                ['生成历史', () => Interaction.toggleRailPopup('history'), 'history'],
                ['服务设置', () => Workspace.openSettings(), 'plug'],
                ['收起助手', () => Interaction.setAgentPanelOpen(false), 'x']
            ]);
            this.toggleMenu($('agent-more-btn'), $('agent-more-menu'));
        };
        $('agent-tools-btn').onclick = () => {
            this.fillMenu($('agent-tools-menu'), '创作设置', [
                ['引用画布节点', () => Creative.openSearch('context'), 'plus'],
                ['图片编辑器', () => Interaction.toggleRailPopup('editor'), 'sliders-horizontal'],
                ['停止等待生成', () => $('stop-generation-btn').click(), 'square'],
                ['缩放到 100%', () => Interaction.setScaleByPercent(100), 'focus'],
                ['服务与模型设置', () => Workspace.openSettings(), 'plug']
            ]);
            this.toggleMenu($('agent-tools-btn'), $('agent-tools-menu'), true);
        };
        document.querySelector('.agent-header-actions .agent-icon-btn').onclick = () => this.newConversation();
        const render = Creative.renderConversations.bind(Creative);
        Creative.renderConversations = (...args) => { const result = render(...args); this.resizeComposer(); if (!$('conversation-menu').hidden) this.renderConversationMenu(); return result; };
        const view = Creative.applyView.bind(Creative);
        Creative.applyView = (...args) => { const result = view(...args); this.syncViewButtons(); return result; };
        const updateCanvas = UI.updateCanvas.bind(UI);
        UI.updateCanvas = (...args) => { const result = updateCanvas(...args); this.syncGrid(); return result; };
        const loadConfig = Workspace.loadConfig.bind(Workspace);
        Workspace.loadConfig = async (...args) => { const result = await loadConfig(...args); this.updateModelCount(); return result; };
        const togglePanel = Interaction.setAgentPanelOpen.bind(Interaction);
        Interaction.setAgentPanelOpen = open => {
            togglePanel(open);
            $('rail-agent-btn').setAttribute('aria-expanded', String(open));
            $('agent-fab').setAttribute('aria-expanded', String(open));
            if (!open) { this.closeMenu(); document.body.classList.remove('agent-fullscreen'); }
            try { localStorage.setItem('canvas.ui.agent-open', String(open)); } catch {}
        };
        let preference;
        try { preference = localStorage.getItem('canvas.ui.agent-open'); } catch {}
        Interaction.setAgentPanelOpen(!Workspace.landingEntry && preference === 'true');
        const fullscreen = $('agent-fullscreen').onclick;
        $('agent-fullscreen').onclick = event => {
            fullscreen?.(event);
            const active = document.body.classList.contains('agent-fullscreen');
            $('agent-fullscreen').setAttribute('aria-pressed', String(active));
            $('agent-fullscreen').setAttribute('aria-label', active ? '退出 Agent 全屏' : 'Agent 全屏');
        };
        $('agent-context-mode').onclick = () => {
            Creative.manualContext = !Creative.manualContext;
            if (Creative.manualContext) Creative.contextIds = new Set(Interaction.getSelectedNodeElements().map(node => node.dataset.nodeId));
            Creative.contextSignature = ''; Creative.updateContext();
            $('agent-context-mode').setAttribute('aria-pressed', String(Creative.manualContext));
            $('agent-context-mode').title = Creative.manualContext ? '只引用手动选择的节点' : '自动引用当前画布，回复由你确认后加入';
            Interaction.toast(Creative.manualContext ? '已切换为手动选择上下文，可点击加号引用节点' : '已恢复自动引用画布', 'info');
        };
        $('refresh-suggestions').onclick = () => { this.suggestionSet = (this.suggestionSet + 1) % this.suggestions.length; this.renderSuggestions(); };
        this.renderSuggestions();
        document.querySelectorAll('[data-quick]').forEach(button => { button.onclick = () => this.quickCreate(button.dataset.quick); });
        $('model-overview-btn').onclick = () => Workspace.openSettings();
        $('community-btn').onclick = () => this.openCommunity();
        $('agent-voice-btn').onclick = () => {
            document.querySelector('.agent-input').focus();
            Interaction.toast('可按 Win + H 使用系统语音听写，在输入框中口述创作需求。', 'info', 5500);
        };
        $('zoom-slider').addEventListener('input', () => { $('zoom-slider').title = `缩放 ${$('zoom-slider').value}%`; });
        document.addEventListener('pointerdown', event => {
            if (this.menu && !this.menu.contains(event.target) && !this.trigger?.contains(event.target)) this.closeMenu();
        });
        document.addEventListener('keydown', event => {
            if (!this.menu) return;
            if (event.key === 'Escape') { const trigger = this.trigger; this.closeMenu(); trigger?.focus({ preventScroll: true }); event.preventDefault(); return; }
            if (!this.menu.contains(event.target)) return;
            if (event.key === 'Tab') { this.closeMenu(); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = [...this.menu.querySelectorAll('button:not(:disabled),a[href]')];
            const index = items.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus({ preventScroll: true });
        });
        window.addEventListener('resize', () => this.closeMenu());
        this.updateModelCount(); this.syncViewButtons(); this.syncGrid();
    },
    installProfileMenu() {
        const trigger = document.getElementById('rail-profile-btn'), menu = this.makeMenu('profile-menu', '个人菜单');
        trigger.setAttribute('aria-label', '个人菜单'); trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-controls', menu.id); trigger.setAttribute('aria-expanded', 'false');
        this.fillMenu(menu, '个人菜单', [['服务设置与访问密码', () => Workspace.openSettings(), 'settings-2']]);
        const link = document.createElement('a'); link.href = '/zh-CN/login'; link.className = 'login-page-entry'; link.role = 'menuitem';
        link.appendChild(Creative.icon('arrow-right')); link.appendChild(document.createTextNode('返回登录首页'));
        menu.insertBefore(link, menu.querySelector('button'));
        trigger.onclick = () => {
            this.toggleMenu(trigger, menu, true);
            if (!menu.hidden) menu.style.left = `${Math.max(12, Math.min(innerWidth - menu.offsetWidth - 12, trigger.getBoundingClientRect().right + 12))}px`;
        };
        document.querySelectorAll('.login-page-entry').forEach(entry => entry.addEventListener('click', async event => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); if (this.returningToLogin) return;
            this.returningToLogin = true; entry.setAttribute('aria-disabled', 'true');
            try { await Creative.flushProject(); location.assign(entry.href); }
            catch (error) { Interaction.toast(error.message || '画布尚未保存，请重试', 'error'); }
            finally { this.returningToLogin = false; entry.removeAttribute('aria-disabled'); }
        }));
    },
    installComposer() {
        const input = document.querySelector('.agent-input'), button = document.getElementById('agent-send-btn');
        const setBusy = Interaction.setAgentBusy.bind(Interaction);
        Interaction.setAgentBusy = busy => {
            setBusy(busy);
            button.disabled = false;
            button.dataset.mode = busy ? 'stop' : 'send';
            button.setAttribute('aria-label', busy ? '停止 Agent 回复' : '发送给 Agent');
            button.title = busy ? '停止等待回复' : '发送 · Enter；换行 · Shift+Enter';
            document.getElementById('chat-messages').setAttribute('aria-busy', String(busy));
            Creative.buttonIcon(button, busy ? 'square' : 'arrow-up');
            this.resizeComposer();
        };
        button.onclick = () => {
            const controller = Workspace.pending.get('agent');
            if (controller) {
                if (!controller.signal.aborted) {
                    controller.abort();
                    button.disabled = true;
                    button.setAttribute('aria-label', '正在停止 Agent 回复');
                    Interaction.setAgentStatus('正在停止等待…', 'busy');
                }
                return;
            }
            Interaction.submitAgentInput();
        };
        input.onkeydown = event => {
            if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat) return;
            event.preventDefault(); event.stopPropagation();
            if (!Workspace.pending.has('agent')) Interaction.submitAgentInput();
        };
        input.onfocus = () => {
            if (!Workspace.pending.has('agent')) Interaction.setAgentStatus('Enter 发送，Shift+Enter 换行', 'info');
        };
        input.addEventListener('input', () => this.resizeComposer());
        this.resizeComposer();
    },
    resizeComposer() {
        const input = document.querySelector('.agent-input');
        input.style.height = '62px';
        input.style.height = `${Math.max(62, Math.min(160, input.scrollHeight))}px`;
        input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
    },
    installCanvasList() {
        const panel = document.querySelector('.project-toolbar'), toggle = document.getElementById('project-menu-toggle');
        const search = document.getElementById('canvas-search-input');
        const original = toggle.onclick;
        const close = () => { Creative.floating(panel, false); panel.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };
        this.closeCanvasList = close;
        toggle.onclick = async event => {
            original(event);
            if (!panel.classList.contains('is-open')) return;
            search.value = ''; this.canvasProjects = null; this.renderCanvasList(); search.focus({ preventScroll:true });
            try {
                await Creative.flushProject();
                const projects = await ProjectStore.listProjects();
                this.canvasProjects = projects; this.renderCanvasList();
            } catch (error) {
                if (panel.classList.contains('is-open')) document.getElementById('canvas-project-list').textContent = error.message;
            }
        };
        search.oninput = () => this.renderCanvasList();
        panel.addEventListener('keydown', event => {
            if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || (event.target === search && !['ArrowDown','ArrowUp'].includes(event.key))) return;
            const buttons = [...panel.querySelectorAll('.canvas-project-row:not(:disabled),.canvas-list-footer button')];
            const index = buttons.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            event.preventDefault(); buttons[next]?.focus({ preventScroll:true }); buttons[next]?.scrollIntoView?.({ block:'nearest' });
        });
        document.getElementById('canvas-create-btn').onclick = async () => {
            if (this.canvasBusy) return;
            this.canvasBusy = true; close();
            try { await Creative.newProject(); } finally { this.canvasBusy = false; }
        };
        document.getElementById('canvas-manage-btn').onclick = () => { close(); document.getElementById('project-settings-dialog').showModal(); };
        document.getElementById('project-switcher-btn').onclick = () => {
            document.getElementById('project-settings-dialog').close(); if (!panel.classList.contains('is-open')) toggle.click();
        };
    },
    renderCanvasList() {
        const list = document.getElementById('canvas-project-list'); list.replaceChildren();
        if (!this.canvasProjects) { list.textContent = '正在读取画布…'; return; }
        const query = document.getElementById('canvas-search-input').value.trim().toLocaleLowerCase();
        const projects = this.canvasProjects.filter(project => project.name.toLocaleLowerCase().includes(query));
        if (!projects.length) { const empty = document.createElement('p'); empty.className = 'canvas-list-empty'; empty.textContent = query ? '没有找到画布' : '还没有保存的画布'; list.appendChild(empty); return; }
        for (const project of projects) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-project-row';
            button.dataset.projectId = project.id; button.setAttribute('aria-current', String(project.id === Workspace.projectId));
            const thumbnail = document.createElementNS('http://www.w3.org/2000/svg','svg'); thumbnail.classList.add('canvas-thumbnail'); thumbnail.setAttribute('viewBox','0 0 40 40'); thumbnail.setAttribute('aria-hidden','true');
            const preview = project.preview || [];
            const xs = preview.map(node => node.x), ys = preview.map(node => node.y);
            const left = Math.min(...xs), top = Math.min(...ys), span = Math.max(500, Math.max(...xs)-left+320, Math.max(...ys)-top+280);
            for (const node of preview) {
                const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
                for (const [key,value] of Object.entries({x:4+(node.x-left)/span*32,y:4+(node.y-top)/span*32,width:Math.max(4,250/span*32),height:Math.max(4,220/span*32),rx:2,fill:node.type==='text'?'#727b80':node.type==='video'?'#8a929b':'#728899'})) rect.setAttribute(key,String(value));
                thumbnail.appendChild(rect);
            }
            if (!preview.length) { const icon = Creative.icon('layout-list'); thumbnail.appendChild(icon); }
            const label = document.createElement('span'); label.className = 'canvas-project-name'; label.textContent = project.name;
            button.append(thumbnail,label);
            if (project.id === Workspace.projectId) button.appendChild(Creative.icon('check'));
            button.onclick = async () => {
                if (this.canvasBusy) return;
                this.canvasBusy = true; button.disabled = true;
                try { await Creative.switchProject(project.id); this.closeCanvasList(); document.getElementById('project-menu-toggle').focus({preventScroll:true}); }
                catch (error) { button.disabled = false; Interaction.toast(error.message,'error',5000); }
                finally { this.canvasBusy = false; }
            };
            list.appendChild(button);
        }
    },
    makeMenu(id, label) {
        const menu = document.createElement('section'); menu.id = id; menu.className = 'workbench-menu'; menu.hidden = true;
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label); document.body.appendChild(menu); return menu;
    },
    closeMenu() {
        if (this.menu) { Creative.floating(this.menu, false); this.menu.hidden = true; }
        this.trigger?.setAttribute('aria-expanded', 'false'); this.menu = null; this.trigger = null;
    },
    toggleMenu(trigger, menu, above = false) {
        if (this.menu === menu) return this.closeMenu();
        this.closeMenu(); Interaction.closeNodeMenu();
        this.menu = menu; this.trigger = trigger; menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
        Creative.floating(menu, true);
        const bounds = trigger.getBoundingClientRect();
        const left = Math.min(innerWidth - menu.offsetWidth - 12, Math.max(12, bounds.right - menu.offsetWidth));
        const top = above ? bounds.top - menu.offsetHeight - 8 : bounds.bottom + 8;
        menu.style.left = `${left}px`; menu.style.top = `${Math.max(12, Math.min(top, innerHeight - menu.offsetHeight - 12))}px`;
        menu.querySelector('button,a')?.focus({ preventScroll: true });
    },
    fillMenu(menu, title, rows) {
        const heading = document.createElement('h3'); heading.textContent = title; menu.replaceChildren(heading);
        for (const [text, action, icon] of rows) {
            const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
            if (icon) button.appendChild(Creative.icon(icon)); const label = document.createElement('span'); label.textContent = text; button.appendChild(label);
            button.onclick = async () => { this.closeMenu(); try { await action(); } catch (error) { Interaction.toast(error.message, 'error'); } };
            menu.appendChild(button);
        }
    },
    newConversation() {
        State.conversations ||= [];
        if (State.conversations.length >= 20) return Interaction.toast('最多保留 20 个对话，请导出项目备份后再整理', 'warn');
        const chat = { id: `chat_${crypto.randomUUID()}`, name: '新建对话', messages: [] };
        State.conversations.push(chat); Creative.chatId = chat.id; Creative.renderConversations();
        document.querySelector('.agent-input').value = ''; this.resizeComposer(); this.closeMenu(); Workspace.scheduleSave();
        document.querySelector('.agent-input').focus();
    },
    renderConversationMenu() {
        const menu = document.getElementById('conversation-menu'), chat = Creative.activeConversation();
        this.fillMenu(menu, '对话列表', [
            ['创建新对话', () => this.newConversation(), 'square-pen'],
            ...State.conversations.map(item => [item.name, () => { Creative.chatId = item.id; Creative.renderConversations(); }, 'message-circle'])
        ]);
        [...menu.querySelectorAll('button')].slice(1).forEach((button, index) => button.setAttribute('aria-current', String(State.conversations[index].id === chat.id)));
    },
    renderSuggestions() {
        document.querySelectorAll('.agent-chip').forEach((button, index) => {
            const [title, description, prompt] = this.suggestions[this.suggestionSet][index];
            const strong = button.querySelector('strong');
            // Replace only the text between the library icons.
            [...strong.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
            strong.insertBefore(document.createTextNode(title), strong.querySelector('.suggestion-arrow'));
            button.querySelector('.suggestion-description').textContent = description;
            button.title = '填入创作需求，由你确认发送';
            button.onclick = () => { const input = document.querySelector('.agent-input'); input.value = prompt; this.resizeComposer(); input.focus(); };
        });
    },
    updateModelCount() {
        const models = Workspace.config?.models || [], count = models.filter(model => model.available).length;
        document.getElementById('available-model-count').textContent = `${count}`;
        document.getElementById('model-overview-btn').title = `本站已配置 ${count} 个可用模型，点击查看服务设置`;
    },
    syncViewButtons() {
        for (const [id, key] of [['hide-links-toggle', 'hideLinks'], ['snap-toggle', 'snap']]) document.getElementById(id).setAttribute('aria-pressed', String(!!State.view?.[key]));
    },
    syncGrid() {
        const scale = State.canvas.scale, step = 20 * scale;
        const factor = SUPPORTS_CSS_ZOOM ? scale : 1;
        const x = Math.round(State.canvas.x * factor) % step, y = Math.round(State.canvas.y * factor) % step;
        const signature = `${step}:${x}:${y}`;
        if (this.gridSignature === signature) return;
        this.gridSignature = signature;
        const viewport = document.getElementById('viewport');
        viewport.style.backgroundSize = `${step}px ${step}px`;
        viewport.style.backgroundPosition = `${x}px ${y}px`;
    },
    quickCreate(kind) {
        if (kind === 'template') return Workspace.openTemplate('storyboard');
        if (kind === 'audio-video') return this.openAudioWorkflow();
        if (!Workspace.ready) return Interaction.toast('请等待项目恢复完成', 'warn');
        const required = kind === 'first-frame' ? 2 : 1;
        if (State.nodes.length + required > ProjectStore.MAX_NODES) return Interaction.toast('画布节点已达容量上限，请新建画布', 'warn');
        if (kind === 'first-frame') {
            let image, video;
            const applied = Interaction.runSceneCommand({}, () => {
                const start = Engine.screenToCanvas(innerWidth * .2, innerHeight * .3), position = Creative.freePosition(start, 'image');
                image = UI.createNode('image', position, null, { nodeName: '首帧参考图' }); State.nodes.push({ el: image, ...position, type: 'image' });
                const next = Creative.freePosition({ x: position.x + 470, y: position.y }, 'video');
                video = UI.createNode('video', next, null, { nodeName: '首帧生视频' }); State.nodes.push({ el: video, ...next, type: 'video' });
                video.dataset.inputMode = 'first-frame'; Creative.configureNode(video);
                Interaction.createLinkBetween(image.querySelector('.conn-right'), video.querySelector('.conn-left'));
                Interaction.syncCanvasEmptyState();
            });
            if (applied) { Interaction.focusNode(image); Creative.layout(); Interaction.toast('上传首帧图片，再选择视频节点描述运动。生成前可检查模型与输入方式。', 'info', 5000); }
            return;
        }
        const imageMode = kind === 'background';
        const node = Creative.addNode(imageMode ? 'image' : 'video', null, imageMode ? '图片换背景' : '文字生视频');
        if (!node) return;
        const input = node.querySelector('.ai-input');
        if (input) input.placeholder = imageMode ? '上传参考图片，描述希望替换的新背景…' : '描述主体、场景和镜头运动…';
        if (imageMode) Interaction.toast('上传参考图片后，描述要替换的背景。', 'info');
    },
    openCommunity() {
        let dialog = document.getElementById('community-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id = 'community-dialog'; dialog.className = 'community-dialog'; dialog.setAttribute('aria-label', '项目社区');
            dialog.innerHTML = '<div class="dialog-header"><h2>项目社区</h2><button type="button" aria-label="关闭项目社区">关闭</button></div><p class="dialog-note">查看项目源码、使用说明，或在 GitHub 反馈问题。</p><div class="community-links"><a href="https://github.com/dcjrcjfc/infinite-canvas-aigc" target="_blank" rel="noopener noreferrer">项目源码</a><a href="https://github.com/dcjrcjfc/infinite-canvas-aigc/issues" target="_blank" rel="noopener noreferrer">问题反馈</a></div>';
            dialog.querySelector('button').onclick = () => dialog.close(); document.body.appendChild(dialog);
        }
        dialog.showModal();
    },
    openAudioWorkflow() {
        let dialog = document.getElementById('audio-workflow-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id = 'audio-workflow-dialog'; dialog.className = 'community-dialog'; dialog.setAttribute('aria-label', '音频与视频创作');
            dialog.innerHTML = '<div class="dialog-header"><h2>音频与视频创作</h2><button type="button" aria-label="关闭音频创作说明">关闭</button></div><p class="workbench-audio-note">上传音频和画面素材，在时间线里调整顺序、时长与音量，再预览并导出视频。</p><p class="dialog-note">目前支持音画合成；直接由音频驱动画面生成尚未接入。</p><button class="primary-action" type="button">打开时间线</button>';
            dialog.querySelector('.dialog-header button').onclick = () => dialog.close();
            dialog.querySelector('.primary-action').onclick = () => { dialog.close(); Timeline.open(); }; document.body.appendChild(dialog);
        }
        dialog.showModal();
    }
};
Workbench.init();
