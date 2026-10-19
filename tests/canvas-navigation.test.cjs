const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canvasApp } = require('./support/canvas-app.cjs');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('edge navigation keeps grabbed nodes under the pointer at every zoom and uses bounded screen speed', async t => {
    let expectedPan;
    for (const cssZoom of [true, false]) for (const scale of [.5, 1, 2]) {
        const a = await canvasApp(t, { cssZoom }); a.State.canvas.scale = scale;
        const node = a.node(), box = node.el.querySelector('.node-box');
        a.mouse(box, 'mousedown', 970, 770); a.mouse(box, 'mousemove', 990, 790);
        const grabbed = a.screen(node), cameraBefore = a.State.canvas.x, cameraYBefore = a.State.canvas.y;
        a.frame(16);
        const firstPan = (a.State.canvas.x - cameraBefore) * (cssZoom ? scale : 1);
        if (expectedPan === undefined) expectedPan = firstPan;
        near(firstPan, expectedPan); assert.ok(firstPan < 0);
        near((a.State.canvas.y - cameraYBefore) * (cssZoom ? scale : 1), expectedPan);
        near(a.screen(node).x, grabbed.x); near(a.screen(node).y, grabbed.y);
        assert.equal(parseFloat(node.el.style.left), node.x, 'node positions flush in the camera frame');
        assert.equal(a.frames.size, 1, 'only the core renderer schedules the next frame');
        const previous = a.State.canvas.x; a.frame(1016);
        assert.ok(Math.abs((a.State.canvas.x - previous) * (cssZoom ? scale : 1)) <= a.navigation.speed * .04 + 1e-8);
        near(a.screen(node).x, grabbed.x);
        a.mouse(box, 'mouseup', 990, 790, 0);
    }
});

test('stationary hover, background pan and obscured assistant space never start edge navigation', async t => {
    const a = await canvasApp(t), node = a.node(), box = node.el.querySelector('.node-box');
    a.mouse(box, 'mousemove', 990, 400, 0); a.frame(16); near(a.State.canvas.x, 0);
    a.mouse(a.viewport, 'mousedown', 970, 400); a.mouse(a.viewport, 'mousemove', 990, 400); a.frame(32); near(a.State.canvas.x, 0);
    a.mouse(a.viewport, 'mouseup', 990, 400, 0);
    a.w.document.body.classList.add('agent-open');
    a.w.document.querySelector('.agent-panel').getBoundingClientRect = () => ({ left: 700, right: 1000, width: 300 });
    a.mouse(box, 'mousedown', 650, 400); a.mouse(box, 'mousemove', 690, 400); a.frame(48);
    assert.ok(a.State.canvas.x < 0, 'the exposed canvas edge stops before the assistant');
    a.mouse(box, 'mousemove', 800, 400); const before = a.State.canvas.x; a.frame(64); near(a.State.canvas.x, before);
    a.mouse(box, 'mouseup', 800, 400, 0);
});

test('mouse release, blur, hidden state and Escape stop edge motion immediately and save once after the gesture', async t => {
    for (const ending of ['mouseup', 'blur', 'hidden', 'Escape']) {
        const a = await canvasApp(t), node = a.node(), box = node.el.querySelector('.node-box');
        let queued = 0; const queueSave = a.Interaction.queueSave.bind(a.Interaction);
        a.Interaction.queueSave = () => { queued++; queueSave(); };
        a.mouse(box, 'mousedown', 970, 400); a.mouse(box, 'mousemove', 990, 400);
        const initial = queued; a.frame(16); a.frame(32); a.frame(48);
        assert.equal(queued, initial, 'continuous edge frames do not queue persistence');
        if (ending === 'mouseup') a.mouse(box, 'mouseup', 990, 400, 0);
        if (ending === 'blur') a.w.dispatchEvent(new a.w.Event('blur'));
        if (ending === 'hidden') { Object.defineProperty(a.w.document, 'hidden', { value: true, configurable: true }); a.w.document.dispatchEvent(new a.w.Event('visibilitychange')); }
        if (ending === 'Escape') a.w.document.body.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const stopped = a.State.canvas.x, afterStop = queued; a.frame(64); a.frame(80);
        near(a.State.canvas.x, stopped); assert.equal(a.navigation.gesture, null);
        assert.equal(afterStop, initial + 1); assert.equal(queued, afterStop);
    }
});

test('edge frames update only incident link geometry while connection drags update their preview in the camera frame', async t => {
    const a = await canvasApp(t), first = a.node(), second = a.node(), third = a.node(), fourth = a.node();
    a.Interaction.createLinkBetween(first.el.querySelector('.conn-right'), second.el.querySelector('.conn-left'));
    a.Interaction.createLinkBetween(third.el.querySelector('.conn-right'), fourth.el.querySelector('.conn-left')); a.frame(0);
    let geometry = 0; const get = a.Engine.getConnPos.bind(a.Engine); a.Engine.getConnPos = el => { geometry++; return get(el); };
    const box = first.el.querySelector('.node-box'); a.mouse(box, 'mousedown', 970, 400); a.mouse(box, 'mousemove', 990, 400); a.frame(16);
    assert.equal(geometry, 2, 'the independent edge is not rebuilt');
    a.mouse(box, 'mouseup', 990, 400, 0); a.frame(32);
    const connector = first.el.querySelector('.conn-left'); a.mouse(connector, 'mousedown', 970, 400); a.mouse(connector, 'mousemove', 990, 400);
    const before = first.x, camera = a.State.canvas.x; a.frame(48);
    assert.ok(a.State.canvas.x < camera); near(first.x, before);
    const mouse = a.Engine.screenToCanvas(990, 400), start = get(connector);
    assert.equal(a.w.document.getElementById('temp-line').getAttribute('d'), a.Engine.getCurvePath(mouse.x, mouse.y, start.x, start.y));
    assert.equal(geometry, 3, 'connection preview does not redraw saved edges');
    a.w.dispatchEvent(new a.w.Event('blur'));
});

test('single-finger node drags receive compensation but background touch and pinches do not auto-pan', async t => {
    const a = await canvasApp(t), node = a.node(), box = node.el.querySelector('.node-box'); a.State.canvas.scale = .5;
    a.touch(box, 'pointerdown', 1, 970, 400); a.touch(a.viewport, 'pointermove', 1, 990, 400);
    const grabbed = a.screen(node); a.frame(16); assert.ok(a.State.canvas.x < 0); near(a.screen(node).x, grabbed.x);
    a.touch(a.viewport, 'pointerdown', 2, 500, 400); const before = a.State.canvas.x; a.frame(32); near(a.State.canvas.x, before);
    a.touch(a.viewport, 'pointerup', 2, 500, 400); a.touch(a.viewport, 'pointerup', 1, 990, 400);
    a.touch(a.viewport, 'pointerdown', 3, 970, 400); a.touch(a.viewport, 'pointermove', 3, 990, 400);
    const afterBackground = a.State.canvas.x; a.frame(48); near(a.State.canvas.x, afterBackground);
    a.touch(a.viewport, 'pointerup', 3, 990, 400);
});

test('group title drags preserve every member under the pointer despite stopped mouse propagation', async t => {
    const a = await canvasApp(t), first = a.node(), second = a.node('text', 800, 600);
    a.w.CanvasLayout.select([first, second]); a.w.CanvasLayout.group(); a.frame(0);
    const header = a.w.document.querySelector('.canvas-group-title'); assert.ok(header);
    a.mouse(header, 'mousedown', 970, 400); a.mouse(header, 'mousemove', 990, 400);
    assert.equal(a.Interaction.dragNodes.length, 2);
    const grabbed = [a.screen(first), a.screen(second)], gap = { x: second.x - first.x, y: second.y - first.y };
    a.frame(16); a.frame(32); assert.ok(a.State.canvas.x < 0);
    [first, second].forEach((node, i) => { near(a.screen(node).x, grabbed[i].x); near(a.screen(node).y, grabbed[i].y); });
    near(second.x - first.x, gap.x); near(second.y - first.y, gap.y);
    a.mouse(header, 'mouseup', 990, 400, 0); const stopped = a.State.canvas.x; a.frame(48); near(a.State.canvas.x, stopped);
});

test('pending camera and workspace saves wait for an active connection drag to end', async t => {
    const a = await canvasApp(t), node = a.node(), connector = node.el.querySelector('.conn-right');
    let writes = 0; const save = a.ProjectStore.save.bind(a.ProjectStore);
    a.ProjectStore.save = (...args) => { writes++; return save(...args); };
    a.Interaction.queueSave(); a.w.Workspace.scheduleSave();
    a.mouse(connector, 'mousedown', 970, 400); a.mouse(connector, 'mousemove', 990, 400); a.frame(16); a.frame(32);
    assert.equal(a.State.linking.active, true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(writes, 0, 'timers from before the connection drag must not persist mid-gesture');
    assert.equal(await a.w.Workspace.save(), false, 'an explicit queued save also yields to the active drag');
    assert.equal(writes, 0);
    a.w.dispatchEvent(new a.w.Event('blur'));
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(writes, 1, 'the deferred changes persist after the drag has ended');
});

test('released long-press click-to-connect mode does not block saving the current graph', async t => {
    const a = await canvasApp(t), node = a.node(), connector = node.el.querySelector('.conn-right');
    a.mouse(connector, 'mousedown', 400, 300);
    await new Promise(resolve => setTimeout(resolve, 280));
    a.mouse(connector, 'mouseup', 400, 300, 0); a.mouse(connector, 'click', 400, 300, 0);
    assert.equal(a.State.linking.active, true, 'click-to-connect mode stays available after releasing the press');
    assert.equal(a.navigation.gesture, null, 'there is no held drag or edge navigation');
    assert.equal(await a.w.Workspace.save(), true);
    assert.equal((await a.ProjectStore.load()).scene.nodes.length, 1);
    a.w.dispatchEvent(new a.w.Event('blur'));
});

test('fixture teardown drains in-flight autosave before closing its document', async t => {
    const a = await canvasApp(t); a.node();
    let complete;
    a.ProjectStore.save = () => new Promise(resolve => { complete = resolve; });
    const saving = a.w.Workspace.save();
    assert.equal(a.w.Workspace.saving, true);
    let closed = false; const disposal = a.dispose().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false, 'teardown must not close the document before the save continuation');
    assert.ok(a.w.document.getElementById('project-status'));
    complete(1); await saving; await disposal;
    assert.equal(closed, true); assert.equal(a.w.document, undefined);
    await a.dispose();
});
