const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { createServer } = require('../proxy-server');
const root=path.join(__dirname,'..','无限画布');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N2kAAAAASUVORK5CYII=';
const audio='data:audio/wav;base64,UklGRg==';
const json=(body)=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
async function app(t, database=new IDBFactory(),handler,options={}) {
    const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:`http://127.0.0.1:8787/${options.entry?'?entry=canvas':''}`,runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
    const w=dom.window;w.indexedDB=database;w.CSS={supports:()=>true};w.structuredClone=structuredClone;
    if(options.agentOpen)w.localStorage.setItem('canvas.ui.agent-open','true');
    w.CanvasIcons={icon:()=>w.document.createElementNS('http://www.w3.org/2000/svg','svg'),render:()=>{}};
    const ctx=new Proxy({}, {get:(_,key)=>key==='canvas'?null:()=>{}});w.HTMLCanvasElement.prototype.getContext=()=>ctx;
    w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    w.fetch=async(url,options)=>{
        if(url.endsWith('/api/config'))return json({models:[{id:'gpt-image-2',type:'image',available:true},{id:'chatgpt',type:'text',available:true},{id:'audio-speech',type:'audio',available:true},{id:'seedance',type:'video',available:true,ratios:['16:9','9:16','1:1'],durations:[5,10],inputModes:['first-frame','first-last-frame','reference'],resolutions:['720p','1080p'],maxReferences:4}]});
        return handler?handler(url,options):json({url:audio});
    };
    const source=['project-store.js','script.js','workspace.js','creative.js','canvas-navigation.js','canvas-layout.js','workbench.js','motion.js','timeline.js'].map((f)=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');w.eval(source+'\nwindow.API={State,Interaction,UI,Engine,ProjectStore};');
    if(options.failFreshSave){const save=w.API.ProjectStore.save;w.API.ProjectStore.save=(project,...args)=>project.name==='未命名画布'?Promise.reject(new w.DOMException('fixture full','QuotaExceededError')):save(project,...args);}
    for(let i=0;i<100&&(!w.Workspace.ready||!w.Workspace.config.models.length);i++)await new Promise((r)=>setTimeout(r,5));
    const a={...w.API,w,database,workspace:w.Workspace,creative:w.Creative,timeline:w.Timeline};
    a.node=(type='image',media=null)=>{const el=a.UI.createNode(type,{x:4500,y:4500},media);a.State.nodes.push({el,x:4500,y:4500,type});return el;};
    a.link=(from,to)=>a.Interaction.createLinkBetween(from.querySelector('.conn-right'),to.querySelector('.conn-left'));
    return a;
}

function dragConnector(a,start,hit,x=700,y=500) {
    const doc=a.w.document;
    const mouse=(target,type,clientX,clientY,buttons)=>{
        const event=new a.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons,clientX,clientY});target.dispatchEvent(event);return event;
    };
    doc.elementFromPoint=()=>hit;
    mouse(start.querySelector('.connector-glyph')||start,'mousedown',100,100,1);
    mouse(doc,'mousemove',x,y,1);mouse(hit||doc,'mouseup',x,y,0);
    return mouse(hit||doc,'click',x,y,0);
}

test('workbench first-frame shortcut creates one reversible, persistent image-to-video flow without generating', async(t)=>{
    let requests=0;
    const a=await app(t,new IDBFactory(),async()=>{requests++;return json({url:pixel});});
    a.w.document.querySelector('[data-quick="first-frame"]').click();
    assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);
    const image=a.State.nodes.find(n=>n.type==='image'),video=a.State.nodes.find(n=>n.type==='video');
    assert.equal(a.State.links[0].fromEl.closest('.node'),image.el);
    assert.equal(a.State.links[0].toEl.closest('.node'),video.el);
    assert.equal(video.el.dataset.inputMode,'first-frame');assert.equal(requests,0);
    a.Interaction.undo();assert.equal(a.State.nodes.length,0);assert.equal(a.State.links.length,0);
    a.Interaction.redo();assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);
    await a.workspace.save();const b=await app(t,a.database);
    assert.equal(b.State.nodes.length,2);assert.equal(b.State.links.length,1);
    assert.equal(b.State.nodes.find(n=>n.type==='video').el.dataset.inputMode,'first-frame');
});

test('workbench suggestions never auto-send, conversation navigation preserves history, and menus dismiss with focus',async(t)=>{
    let requests=0;
    const a=await app(t,new IDBFactory(),async()=>{requests++;return json({text:'unused'});});
    const workbench=a.w.Workbench,first=a.creative.activeConversation();first.name='已有创作对话';first.messages.push({role:'user',text:'保留这段历史'});a.creative.renderConversations();
    workbench.newConversation();assert.equal(a.State.conversations.length,2);assert.equal(a.creative.activeConversation().messages.length,0);
    a.w.document.querySelector('.agent-chip').click();assert.match(a.w.document.querySelector('.agent-input').value,/创作风格/);assert.equal(requests,0);assert.equal(a.State.nodes.length,0);
    a.w.document.getElementById('chat-list-btn').click();
    const menu=a.w.document.getElementById('conversation-menu');assert.equal(menu.hidden,false);
    [...menu.querySelectorAll('button')].find(button=>button.textContent==='已有创作对话').click();
    assert.equal(a.creative.chatId,first.id);assert.equal(menu.hidden,true);assert.match(a.w.document.getElementById('chat-messages').textContent,/保留这段历史/);
    const trigger=a.w.document.getElementById('agent-more-btn');trigger.click();assert.equal(trigger.getAttribute('aria-expanded'),'true');
    a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(a.w.document.getElementById('agent-more-menu').hidden,true);assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(a.w.document.activeElement,trigger);
    await a.workspace.save();const b=await app(t,a.database);assert.equal(b.State.conversations.length,2);assert.equal(b.State.conversations.find(chat=>chat.id===first.id).messages[0].text,'保留这段历史');
});

test('capacity limits reject edits and saves without poisoning the last recoverable revision', async(t)=>{
    const a=await app(t),seed=a.node('text'),project=a.workspace.project();
    project.scene.nodes=Array.from({length:a.ProjectStore.MAX_NODES},(_,i)=>({...project.scene.nodes[0],id:`capacity_${i}`}));
    project.history=[];await a.ProjectStore.save(project,a.workspace.revision);
    const bad=structuredClone(project);bad.scene.nodes.push({...bad.scene.nodes[0],id:'overflow'});
    await assert.rejects(a.ProjectStore.save(bad,1),/500/);
    assert.equal((await a.ProjectStore.load()).scene.nodes.length,500);
    const b=await app(t,a.database);assert.equal(b.workspace.ready,true);assert.equal(b.State.nodes.length,500);
    assert.throws(()=>b.node('text'),/500/);assert.equal(b.State.nodes.length,500);
    const original=b.State.nodes[0].el;b.Interaction.focusNode(original);b.Interaction.copySelectedNodes();
    b.Interaction.pasteCopiedNodes();assert.equal(b.State.nodes.length,500);assert.equal(b.State.selection.item,original);
    const oldLinks=a.State.links;a.State.links=Array.from({length:a.ProjectStore.MAX_LINKS},()=>({}));
    const other=a.node('text');assert.throws(()=>a.link(seed,other),/3000/);a.State.links=oldLinks;
    const linked=structuredClone(project);
    linked.scene.links=Array.from({length:3001},(_,i)=>({id:`link_${i}`,fromNodeId:'capacity_0',toNodeId:'capacity_1'}));
    await assert.rejects(a.ProjectStore.save(linked,1),/3000/);
    assert.equal((await a.ProjectStore.load()).revision,1);
});

test('legacy unreadable active records expose an exact raw backup instead of overwriting them',async(t)=>{
    const a=await app(t);a.node('text');const raw=a.workspace.project();raw.name='旧版超限项目';
    raw.scene.nodes=Array.from({length:501},(_,i)=>({...raw.scene.nodes[0],id:`legacy_${i}`}));raw.revision=8;
    await new Promise((resolve,reject)=>{
        const request=a.w.indexedDB.open('infinite_canvas_projects',1);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(raw,'active');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    });
    const b=await app(t,a.database);assert.equal(b.workspace.ready,false);
    assert.equal(b.w.document.getElementById('project-recover-btn').hidden,false);
    let blob;b.workspace.download=(name,value)=>{blob=value;};await b.workspace.exportProject();
    const text=await new Promise((resolve,reject)=>{const reader=new b.w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});
    assert.equal(JSON.parse(text).scene.nodes.length,501);assert.equal(JSON.parse(text).revision,8);
    assert.equal((await b.ProjectStore.load()).scene.nodes.length,501);
});

test('late cleanup of a cancelled generation cannot unregister or stop tracking a replacement',async(t)=>{
    const a=await app(t),node=a.node('image');node.dataset.model='gpt-image-2';node.querySelector('.ai-panel .ai-input').value='生成测试';
    const scene=a.Interaction.captureScene();let releasePrep,releaseResponse;
    a.Interaction.getNodeReferenceFiles=()=>new Promise(resolve=>{releasePrep=()=>resolve([]);});
    a.w.fetch=async(url,options)=>{if(options.signal.aborted)throw new DOMException('Aborted','AbortError');return new Promise(resolve=>{releaseResponse=resolve;});};
    const old=a.Interaction.runAI(node);while(!releasePrep)await new Promise(r=>setTimeout(r,0));
    a.Interaction.restoreScene(scene);const restored=a.State.nodes[0].el;
    a.Interaction.getNodeReferenceFiles=async()=>[];
    const fresh=a.Interaction.runAI(restored);while(!releaseResponse)await new Promise(r=>setTimeout(r,0));
    const controller=a.workspace.pending.get(restored.dataset.nodeId);releasePrep();await old;
    assert.equal(a.workspace.pending.get(restored.dataset.nodeId),controller);assert.equal(restored.querySelector('.send-btn').disabled,true);
    a.workspace.cancelAll();assert.equal(controller.signal.aborted,true);
    releaseResponse(json({url:pixel}));await fresh;assert.equal(restored.querySelector('.media-container img'),null);
    for(const key of ['agent','timeline-export']){const first=new AbortController(),second=new AbortController();a.workspace.pending.set(key,second);assert.equal(a.workspace.finishTask(key,first),false);assert.equal(a.workspace.pending.get(key),second);a.workspace.finishTask(key,second);}
});

test('import conflicts and commit failures preserve the complete current workspace and its undo stack',async(t)=>{
    const a=await app(t);a.creative.renderConversations();a.node('text').querySelector('.text-node-input').value='原始内容';a.w.document.getElementById('project-name').value='原项目';
    a.State.history=[{id:'original',type:'generate',text:'原历史',time:'12:00'}];await a.workspace.save();
    const imported=a.workspace.project();imported.name='导入项目';imported.scene.nodes[0].textValue='导入内容';imported.history=[];
    const file={size:100,text:async()=>JSON.stringify(imported)},before=JSON.stringify(a.workspace.captureWorkspace());
    const b=await app(t,a.database);await b.workspace.save();
    await assert.rejects(a.workspace.importProject(file),/另一个页面/);
    assert.equal(JSON.stringify(a.workspace.captureWorkspace()),before);assert.equal(a.State.undoStack.length,0);
    assert.doesNotMatch(a.w.document.getElementById('toast').textContent,/已导入/);
    const c=await app(t,a.database),beforeCommit=JSON.stringify(c.workspace.captureWorkspace()),realSave=c.ProjectStore.save;let calls=0;
    c.ProjectStore.save=async(...args)=>{if(++calls===2)throw new DOMException('模拟空间不足','QuotaExceededError');return realSave(...args);};
    await assert.rejects(c.workspace.importProject(file),/模拟空间不足/);
    assert.equal(JSON.stringify(c.workspace.captureWorkspace()),beforeCommit);assert.equal(c.State.undoStack.length,0);
    assert.notEqual(c.w.document.body.inert,true);assert.equal(c.workspace.saving,false);
    assert.equal((await c.ProjectStore.load()).name,'原项目');
});

test('import waits for an existing save and undo/redo restores and persists name, scene and history together',async(t)=>{
    const a=await app(t);a.node('text').querySelector('.text-node-input').value='原文';a.w.document.getElementById('project-name').value='原名称';
    a.State.history=[{id:'history_old',type:'generate',text:'原历史',time:'12:00'}];
    const imported=a.workspace.project();imported.name='新名称';imported.scene.nodes[0].textValue='新文';imported.history=[{type:'generate',text:'新历史',time:'13:00'}];
    const realSave=a.ProjectStore.save;let release,calls=0;
    a.ProjectStore.save=async(...args)=>{if(++calls===1)await new Promise(r=>{release=r;});return realSave(...args);};
    const saving=a.workspace.save();const importing=a.workspace.importProject({size:100,text:async()=>JSON.stringify(imported)});
    await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);assert.equal(a.w.document.getElementById('project-name').value,'原名称');
    release();await saving;await importing;
    assert.equal(a.w.document.getElementById('project-name').value,'新名称');
    a.Interaction.undo();assert.equal(a.w.document.getElementById('project-name').value,'原名称');assert.equal(a.State.history[0].text,'原历史');assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value,'原文');
    await a.workspace.save();const reopened=await app(t,a.database);assert.equal(reopened.w.document.getElementById('project-name').value,'原名称');assert.equal(reopened.State.history[0].text,'原历史');reopened.w.close();
    a.Interaction.redo();assert.equal(a.w.document.getElementById('project-name').value,'新名称');assert.equal(a.State.history[0].text,'新历史');assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value,'新文');
    assert.equal(await a.workspace.save(),true);const redone=await app(t,a.database);assert.equal(redone.w.document.getElementById('project-name').value,'新名称');assert.equal(redone.State.history[0].text,'新历史');
});

test('magnetic connector follows the pointer without moving graph anchors, and returns on camera input', async (t) => {
    const a=await app(t), node=a.node('image'), c=node.querySelector('.conn-right'), motion=a.w.CanvasMotion;
    const frames=new Map();let seq=0,now=0;
    a.w.requestAnimationFrame=callback=>{frames.set(++seq,callback);return seq;};
    a.w.cancelAnimationFrame=id=>frames.delete(id);
    const tick=()=>{const callbacks=[...frames.values()];frames.clear();now+=16;callbacks.forEach(callback=>callback(now));};
    c.getBoundingClientRect=()=>({left:300,top:200,width:24,height:24});
    const before=JSON.stringify(a.Interaction.captureScene());
    a.State.canvas.scale=.5; motion.node=node; motion.pointer={x:352,y:242}; motion.update();
    assert.equal(c.classList.contains('is-magnetic'),true);
    tick();const first=parseFloat(c.style.getPropertyValue('--mag-x'));
    assert.ok(first>0&&first<36,'magnet eases toward the pointer in one animation loop');
    for(let i=0;i<30;i++)tick();
    assert.equal(c.style.getPropertyValue('--mag-x'),'36px');
    assert.equal(c.style.getPropertyValue('--mag-y'),'28px');
    assert.equal(c.querySelector('.connector-glyph')!==null,true);
    c.dispatchEvent(new a.w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(c.style.getPropertyValue('--mag-x'),'36px','pressing the displaced glyph must keep its hit area in place until click');
    assert.equal(motion.motionFrame,null);
    motion.pointer={x:332,y:222};motion.update();tick();
    assert.notEqual(c.style.getPropertyValue('--mag-x'),'36px');
    a.State.canvas.scale=1;
    assert.equal(JSON.stringify(a.Interaction.captureScene()),before);
    a.UI.updateCanvas();
    assert.equal(c.style.getPropertyValue('--mag-x'),'');
    assert.equal(c.classList.contains('is-magnetic'),false);
    assert.equal(motion.connectors.size,0);assert.equal(motion.motionFrame,null);
    for(let i=0;i<10;i++)tick();
    assert.equal(c.style.getPropertyValue('--mag-x'),'','no old animation may repaint after camera reset');
});

test('connector return uses one loop and manipulation cancels every pending position',async(t)=>{
    const a=await app(t),node=a.node('image'),c=node.querySelector('.conn-right'),motion=a.w.CanvasMotion;
    const frames=new Map();let seq=0,now=0;
    a.w.requestAnimationFrame=callback=>{frames.set(++seq,callback);return seq;};a.w.cancelAnimationFrame=id=>frames.delete(id);
    const tick=()=>{const callbacks=[...frames.values()];frames.clear();now+=16;callbacks.forEach(callback=>callback(now));};
    c.getBoundingClientRect=()=>({left:300,top:200,width:24,height:24});
    motion.node=node;motion.pointer={x:352,y:242};motion.update();tick();
    const displaced=parseFloat(c.style.getPropertyValue('--mag-x'));
    motion.pointer={x:800,y:800};motion.update();motion.update();
    assert.equal(frames.size,1,'pointer changes must not stack return animations');
    tick();assert.ok(parseFloat(c.style.getPropertyValue('--mag-x'))<displaced);
    for(let i=0;i<50;i++)tick();
    assert.equal(motion.active.size,0);assert.equal(frames.size,0);
    motion.node=node;motion.pointer={x:352,y:242};motion.update();tick();
    a.Interaction.setManipulating(true);
    assert.equal(c.style.getPropertyValue('--mag-x'),'');assert.equal(frames.size,0);assert.equal(motion.connectors.size,0);
    tick();assert.equal(c.classList.contains('is-magnetic'),false);
});

test('magnetic feedback yields to dragging, touch and reduced motion and never changes button text', async (t) => {
    const a=await app(t), motion=a.w.CanvasMotion, button=a.w.document.getElementById('project-menu-toggle');
    button.getBoundingClientRect=()=>({left:10,top:10,right:210,bottom:50,width:200,height:40});
    const label=button.textContent;
    motion.button=button;motion.pointer={x:120,y:40};motion.update();
    assert.equal(button.style.getPropertyValue('--mag-x'),'1px');
    assert.equal(button.textContent,label);
    a.Interaction.isPanning=true;motion.update();assert.equal(button.classList.contains('is-magnetic'),false);
    a.Interaction.isPanning=false;motion.button=button;motion.reduced={matches:true};motion.update();
    assert.equal(button.classList.contains('is-magnetic'),false);
});

test('creation menus preserve camera and intent: canvas location stays independent, connectors link explicitly', async (t) => {
    const a = await app(t), doc = a.w.document, source = a.node('text');
    a.Interaction.focusNode(source);
    const camera = JSON.stringify(a.State.canvas), expected = a.Engine.screenToCanvas(730, 340);
    a.Interaction.openNodeMenuAt(730, 340);
    doc.querySelector('#nodeMenu [data-type="image"]').click();
    assert.equal(a.State.links.length, 0, 'a selected node must not turn general creation into a linked operation');
    assert.equal(a.State.nodes[1].x, expected.x);
    assert.equal(a.State.nodes[1].y, expected.y);
    assert.equal(JSON.stringify(a.State.canvas), camera, 'creation must not recenter the scene');
    a.Interaction.openNodeMenuAt(400, 300, source.querySelector('.conn-right'));
    assert.equal(doc.querySelector('[data-tool="timeline"]').hidden, true);
    assert.equal(doc.getElementById('menu-link-preview').hidden, false);
    doc.querySelector('#nodeMenu [data-type="image"]').click();
    assert.equal(a.State.links.length, 1);
    assert.equal(a.State.links[0].fromEl.closest('.node'), source);
    assert.equal(JSON.stringify(a.State.canvas), camera);
    assert.equal(doc.getElementById('menu-link-preview').hidden, true);
    a.Interaction.undo();
    assert.equal(a.State.nodes.length, 2);
    assert.equal(a.State.links.length, 0);
});

test('nested menu keyboard and pointer paths preserve focus and dismiss without creating a node', async (t) => {
    const a = await app(t), doc = a.w.document, add = doc.getElementById('ui-add-btn');
    const trigger = doc.getElementById('scene-menu-trigger'), submenu = doc.getElementById('scene-submenu');
    const key = (el, value) => el.dispatchEvent(new a.w.KeyboardEvent('keydown', { key:value, bubbles:true, cancelable:true }));
    add.click();
    assert.equal(doc.activeElement, doc.querySelector('#nodeMenu button'));
    key(doc.activeElement, 'End');
    assert.equal(doc.activeElement.id, 'global-upload-btn');
    trigger.focus(); key(trigger, 'ArrowRight');
    assert.equal(submenu.hidden, false);
    assert.equal(doc.activeElement, submenu.querySelector('button'));
    key(doc.activeElement, 'Escape');
    assert.equal(submenu.hidden, true);
    assert.equal(doc.activeElement, trigger);
    assert.equal(doc.getElementById('nodeMenu').style.display, 'block');
    key(trigger, 'Escape');
    assert.equal(doc.activeElement, add);
    assert.equal(add.getAttribute('aria-expanded'), 'false');
    add.click();
    trigger.dispatchEvent(new a.w.MouseEvent('pointerenter'));
    assert.equal(submenu.hidden, false);
    trigger.click();
    assert.equal(submenu.hidden, false, 'clicking an already hovered parent must keep its submenu open');
    doc.getElementById('viewport').dispatchEvent(new a.w.MouseEvent('pointerdown', { bubbles:true }));
    assert.equal(submenu.hidden, true);
    assert.equal(a.State.nodes.length, 0);
});

test('project and node option popovers dismiss on outside press and Escape with accurate toggle state', async (t) => {
    const a = await app(t), doc = a.w.document, node = a.node('image');
    const toggle = doc.getElementById('project-menu-toggle');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    doc.getElementById('ui-add-btn').click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    a.Interaction.closeNodeMenu();
    node.querySelector('.ratio-toggle').click();
    assert.equal(node.querySelector('.ratio-toggle').getAttribute('aria-expanded'), 'true');
    node.querySelector('.ratio-toggle').dispatchEvent(new a.w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
    assert.equal(node.querySelector('.ratio-popover').style.display, 'none');
    assert.equal(node.querySelector('.ratio-toggle').getAttribute('aria-expanded'), 'false');
    toggle.click();
    doc.getElementById('viewport').dispatchEvent(new a.w.MouseEvent('pointerdown', { bubbles:true }));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('text nodes enter editing explicitly and return to draggable content on blur', async (t) => {
    const a = await app(t), node = a.node('text'), text = node.querySelector('.text-node-input');
    assert.equal(text.readOnly, true);
    node.querySelector('.node-box').dispatchEvent(new a.w.MouseEvent('dblclick', { bubbles:true }));
    assert.equal(text.readOnly, false);
    assert.equal(a.w.document.activeElement, text);
    text.value = '双击编辑后保留的文本'; text.blur();
    assert.equal(text.readOnly, true);
    assert.equal(text.value, '双击编辑后保留的文本');
    text.focus(); text.dispatchEvent(new a.w.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
    assert.equal(text.readOnly, false);
});

test('profile menu exposes same-site login return, keeps settings accessible and preserves the canvas on save failure', async (t) => {
    const a = await app(t), doc = a.w.document, profile = doc.getElementById('rail-profile-btn');
    const node = a.node('text'), original = node.dataset.nodeId;
    profile.click(); const menu = doc.getElementById('profile-menu'), link = menu.querySelector('a');
    assert.equal(menu.hidden, false); assert.equal(profile.getAttribute('aria-expanded'), 'true');
    assert.equal(link.pathname, '/zh-CN/login'); assert.equal(link.origin, a.w.location.origin);
    assert.equal(doc.activeElement, link);
    link.dispatchEvent(new a.w.KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    assert.equal(menu.hidden, true); assert.equal(doc.activeElement, profile);
    profile.click(); menu.querySelector('button').click();
    assert.equal(doc.getElementById('settings-dialog').open, true);
    doc.getElementById('settings-dialog').close();
    profile.click();
    let saves = 0; a.ProjectStore.save = async () => { saves++; throw new Error('fixture save failed'); };
    const click = new a.w.MouseEvent('click', { button:0, bubbles:true, cancelable:true });
    link.dispatchEvent(click); assert.equal(click.defaultPrevented, true);
    for (let i=0; i<20 && a.w.Workbench.returningToLogin; i++) await new Promise(r => setTimeout(r,5));
    assert.equal(saves, 1); assert.equal(a.w.Workbench.returningToLogin, false);
    assert.equal(link.hasAttribute('aria-disabled'), false); assert.equal(a.w.location.pathname, '/');
    assert.equal(a.State.nodes[0].el.dataset.nodeId, original);
    assert.match(doc.getElementById('toast').textContent, /fixture save failed/);
});

test('renaming commits once on Enter, cancels on Escape, and restores keyboard focus for undo', async (t) => {
    const a=await app(t),doc=a.w.document,node=a.node('text'),id=node.dataset.nodeId,original=node.dataset.nodeName;
    const key=(target,value)=>target.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
    const label=node.querySelector('.node-label');label.focus();key(label,'Enter');
    const input=label.querySelector('input');assert.equal(doc.activeElement,input);input.value='新的节点名称';key(input,'Enter');
    assert.equal(node.dataset.nodeName,'新的节点名称');assert.equal(label.querySelector('input'),null);
    assert.equal(doc.activeElement,label);assert.equal(a.State.undoStack.length,1);
    key(label,'Enter');const cancelled=label.querySelector('input');cancelled.value='不要保存';key(cancelled,'Escape');
    assert.equal(node.dataset.nodeName,'新的节点名称');assert.equal(label.querySelector('input'),null);
    assert.equal(doc.activeElement,label);assert.equal(a.State.undoStack.length,1,'cancelling must not add an undo command');
    label.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));
    assert.equal(a.State.nodes.find(n=>n.el.dataset.nodeId===id).el.dataset.nodeName,original);
    a.Interaction.redo();assert.equal(a.State.nodes.find(n=>n.el.dataset.nodeId===id).el.dataset.nodeName,'新的节点名称');
});

test('Space leaves buttons and their descendants usable while retaining background Space panning',async(t)=>{
    const a=await app(t),doc=a.w.document,view=doc.getElementById('viewport'),add=doc.getElementById('ui-add-btn');
    const key=(target,type='keydown')=>{const event=new a.w.KeyboardEvent(type,{key:' ',code:'Space',bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
    add.focus();assert.equal(key(add).defaultPrevented,false);assert.equal(!!a.Interaction.spaceHeld,false);key(add,'keyup');
    const child=doc.createElement('span');add.appendChild(child);
    assert.equal(key(child).defaultPrevented,false);assert.equal(a.Interaction.spaceHeld,false);key(child,'keyup');
    // JSDOM has no native Space-to-click default action: verify its click path separately.
    add.click();assert.equal(doc.getElementById('nodeMenu').style.display,'block');a.Interaction.closeNodeMenu();
    const node=a.node('text'),label=node.querySelector('.node-label');label.focus();key(label);
    assert.ok(label.querySelector('input'),'the custom role=button keeps its own Space activation');
    assert.equal(a.Interaction.spaceHeld,false);label.querySelector('input').blur();key(label,'keyup');
    doc.activeElement?.blur();a.State.canvas.scale=.5;const before={...a.State.canvas};
    assert.equal(key(view).defaultPrevented,true);assert.equal(a.Interaction.spaceHeld,true);
    view.dispatchEvent(new a.w.MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:100,clientY:100}));
    view.dispatchEvent(new a.w.MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:120,clientY:130}));
    view.dispatchEvent(new a.w.MouseEvent('mouseup',{bubbles:true,button:0,clientX:120,clientY:130}));key(view,'keyup');
    assert.equal(a.State.canvas.x,before.x+40);assert.equal(a.State.canvas.y,before.y+60);
    assert.equal(a.Interaction.spaceHeld,false);assert.equal(a.Interaction.isPanning,false);
});

test('Delete and Backspace respect focused controls and their icons but still delete from canvas focus',async(t)=>{
    const a=await app(t),doc=a.w.document,node=a.node('text'),add=doc.getElementById('ui-add-btn'),view=doc.getElementById('viewport');
    a.Interaction.focusNode(node);const child=doc.createElement('span');add.appendChild(child);
    for(const target of [add,child,node.querySelector('.node-label')]){
        (target===child?add:target).focus();
        for(const key of ['Delete','Backspace'])target.dispatchEvent(new a.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
        assert.equal(a.State.nodes.length,1);assert.equal(a.State.selection.item,node);assert.equal(a.State.undoStack.length,0);
    }
    doc.activeElement?.blur();view.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
    assert.equal(a.State.nodes.length,0);assert.equal(a.State.undoStack.length,1);
    a.Interaction.undo();assert.equal(a.State.nodes.length,1);
    a.Interaction.focusNode(a.State.nodes[0].el);doc.activeElement?.blur();
    view.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));assert.equal(a.State.nodes.length,0);
});

test('Agent composer preserves IME and multiline keys while Enter sends once and retains modifier shortcuts',async(t)=>{
    let requests=0;const a=await app(t,undefined,async()=>{requests++;return json({text:'创作回复'});}),input=a.w.document.querySelector('.agent-input');
    const key=options=>{const event=new a.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options});input.dispatchEvent(event);return event;};
    input.value='我的创作需求';input.focus();
    for(const options of [{isComposing:true},{keyCode:229},{shiftKey:true},{repeat:true},{altKey:true}])assert.equal(key(options).defaultPrevented,false);
    assert.equal(requests,0);assert.equal(input.value,'我的创作需求');
    assert.equal(key({}).defaultPrevented,true);key({repeat:true});assert.equal(requests,1);
    for(let i=0;i<50&&a.workspace.pending.has('agent');i++)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(a.workspace.pending.has('agent'),false);assert.equal(a.creative.activeConversation().messages.filter(m=>m.role==='assistant').length,1);
    for(const modifier of ['ctrlKey','metaKey']){
        input.value='快捷键继续创作';assert.equal(key({[modifier]:true}).defaultPrevented,true);
        for(let i=0;i<50&&a.workspace.pending.has('agent');i++)await new Promise(resolve=>setTimeout(resolve,2));
    }
    assert.equal(requests,3);assert.equal(a.creative.activeConversation().messages.filter(m=>m.role==='assistant').length,3);
});

test('Agent stop aborts only its request, ignores late replies, preserves input and permits another send',async(t)=>{
    const waiting=[];const a=await app(t,undefined,async(url,options)=>new Promise(resolve=>waiting.push({resolve,signal:options.signal}))),doc=a.w.document,input=doc.querySelector('.agent-input'),button=doc.getElementById('agent-send-btn');
    const other=new AbortController();a.workspace.pending.set('node-fixture',other);
    input.value='停止后保留这段需求';const task=a.creative.submitAgent();
    assert.equal(waiting.length,1);assert.equal(button.dataset.mode,'stop');assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-label'),'停止 Agent 回复');
    button.click();assert.equal(waiting[0].signal.aborted,true);assert.equal(other.signal.aborted,false);assert.equal(button.disabled,true);
    waiting[0].resolve(json({text:'停止后晚到的回复'}));await task;
    assert.equal(a.creative.activeConversation().messages.some(m=>m.role==='assistant'),false);
    assert.equal(input.value,'停止后保留这段需求');assert.equal(a.workspace.pending.has('agent'),false);assert.equal(a.workspace.pending.get('node-fixture'),other);
    assert.equal(button.dataset.mode,'send');assert.equal(button.disabled,false);assert.match(doc.getElementById('agent-status').textContent,/已停止/);
    input.value='重新发送';const retry=a.creative.submitAgent();assert.equal(waiting.length,2);
    waiting[1].resolve(json({text:'重新发送的回复'}));await retry;
    assert.deepEqual(Array.from(a.creative.activeConversation().messages.filter(m=>m.role==='assistant'),m=>m.text),['重新发送的回复']);
    input.value='再次停止';const final=a.creative.submitAgent();button.click();input.value='后来手动输入的需求';
    waiting[2].resolve(json({text:'又一个晚到回复'}));await final;
    assert.equal(input.value,'后来手动输入的需求');assert.equal(other.signal.aborted,false);assert.equal(button.dataset.mode,'send');
});

test('blur, hidden pages and Escape cancel connector drags without reviving them on the next node drag',async(t)=>{
    for(const reason of ['blur','hidden','Escape']){
        const a=await app(t),doc=a.w.document,node=a.node('text'),connector=node.querySelector('.conn-right');a.State.canvas.scale=1;
        const mouse=(target,type,x,y,buttons=1)=>target.dispatchEvent(new a.w.MouseEvent(type,{bubbles:true,button:0,buttons,clientX:x,clientY:y}));
        mouse(connector.querySelector('.connector-glyph'),'mousedown',100,100);mouse(doc,'mousemove',120,100);
        await new Promise(resolve=>setTimeout(resolve,25));
        assert.equal(a.State.linking.active,true,reason);assert.equal(doc.body.classList.contains('is-linking'),true,reason);
        assert.match(doc.getElementById('temp-line').getAttribute('d'),/^M/,reason);
        if(reason==='blur')a.w.dispatchEvent(new a.w.Event('blur'));
        else if(reason==='hidden'){Object.defineProperty(doc,'hidden',{configurable:true,value:true});doc.dispatchEvent(new a.w.Event('visibilitychange'));}
        else doc.body.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        await new Promise(resolve=>setTimeout(resolve,25));
        assert.equal(a.State.linking.active,false,reason);assert.equal(a.State.linking.startEl,null,reason);
        assert.equal(doc.body.classList.contains('is-linking'),false,reason);assert.equal(doc.getElementById('temp-line').getAttribute('d'),'',reason);
        assert.equal(a.Interaction.connectorPressTimer,null,reason);assert.equal(a.Interaction.connectorPressEl,null,reason);
        mouse(node.querySelector('.node-box'),'mousedown',100,100);mouse(doc,'mousemove',130,110);mouse(doc,'mouseup',130,110,0);
        assert.equal(a.State.nodes[0].x,4530,reason);assert.equal(a.State.links.length,0,reason);
        assert.equal(a.State.linking.active,false,reason);assert.equal(doc.getElementById('temp-line').getAttribute('d'),'',reason);
    }
});

test('Escape cancels a pending connector long press and normal connector drag still creates one reversible link',async(t)=>{
    const a=await app(t),doc=a.w.document,source=a.node('text'),target=a.node('image'),from=source.querySelector('.conn-right'),to=target.querySelector('.conn-left');
    const mouse=(element,type,x,y,buttons=1)=>{const event=new a.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons,clientX:x,clientY:y});element.dispatchEvent(event);return event;};
    mouse(from,'mousedown',100,100);assert.notEqual(a.Interaction.connectorPressTimer,null);
    from.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(a.Interaction.connectorPressTimer,null);mouse(doc,'mousemove',120,100);assert.equal(a.State.linking.active,false);
    mouse(doc,'mouseup',120,100,0);
    mouse(from,'mousedown',100,100);mouse(doc,'mousemove',120,100);doc.elementFromPoint=()=>to.querySelector('.connector-glyph');
    mouse(to,'mouseup',200,100,0);assert.equal(a.State.links.length,1);assert.equal(a.State.linking.active,false);
    assert.equal(a.State.linking.startEl,null);assert.equal(doc.body.classList.contains('is-linking'),false);
    assert.equal(mouse(to,'click',200,100,0).defaultPrevented,true,'only the release click is suppressed');
    doc.getElementById('ui-add-btn').click();assert.equal(doc.getElementById('nodeMenu').style.display,'block');
    a.Interaction.undo();assert.equal(a.State.links.length,0);a.Interaction.redo();assert.equal(a.State.links.length,1);
});

test('connector drags accept node bodies and preserve source direction from either side',async(t)=>{
    for(const [side,body] of [['right',true],['left',true],['left',false]]){
        const a=await app(t),source=a.node('text'),target=a.node('image');
        const start=source.querySelector(`.conn-${side}`),opposite=target.querySelector(side==='right'?'.conn-left':'.conn-right');
        const release=dragConnector(a,start,body?target.querySelector('.node-box'):opposite.querySelector('.connector-glyph'));
        assert.equal(release.defaultPrevented,true);assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);
        assert.equal(a.State.links[0].fromEl.closest('.node'),side==='right'?source:target);
        assert.equal(a.State.links[0].toEl.closest('.node'),side==='right'?target:source);
        assert.equal(a.State.undoStack.length,1);assert.equal(a.State.linking.active,false);assert.equal(a.State.menuConnectorEl,null);
        a.Interaction.undo();assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,0);
        a.Interaction.redo();assert.equal(a.State.links.length,1);
    }
});

test('connector drops accept readonly text content but never an actively edited textarea',async(t)=>{
    for(const [side,editing] of [['right',false],['left',false],['right',true]]){
        const a=await app(t),doc=a.w.document,source=a.node('image'),target=a.node('text'),text=target.querySelector('.text-node-input');
        text.readOnly=!editing;assert.equal(text.matches('[readonly]'),!editing);
        dragConnector(a,source.querySelector(`.conn-${side}`),text);
        assert.equal(a.State.nodes.length,2);assert.notEqual(doc.getElementById('nodeMenu').style.display,'block');
        assert.equal(a.State.menuConnectorEl,null);assert.equal(a.State.linking.active,false);
        if(editing){
            assert.equal(a.State.links.length,0);assert.equal(a.State.undoStack.length,0);
            assert.match(doc.getElementById('toast').textContent,/节点主体/);
        }else{
            assert.equal(a.State.links.length,1);assert.equal(a.State.undoStack.length,1);
            assert.equal(a.State.links[0].fromEl.closest('.node'),side==='right'?source:target);
            assert.equal(a.State.links[0].toEl.closest('.node'),side==='right'?target:source);
            a.Interaction.undo();assert.equal(a.State.links.length,0);assert.equal(a.State.nodes.length,2);
        }
    }
});

test('dropping either connector on blank canvas opens a cancellable linked creation menu and confirms atomically',async(t)=>{
    for(const side of ['right','left']){
        const a=await app(t),doc=a.w.document,source=a.node('text'),sourceId=source.dataset.nodeId,start=source.querySelector(`.conn-${side}`),view=doc.getElementById('viewport');
        const before=JSON.stringify(a.Interaction.captureScene());
        dragConnector(a,start,view);
        const menu=doc.getElementById('nodeMenu');assert.equal(menu.style.display,'block');assert.equal(menu.dataset.mode,'connect');
        assert.equal(a.State.menuConnectorEl,start);assert.equal(doc.getElementById('menu-link-preview').hidden,false);
        assert.equal(JSON.stringify(a.Interaction.captureScene()),before,'opening must not create a temporary command node');
        menu.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.equal(menu.style.display,'none');assert.equal(a.State.menuConnectorEl,null);assert.equal(a.State.menuFromDrop,false);
        assert.equal(JSON.stringify(a.Interaction.captureScene()),before);assert.equal(a.State.undoStack.length,0);
        dragConnector(a,start,view);
        const expected=a.creative.freePosition(a.Engine.screenToCanvas(700,500),'image',side==='left'?-1:1);
        doc.querySelector('#nodeMenu [data-type="image"]').click();
        assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);assert.equal(a.State.undoStack.length,1);
        const added=a.State.nodes.find(n=>n.el.dataset.nodeId!==sourceId);
        assert.equal(added.x,expected.x);assert.equal(added.y,expected.y);
        assert.equal(a.State.links[0].fromEl.closest('.node'),side==='right'?source:added.el);
        assert.equal(a.State.links[0].toEl.closest('.node'),side==='right'?added.el:source);
        a.Interaction.undo();assert.equal(a.State.nodes.length,1);assert.equal(a.State.links.length,0);
        a.Interaction.redo();assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);
    }
});

test('invalid connector drops never become blank-canvas creation or change the graph',async(t)=>{
    const a=await app(t),doc=a.w.document,first=a.node('text'),second=a.node('image');a.link(first,second);
    const before=JSON.stringify(a.Interaction.captureScene());
    for(const [start,hit,warning] of [
        [second.querySelector('.conn-right'),first.querySelector('.node-box'),/循环/],
        [first.querySelector('.conn-left'),first.querySelector('.node-box'),/自身/],
        [first.querySelector('.conn-right'),second.querySelector('.conn-right'),/输入和输出/],
        [first.querySelector('.conn-right'),second.querySelector('.node-box'),/已经连接/],
        [first.querySelector('.conn-right'),second.querySelector('.send-btn'),/节点主体/],
        [first.querySelector('.conn-right'),doc.getElementById('ui-add-btn'),null],
        [first.querySelector('.conn-right'),null,null]
    ]){
        dragConnector(a,start,hit);
        assert.equal(JSON.stringify(a.Interaction.captureScene()),before);assert.equal(a.State.undoStack.length,0);
        assert.notEqual(doc.getElementById('nodeMenu').style.display,'block');assert.equal(a.State.menuConnectorEl,null);
        assert.equal(a.State.linking.active,false);assert.equal(doc.getElementById('temp-line').getAttribute('d'),'');
        if(warning)assert.match(doc.getElementById('toast').textContent,warning);
    }
});

test('new-node reveal moves only the overflowing distance and leaves a visible node camera unchanged', async (t) => {
    const a = await app(t), doc = a.w.document, viewport = doc.getElementById('viewport'), node = a.node('text');
    Object.defineProperties(viewport, { clientWidth:{value:1200}, clientHeight:{value:900} });
    a.Interaction.setAgentPanelOpen(false); a.State.canvas.scale = .5;
    const original = {...a.State.canvas};
    node.querySelector('.node-box').getBoundingClientRect = () => ({ left:1000, right:1250, top:600, bottom:850 });
    a.Interaction.focusNode(node, { keepCamera:true, reveal:true });
    assert.equal(a.State.canvas.x, original.x - 74 / .5);
    assert.equal(a.State.canvas.y, original.y - 30 / .5);
    const current = JSON.stringify(a.State.canvas);
    node.querySelector('.node-box').getBoundingClientRect = () => ({ left:900, right:1150, top:500, bottom:750 });
    a.Interaction.focusNode(node, { keepCamera:true, reveal:true });
    assert.equal(JSON.stringify(a.State.canvas), current);
});

test('audio node consumes upstream text, saves real response, and survives a browser reopen',async(t)=>{
    let sent;const a=await app(t,undefined,async(url,options)=>{assert.match(url,/\/api\/audio$/);sent=JSON.parse(options.body);return json({url:audio});});
    const text=a.node('text'),sound=a.node('audio');text.querySelector('.text-node-input').value='欢迎来到未来城市';a.link(text,sound);
    sound.querySelector('.ai-panel .ai-input').value='温柔地朗读';sound.querySelector('.audio-voice').value='nova';sound.querySelector('.audio-speed').value='1.25';
    await a.Interaction.runAI(sound);assert.match(sent.prompt,/未来城市/);assert.equal(sent.voice,'nova');assert.equal(sent.speed,1.25);assert.equal(sound.querySelector('audio').src,audio);
    await a.workspace.save();const b=await app(t,a.database);const restored=b.State.nodes.find((n)=>n.type==='audio').el;
    assert.equal(restored.querySelector('audio').src,audio);assert.equal(restored.querySelector('.audio-voice').value,'nova');assert.equal(restored.querySelector('.audio-speed').value,'1.25');assert.equal(b.State.links.length,1);
});

test('Agent preserves conversation context and requires explicit insertion into the graph',async(t)=>{
    const calls=[];const a=await app(t,undefined,async(url,options)=>{calls.push(JSON.parse(options.body));return json({text:`创意方案 ${calls.length}`});});
    const text=a.node('text');text.querySelector('.text-node-input').value='科幻城市角色';a.Interaction.focusNode(text);a.w.document.getElementById('agent-llm-select').value='chatgpt';
    a.w.document.querySelector('.agent-input').value='如何开始';await a.creative.submitAgent();
    assert.equal(a.State.nodes.length,1);assert.match(calls[0].context,/科幻城市角色/);assert.equal(a.State.conversations[0].messages.length,2);
    a.w.document.querySelector('.agent-input').value='继续细化';await a.creative.submitAgent();assert.match(calls[1].context,/创意方案 1/);
    a.w.document.querySelector('.chat-message.assistant button').click();assert.equal(a.State.nodes.length,2);assert.equal(a.State.nodes[1].el.querySelector('.text-node-input').value,'创意方案 1');
    a.w.document.querySelector('.chat-message.assistant button').click();assert.equal(a.State.nodes.length,2);
    await a.workspace.save();const b=await app(t,a.database);assert.equal(b.State.conversations[0].messages.length,4);assert.equal(b.State.nodes.length,2);
});

test('timeline combines sequential visuals and offset audio; edit/undo/reopen preserve clip settings',async(t)=>{
    const a=await app(t);const image=a.node('image',pixel),sound=a.node('audio',audio);a.Interaction.focusNode(image);a.timeline.addSelected();a.timeline.addSelected();a.Interaction.focusNode(sound);a.timeline.addSelected();
    a.Interaction.runSceneCommand({},()=>{a.State.timeline[2].start=2;a.State.timeline[2].trim=.5;a.State.timeline[2].duration=3;a.State.timeline[2].volume=.4;});
    let schedule=a.timeline.schedule();assert.deepEqual(Array.from(schedule.items,(c)=>c.start),[0,4,2]);assert.equal(schedule.duration,8);assert.equal(schedule.items[2].volume,.4);
    a.timeline.editClip(1,'remove');assert.equal(a.State.timeline.length,2);a.Interaction.undo();assert.equal(a.State.timeline.length,3);
    await a.workspace.save();const b=await app(t,a.database);assert.equal(b.State.timeline[2].trim,.5);assert.equal(b.State.timeline[2].start,2);assert.equal(b.State.timeline[2].volume,.4);
});

test('3D scene metadata and GLB assets are portable, reversible, and validated on import',async(t)=>{
    const a=await app(t),node=a.node('scene');
    const spec={camera:[5,3,6],target:[0,1,0],fov:55,background:'#17191c',light:2,objects:[{id:'actor',name:'角色',type:'actor',position:[2,0,0],rotation:[0,1,0],scale:1,color:'#ffccaa'},{id:'asset',name:'测试 GLB',type:'glb',position:[0,0,0],rotation:[0,0,0],scale:1,color:'#bfc2c9',tint:true,asset:'data:model/gltf-binary;base64,Z2xURg=='}]};
    a.creative.commitScene(node,spec);const project=a.ProjectStore.validate(a.workspace.project());assert.equal(project.scene.nodes[0].sceneSpec.objects[0].position[0],2);assert.equal(project.scene.nodes[0].sceneSpec.objects[1].asset,spec.objects[1].asset);assert.equal(project.scene.nodes[0].sceneSpec.objects[1].tint,true);
    a.Interaction.undo();assert.equal(a.State.nodes[0].el.dataset.sceneSpec,undefined);a.Interaction.redo();await a.workspace.save();const b=await app(t,a.database);assert.equal(JSON.parse(b.State.nodes[0].el.dataset.sceneSpec).fov,55);
    const bad=JSON.parse(JSON.stringify(project));bad.scene.nodes[0].sceneSpec.objects[1].asset='https://example.com/model.glb';assert.throws(()=>a.ProjectStore.validate(bad),/GLB/);
});

test('node search, explicit linking, resource filtering and deletion operate on the real graph',async(t)=>{
    const a=await app(t),text=a.node('text'),image=a.node('image',pixel);a.Interaction.applyNodeName(text,'独立角色');a.Interaction.applyNodeName(image,'角色参考图');
    a.creative.openSearch();a.w.document.getElementById('node-search-input').value='独立';a.creative.renderSearch();assert.equal(a.w.document.querySelectorAll('.search-result').length,1);a.w.document.querySelector('.search-result').click();assert.equal(a.State.selection.item,text);
    a.creative.linkSource=text;a.creative.openSearch('link');a.w.document.getElementById('node-search-input').value='参考';a.creative.renderSearch();a.w.document.querySelector('.search-result').click();assert.equal(a.State.links.length,1);
    a.creative.assetFilter='image';a.creative.renderAssets();assert.equal(a.w.document.querySelectorAll('.asset-item').length,1);
    a.Interaction.focusNode(image);a.w.document.querySelector('[data-node-action="delete"]').click();assert.equal(a.State.nodes.length,1);assert.equal(a.State.links.length,0);a.Interaction.undo();assert.equal(a.State.nodes.length,2);assert.equal(a.State.links.length,1);
});

test('video selectors reflect server capabilities and preserve configured input mode on reopen',async(t)=>{
    const a=await app(t),node=a.node('video');assert.equal(node.querySelector('.video-duration').value,'5');assert.equal(node.querySelectorAll('.ratio-item').length,3);
    node.dataset.inputMode='reference';node.dataset.resolution='1080p';node.dataset.ratio='1:1';node.querySelector('.video-duration').value='10';await a.workspace.save();const b=await app(t,a.database);const restored=b.State.nodes[0].el;
    assert.equal(restored.dataset.inputMode,'reference');assert.equal(restored.dataset.resolution,'1080p');assert.equal(restored.querySelector('.video-duration').value,'10');assert.equal(restored.dataset.ratio,'1:1');
});

test('new local canvas archives the old one and switching restores the full graph',async(t)=>{
    const a=await app(t);const original=a.node('text');original.querySelector('.text-node-input').value='第一张画布的内容';a.w.document.getElementById('project-name').value='角色项目';
    await a.workspace.save();const firstId=a.workspace.projectId;await a.creative.newProject();assert.notEqual(a.workspace.projectId,firstId);assert.equal(a.State.nodes.length,0);
    const second=a.node('image',pixel);a.w.document.getElementById('project-name').value='海报项目';await a.workspace.save();const secondId=a.workspace.projectId;
    assert.equal((await a.ProjectStore.listProjects()).length,2);await a.creative.switchProject(firstId);assert.equal(a.State.nodes.length,1);assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value,'第一张画布的内容');assert.equal(a.w.document.getElementById('project-name').value,'角色项目');
    await a.creative.switchProject(secondId);assert.equal(a.State.nodes[0].el.querySelector('img').src,pixel);
    const b=await app(t,a.database);assert.equal(b.workspace.projectId,secondId);assert.equal(b.State.nodes[0].type,'image');
});

test('login and explore entry starts an empty canvas with collapsed assistant and open minimap, preserving the old project and refresh',async(t)=>{
    const a=await app(t),original=a.node('text');original.querySelector('.text-node-input').value='原画布内容需要保留';
    a.w.document.getElementById('project-name').value='已有分镜';a.State.view={minimap:false,snap:true};await a.workspace.save();
    const oldId=a.workspace.projectId;
    const b=await app(t,a.database,undefined,{entry:true,agentOpen:true});
    assert.equal(b.workspace.ready,true);assert.notEqual(b.workspace.projectId,oldId);
    assert.equal(b.State.nodes.length,0);assert.equal(b.State.links.length,0);assert.equal(b.State.timeline.length,0);
    assert.equal(b.w.document.body.classList.contains('agent-open'),false);assert.equal(b.w.document.getElementById('agent-fab').getAttribute('aria-expanded'),'false');
    assert.equal(b.State.view.minimap,true);assert.equal(b.w.document.getElementById('minimap').classList.contains('is-open'),true);
    assert.equal(b.w.document.getElementById('canvas-empty-state').classList.contains('hidden'),false);
    assert.equal(b.w.location.search,'');assert.equal((await b.ProjectStore.listProjects()).length,2);
    const freshId=b.workspace.projectId;b.node('image');await b.workspace.save();
    const refresh=await app(t,a.database);assert.equal(refresh.workspace.projectId,freshId);assert.equal(refresh.State.nodes.length,1);
    assert.equal((await refresh.ProjectStore.listProjects()).length,2,'refresh must restore, not create another blank');
    await refresh.creative.switchProject(oldId);assert.equal(refresh.State.nodes[0].el.querySelector('.text-node-input').value,'原画布内容需要保留');
    assert.equal(refresh.w.document.getElementById('project-name').value,'已有分镜');assert.equal(refresh.State.view.snap,true);
});

test('failed landing creation never replaces the previous active canvas',async(t)=>{
    const a=await app(t),original=a.node('text');original.querySelector('.text-node-input').value='写入失败仍保留';await a.workspace.save();
    const oldId=a.workspace.projectId,b=await app(t,a.database,undefined,{entry:true,failFreshSave:true});
    assert.equal(b.workspace.ready,false);assert.equal((await b.ProjectStore.load()).id,oldId);
    assert.equal((await b.ProjectStore.loadProject(oldId)).scene.nodes[0].textValue,'写入失败仍保留');
    assert.equal((await b.ProjectStore.listProjects()).length,1);assert.equal(b.w.location.search,'?entry=canvas');
});

test('project pill lists and searches actual canvases, switches content and creates a separately saved canvas',async(t)=>{
    const a=await app(t),doc=a.w.document,toggle=doc.getElementById('project-menu-toggle'),panel=doc.querySelector('.project-toolbar');
    a.node('text').querySelector('.text-node-input').value='第一张画布的原文';doc.getElementById('project-name').value='角色构思';await a.workspace.save();const first=a.workspace.projectId;
    await a.creative.newProject();a.node('image',pixel);doc.getElementById('project-name').value='海报设计';await a.workspace.save();const second=a.workspace.projectId;
    await toggle.onclick(new a.w.MouseEvent('click'));
    assert.equal(panel.classList.contains('is-open'),true);assert.equal(doc.activeElement.id,'canvas-search-input');
    assert.equal(panel.querySelectorAll('.canvas-project-row').length,2);
    assert.equal(panel.querySelector('[aria-current=true]').dataset.projectId,second);
    assert.equal(panel.querySelectorAll('.canvas-thumbnail rect').length,2);
    const search=doc.getElementById('canvas-search-input');search.value='角色';search.dispatchEvent(new a.w.Event('input'));
    assert.equal(panel.querySelectorAll('.canvas-project-row').length,1);
    await panel.querySelector('.canvas-project-row').onclick();
    assert.equal(a.workspace.projectId,first);assert.equal(a.State.nodes[0].el.querySelector('.text-node-input').value,'第一张画布的原文');assert.equal(toggle.getAttribute('aria-expanded'),'false');
    await toggle.onclick(new a.w.MouseEvent('click'));search.value='不存在';search.dispatchEvent(new a.w.Event('input'));assert.match(panel.textContent,/没有找到画布/);
    await doc.getElementById('canvas-create-btn').onclick();assert.equal(a.State.nodes.length,0);assert.equal((await a.ProjectStore.listProjects()).length,3);
    assert.equal((await a.ProjectStore.loadProject(first)).scene.nodes[0].textValue,'第一张画布的原文');
    const b=await app(t,a.database);assert.equal(b.workspace.projectId,a.workspace.projectId);assert.equal(b.State.nodes.length,0);
});

test('actual audio upload embeds bytes and refuses replacing an image node with audio',async(t)=>{
    const a=await app(t),input=a.w.document.getElementById('file-input');const file=new a.w.File(['RIFF-audio-fixture'],'sample.wav',{type:'audio/wav'});Object.defineProperty(input,'files',{configurable:true,value:[file]});
    a.State.uploadContext={kind:'global'};await input.onchange({target:input});assert.equal(a.State.nodes[0].type,'audio');assert.match(a.State.nodes[0].el.querySelector('audio').src,/^data:audio\/wav;base64,/);
    const image=a.node('image',pixel);a.State.uploadContext={kind:'node',node:image};await input.onchange({target:input});assert.equal(image.querySelector('img').src,pixel);assert.equal(image.querySelector('audio'),null);
});

test('touch gestures pan at the current zoom, move nodes reversibly and pinch to zoom',async(t)=>{
    const a=await app(t),viewport=a.w.document.getElementById('viewport');a.State.canvas.scale=.5;
    const touch=(target,type,id,x,y)=>{const e=new a.w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});Object.defineProperties(e,{pointerType:{value:'touch'},pointerId:{value:id}});target.dispatchEvent(e);};
    const before={...a.State.canvas};touch(viewport,'pointerdown',1,100,100);touch(viewport,'pointermove',1,120,130);touch(viewport,'pointerup',1,120,130);assert.equal(a.State.canvas.x,before.x+40);assert.equal(a.State.canvas.y,before.y+60);
    const node=a.node('text'),box=node.querySelector('.node-box');touch(box,'pointerdown',2,100,100);touch(viewport,'pointermove',2,120,100);touch(viewport,'pointerup',2,120,100);assert.equal(a.State.nodes[0].x,4540);a.Interaction.undo();assert.equal(a.State.nodes[0].x,4500);
    touch(viewport,'pointerdown',3,100,100);touch(viewport,'pointerdown',4,200,100);touch(viewport,'pointermove',4,300,100);assert.equal(a.State.canvas.scale,1);touch(viewport,'pointerup',4,300,100);touch(viewport,'pointerup',3,100,100);
});

test('wheel movement is screen-consistent and cursor-anchored zoom preserves the pointed content',async(t)=>{
    const a=await app(t),view=a.w.document.getElementById('viewport');
    for(const scale of [.5,2]) {
        a.State.canvas={x:-4500,y:-4500,scale};
        view.onwheel({target:view,deltaX:20,deltaY:40,deltaMode:0,ctrlKey:false,preventDefault(){}});
        assert.equal((a.State.canvas.x+4500)*scale,-20);
        assert.equal((a.State.canvas.y+4500)*scale,-40);
        const before=a.Engine.screenToCanvas(320,210);
        view.onwheel({target:view,deltaY:-70,ctrlKey:true,clientX:320,clientY:210,preventDefault(){}});
        const after=a.Engine.screenToCanvas(320,210);
        assert.ok(Math.abs(before.x-after.x)<.001&&Math.abs(before.y-after.y)<.001);
        a.UI.updateCanvas();
        assert.equal(a.w.document.getElementById('canvas').style.zoom,'');
        assert.match(a.w.document.getElementById('canvas').style.transform,/translate3d.+scale/);
    }
});

test('camera and connector preview do not rebuild graph geometry or save during continuous input',async(t)=>{
    const a=await app(t);a.link(a.node(),a.node());
    await new Promise(r=>setTimeout(r,50));clearTimeout(a.Interaction.persistTimer);
    let lines=0,saves=0;const update=a.UI.updateLines.bind(a.UI);a.UI.updateLines=(...args)=>{lines++;return update(...args);};
    a.workspace.scheduleSave=()=>{saves++;};const view=a.w.document.getElementById('viewport');
    for(let i=0;i<20;i++){view.onwheel({target:view,deltaX:3,deltaY:4,deltaMode:0,preventDefault(){}});a.Interaction.requestRender({tempLine:true});}
    await new Promise(r=>setTimeout(r,50));assert.equal(lines,0);assert.equal(saves,0);
    await new Promise(r=>setTimeout(r,280));assert.equal(saves,1);
    saves=0;a.Interaction.requestRender({tempLine:true});await new Promise(r=>setTimeout(r,280));assert.equal(saves,0);
});

test('batched drag updates only incident edges and blur releases the gesture with reversible coordinates',async(t)=>{
    const a=await app(t),first=a.node(),second=a.node(),third=a.node(),fourth=a.node();a.link(first,second);a.link(third,fourth);
    await new Promise(r=>setTimeout(r,50));let geometry=0;const get=a.Engine.getConnPos.bind(a.Engine);a.Engine.getConnPos=(el)=>{geometry++;return get(el);};
    a.w.document.body.onmousedown({target:first.querySelector('.node-box'),button:0,clientX:200,clientY:200,preventDefault(){}});
    a.w.onmousemove({clientX:230,clientY:220});a.w.onmousemove({clientX:250,clientY:240});
    assert.equal(first.style.left,'4500px');
    await new Promise(r=>setTimeout(r,40));assert.equal(first.style.left,'4550px');assert.equal(geometry,2);
    a.w.onblur();assert.equal(a.Interaction.dragNode,null);assert.equal(a.Interaction.isPanning,false);assert.equal(a.Interaction.inertiaRAF,null);
    a.Interaction.undo();assert.equal(a.State.nodes[0].x,4500);a.Interaction.redo();assert.equal(a.State.nodes[0].x,4550);
});

test('grid snapping leaves a click unchanged and records only an actual snapped move for undo',async(t)=>{
    const a=await app(t),node=a.node(),target=node.querySelector('.node-box');a.State.view={snap:true};
    const down=()=>a.w.document.body.onmousedown({target,button:0,clientX:100,clientY:100,preventDefault(){}});
    down();a.w.onmouseup();assert.equal(a.State.nodes[0].x,4500);assert.equal(a.State.undoStack.length,0);
    down();a.w.onmousemove({clientX:130,clientY:100});a.w.onmouseup();
    assert.equal(a.State.nodes[0].x,4536);assert.equal(a.State.nodes[0].y,4512);assert.equal(node.style.left,'4536px');
    a.Interaction.undo();assert.equal(a.State.nodes[0].x,4500);assert.equal(a.State.nodes[0].y,4500);
});

test('new links queued in the same frame as a drag still receive complete geometry',async(t)=>{
    const a=await app(t),first=a.node(),second=a.node(),third=a.node(),fourth=a.node();a.link(first,second);
    await new Promise(r=>setTimeout(r,40));a.link(third,fourth);
    a.Interaction.moveNode(a.State.nodes[0],10,0);a.Interaction.requestRender({lines:true,nodePositions:true});
    await new Promise(r=>setTimeout(r,40));assert.match(a.State.links[1].pathEl.getAttribute('d'),/^M/);
});

test('reference gestures separate marquee selection from camera panning and keep the active editor selected',async(t)=>{
    const a=await app(t),node=a.node(),view=a.w.document.getElementById('viewport');a.State.canvas.scale=.5;
    a.State.selection={type:'node',item:node};node.classList.add('selected');
    const before={...a.State.canvas};
    view.onmousedown({target:view,button:0,clientX:10,clientY:10,preventDefault(){}});
    assert.equal(a.Interaction.isMarqueeSelecting,true);assert.equal(a.Interaction.isPanning,false);
    a.w.onmousemove({clientX:40,clientY:40});a.w.onmouseup();assert.deepEqual({...a.State.canvas},before);
    a.State.selection={type:'node',item:node};node.classList.add('selected');a.Interaction.spaceHeld=true;
    view.onmousedown({target:view,button:0,clientX:100,clientY:100,preventDefault(){}});
    a.w.onmousemove({clientX:120,clientY:130});a.w.onmouseup();a.Interaction.spaceHeld=false;
    assert.equal(a.State.selection.item,node);assert.equal(a.State.canvas.x,before.x+40);assert.equal(a.State.canvas.y,before.y+60);
    view.onwheel({target:view,deltaX:0,deltaY:20,deltaMode:0,preventDefault(){}});assert.equal(a.State.selection.item,node);
});

test('a node selects on pointer down and group drag preserves the group after the following click',async(t)=>{
    const a=await app(t),first=a.node(),second=a.node(),target=first.querySelector('.node-box');
    const down=()=>a.w.document.body.onmousedown({target,button:0,clientX:100,clientY:100,preventDefault(){}});
    first.querySelector('.ai-panel .ai-input').focus();down();assert.equal(a.State.selection.item,first);assert.equal(a.w.document.activeElement,a.w.document.body);a.w.onmouseup();
    a.State.multiSelection=[first,second];first.classList.add('multi-selected');second.classList.add('multi-selected');
    down();a.w.onmousemove({clientX:130,clientY:100});a.w.onmouseup();a.w.document.body.onclick({target});
    assert.equal(a.State.multiSelection.length,2);assert.equal(a.State.nodes[0].x,4530);assert.equal(a.State.nodes[1].x,4530);
});

test('marquee input batches into one frame and the final pointer position is committed on release',async(t)=>{
    const a=await app(t),node=a.node(),view=a.w.document.getElementById('viewport');
    node.getBoundingClientRect=()=>({left:50,top:50,right:80,bottom:80,width:30,height:30});
    let updates=0;const update=a.Interaction.updateMarqueeSelection.bind(a.Interaction);a.Interaction.updateMarqueeSelection=(...args)=>{updates++;return update(...args);};
    view.onmousedown({target:view,button:0,clientX:20,clientY:20,preventDefault(){}});
    for(let i=0;i<20;i++)a.w.onmousemove({clientX:30+i,clientY:30+i});
    assert.equal(updates,0);await new Promise(r=>setTimeout(r,40));assert.equal(updates,1);
    a.w.onmousemove({clientX:100,clientY:100});a.w.onmouseup();assert.equal(a.State.selection.item,node);assert.equal(a.State.multiSelection.length,1);
});

test('the shipped GLTF loader parses an embedded GLB without remote resource requests',async()=>{
    const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
    const positions=new Float32Array([-1,0,0,1,0,0,0,2,0]),bytes=Buffer.from(positions.buffer);
    const data=JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:bytes.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bytes.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,2,0]}]});
    const encoded=Buffer.from(data.padEnd(Math.ceil(Buffer.byteLength(data)/4)*4,' ')),glb=Buffer.alloc(28+encoded.length+bytes.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(encoded.length,12);glb.writeUInt32LE(0x4e4f534a,16);encoded.copy(glb,20);const start=20+encoded.length;glb.writeUInt32LE(bytes.length,start);glb.writeUInt32LE(0x004e4942,start+4);bytes.copy(glb,start+8);
    const loaded=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.length),'');assert.equal(loaded.scene.children.length,1);assert.equal(loaded.scene.children[0].geometry.attributes.position.count,3);
});

async function server(t,env,fetchImpl) {const s=createServer({env,fetch:fetchImpl,jobFile:null,audit:()=>{}});await new Promise((r)=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.close();s.closeAllConnections();});const base=`http://127.0.0.1:${s.address().port}`;return {base,post:(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};}
test('audio endpoint forwards speech inputs, returns portable audio and rejects invalid values before charging',async(t)=>{
    const calls=[];const {post,base}=await server(t,{AUDIO_API_BASE:'https://audio.example',AUDIO_API_KEY:'private-audio-key',AUDIO_MODEL:'fixture-speech'},async(url,options)=>{calls.push({url,...options});return new Response(Buffer.from('fixture-audio'),{headers:{'Content-Type':'audio/mpeg'}});});
    const result=await post('/api/audio',{model:'audio-speech',prompt:'你好',voice:'nova',speed:1.2});assert.equal(result.status,200);assert.match((await result.json()).url,/^data:audio\/mpeg;base64,/);assert.equal(JSON.parse(calls[0].body).input,'你好');assert.match(calls[0].url,/\/v1\/audio\/speech$/);
    assert.equal((await post('/api/audio',{model:'audio-speech',prompt:'你好',voice:'bad'})).status,400);assert.equal((await post('/api/audio',{model:'audio-speech',prompt:'你好',speed:-1})).status,400);assert.equal(calls.length,1);assert.ok(!(await (await fetch(base+'/api/config')).text()).includes('private-audio-key'));
});

test('configured JSON video supports reference mode, resolution and supplier-specific durations',async(t)=>{
    let payload;const {post}=await server(t,{VIDEO_API_STYLE:'json-task',VIDEO_API_KEY:'fixture',SEEDANCE_MODEL:'video-model',VIDEO_INPUT_MODES:'first-frame,first-last-frame,reference',VIDEO_MAX_REFERENCES:'4',VIDEO_DURATIONS:'5,10',VIDEO_RATIOS:'16:9,1:1',VIDEO_RESOLUTIONS:'720p,1080p'},async(url,options)=>{payload=JSON.parse(options.body);return json({id:'task-1',status:'queued'});});
    const response=await post('/api/videos',{model:'seedance',prompt:'运镜',ratio:'1:1',duration:5,mode:'reference',resolution:'1080p',images:[pixel,pixel,pixel]});assert.equal(response.status,200);assert.equal(payload.input_mode,'reference');assert.equal(payload.images.length,3);assert.equal(payload.resolution,'1080p');
    assert.equal((await post('/api/videos',{model:'seedance',prompt:'运镜',ratio:'1:1',duration:5,mode:'first-frame',images:[pixel,pixel]})).status,400);
});

test('static migration assets and required third-party notices are served',async(t)=>{const {base}=await server(t,{},async()=>{throw new Error('no paid calls');});for(const asset of ['creative.css','creative.js','timeline.js','scene3d.js','vendor-icons.js','media-encoder.js','THIRD_PARTY_NOTICES.txt'])assert.equal((await fetch(`${base}/${asset}`)).status,200);assert.equal((await fetch(`${base}/private.txt`)).status,404);});
