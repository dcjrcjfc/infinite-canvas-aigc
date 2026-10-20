const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..', '无限画布');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N2kAAAAASUVORK5CYII=';
async function app(t, database = new IDBFactory(), preferences = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'http://localhost:8787/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close()); const w = dom.window; w.indexedDB = database; w.structuredClone = structuredClone; w.CSS = { supports: () => true }; for (const [key, value] of Object.entries(preferences)) w.localStorage.setItem(key, value);
    w.CanvasIcons = { icon: () => w.document.createElementNS('http://www.w3.org/2000/svg', 'svg'), render: () => {} };
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.HTMLMediaElement.prototype.pause = function () {}; w.HTMLMediaElement.prototype.load = function () {};
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    w.fetch = async () => new Response(JSON.stringify({ models: [{ id: 'gpt-image-2', type: 'image', available: true }, { id: 'seedance', type: 'video', available: true }] }), { headers: { 'Content-Type': 'application/json' } });
    w.eval(['project-store.js', 'script.js', 'workspace.js', 'creative.js', 'canvas-navigation.js', 'canvas-layout.js', 'workbench.js', 'motion.js', 'timeline.js', 'production-library.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') + '\nwindow.API={State,UI,Interaction,ProjectStore,Engine};');
    for (let i = 0; i < 100 && !w.Workspace.ready; i++) await new Promise(resolve => setTimeout(resolve, 5));
    w.ProductionLibrary.init(); const a = { ...w.API, w, library: w.ProductionLibrary, database };
    a.node = (type = 'image', media = null, x = 4500, y = 4500) => { const el = a.UI.createNode(type, { x, y }, media); const model = { el, type, x, y }; a.State.nodes.push(model); return model; };
    a.link = (from, to) => a.Interaction.createLinkBetween(from.el.querySelector('.conn-right'), to.el.querySelector('.conn-left'));
    a.flush = () => w.Workspace.save(); return a;
}

test('storyboard edits affect node inputs, reorder and deletion undo retain same scene data', async t => {
    const a = await app(t), first = a.library.addShot('image'), second = a.library.addShot('video');
    a.library.updateShot(first.dataset.nodeId, 'imagePrompt', '夜雨中的城市'); a.library.updateShot(second.dataset.nodeId, 'duration', 10);
    assert.equal(first.querySelector('.ai-input').value, '夜雨中的城市'); assert.equal(second.querySelector('.video-duration').value, '10');
    a.library.reorder(second.dataset.nodeId, -1); assert.equal(a.library.rows()[0].el, second);
    a.Interaction.undo(); assert.equal(a.library.rows()[0].el.dataset.nodeId, first.dataset.nodeId);
    const restored = a.State.nodes[1].el; a.Interaction.clearMultiSelection(); a.Interaction.deselect(); a.State.selection = { type: 'node', item: restored }; a.Interaction.deleteSelected(); assert.equal(a.library.rows().length, 1);
    a.Interaction.undo(); assert.equal(a.library.rows().length, 2); assert.equal(a.library.rows()[1].el._production.shot.duration, 10);
    await a.flush(); const b = await app(t, a.database); assert.equal(b.library.rows().length, 2); assert.equal(b.library.rows()[0].el.querySelector('.ai-input').value, '夜雨中的城市');
});

test('assets persist across instances, version refresh is explicit and undoable', async t => {
    const a = await app(t), source = a.node('text'); source.el.querySelector('.text-node-input').value = '角色设定第一版';
    const saved = await a.library.saveAsset(source, '<img src=x onerror=alert(1)>', '角色');
    const map = a.library.insert(saved), copy = [...map.values()][0]; assert.equal(copy.querySelector('.text-node-input').value, '角色设定第一版');
    source.el.querySelector('.text-node-input').value = '角色设定第二版'; const updated = await a.library.saveAsset(source, saved.name, '角色', saved.id);
    assert.equal(updated.version, 2); assert.equal(copy.querySelector('.text-node-input').value, '角色设定第一版');
    a.library.updateReferences(updated); assert.equal(copy.querySelector('.text-node-input').value, '角色设定第二版'); assert.equal(copy._production.asset.version, 2);
    a.Interaction.undo(); const reverted = a.State.nodes.find(node => node.el.dataset.nodeId === copy.dataset.nodeId).el; assert.equal(reverted.querySelector('.text-node-input').value, '角色设定第一版');
    await a.library.open('asset'); assert.equal(a.w.document.querySelector('.production-library-card input').value, saved.name); assert.equal(a.w.document.querySelector('.production-library-card img'), null);
    await a.flush(); const b = await app(t, a.database), persisted = await b.library.get(saved.id); assert.equal(persisted.version, 2); assert.equal(persisted.category, '角色'); assert.equal((await b.library.countReferences()).get(saved.id), 2);
    await b.library.remove(saved.id); assert.equal((await b.library.list()).length, 0); assert.equal(b.State.nodes.length, 2);
});

test('workflow reuse remaps nodes/groups/links, enforces external inputs and is one undo', async t => {
    const a = await app(t), input = a.node('text'), image = a.node('image', pixel, 4800, 4600), video = a.node('video', null, 5200, 4680);
    input.el.querySelector('.text-node-input').value = '外部输入'; a.link(input, image); a.link(image, video);
    image.el.dataset.groupId = 'group_original'; video.el.dataset.groupId = 'group_original'; image.el.dataset.groupName = video.el.dataset.groupName = '一组';
    const saved = await a.library.saveWorkflow([image, video], '产品视频'); assert.equal(saved.scene.nodes[0].x, 0); assert.equal(saved.scene.nodes[1].x, 400); assert.equal(saved.slots[0].required, true);
    assert.throws(() => a.library.insert(saved), /输入节点/); assert.equal(a.State.nodes.length, 3);
    const mapping = a.library.insert(saved, { [image.el.dataset.nodeId]: input.el.dataset.nodeId }); assert.equal(a.State.nodes.length, 5); assert.equal(a.State.links.length, 4);
    const copiedImage = mapping.get(image.el.dataset.nodeId), copiedVideo = mapping.get(video.el.dataset.nodeId);
    assert.notEqual(copiedImage.dataset.nodeId, image.el.dataset.nodeId); assert.notEqual(copiedImage.dataset.groupId, 'group_original'); assert.equal(copiedImage.dataset.groupId, copiedVideo.dataset.groupId);
    assert.equal(a.State.nodes.find(n => n.el === copiedVideo).x - a.State.nodes.find(n => n.el === copiedImage).x, 400);
    assert.equal(copiedVideo._refs[0].sourceNodeId, copiedImage.dataset.nodeId);
    a.Interaction.undo(); assert.equal(a.State.nodes.length, 3); assert.equal(a.State.links.length, 2); a.Interaction.redo(); assert.equal(a.State.nodes.length, 5); assert.equal(a.State.links.length, 4);
    await a.flush();
});

test('untrusted workflow records are validated before modifying the scene', async t => {
    const a = await app(t), node = a.node('image', pixel), valid = await a.library.saveWorkflow([node], '安全校验');
    const malformed = structuredClone(valid); malformed.scene.nodes[0].media.src = 'javascript:alert(1)'; assert.throws(() => a.library.insert(malformed), /素材地址/); assert.equal(a.State.nodes.length, 1);
    const cycle = structuredClone(valid); cycle.scene.nodes.push({ ...cycle.scene.nodes[0], id: 'node_two' }); cycle.scene.links = [{ id: 'a', fromNodeId: cycle.scene.nodes[0].id, toNodeId: 'node_two' }, { id: 'b', fromNodeId: 'node_two', toNodeId: cycle.scene.nodes[0].id }]; assert.throws(() => a.library.insert(cycle), /循环/); assert.equal(a.State.nodes.length, 1);
    await a.flush();
});

test('each external workflow input has an independent slot and replacement keeps the library identity', async t => {
    const a = await app(t), first = a.node('image', pixel), second = a.node('text'), target = a.node('video'); a.link(first, target); a.link(second, target);
    const saved = await a.library.saveWorkflow([target], '多源参考', '视频'); assert.equal(saved.slots.length, 2); assert.notEqual(saved.slots[0].id, saved.slots[1].id);
    const bindings = { [saved.slots[0].id]: first.el.dataset.nodeId, [saved.slots[1].id]: second.el.dataset.nodeId };
    const mapped = a.library.insert(saved, bindings), copy = mapped.get(target.el.dataset.nodeId); assert.equal(a.State.links.filter(link => link.toEl.closest('.node') === copy).length, 2);
    const replaced = await a.library.saveWorkflow([first, target], '改名工作流', '产品', saved.id); assert.equal(replaced.id, saved.id); assert.equal(replaced.version, 2); assert.equal(replaced.category, '产品'); assert.equal((await a.library.list()).length, 1); await a.flush();
});

test('asset reference counts include saved other canvases while current edits override the saved current scene', async t => {
    const a = await app(t), node = a.node('image', pixel), item = await a.library.saveAsset(node, '跨画布角色', '角色'); await a.flush();
    const saved = a.w.Workspace.project(); saved.id = 'project_other'; saved.name = '另一个画布';
    a.w.Workspace.revision = await a.ProjectStore.save(saved, a.w.Workspace.revision);
    assert.equal((await a.library.countReferences()).get(item.id), 2);
    a.Interaction.clearMultiSelection(); a.Interaction.deselect(); a.State.selection = { type: 'node', item: node.el }; a.Interaction.deleteSelected();
    assert.equal((await a.library.countReferences()).get(item.id), 1); await a.flush();
});

test('library creation uses the same CSS-zoom coordinate mapping as the canvas engine', async t => {
    const a = await app(t); a.State.canvas = { x: -1700, y: -2100, scale: 0.5 };
    const expected = a.Engine.screenToCanvas(a.w.innerWidth / 2, a.w.innerHeight / 2); const shot = a.library.addShot(); const node = a.State.nodes.find(n => n.el === shot);
    assert.equal(node.x, expected.x); assert.equal(node.y, expected.y); await a.flush();
});

test('backup restores all library kinds as copies, remaps asset references and can undo the entire import', async t => {
    const a = await app(t), source = a.node('text'); source.el.querySelector('.text-node-input').value = '角色说明'; source.el._production = { note: true, count: 3 };
    const asset = await a.library.saveAsset(source, '角色', '角色'), workflow = await a.library.saveWorkflow([source], '说明工作流');
    assert.equal(workflow.scene.nodes[0].production.note, true); assert.equal(workflow.scene.nodes[0].production.count, 3);
    const backup = await a.library.exportBackup(); assert.equal(backup.items.length, 2);
    const imported = await a.library.importBackup(JSON.stringify(backup)); assert.equal(imported.length, 2); assert.equal((await a.library.list()).length, 4);
    const importedAsset = imported.find(item => item.kind === 'asset'), importedWorkflow = imported.find(item => item.kind === 'workflow');
    assert.notEqual(importedAsset.id, asset.id); assert.notEqual(importedWorkflow.id, workflow.id); assert.equal(importedWorkflow.scene.nodes[0].production.asset.id, importedAsset.id);
    const mapped = a.library.insert(importedWorkflow); assert.equal([...mapped.values()][0]._production.note, true); assert.equal([...mapped.values()][0]._production.count, 3);
    await a.library.undoImport(); assert.equal((await a.library.list()).length, 2); assert.equal(a.State.nodes.length, 2); await a.flush();
});

test('a malformed item rejects the whole backup before writes, and import undo does not discard later edits', async t => {
    const a = await app(t), source = a.node('image', pixel); await a.library.saveAsset(source, '素材'); const backup = await a.library.exportBackup();
    const unsafe = structuredClone(backup); unsafe.items.push({ ...unsafe.items[0], id: 'unsafe_asset', scene: { nodes: [{ ...unsafe.items[0].scene.nodes[0], media: { kind: 'img', src: 'javascript:alert(1)' } }], links: [] } });
    await assert.rejects(a.library.importBackup(unsafe), /素材地址/); assert.equal((await a.library.list()).length, 1);
    const imported = await a.library.importBackup(backup); await a.library.saveAsset(source, '修改导入条目', '风格', imported[0].id);
    await assert.rejects(a.library.undoImport(), /已被修改/); assert.equal((await a.library.list()).length, 2); await a.flush();
});

test('backup export embeds remote media and initialization is idempotent during workspace recovery', async t => {
    const a = await app(t), source = a.node('image', pixel); await a.library.saveAsset(source, '素材'); const backup = await a.library.exportBackup();
    backup.items[0].id = 'asset_remote'; backup.items[0].scene.nodes[0].media.src = 'https://example.test/image.png'; await a.library.importBackup(backup);
    let remoteReads = 0; a.w.fetch = async (url, options) => { assert.equal(url, 'https://example.test/image.png'); assert.equal(options.credentials, 'omit'); remoteReads++; return { ok: true, blob: async () => new a.w.Blob([Buffer.from(pixel.split(',')[1], 'base64')], { type: 'image/png' }) }; };
    const exported = await a.library.exportBackup(); assert.equal(remoteReads, 1); assert.equal(exported.items.find(item => item.id === 'asset_remote').scene.nodes[0].media.src, pixel);
    a.w.Workspace.ready = false; a.library.init(); a.library.init(); assert.equal(a.w.document.querySelectorAll('.production-library-dialog').length, 1); assert.equal(a.w.document.querySelectorAll('.production-library-entry').length, 1); assert.throws(() => a.library.addShot(), /仍在恢复/); a.w.Workspace.ready = true; await a.flush();
});

test('folders and tags are independent from categories, filter without replacing inputs, and survive version updates and backup', async t => {
    const a = await app(t), first = a.node('image', pixel), second = a.node('image', pixel);
    const hero = await a.library.saveAsset(first, '主角', '角色', undefined, { folder: '品牌 / 春季', tags: '蓝色, 主视觉,蓝色' });
    const prop = await a.library.saveAsset(second, '道具', '道具', undefined, { folder: '品牌 / 春季', tags: ['木材'] });
    assert.equal(hero.category, '角色'); assert.equal(hero.folder, '品牌 / 春季'); assert.deepEqual([...hero.tags], ['蓝色', '主视觉']);
    await a.library.open('asset'); const doc = a.w.document, search = doc.querySelector('[aria-label="搜索库"]'); search.focus(); search.value = '蓝色'; search.dispatchEvent(new a.w.Event('input', { bubbles: true }));
    assert.equal(doc.querySelectorAll('.production-library-card:not([hidden])').length, 1); assert.equal(doc.activeElement, search); assert.equal(doc.querySelector('[aria-label="搜索库"]'), search);
    search.value = ''; search.dispatchEvent(new a.w.Event('input', { bubbles: true }));
    const folderSelect = doc.querySelector('[aria-label="文件夹筛选"]'); folderSelect.value = '品牌 / 春季'; folderSelect.dispatchEvent(new a.w.Event('change')); assert.equal(doc.querySelectorAll('.production-library-card:not([hidden])').length, 2);
    const tagSelect = doc.querySelector('[aria-label="标签筛选"]'); tagSelect.value = '木材'; tagSelect.dispatchEvent(new a.w.Event('change')); assert.equal(doc.querySelector('.production-library-card:not([hidden])').dataset.itemId, prop.id);
    tagSelect.value = ''; tagSelect.dispatchEvent(new a.w.Event('change'));
    const card = doc.querySelector(`[data-item-id="${hero.id}"]`), folderInput = card.querySelector('[aria-label="文件夹"]'), tagsInput = card.querySelector('[aria-label="标签"]'); folderInput.value = '品牌 / 夏季'; tagsInput.focus(); await folderInput.onchange();
    assert.equal(card.querySelector('[aria-label="标签"]'), tagsInput); assert.equal(doc.activeElement, tagsInput); assert.equal((await a.library.get(hero.id)).folder, '品牌 / 夏季');
    await a.library.updateOrganization(hero.id, { tags: ['轻快', '轻快', '<script>'] }); const updated = await a.library.saveAsset(first, '主角新版', '角色', hero.id); assert.equal(updated.folder, '品牌 / 夏季'); assert.deepEqual([...updated.tags], ['轻快', '<script>']);
    const backup = await a.library.exportBackup(), imported = await a.library.importBackup(backup), copy = imported.find(item => item.name.startsWith('主角新版')); assert.equal(copy.folder, '品牌 / 夏季'); assert.deepEqual([...copy.tags], ['轻快', '<script>']); await a.flush();
});

test('storyboard visibility persists and field commits preserve neighboring controls and scroll position', async t => {
    const a = await app(t), node = a.library.addShot('image'); await a.library.open('storyboard'); const doc = a.w.document;
    const description = doc.querySelector('[data-shot-field="description"]'), dialogue = doc.querySelector('[data-shot-field="dialogue"]'), scroller = doc.querySelector('.production-table-scroll'); scroller.scrollLeft = 400;
    description.value = '大雨中的人物'; dialogue.focus(); description.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    assert.equal(node._production.shot.description, '大雨中的人物'); assert.equal(doc.querySelector('[data-shot-field="dialogue"]'), dialogue); assert.equal(doc.activeElement, dialogue); assert.equal(doc.querySelector('.production-table-scroll'), scroller); assert.equal(scroller.scrollLeft, 400);
    for (const key of ['number', 'duration', 'description', 'dialogue', 'imagePrompt', 'videoPrompt']) a.library.setFieldVisibility(key, false);
    assert.ok([...doc.querySelectorAll('[data-storyboard-column="description"]')].every(cell => cell.hidden)); assert.equal(doc.querySelector('[data-storyboard-column="actions"]').hidden, false);
    assert.ok([...doc.querySelectorAll('.production-table-scroll button')].some(button => button.textContent === '定位'));
    const preferences = { 'canvas.storyboard.fields': a.w.localStorage.getItem('canvas.storyboard.fields') }; await a.flush(); const b = await app(t, a.database, preferences); await b.library.open('storyboard');
    assert.equal(b.w.document.querySelector('[data-field-toggle="description"]').checked, false); assert.ok([...b.w.document.querySelectorAll('[data-storyboard-column="description"]')].every(cell => cell.hidden)); b.library.setFieldVisibility('description', true); assert.equal(b.w.document.querySelector('[data-shot-field="description"]').value, '大雨中的人物');
});
