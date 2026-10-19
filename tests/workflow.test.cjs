const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..', '无限画布');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N2kAAAAASUVORK5CYII=';
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
async function openApp(t, database = new IDBFactory(), handler) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://127.0.0.1:8787', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const win = dom.window;
    win.indexedDB = database;
    win.structuredClone = structuredClone;
    win.CSS = { supports: () => true };
    win.fetch = async (url, options) => {
        if (url.endsWith('/api/config')) return json({ models: ['gpt-image-2', 'gemini-3.1-flash-image-preview-4k', 'chatgpt', 'gemini', 'seedance'].map((id) => ({ id, label: id, available: true })), authenticated: true });
        if (url.startsWith('data:')) {
            const data = await (await fetch(url)).arrayBuffer();
            return { ok: true, blob: async () => new win.Blob([data], { type: 'image/png' }) };
        }
        return handler ? handler(url, options) : json({ url: pixel });
    };
    win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    win.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    const source = ['project-store.js', 'script.js', 'workspace.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    win.eval(source + '\nwindow.TestAPI = { State, Interaction, UI, ProjectStore };');
    for (let index = 0; !win.Workspace.ready && index < 100; index++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(win.Workspace.ready, true, win.document.getElementById('project-status').textContent);
    const api = { ...win.TestAPI, win, workspace: win.Workspace, database };
    api.node = (type = 'image', media = null) => {
        const el = api.UI.createNode(type, { x: 4500, y: 4500 }, media);
        api.State.nodes.push({ el, x: 4500, y: 4500, type });
        return el;
    };
    api.link = (a, b) => api.Interaction.createLinkBetween(a.querySelector('.conn-right'), b.querySelector('.conn-left'));
    return api;
}
test('first upstream generation creates reference; updates preserve primary and user order', async (t) => {
    const app = await openApp(t);
    const a = app.node(), b = app.node(), c = app.node();
    app.link(a, c); app.link(b, c);
    assert.equal(c._refs?.length || 0, 0);
    a.querySelector('.media-container').innerHTML = `<img src="${pixel}">`;
    app.Interaction.refreshDownstreamReferences(a);
    assert.equal(c._refs.length, 1); assert.equal(c._refs[0].src, pixel);
    b.querySelector('.media-container').innerHTML = `<img src="${pixel}">`;
    app.Interaction.refreshDownstreamReferences(b);
    const id = c._refs[1].id;
    app.Interaction.moveReference(c, id, -1); app.Interaction.setPrimaryReference(c, id);
    app.Interaction.refreshAllReferences();
    assert.equal(c._refs[0].id, id); assert.equal(c._refs[0].isPrimary, true);
    app.Interaction.removeReferenceById(c, id); app.Interaction.refreshAllReferences();
    assert.equal(c._refs.length, 1); assert.equal(app.State.links.length, 1);
});
test('transitive upstream text enters image request; generated output updates connected nodes immediately', async (t) => {
    let payload;
    const app = await openApp(t, undefined, async (url, options) => { payload = JSON.parse(options.body); return json({ url: pixel }); });
    const brief = app.node('text'), first = app.node(), second = app.node();
    brief.querySelector('.text-node-input').value = '角色穿蓝色外套';
    app.link(brief, first); app.link(first, second);
    first.querySelector('.ai-panel .ai-input').value = '画角色'; first.dataset.ratio = '3:4';
    await app.Interaction.runAI(first);
    assert.match(payload.prompt, /蓝色外套/); assert.equal(payload.ratio, '3:4');
    assert.equal(second._refs.length, 1); assert.equal(first.dataset.nodeStatus, '已生成');
    second.querySelector('.ai-panel .ai-input').value = '画海报';
    await app.Interaction.runAI(second);
    assert.match(payload.prompt, /蓝色外套/); assert.equal(payload.images.length, 1);
    assert.equal(app.State.history.length, 2);
});
test('duplicate and cyclic graph links are rejected', async (t) => {
    const app = await openApp(t);
    const a = app.node(), b = app.node(), c = app.node();
    app.link(a, b); app.link(a, b); app.link(b, c); app.link(c, a);
    assert.equal(app.State.links.length, 2);
});
test('complete project, uploaded image, prompt and history survive a browser reopen', async (t) => {
    const database = new IDBFactory();
    const app = await openApp(t, database);
    const upload = app.node('image', pixel), next = app.node();
    upload.dataset.nodeStatus = '已上传';
    next.querySelector('.ai-panel .ai-input').value = '持久化提示词'; app.link(upload, next);
    app.Interaction.pushHistory('generate', '样例历史', { nodeId: next.dataset.nodeId, scene: app.Interaction.captureScene() });
    app.win.document.getElementById('project-name').value = '持久化项目';
    await app.workspace.save();
    const reopened = await openApp(t, database);
    assert.equal(reopened.State.nodes.length, 2); assert.equal(reopened.State.links.length, 1);
    assert.equal(reopened.State.nodes[0].el.querySelector('img').src, pixel);
    assert.equal(reopened.State.nodes[1].el.querySelector('.ai-panel .ai-input').value, '持久化提示词');
    assert.equal(reopened.State.history[0].text, '样例历史');
    assert.equal(reopened.win.document.getElementById('project-name').value, '持久化项目');
});
test('project import is reversible; invalid imports never replace the current scene', async (t) => {
    const app = await openApp(t);
    const a = app.node('text'); a.querySelector('.text-node-input').value = '原画布';
    const project = JSON.parse(JSON.stringify(app.workspace.project())); project.name = '导入项目'; project.scene.nodes[0].textValue = '导入画布';
    await app.workspace.importProject({ size: 100, text: async () => JSON.stringify(project) });
    assert.equal(app.State.nodes[0].el.querySelector('.text-node-input').value, '导入画布');
    app.Interaction.undo(); assert.equal(app.State.nodes[0].el.querySelector('.text-node-input').value, '原画布');
    const invalid = structuredClone(project); invalid.scene.nodes[0].media.src = 'javascript:alert(1)';
    await assert.rejects(() => app.workspace.importProject({ size: 100, text: async () => JSON.stringify(invalid) }), /素材地址/);
    assert.equal(app.State.nodes[0].el.querySelector('.text-node-input').value, '原画布');
    const markup = structuredClone(project); markup.scene.nodes[0].name = '<img src=x onerror="alert(1)">';
    app.Interaction.restoreScene(app.ProjectStore.validate(markup).scene);
    assert.equal(app.State.nodes[0].el.querySelector('.node-label img'), null);
});
test('multi-tab autosave detects a newer revision and does not overwrite it', async (t) => {
    const database = new IDBFactory();
    const first = await openApp(t, database), second = await openApp(t, database);
    first.node('text'); await first.workspace.save();
    second.node('image'); await second.workspace.save();
    assert.equal(second.workspace.ready, false);
    assert.match(second.win.document.getElementById('project-status').textContent, /另一个页面/);
    const saved = await first.ProjectStore.load(); assert.equal(saved.scene.nodes[0].type, 'text');
});
test('Agent sends selected model/context and saves the returned answer as a text node', async (t) => {
    let payload;
    const app = await openApp(t, undefined, async (url, options) => { assert.match(url, /\/api\/chat$/); payload = JSON.parse(options.body); return json({ text: '一位穿蓝色外套的侦探' }); });
    const brief = app.node('text'); brief.querySelector('.text-node-input').value = '蓝色外套';
    app.Interaction.focusNode(brief);
    app.win.document.getElementById('agent-llm-select').value = 'chatgpt';
    app.win.document.querySelector('.agent-input').value = '完善角色设定';
    await app.Interaction.submitAgentInput();
    assert.equal(payload.model, 'chatgpt'); assert.match(payload.context, /蓝色外套/);
    assert.equal(app.State.nodes.length, 2);
    assert.equal(app.State.nodes[1].el.querySelector('.text-node-input').value, '一位穿蓝色外套的侦探');
});
test('undo while a request is in flight cannot write a late result into restored nodes', async (t) => {
    let release;
    const app = await openApp(t, undefined, () => new Promise((resolve) => { release = () => resolve(json({ url: pixel })); }));
    const node = app.node(); node.querySelector('.ai-panel .ai-input').value = 'test';
    const before = app.Interaction.captureScene();
    const running = app.Interaction.runAI(node);
    for (let i = 0; !release && i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    app.Interaction.restoreScene(before); release(); await running;
    assert.equal(app.State.nodes[0].el.querySelector('img'), null); assert.equal(app.State.history.length, 0);
});
test('text editing keeps native Undo; configured templates honor subject, ratio and count', async (t) => {
    const app = await openApp(t);
    app.win.document.getElementById('template-kind').value = 'poster';
    app.win.document.getElementById('template-theme').value = '城市雨夜';
    app.win.document.getElementById('template-ratio').value = '2:3';
    app.win.document.getElementById('template-count').value = '3';
    app.workspace.createTemplate();
    assert.equal(app.State.nodes.length, 4); assert.equal(app.State.links.length, 3);
    assert.equal(app.State.nodes[1].el.dataset.ratio, '2:3');
    assert.match(app.State.nodes[0].el.querySelector('.text-node-input').value, /城市雨夜/);
    const input = app.State.nodes[0].el.querySelector('textarea'); input.focus();
    const event = new app.win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event); assert.equal(event.defaultPrevented, false); assert.equal(app.State.nodes.length, 4);
});

test('the actual upload handler embeds local files, refreshes references and can be undone', async (t) => {
    const app = await openApp(t);
    const source = app.node(), target = app.node(); app.link(source, target);
    app.State.uploadContext = { kind: 'node', node: source };
    const input = app.win.document.getElementById('file-input');
    const file = new app.win.File([Buffer.from(pixel.split(',')[1], 'base64')], 'upload.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await input.onchange({ target: input });
    assert.equal(source.querySelector('img').src, pixel); assert.equal(target._refs[0].src, pixel);
    assert.equal(source.dataset.nodeStatus, '已上传');
    app.Interaction.undo(); assert.equal(app.State.nodes[0].el.querySelector('img'), null);
});

test('resuming a saved video task polls without submitting a duplicate generation', async (t) => {
    const routes = [];
    const app = await openApp(t, undefined, async (url) => { routes.push(url); return json({ status: 'completed', url: 'data:video/mp4;base64,dGVzdA==' }); });
    const node = app.node('video');
    node.dataset.videoTask = JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' });
    await app.Interaction.runAI(node);
    assert.equal(routes.length, 1); assert.match(routes[0], /\/api\/videos\/1111/);
    assert.equal(node.querySelector('video').getAttribute('src'), 'data:video/mp4;base64,dGVzdA==');
    assert.equal(node.dataset.videoTask, undefined); assert.equal(app.State.history.length, 1);
});

test('restoring an edited image before decode preserves its baked downstream reference', async (t) => {
    const app = await openApp(t);
    const source = app.node('image', pixel), target = app.node(); app.link(source, target);
    source.querySelector('img').style.filter = 'brightness(120%) contrast(100%) saturate(100%)';
    const snapshot = app.Interaction.captureScene();
    assert.doesNotThrow(() => app.Interaction.restoreScene(snapshot));
    assert.equal(app.State.nodes.length, 2); assert.equal(app.State.nodes[1].el._refs[0].src, pixel);
});
