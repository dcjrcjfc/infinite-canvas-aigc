/* Edge navigation shares the graph renderer's frame and coordinate conventions. */
window.CanvasNavigation = {
    gesture: null, touches: new Set(), lastTime: null, panned: false, listeners: [],
    edge: 48, speed: 600,
    listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this.listeners.push(() => target.removeEventListener(type, handler, options));
    },
    stop(clearTouches = false) {
        this.gesture = null; this.lastTime = null;
        if (clearTouches) this.touches.clear();
        if (this.panned) { this.panned = false; Interaction.queueSave(); }
    },
    active() {
        const gesture = this.gesture;
        if (!gesture?.moved || document.hidden || document.querySelector('dialog[open]') || Interaction.isPanning) return null;
        if (gesture.kind === 'touch') {
            if (!Interaction.touchActive || this.touches.size !== 1) return null;
            const nodes = gesture.nodes.filter(node => node.el.isConnected && State.nodes.includes(node));
            return nodes.length ? { nodes } : null;
        }
        const nodes = Interaction.dragNodes.length ? Interaction.dragNodes : Interaction.dragNode ? [Interaction.dragNode] : [];
        if (nodes.length) return { nodes };
        return State.linking.active && State.linking.startEl?.isConnected ? { nodes: [] } : null;
    },
    velocity() {
        const point = this.gesture?.point, viewport = document.getElementById('viewport');
        if (!point || !viewport) return { x: 0, y: 0 };
        const rect = viewport.getBoundingClientRect();
        const bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        if (document.body.classList.contains('agent-open')) {
            const panel = document.querySelector('.agent-panel')?.getBoundingClientRect();
            if (panel?.width > 0 && panel.left > bounds.left) bounds.right = Math.min(bounds.right, panel.left);
        }
        // An obscured sidebar or a pointer outside the viewport is not a canvas edge.
        if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return { x: 0, y: 0 };
        const axis = (position, low, high) => {
            const band = Math.min(this.edge, (high - low) / 3);
            if (band <= 0) return 0;
            if (position < low + band) return this.speed * ((low + band - position) / band) ** 2;
            if (position > high - band) return -this.speed * ((position - high + band) / band) ** 2;
            return 0;
        };
        return { x: axis(point.x, bounds.left, bounds.right), y: axis(point.y, bounds.top, bounds.bottom) };
    },
    wake() {
        if (!this.active()) return;
        const velocity = this.velocity();
        if (velocity.x || velocity.y) Interaction.requestRender({});
    },
    step(time) {
        const active = this.active();
        if (!active) { this.lastTime = null; return; }
        const velocity = this.velocity();
        if (!velocity.x && !velocity.y) { this.lastTime = null; return; }
        const dt = this.lastTime === null ? 1 / 60 : Math.min(.04, Math.max(0, (time - this.lastTime) / 1000));
        this.lastTime = time;
        const dx = velocity.x * dt, dy = velocity.y * dt, scale = State.canvas.scale;
        State.canvas.x += dx / (SUPPORTS_CSS_ZOOM ? scale : 1);
        State.canvas.y += dy / (SUPPORTS_CSS_ZOOM ? scale : 1);
        // Keep the grabbed point stationary on screen as the camera reveals more world space.
        for (const node of active.nodes) Interaction.moveNode(node, -dx / scale, -dy / scale);
        Interaction.dirtyCanvas = true; Interaction.dirtyTempLine = true;
        if (active.nodes.length) Interaction.dirtyLines = true;
        this.panned = true;
    },
    init() {
        this.previousBefore = Interaction.beforeCanvasFrame; this.previousAfter = Interaction.afterCanvasFrame;
        this.before = time => { this.previousBefore?.call(Interaction, time); this.step(time); };
        this.after = time => { this.previousAfter?.call(Interaction, time); this.wake(); };
        Interaction.beforeCanvasFrame = this.before; Interaction.afterCanvasFrame = this.after;
        this.listen(document, 'mousedown', event => {
            if (event.button !== 0 || Interaction.isPanning || Interaction.spaceHeld) return;
            const connector = event.target.closest('.connector');
            if (!connector && (!event.target.closest('.node,.canvas-group-title') || event.target.closest('button,input,textarea,select,video,audio,.ai-panel'))) return;
            this.stop();
            this.gesture = { kind: 'mouse', origin: { x: event.clientX, y: event.clientY }, point: { x: event.clientX, y: event.clientY }, moved: false };
        }, true);
        this.listen(document, 'mousemove', event => {
            if (this.gesture?.kind !== 'mouse') return;
            if (!(event.buttons & 1)) return this.stop();
            this.gesture.point = { x: event.clientX, y: event.clientY };
            this.gesture.moved ||= Math.hypot(event.clientX - this.gesture.origin.x, event.clientY - this.gesture.origin.y) > 2;
            this.wake();
        });
        this.listen(document, 'mouseup', () => this.stop(), true);
        this.listen(document, 'pointerdown', event => {
            if (event.pointerType !== 'touch') return;
            this.touches.add(event.pointerId);
            if (this.touches.size !== 1) return this.stop();
            const node = event.target.closest('.node');
            if (!node || event.target.closest('button,input,textarea,select,video,audio,.ai-panel') || !Interaction.touchActive) return;
            const selected = new Set(Interaction.getSelectedNodeElements());
            this.gesture = { kind: 'touch', id: event.pointerId, nodes: State.nodes.filter(item => selected.has(item.el)), origin: { x: event.clientX, y: event.clientY }, point: { x: event.clientX, y: event.clientY }, moved: false };
        });
        this.listen(document, 'pointermove', event => {
            if (this.gesture?.kind !== 'touch' || this.gesture.id !== event.pointerId) return;
            this.gesture.point = { x: event.clientX, y: event.clientY };
            this.gesture.moved ||= Math.hypot(event.clientX - this.gesture.origin.x, event.clientY - this.gesture.origin.y) > 2;
            this.wake();
        });
        const endPointer = event => {
            this.touches.delete(event.pointerId);
            if (event.pointerType !== 'touch' || this.gesture?.id === event.pointerId) this.stop();
        };
        this.listen(document, 'pointerup', endPointer, true);
        this.listen(document, 'pointercancel', endPointer, true);
        this.listen(document, 'lostpointercapture', endPointer, true);
        this.listen(window, 'blur', () => this.stop(true));
        this.listen(document, 'visibilitychange', () => { if (document.hidden) this.stop(true); });
        this.listen(document, 'keydown', event => { if (event.key === 'Escape') this.stop(true); }, true);
    },
    dispose() {
        this.stop(true); this.listeners.splice(0).forEach(remove => remove());
        if (Interaction.beforeCanvasFrame === this.before) Interaction.beforeCanvasFrame = this.previousBefore;
        if (Interaction.afterCanvasFrame === this.after) Interaction.afterCanvasFrame = this.previousAfter;
    }
};
CanvasNavigation.init();
