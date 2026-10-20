const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { sharedProjects } = require('../server/shared-projects');
const root = path.join(__dirname, '..', '无限画布');
const project = name => ({ format: 'infinite-canvas-project', version: 1, id: 'project_a', name, scene: { nodes: [{ id: 'node_one', type: 'text', x: 1, y: 2, name: '文字', textValue: name }], links: [] }, history: [] });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function service(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-shared-review-'));
    t.after(() => { const absolute = path.resolve(directory); assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(absolute, { recursive: true, force: true }); });
    return sharedProjects(directory);
}
test('an invite body arriving after a write and revocation cannot restore old revisions or revoked links', async t => {
    const api = service(t), call = (route, method = 'GET', body, token, owner = 'owner') => api.handle({ route, method, owner, token, readBody: async () => body });
    const created = await call('/api/shared-projects', 'POST', { project: project('旧内容') }), route = `/api/shared-projects/${created.id}`;
    const oldInvite = await call(`${route}/invites`, 'POST', { role: 'edit' });
    const body = deferred(); const pending = api.handle({ route: `${route}/invites`, method: 'POST', owner: 'owner', readBody: () => body.promise });
    await call(route, 'PUT', { revision: 1, project: project('新内容') }); await call(`${route}/invites`, 'DELETE'); body.resolve({ role: 'read' }); await pending;
    const current = await call(route); assert.equal(current.revision, 2); assert.equal(current.project.name, '新内容');
    await assert.rejects(call(route, 'GET', undefined, oldInvite.token, null), error => error.status === 403);
});

test('shared project writes reject malformed scene nodes and unsafe media before poisoning the stored revision', async t => {
    const api = service(t), call = (route, method, body) => api.handle({ route, method, owner: 'owner', readBody: async () => body });
    const created = await call('/api/shared-projects', 'POST', { project: project('可恢复') }), route = `/api/shared-projects/${created.id}`;
    const invalid = project('坏数据'); invalid.scene.nodes[0] = null;
    await assert.rejects(call(route, 'PUT', { revision: 1, project: invalid }), error => error.status === 400);
    const unsafe = project('不安全地址'); unsafe.scene.nodes[0].media = { kind: 'img', src: 'javascript:alert(1)' };
    await assert.rejects(call(route, 'PUT', { revision: 1, project: unsafe }), error => error.status === 400);
    const current = await call(route, 'GET'); assert.equal(current.revision, 1); assert.equal(current.project.name, '可恢复');
});

test('an edit capability is project scoped and a body delayed past revocation cannot commit', async t => {
    const api = service(t), call = (route, method = 'GET', body, owner = 'owner', token) => api.handle({ route, method, owner, token, readBody: async () => body });
    const a = await call('/api/shared-projects', 'POST', { project: project('A') }), b = await call('/api/shared-projects', 'POST', { project: project('B') });
    const route = `/api/shared-projects/${a.id}`, invite = await call(`${route}/invites`, 'POST', { role: 'edit' });
    await assert.rejects(call(`/api/shared-projects/${b.id}`, 'GET', undefined, null, invite.token), error => error.status === 403);
    await assert.rejects(call(`${route}/invites`, 'POST', { role: 'edit' }, null, invite.token), error => error.status === 403);
    const body = deferred(); const writing = api.handle({ route, method: 'PUT', owner: null, token: invite.token, readBody: () => body.promise });
    await call(`${route}/invites`, 'DELETE'); body.resolve({ revision: 1, project: project('不得写入') }); await assert.rejects(writing, error => error.status === 403);
    assert.equal((await call(route)).revision, 1);
});

async function app(t) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://localhost:8787/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close()); const w = dom.window; w.indexedDB = new IDBFactory(); w.structuredClone = structuredClone; w.CSS = { supports: () => true };
    w.CanvasIcons = { icon: () => w.document.createElementNS('http://www.w3.org/2000/svg', 'svg'), render: () => {} };
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} }); w.HTMLMediaElement.prototype.pause = function () {}; w.HTMLMediaElement.prototype.load = function () {};
    w.fetch = async () => new Response(JSON.stringify({ models: [] }));
    w.eval(['project-store.js', 'script.js', 'workspace.js', 'creative.js', 'canvas-navigation.js', 'canvas-layout.js', 'workbench.js', 'motion.js', 'timeline.js', 'shared-workspace.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') + '\nwindow.API={State,Interaction,UI,ProjectStore};');
    for (let i = 0; i < 100 && !w.Workspace.ready; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const a = { ...w.API, w, shared: w.SharedWorkspace }; a.shared.message = w.document.createElement('p'); a.shared.render = async () => {};
    a.setProject = (name, id) => { a.Interaction.restoreScene(project(name).scene); w.Workspace.projectId = id; w.document.getElementById('project-name').value = name; w.document.querySelector('.brand-name').textContent = name; a.State.undoStack = []; a.State.redoStack = []; };
    a.setProject('本地 A', 'project_a'); a.shared.binding = { id: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64), role: 'edit', revision: 1, localId: 'project_a' };
    return a;
}

test('delayed shared pull cannot overwrite a different local canvas selected while waiting', async t => {
    const a = await app(t), response = deferred(), started = deferred();
    a.w.fetch = async () => { started.resolve(); return response.promise; }; const pending = a.shared.pull().catch(error => error); await started.promise;
    a.setProject('本地 B 未保存草稿', 'project_b'); const nextBinding = { id: '22222222-2222-4222-8222-222222222222', token: 'b'.repeat(64), localId: 'project_b', role: 'edit', revision: 3 }; a.shared.binding = nextBinding;
    response.resolve(new Response(JSON.stringify({ project: project('共享 A'), revision: 2, role: 'edit' }))); await pending;
    assert.equal(a.w.Workspace.projectId, 'project_b'); assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value, '本地 B 未保存草稿'); assert.equal(a.shared.binding.id, nextBinding.id); await a.w.Workspace.save();
});

test('delayed publish never binds the published snapshot to a newly selected canvas', async t => {
    const a = await app(t), response = deferred(), started = deferred(); a.shared.binding = null;
    a.w.fetch = async () => { started.resolve(); return response.promise; }; const pending = a.shared.publish().catch(error => error); await started.promise;
    a.setProject('本地 B', 'project_b'); response.resolve(new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', revision: 1 }))); await pending;
    assert.notEqual(a.shared.binding?.localId, 'project_b'); assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value, '本地 B'); await a.w.Workspace.save();
});

test('delayed join preserves a newly selected local draft and sends only the requested invite token', async t => {
    const a = await app(t), response = deferred(), started = deferred(), headers = [];
    a.w.fetch = async (route, options) => { headers.push(options.headers); started.resolve(); return response.promise; };
    const pending = a.shared.openRemote('33333333-3333-4333-8333-333333333333', 'c'.repeat(64)).catch(error => error); await started.promise;
    a.setProject('B 尚未保存', 'project_b'); const before = structuredClone(a.shared.binding);
    response.resolve(new Response(JSON.stringify({ project: project('共享 C'), revision: 2, role: 'read' }))); await pending;
    assert.equal(headers[0]['X-Canvas-Share'], 'c'.repeat(64)); assert.equal(a.w.Workspace.projectId, 'project_b'); assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value, 'B 尚未保存'); assert.equal(a.shared.binding.id, before.id); await a.w.Workspace.save();
});

test('changing the shared binding during portable media preparation never sends A into shared B', async t => {
    const a = await app(t), preparation = deferred(), started = deferred(), sent = [];
    a.ProjectStore.portable = async value => { started.resolve(); await preparation.promise; return value; };
    a.w.fetch = async (route, options) => { sent.push({ route, body: options.body && JSON.parse(options.body), token: options.headers?.['X-Canvas-Share'] }); return new Response(JSON.stringify({ revision: 2 })); };
    const pending = a.shared.push().catch(error => error); await started.promise; a.setProject('本地 B', 'project_b'); a.shared.binding = { id: '22222222-2222-4222-8222-222222222222', token: 'b'.repeat(64), role: 'edit', localId: 'project_b', revision: 1 }; preparation.resolve(); await pending;
    assert.ok(sent.every(request => !request.route.includes('22222222-2222-4222-8222-222222222222')), 'A snapshot must not be PUT to the newly selected B binding'); await a.w.Workspace.save();
});

test('disconnecting while pulled media is being prepared cancels the old shared import and binding', async t => {
    const a = await app(t), preparation = deferred(), started = deferred();
    a.ProjectStore.portable = async value => { started.resolve(); await preparation.promise; return value; };
    a.w.fetch = async () => new Response(JSON.stringify({ project: project('已断开的共享版本'), revision: 2, role: 'edit' }));
    const pending = a.shared.pull().catch(error => error); await started.promise; a.shared.binding = null; preparation.resolve(); await pending;
    assert.equal(a.shared.binding, null); assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value, '本地 A'); await a.w.Workspace.save();
});

test('loading a shared revision has reversible scene, name, visible brand and history', async t => {
    const a = await app(t); a.State.history = [{ type: 'generate', text: '本地历史', time: '', id: 'local_history' }];
    a.w.fetch = async () => new Response(JSON.stringify({ project: project('远程新名称'), revision: 2, role: 'edit' }));
    await a.shared.pull(); assert.equal(a.w.document.getElementById('project-name').value, '远程新名称'); assert.equal(a.w.document.querySelector('.brand-name').textContent, '远程新名称');
    a.Interaction.undo(); assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value, '本地 A'); assert.equal(a.w.document.getElementById('project-name').value, '本地 A'); assert.equal(a.w.document.querySelector('.brand-name').textContent, '本地 A'); assert.equal(a.State.history[0].text, '本地历史'); await a.w.Workspace.save();
});
