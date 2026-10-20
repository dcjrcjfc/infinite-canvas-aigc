const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..', '无限画布');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N2kAAAAASUVORK5CYII=';
async function app(t, full = false) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://localhost:8787', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; t.after(() => { clearTimeout(w.Workspace?.timer); dom.window.close(); });
    w.indexedDB = new IDBFactory(); w.structuredClone = structuredClone; w.CSS = { supports: () => true };
    w.CanvasIcons = { icon: () => w.document.createElement('span'), render() {} };
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.HTMLMediaElement.prototype.pause = function() {}; w.HTMLMediaElement.prototype.load = function() {};
    w.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; w.HTMLDialogElement.prototype.close = function() { this.open = false; };
    w.fetch = async () => new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } });
    const sources = ['project-store.js', 'script.js', 'workspace.js', 'creative.js', 'canvas-navigation.js', 'canvas-layout.js', 'workbench.js', 'motion.js', 'timeline.js'];
    if (full) sources.push('production.js', 'production-library.js', 'image-editor.js', 'shared-workspace.js');
    sources.push('productivity.js'); if (full) sources.push('production-boot.js');
    w.eval(sources.map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n') + '\nwindow.API={State,Interaction,UI,Engine,ProjectStore};');
    for (let i = 0; i < 100 && !w.Workspace.ready; i++) await new Promise(resolve => setTimeout(resolve, 5));
    w.Productivity.init();
    return { w, ...w.API, p: w.Productivity, node(type = 'text', x = 4500, y = 4500) { const el = w.API.UI.createNode(type, { x, y }, type === 'image' ? pixel : null); w.API.State.nodes.push({ el, x, y, type }); return el; } };
}
test('batch import isolates invalid and unreadable files and commits all valid assets in one undo', async t => {
    const a = await app(t);
    a.ProjectStore.fileDataUrl = async file => { if (file.name === 'broken.png') throw new Error('损坏'); return pixel; };
    const result = await a.p.importFiles([
        { name: 'one.png', type: 'image/png', size: 20 }, { name: 'virus.svg', type: 'image/svg+xml', size: 30 },
        { name: 'broken.png', type: 'image/png', size: 30 }, { name: 'two.png', type: 'image/png', size: 20 },
        { name: 'large.png', type: 'image/png', size: 101 * 1024 * 1024 }
    ], { x: 500, y: 600 });
    assert.equal(result.created, 2); assert.equal(a.State.nodes.length, 2); assert.equal(a.State.undoStack.length, 1);
    assert.equal(a.State.nodes[0].x, 500); assert.notEqual(a.State.nodes[0].x, a.State.nodes[1].x);
    assert.match(result.rows[1].status, /格式/); assert.match(result.rows[2].status, /损坏/); assert.match(result.rows[4].status, /100MB/);
    a.Interaction.undo(); assert.equal(a.State.nodes.length, 0); a.Interaction.redo(); assert.equal(a.State.nodes.length, 2);
});
test('switching project while reading cancels the entire pending import', async t => {
    const a = await app(t); let release;
    a.ProjectStore.fileDataUrl = () => new Promise(resolve => release = resolve);
    const pending = a.p.importFiles([{ name: 'one.png', type: 'image/png', size: 20 }]);
    a.w.Workspace.projectId = 'another-project'; release(pixel);
    const result = await pending;
    assert.equal(result.cancelled, true); assert.equal(a.State.nodes.length, 0); assert.equal(a.State.undoStack.length, 0);
    assert.match(result.rows[0].status, /取消/);
});
test('capacity filled during asynchronous read rejects excess assets without corrupting scene', async t => {
    const a = await app(t); const max = a.ProjectStore.MAX_NODES; a.ProjectStore.MAX_NODES = 2; let release;
    a.ProjectStore.fileDataUrl = () => new Promise(resolve => release = resolve);
    const pending = a.p.importFiles([{ name: 'one.png', type: 'image/png', size: 20 }]);
    a.node(); a.node(); release(pixel);
    const result = await pending; assert.equal(result.created, 0); assert.equal(a.State.nodes.length, 2);
    assert.match(result.rows[0].status, /容量/); a.ProjectStore.MAX_NODES = max;
});
test('clipboard image import does not intercept text editing, and global input keeps node replace path', async t => {
    const a = await app(t); let imports = 0; a.p.importFiles = async files => { imports += files.length; };
    const paste = target => { const event = new a.w.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({ name: 'pasted.png' }) }] } }); target.dispatchEvent(event); return event; };
    const input = a.w.document.querySelector('.agent-input'); assert.equal(paste(input).defaultPrevented, false); assert.equal(imports, 0);
    assert.equal(paste(a.w.document.getElementById('viewport')).defaultPrevented, true); assert.equal(imports, 1);
    const node = a.node('image'); a.ProjectStore.fileDataUrl = async () => pixel;
    a.State.uploadContext = { kind: 'node', node };
    await a.w.document.getElementById('file-input').onchange({ target: { files: [{ name: 'replacement.png', type: 'image/png', size: 10 }], value: 'selected' } });
    assert.equal(imports, 1); assert.equal(a.State.nodes.length, 1); assert.equal(node.dataset.nodeStatus, '已上传');
});
test('assistant context exposes separate locate and remove controls and resize is clamped and remembered', async t => {
    const a = await app(t), first = a.node('image'), second = a.node('text');
    a.w.Creative.manualContext = true; a.w.Creative.contextIds = new Set([first.dataset.nodeId, second.dataset.nodeId]); a.w.Creative.updateContext();
    const target = a.w.document.getElementById('agent-context'); assert.equal(target.querySelectorAll('.reference-object').length, 2); assert.equal(target.querySelectorAll('img').length, 1);
    target.querySelector('.reference-locate').click(); assert.equal(a.State.selection.item, first); assert.equal(a.w.Creative.contextIds.size, 2);
    target.querySelector('button[aria-label^="移除引用"]').click(); assert.equal(a.w.Creative.contextIds.size, 1);
    assert.equal(a.p.setAssistantWidth(99999), a.p.widthBounds().max); assert.equal(a.p.setAssistantWidth(-1), a.p.widthBounds().min);
    a.p.separator.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert.equal(a.p.assistantWidth, a.p.widthBounds().min + 16); assert.equal(Number(a.w.localStorage.getItem('canvas.ui.assistant-width')), a.p.assistantWidth);
});
test('note has no generation controls and main-cluster navigation excludes outlier and returns previous camera', async t => {
    const a = await app(t); const note = a.p.addNote({ x: 500, y: 500 });
    assert.equal(note._production.note, true); assert.equal(note.querySelector('.ai-panel'), null); assert.equal(note.querySelector('.connector').hidden, true);
    a.node('image', 850, 500); a.node('image', 20000, 20000);
    assert.equal(a.p.mainCluster().length, 2);
    const before = { ...a.State.canvas }; a.p.fit(a.p.mainCluster()); assert.notEqual(a.State.canvas.x, before.x); a.p.returnView();
    assert.deepEqual({ ...a.State.canvas }, before);
    a.p.updateVisibility(); assert.equal(a.State.nodes.at(-1).el.classList.contains('productivity-offscreen'), true);
    assert.equal(a.State.nodes.at(-1).el.querySelector('.connector').isConnected, true);
});
test('integrated production boot retains note metadata, clipboard controls and referenced-node focus through restore', async t => {
    const a = await app(t, true), note = a.p.addNote({ x: 600, y: 600 });
    const shot = a.w.ProductionLibrary.addShot('image');
    assert.equal(a.w.document.querySelectorAll('.assistant-resizer').length, 1);
    assert.ok(a.w.document.querySelector('.production-library-entry')); assert.ok(a.w.document.querySelector('.production-dock'));
    a.w.Creative.manualContext = true; a.w.Creative.contextIds = new Set([note.dataset.nodeId, shot.dataset.nodeId]); a.w.Creative.updateContext();
    const restored = a.ProjectStore.sceneOf(a.Interaction.captureScene()); a.Interaction.restoreScene(restored);
    const restoredNote = a.State.nodes.find(n => n.el._production?.note).el;
    assert.equal(restoredNote.querySelector('.ai-panel'), null); assert.equal(restoredNote.querySelector('.connector').hidden, true);
    assert.equal(a.w.ProductionLibrary.rows().length, 1);
    a.w.document.querySelector('.reference-locate').click(); assert.equal(a.State.selection.item, restoredNote);
    const key = new a.w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    a.w.document.getElementById('viewport').dispatchEvent(key); assert.equal(key.defaultPrevented, false);
    const dialog = a.w.document.querySelector('.production-library-dialog'); dialog.showModal();
    let imports = 0; a.p.importFiles = async () => imports++;
    const paste = new a.w.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({}) }] } });
    a.w.document.body.dispatchEvent(paste); assert.equal(imports, 0); assert.equal(paste.defaultPrevented, false); dialog.close();
    clearTimeout(a.w.Production.refreshTimer);
});
test('offscreen virtualization preserves selected, focused and connected node geometry and pauses media once', async t => {
    const a = await app(t), distant = a.node('video', 20000, 20000), media = distant.querySelector('video') || a.w.document.createElement('video');
    distant.querySelector('.media-container').appendChild(media); Object.defineProperty(media, 'paused', { value: false, writable: true });
    let pauses = 0; media.pause = () => { pauses++; media.paused = true; };
    const connector = distant.querySelector('.connector'), left = distant.style.left;
    a.p.updateVisibility(); a.p.updateVisibility(); assert.equal(pauses, 1); assert.equal(distant.style.left, left); assert.equal(connector.isConnected, true);
    a.State.multiSelection = [distant]; a.p.updateVisibility(); assert.equal(distant.classList.contains('productivity-offscreen'), false);
    a.State.multiSelection = []; a.p.updateVisibility(); assert.equal(distant.classList.contains('productivity-offscreen'), true);
    connector.focus(); a.p.updateVisibility(); assert.equal(distant.classList.contains('productivity-offscreen'), false);
});
test('100 and 300 node DOM management benchmark (not rendered frame rate)', async t => {
    const a = await app(t), results = [];
    Object.assign(a.State.canvas, { x: 0, y: 0, scale: 1 });
    const baselineScan = () => {
        const start = a.Engine.screenToCanvas(-180, -180), end = a.Engine.screenToCanvas(a.w.innerWidth + 180, a.w.innerHeight + 180);
        for (const n of a.State.nodes) {
            const offscreen = n.x + 500 < start.x || n.y + 500 < start.y || n.x > end.x || n.y > end.y;
            if (n.el.classList.contains('productivity-offscreen') !== offscreen) n.el.classList.toggle('productivity-offscreen', offscreen);
            if (offscreen) for (const media of n.el.querySelectorAll('video,audio')) if (!media.paused) media.pause();
        }
    };
    for (const count of [100, 300]) {
        a.State.nodes.forEach(n => n.el.remove()); a.State.nodes = [];
        for (let i = 0; i < count; i++) {
            const node = a.w.document.createElement('div'); node.className = 'node'; node.innerHTML = '<div class="node-box"><div class="media-container"><video></video></div></div><button class="connector"></button>';
            a.w.document.getElementById('canvas').appendChild(node); a.State.nodes.push({ el: node, type: 'video', x: i % 8 * 350, y: Math.floor(i / 8) * 350 });
        }
        baselineScan(); a.p.updateVisibility();
        const iterations = 120, before = performance.now(); for (let i = 0; i < iterations; i++) baselineScan(); const baselineMs = (performance.now() - before) / iterations;
        const after = performance.now(); for (let i = 0; i < iterations; i++) a.p.updateVisibility(); const optimizedMs = (performance.now() - after) / iterations;
        const visible = a.State.nodes.filter(n => !n.el.classList.contains('productivity-offscreen')).length;
        results.push({ nodes: count, beforeRenderedInteriors: count, afterVisibleInteriors: visible, iterations, priorScanMs: Number(baselineMs.toFixed(3)), cachedScanMs: Number(optimizedMs.toFixed(3)) });
        assert.ok(visible < count); assert.equal(a.w.document.querySelectorAll('#canvas .connector').length, count);
    }
    t.diagnostic(JSON.stringify({ environment: 'jsdom, static camera, DOM management only; no browser paint/GPU/frame rate measurement', results }));
});
