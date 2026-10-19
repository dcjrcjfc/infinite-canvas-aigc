/* Selection tools and group frames use the same scene/history as nodes. */
window.CanvasLayout = {
    frames: new Map(),
    selected() {
        const elements = new Set(Interaction.getSelectedNodeElements());
        return State.nodes.filter(node => elements.has(node.el));
    },
    size(node) {
        return { width: node.el.offsetWidth || (['video', 'audio'].includes(node.type) ? 440 : node.type === 'scene' ? 320 : 250), height: node.el.offsetHeight || 290 };
    },
    bounds(nodes) {
        const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
        const right = Math.max(...nodes.map(n => n.x + this.size(n).width)), bottom = Math.max(...nodes.map(n => n.y + this.size(n).height));
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    },
    select(nodes) {
        Interaction.clearMultiSelection(); Interaction.deselect();
        if (nodes.length) {
            State.selection = { type: 'node', item: nodes[0].el }; nodes[0].el.classList.add('selected');
            if (nodes.length > 1) { State.multiSelection = nodes.map(n => n.el); nodes.forEach(n => n.el.classList.add('multi-selected')); }
        }
        Creative.layout();
    },
    command(text, mutate) {
        const result = Interaction.runSceneCommand({ historyType: 'node', historyText: text }, mutate);
        Interaction.flushNodePositions(); Interaction.requestRender({ lines: true }); Creative.layout();
        return result;
    },
    group() {
        const nodes = this.selected(); if (nodes.length < 2) return;
        const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        this.command(`创建分组 · ${nodes.length} 个节点`, () => nodes.forEach(n => { n.el.dataset.groupId = id; n.el.dataset.groupName = '未命名分组'; }));
    },
    ungroup() {
        const ids = new Set(this.selected().map(n => n.el.dataset.groupId).filter(Boolean)); if (!ids.size) return;
        this.command('取消分组', () => State.nodes.filter(n => ids.has(n.el.dataset.groupId)).forEach(n => { delete n.el.dataset.groupId; delete n.el.dataset.groupName; }));
    },
    duplicate() { Interaction.copySelectedNodes(); Interaction.pasteCopiedNodes(); Creative.layout(); },
    arrange(mode) {
        const nodes = this.selected(); if (nodes.length < 2) return;
        const b = this.bounds(nodes), targets = new Map();
        if (mode === 'grid') {
            const columns = Math.ceil(Math.sqrt(nodes.length)), gap = 80;
            const widths = Array(columns).fill(0), heights = [];
            nodes.forEach((n, i) => { widths[i % columns] = Math.max(widths[i % columns], this.size(n).width); const row = Math.floor(i / columns); heights[row] = Math.max(heights[row] || 0, this.size(n).height); });
            const offset = (sizes, index) => sizes.slice(0, index).reduce((sum, size) => sum + size + gap, 0);
            nodes.forEach((n, i) => targets.set(n, { x: b.left + offset(widths, i % columns), y: b.top + offset(heights, Math.floor(i / columns)) }));
        } else if (mode === 'tree') {
            const byId = new Map(nodes.map(n => [n.el.dataset.nodeId, n])), ranks = new Map(nodes.map(n => [n, 0]));
            const incoming = new Map(nodes.map(n => [n, 0])), outgoing = new Map(nodes.map(n => [n, []]));
            State.links.forEach(link => {
                const from = byId.get(link.fromEl.closest('.node')?.dataset.nodeId), to = byId.get(link.toEl.closest('.node')?.dataset.nodeId);
                if (from && to) { outgoing.get(from).push(to); incoming.set(to, incoming.get(to) + 1); }
            });
            const queue = nodes.filter(n => !incoming.get(n));
            for (let i = 0; i < queue.length; i++) {
                const n = queue[i]; outgoing.get(n).forEach(next => { ranks.set(next, Math.max(ranks.get(next), ranks.get(n) + 1)); incoming.set(next, incoming.get(next) - 1); if (!incoming.get(next)) queue.push(next); });
            }
            const columns = [];
            nodes.forEach(n => (columns[ranks.get(n)] ||= []).push(n));
            let x = b.left;
            for (const column of columns) {
                let y = b.top; for (const n of column) { targets.set(n, { x, y }); y += this.size(n).height + 100; }
                x += Math.max(...column.map(n => this.size(n).width)) + 180;
            }
        } else {
            const modes = {
                left: n => ({ x: b.left, y: n.y }), right: n => ({ x: b.right - this.size(n).width, y: n.y }),
                top: n => ({ x: n.x, y: b.top }), bottom: n => ({ x: n.x, y: b.bottom - this.size(n).height }),
                center: n => ({ x: b.left + (b.width - this.size(n).width) / 2, y: n.y }),
                middle: n => ({ x: n.x, y: b.top + (b.height - this.size(n).height) / 2 })
            };
            if (!modes[mode]) return; nodes.forEach(n => targets.set(n, modes[mode](n)));
        }
        this.command(mode === 'tree' ? '按连线整理' : mode === 'grid' ? '网格整理' : '对齐节点', () => targets.forEach((p, n) => Interaction.moveNode(n, p.x - n.x, p.y - n.y)));
    },
    rename(id, header) {
        if (header.querySelector('input')) return;
        const nodes = State.nodes.filter(n => n.el.dataset.groupId === id); if (!nodes.length) return;
        const previous = nodes[0].el.dataset.groupName || '未命名分组', input = document.createElement('input');
        input.value = previous; input.maxLength = 80; input.setAttribute('aria-label', '分组名称'); header.replaceChildren(input); input.focus(); input.select();
        let done = false;
        const finish = confirm => {
            if (done) return; done = true; const name = confirm ? input.value.trim() || previous : previous;
            header.textContent = previous;
            if (name !== previous) this.command('重命名分组', () => nodes.forEach(n => n.el.dataset.groupName = name));
            this.render();
        };
        input.addEventListener('mousedown', e => e.stopPropagation());
        input.onkeydown = e => { if (e.isComposing) return; if (['Enter', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(e.key === 'Enter'); header.focus(); } };
        input.onblur = () => finish(true);
    },
    startGroupDrag(event, id) {
        if (event.button !== 0 || Interaction.spaceHeld || event.target.closest('input')) return;
        event.preventDefault(); event.stopPropagation(); document.activeElement?.blur();
        const nodes = State.nodes.filter(n => n.el.dataset.groupId === id); this.select(nodes);
        Interaction.stopInertia(); Interaction.lastPointer = { x: event.clientX, y: event.clientY };
        Interaction.mouseScreen = { x: event.clientX, y: event.clientY };
        Interaction.setManipulating(true); Interaction.dragSceneBefore = Interaction.captureScene(); Interaction.dragMoved = false;
        Interaction.dragNode = null; Interaction.dragNodes = nodes; nodes.forEach(n => n.el.classList.add('dragging'));
    },
    render() {
        const groups = new Map();
        State.nodes.forEach(n => { const id = n.el.dataset.groupId; if (id) { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(n); } });
        for (const [id, frame] of this.frames) if (!groups.has(id)) { frame.remove(); this.frames.delete(id); }
        for (const [id, nodes] of groups) {
            let frame = this.frames.get(id);
            if (!frame) {
                frame = document.createElement('section'); frame.className = 'canvas-group'; frame.dataset.groupId = id;
                const header = document.createElement('div'); header.className = 'canvas-group-title'; header.tabIndex = 0; header.setAttribute('role', 'button'); header.title = '拖动分组 · 双击重命名';
                header.onmousedown = e => this.startGroupDrag(e, id);
                header.ondblclick = e => { e.preventDefault(); e.stopPropagation(); this.rename(id, header); };
                header.onkeydown = e => { if (e.target !== header || e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); this.rename(id, header); } if (e.key === ' ') { e.preventDefault(); this.select(State.nodes.filter(n => n.el.dataset.groupId === id)); } };
                frame.appendChild(header); document.getElementById('canvas').appendChild(frame); this.frames.set(id, frame);
            }
            const b = this.bounds(nodes); Object.assign(frame.style, { left: `${b.left - 28}px`, top: `${b.top - 46}px`, width: `${b.width + 56}px`, height: `${b.height + 74}px` });
            const header = frame.firstElementChild;
            if (!header.querySelector('input')) header.textContent = nodes[0].el.dataset.groupName || '未命名分组';
            header.setAttribute('aria-label', `分组：${nodes[0].el.dataset.groupName || '未命名分组'}，${nodes.length} 个节点`);
        }
        const nodes = this.selected(), show = nodes.length > 1; this.toolbar.hidden = !show; this.outline.hidden = !show;
        if (!show) return;
        const b = this.bounds(nodes); Object.assign(this.outline.style, { left: `${b.left - 12}px`, top: `${b.top - 12}px`, width: `${b.width + 24}px`, height: `${b.height + 24}px` });
        // Derive the overlay from the same camera transform instead of reading
        // every moved node's screen rectangle after writing group geometry.
        const scale = Engine.roundScale(State.canvas.scale), divisor = SUPPORTS_CSS_ZOOM ? scale : 1;
        const tx = Engine.snapToDevicePixel(State.canvas.x * divisor), ty = Engine.snapToDevicePixel(State.canvas.y * divisor);
        const left = b.left * scale + tx, right = b.right * scale + tx, top = b.top * scale + ty;
        const panelLeft = document.body.classList.contains('agent-open') ? document.querySelector('.agent-panel')?.getBoundingClientRect().left : innerWidth;
        const width = this.toolbar.offsetWidth || 500, limit = Math.max(96, (panelLeft || innerWidth) - width / 2 - 12);
        this.toolbar.style.left = `${Math.max(width / 2 + 12, Math.min(limit, (left + right) / 2))}px`;
        this.toolbar.style.top = `${Math.max(76, top - 64)}px`;
        this.toolbar.querySelector('[data-selection-count]').textContent = `${nodes.length} 个节点`;
        const groupIds = new Set(nodes.map(n => n.el.dataset.groupId));
        const complete = groupIds.size === 1 && !groupIds.has(undefined) && State.nodes.filter(n => n.el.dataset.groupId === nodes[0].el.dataset.groupId).length === nodes.length;
        this.toolbar.querySelector('[data-layout-action="group"]').hidden = complete;
        this.toolbar.querySelector('[data-layout-action="ungroup"]').hidden = !nodes.some(n => n.el.dataset.groupId);
    },
    menu(items, x, y) {
        this.closeMenu(); const menu = this.context; menu.replaceChildren();
        this.menuAnchor = this.toolbar.contains(document.activeElement) ? document.activeElement : document.getElementById('viewport');
        for (const [label, action, disabled] of items) {
            const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem'; button.textContent = label; button.disabled = !!disabled;
            button.onclick = () => { this.closeMenu(true); action(); }; menu.appendChild(button);
        }
        menu.hidden = false; Creative.floating(menu, true); menu.style.left = `${Math.max(8, Math.min(x, innerWidth - 220))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, innerHeight - (menu.offsetHeight || items.length * 34) - 8))}px`; menu.querySelector('button:not(:disabled)')?.focus();
    },
    closeMenu(restoreFocus = false) {
        if (!this.context) return;
        Creative.floating(this.context, false); this.context.hidden = true;
        if (restoreFocus) {
            const anchor = this.menuAnchor?.isConnected && !this.menuAnchor.closest('[hidden]') ? this.menuAnchor : document.getElementById('viewport');
            if (anchor.id === 'viewport') anchor.tabIndex = -1;
            anchor.focus({ preventScroll: true });
        }
    },
    init() {
        this.outline = document.createElement('div'); this.outline.className = 'canvas-selection-bounds'; this.outline.hidden = true; document.getElementById('canvas').appendChild(this.outline);
        this.toolbar = document.createElement('div'); this.toolbar.className = 'canvas-multi-tools'; this.toolbar.hidden = true; this.toolbar.role = 'toolbar'; this.toolbar.setAttribute('aria-label', '多选节点操作');
        this.toolbar.innerHTML = '<span data-selection-count></span><button data-layout-action="group">分组</button><button data-layout-action="ungroup" hidden>取消分组</button><button data-layout-action="align">对齐⌄</button><button data-layout-action="grid">网格整理</button><button data-layout-action="tree">按连线整理</button><button data-layout-action="duplicate" aria-label="复制所选节点" data-icon="copy"></button><button data-layout-action="delete" aria-label="删除所选节点" data-icon="trash-2"></button>';
        document.body.appendChild(this.toolbar); CanvasIcons.render(this.toolbar);
        this.toolbar.onmousedown = e => e.stopPropagation();
        this.toolbar.onclick = e => {
            const button = e.target.closest('[data-layout-action]'); if (!button) return;
            const action = button.dataset.layoutAction;
            if (action === 'align') { const r = button.getBoundingClientRect(); this.menu([['左对齐', 'left'], ['水平居中', 'center'], ['右对齐', 'right'], ['顶对齐', 'top'], ['垂直居中', 'middle'], ['底对齐', 'bottom']].map(([label, mode]) => [label, () => this.arrange(mode)]), r.left, r.bottom + 8); }
            else if (action === 'delete') Interaction.deleteSelected();
            else if (['grid', 'tree'].includes(action)) this.arrange(action);
            else this[action]?.();
            Creative.layout();
        };
        this.context = document.createElement('div'); this.context.className = 'canvas-command-menu'; this.context.role = 'menu'; this.context.setAttribute('aria-label', '画布操作'); this.context.hidden = true; document.body.appendChild(this.context);
        this.context.onmousedown = e => e.stopPropagation();
        this.context.onkeydown = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault(); const buttons = [...this.context.querySelectorAll('button:not(:disabled)')], current = buttons.indexOf(document.activeElement);
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length; buttons[next]?.focus();
            }
        };
        document.getElementById('viewport').addEventListener('contextmenu', e => {
            if (e.target.closest('input,textarea,select,[contenteditable="true"],.ai-panel')) { this.closeMenu(); return; }
            e.preventDefault(); const node = e.target.closest('.node'), group = e.target.closest('.canvas-group');
            if (node && !this.selected().some(n => n.el === node)) this.select(State.nodes.filter(n => n.el === node));
            if (group) this.select(State.nodes.filter(n => n.el.dataset.groupId === group.dataset.groupId));
            Interaction.closeNodeMenu();
            const selected = node || group;
            this.menu(selected ? [
                ['复制节点', () => Interaction.copySelectedNodes()], ['创建副本 · Ctrl+D', () => this.duplicate()],
                ['创建分组', () => this.group(), this.selected().length < 2], ['取消分组', () => this.ungroup(), !this.selected().some(n => n.el.dataset.groupId)],
                ['网格整理', () => this.arrange('grid'), this.selected().length < 2], ['按连线整理', () => this.arrange('tree'), this.selected().length < 2], ['删除', () => Interaction.deleteSelected()]
            ] : [
                ['添加节点…', () => Interaction.openNodeMenuAt(e.clientX, e.clientY, null)], ['粘贴节点', () => { Interaction.pasteCopiedNodes(); Creative.layout(); }, !State.clipboard?.nodes?.length],
                ['全选节点 · Ctrl+A', () => this.select(State.nodes), !State.nodes.length], ['撤销', () => Interaction.undo(), !State.undoStack.length], ['重做', () => Interaction.redo(), !State.redoStack.length]
            ], e.clientX, e.clientY);
        });
        document.addEventListener('mousedown', e => { if (!e.target.closest('.canvas-command-menu')) this.closeMenu(); });
        window.addEventListener('blur', () => this.closeMenu());
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.closeMenu();
            if (e.isComposing || e.repeat || document.querySelector('dialog[open]') || isCanvasShortcutControl(e.target) || isCanvasShortcutControl(document.activeElement) || !(e.ctrlKey || e.metaKey)) return;
            if (e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(State.nodes); }
            if (e.key.toLowerCase() === 'd') { e.preventDefault(); if (this.selected().length) this.duplicate(); }
            if (e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? this.ungroup() : this.group(); }
        });
        const layout = Creative.flushLayout.bind(Creative); Creative.flushLayout = (...args) => { layout(...args); this.render(); };
        this.render();
    }
};
CanvasLayout.init();
