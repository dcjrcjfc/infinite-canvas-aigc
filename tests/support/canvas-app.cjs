const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..', '..', '无限画布');

async function canvasApp(t, { cssZoom = true } = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
        url: 'http://127.0.0.1:8787/', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window, frames = new Map(); let nextFrame = 0;
    w.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
    w.cancelAnimationFrame = id => frames.delete(id);
    w.indexedDB = new IDBFactory(); w.CSS = { supports: () => cssZoom }; w.structuredClone = structuredClone;
    w.CanvasIcons = { icon: () => w.document.createElementNS('http://www.w3.org/2000/svg', 'svg'), render: () => {} };
    const context = new Proxy({}, { get: () => () => {} });
    w.HTMLCanvasElement.prototype.getContext = () => context;
    w.HTMLMediaElement.prototype.pause = function () {};
    w.HTMLMediaElement.prototype.load = function () {};
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    w.fetch = async () => new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } });
    const source = ['project-store.js', 'script.js', 'workspace.js', 'creative.js', 'canvas-navigation.js', 'canvas-layout.js']
        .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
    w.eval(source + '\nwindow.canvasAPI = { State, Interaction, UI, Engine, ProjectStore };');
    const api = { ...w.canvasAPI, w, frames, navigation: w.CanvasNavigation, viewport: w.document.getElementById('viewport') };
    api.frame = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
    api.mouse = (target, type, x, y, buttons = 1) => target.dispatchEvent(new w.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y
    }));
    api.touch = (target, type, id, x, y) => {
        const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: id } }); target.dispatchEvent(event);
    };
    api.node = (type = 'image', x = 400, y = 300) => {
        const el = api.UI.createNode(type, { x, y }); const node = { el, x, y, type }; api.State.nodes.push(node); return node;
    };
    api.screen = node => ({ x: node.x * api.State.canvas.scale + api.State.canvas.x * (cssZoom ? api.State.canvas.scale : 1), y: node.y * api.State.canvas.scale + api.State.canvas.y * (cssZoom ? api.State.canvas.scale : 1) });
    api.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 });
    Object.defineProperties(api.viewport, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
    for (let i = 0; i < 100 && !w.Workspace.ready; i++) await new Promise(resolve => setTimeout(resolve, 5));
    api.frame(0); api.State.canvas = { x: 0, y: 0, scale: 1 };
    t.after(() => { api.navigation.dispose(); clearTimeout(api.Interaction.persistTimer); dom.window.close(); });
    return api;
}
module.exports = { canvasApp };
