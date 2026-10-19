/* Pointer feedback is visual only: graph anchors and hit targets stay stable. */
window.CanvasMotion = {
    active: new Set(), node: null, button: null, frame: null, pointer: null,
    connectors: new Map(), motionFrame: null, motionTime: null,
    controls: 'button:not(:disabled):not(.connector):not(.menu-item):not(.model-item):not(.ratio-item)',
    reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)'),
    reset() {
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.motionFrame) cancelAnimationFrame(this.motionFrame);
        this.frame = null;
        this.motionFrame = null; this.motionTime = null; this.connectors.clear();
        for (const el of this.active) {
            el.classList.remove('is-magnetic');
            el.style.removeProperty('--mag-x'); el.style.removeProperty('--mag-y');
            el.style.removeProperty('--pointer-x'); el.style.removeProperty('--pointer-y');
        }
        this.active.clear(); this.node = null; this.button = null;
    },
    animateConnectors(now) {
        this.motionFrame = null;
        // Paint the glyph and its hit area together. Nested CSS transform
        // transitions can keep compositing old positions while the camera moves.
        const dt = this.motionTime === null ? 16 : Math.min(32, Math.max(0, now - this.motionTime));
        this.motionTime = now;
        let moving = false;
        for (const [el, p] of this.connectors) {
            if (!el.isConnected) { this.connectors.delete(el); this.active.delete(el); continue; }
            const amount = 1 - Math.exp(-dt / (p.returning ? 65 : 32));
            p.x += (p.tx - p.x) * amount; p.y += (p.ty - p.y) * amount;
            const settled = Math.hypot(p.tx - p.x, p.ty - p.y) * State.canvas.scale < .15;
            if (settled) { p.x = p.tx; p.y = p.ty; }
            const snap = value => Engine.snapToDevicePixel(value * State.canvas.scale) / State.canvas.scale;
            el.style.setProperty('--mag-x', `${snap(p.x)}px`);
            el.style.setProperty('--mag-y', `${snap(p.y)}px`);
            if (settled && p.returning) {
                el.classList.remove('is-magnetic');
                el.style.removeProperty('--mag-x'); el.style.removeProperty('--mag-y');
                this.connectors.delete(el); this.active.delete(el);
            } else if (!settled) moving = true;
        }
        if (moving) this.motionFrame = requestAnimationFrame(time => this.animateConnectors(time));
        else this.motionTime = null;
    },
    update() {
        this.frame = null;
        if (this.reduced?.matches || !this.pointer || Interaction.isPanning || Interaction.dragNode || Interaction.dragNodes.length || Interaction.touchActive || State.linking.active) return this.reset();
        const { x, y } = this.pointer, next = new Set(), writes = [];
        // Read only the hovered control and two nearby connectors, never the graph.
        if (this.node?.isConnected) for (const el of this.node.querySelectorAll('.connector')) {
            const r = el.getBoundingClientRect(), dx = x - r.left - r.width / 2, dy = y - r.top - r.height / 2;
            const distance = Math.hypot(dx, dy), radius = 105;
            if (distance >= radius) continue;
            const strength = Math.min(1, (radius - distance) / 40), scale = State.canvas.scale;
            const mx = Math.round(Math.max(-28, Math.min(28, dx * .45 * strength))), my = Math.round(Math.max(-28, Math.min(28, dy * .45 * strength)));
            writes.push([el, mx / scale, my / scale, null, null]); next.add(el);
        }
        if (this.button?.isConnected && !this.button.disabled) {
            const el = this.button, r = el.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                const scale = el.closest('#canvas') && el.closest('.ai-panel')?.dataset.screenOverlay !== 'true' ? State.canvas.scale : 1;
                writes.push([el, Math.round(Math.max(-4,Math.min(4,(x-r.left-r.width/2)*.14)))/scale, Math.round(Math.max(-4,Math.min(4,(y-r.top-r.height/2)*.14)))/scale, x-r.left, y-r.top]); next.add(el);
            }
        }
        for (const el of this.active) if (!next.has(el)) {
            if (this.connectors.has(el)) {
                const p = this.connectors.get(el); p.tx = 0; p.ty = 0; p.returning = true;
                next.add(el); continue;
            }
            el.classList.remove('is-magnetic'); el.style.removeProperty('--mag-x'); el.style.removeProperty('--mag-y');
            el.style.removeProperty('--pointer-x'); el.style.removeProperty('--pointer-y');
        }
        for (const [el,mx,my,px,py] of writes) {
            if (el.classList.contains('connector')) {
                const p = this.connectors.get(el) || { x:0, y:0 };
                Object.assign(p, { tx:mx, ty:my, returning:false }); this.connectors.set(el, p);
            } else {
                el.style.setProperty('--mag-x', `${mx}px`); el.style.setProperty('--mag-y', `${my}px`);
            }
            if (px !== null) { el.style.setProperty('--pointer-x', `${px}px`); el.style.setProperty('--pointer-y', `${py}px`); }
            el.classList.add('is-magnetic');
        }
        this.active = next;
        if (this.connectors.size && !this.motionFrame) this.motionFrame = requestAnimationFrame(time => this.animateConnectors(time));
    },
    init() {
        const track = (e) => {
            if (e.pointerType === 'touch' || e.buttons || this.reduced?.matches) return this.reset();
            this.pointer = { x:e.clientX, y:e.clientY };
            this.node = e.target.closest('.node') || this.node;
            this.button = e.target.closest(this.controls);
            if (!this.frame) this.frame = requestAnimationFrame(() => this.update());
        };
        document.addEventListener('pointermove', track, { passive:true });
        document.addEventListener('pointerup', track, { passive:true });
        document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) this.reset(); });
        // Keep the displaced hit area frozen between press and release so a
        // click on the visible glyph cannot turn into a click on the canvas.
        document.addEventListener('pointerdown', () => {
            if (this.frame) cancelAnimationFrame(this.frame);
            if (this.motionFrame) cancelAnimationFrame(this.motionFrame);
            this.frame = null; this.motionFrame = null; this.motionTime = null;
        }, { passive:true });
        document.addEventListener('keydown', () => this.reset());
        window.addEventListener('blur', () => this.reset());
        window.addEventListener('resize', () => this.reset());
        this.reduced?.addEventListener('change', () => this.reset());
    }
};
CanvasMotion.init();
