const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canvasApp } = require('./support/canvas-app.cjs');

test('groups survive validation/restore and duplicate into independent groups with internal links', async t => {
    const a = await canvasApp(t), layout = a.w.CanvasLayout;
    const one = a.node('text', 100, 200), two = a.node('image', 600, 250);
    a.Interaction.createLinkBetween(one.el.querySelector('.conn-right'), two.el.querySelector('.conn-left'));
    layout.select([one, two]); layout.group(); a.frame(16);
    const id = one.el.dataset.groupId;
    assert.ok(id); assert.equal(two.el.dataset.groupId, id);
    assert.equal(a.w.document.querySelectorAll('.canvas-group').length, 1);
    assert.equal(a.w.document.getElementById('node-actions').hidden, true);
    const portable = a.ProjectStore.sceneOf(a.Interaction.captureScene());
    assert.equal(portable.nodes[0].groupId, id);
    a.Interaction.restoreScene(portable); a.frame(32);
    layout.select(a.State.nodes); layout.duplicate(); a.frame(48);
    const copied = a.State.nodes.slice(2);
    assert.equal(a.State.nodes.length, 4); assert.equal(a.State.links.length, 2);
    assert.equal(copied[0].el.dataset.groupId, copied[1].el.dataset.groupId);
    assert.notEqual(copied[0].el.dataset.groupId, id);
    assert.equal(a.w.document.querySelectorAll('.canvas-group').length, 2);
    layout.ungroup(); a.frame(64);
    assert.equal(copied[0].el.dataset.groupId, undefined);
    assert.equal(a.State.nodes[0].el.dataset.groupId, id, 'original group is independent');
    a.Interaction.undo(); a.frame(80);
    assert.equal(a.w.document.querySelectorAll('.canvas-group').length, 2);
});

test('group header moves every member as one undoable gesture and rename remains text', async t => {
    const a = await canvasApp(t), layout = a.w.CanvasLayout;
    const one = a.node('image', 100, 200), two = a.node('video', 600, 250);
    layout.select([one, two]); layout.group(); a.frame(16);
    const header = a.w.document.querySelector('.canvas-group-title'); const count = a.State.undoStack.length;
    a.mouse(header, 'mousedown', 300, 300); a.mouse(header, 'mousemove', 350, 330); a.frame(32); a.mouse(header, 'mouseup', 350, 330, 0);
    assert.equal(one.x, 150); assert.equal(two.x, 650); assert.equal(two.y, 280);
    assert.equal(a.State.undoStack.length, count + 1);
    a.Interaction.undo(); a.frame(48); assert.equal(a.State.nodes[0].x, 100); assert.equal(a.State.nodes[1].y, 250);
    const fresh = a.w.document.querySelector('.canvas-group-title'); layout.rename(a.State.nodes[0].el.dataset.groupId, fresh);
    const input = fresh.querySelector('input'); input.value = '<img src=x onerror=alert(1)>';
    input.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); a.frame(64);
    assert.equal(fresh.querySelector('img'), null); assert.equal(fresh.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(a.State.nodes[1].el.dataset.groupName, fresh.textContent);
    layout.rename(a.State.nodes[0].el.dataset.groupId, fresh); const cancel = fresh.querySelector('input'); cancel.value = '取消';
    cancel.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(a.State.nodes[0].el.dataset.groupName, '<img src=x onerror=alert(1)>');
});

test('grid accounts for mixed node sizes; tree follows edges, leaves other nodes and links intact, and undoes atomically', async t => {
    const a = await canvasApp(t), layout = a.w.CanvasLayout;
    const nodes = [a.node('video', 300, 700), a.node('text', 100, 200), a.node('image', 600, 400), a.node('audio', 900, 900)];
    const outside = a.node('image', 40, 50);
    layout.select(nodes); layout.arrange('grid'); a.frame(16);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i], q = nodes[j], ps = layout.size(p), qs = layout.size(q);
        assert.ok(p.x + ps.width <= q.x || q.x + qs.width <= p.x || p.y + ps.height <= q.y || q.y + qs.height <= p.y, 'grid cells cannot overlap');
    }
    a.Interaction.createLinkBetween(nodes[1].el.querySelector('.conn-right'), nodes[0].el.querySelector('.conn-left'));
    a.Interaction.createLinkBetween(nodes[0].el.querySelector('.conn-right'), nodes[2].el.querySelector('.conn-left'));
    const before = a.Interaction.captureScene(), count = a.State.undoStack.length;
    layout.arrange('tree'); a.frame(32);
    assert.ok(nodes[1].x < nodes[0].x && nodes[0].x < nodes[2].x);
    assert.equal(a.State.links.length, 2); assert.equal(outside.x, 40); assert.equal(outside.y, 50);
    assert.equal(a.State.undoStack.length, count + 1);
    a.Interaction.undo(); a.frame(48);
    assert.deepEqual(a.Interaction.captureScene().nodes.map(n => [n.x, n.y]), before.nodes.map(n => [n.x, n.y]));
});

test('alignment uses actual dimensions and keyboard shortcuts respect focused controls and IME', async t => {
    const a = await canvasApp(t), layout = a.w.CanvasLayout;
    const one = a.node('video', 100, 200), two = a.node('text', 800, 500);
    layout.select([one, two]); layout.arrange('right'); a.frame(16);
    assert.equal(one.x + layout.size(one).width, two.x + layout.size(two).width);
    const input = one.el.querySelector('textarea'); input.focus();
    input.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    assert.equal(a.State.nodes.length, 2);
    input.blur(); a.w.document.body.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, isComposing: true, bubbles: true }));
    assert.equal(a.State.nodes.length, 2);
    a.w.document.body.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(a.State.nodes.length, 4);
});

test('canvas context menu selects clicked node, preserves multi-selection and returns native text context menus', async t => {
    const a = await canvasApp(t), layout = a.w.CanvasLayout;
    const one = a.node(), two = a.node('text', 800, 300);
    layout.select([one, two]);
    const context = target => { const e = new a.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 }); target.dispatchEvent(e); return e; };
    context(one.el.querySelector('.node-box')); assert.equal(layout.selected().length, 2); assert.equal(layout.context.hidden, false);
    const native = context(two.el.querySelector('textarea'));
    assert.equal(native.defaultPrevented, false); assert.equal(layout.context.hidden, true);
    context(a.viewport); assert.ok(layout.context.textContent.includes('全选节点'));
    layout.context.querySelector('button').dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(a.w.document.activeElement.textContent, '全选节点 · Ctrl+A', 'disabled history commands are skipped');
    a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(a.w.document.activeElement.id, 'viewport');
    assert.equal(a.w.document.activeElement.closest('[hidden]'), null);
    a.Interaction.clearMultiSelection(); a.Interaction.deselect(); a.frame(32); layout.render();
    assert.equal(layout.toolbar.hidden, true); assert.equal(layout.outline.hidden, true);
});

test('multi-selection toolbar follows camera coordinates without reading moved node screen rectangles', async t => {
    for (const cssZoom of [true, false]) {
        const a = await canvasApp(t, { cssZoom }), layout = a.w.CanvasLayout;
        const nodes = [a.node('text', 300, 300), a.node('image', 700, 400)];
        layout.select(nodes); a.frame(16);
        nodes.forEach(n => { n.el.getBoundingClientRect = () => { throw new Error('multi-select must use scene coordinates'); }; });
        for (const scale of [.5, 1, 2]) {
            a.State.canvas = { x: 40, y: 60, scale }; layout.render();
            const expectedTop = Math.max(76, 300 * scale + 60 * (cssZoom ? scale : 1) - 64);
            assert.equal(parseFloat(layout.toolbar.style.top), expectedTop);
        }
    }
});
