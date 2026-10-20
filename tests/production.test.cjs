const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {canvasApp}=require('./support/canvas-app.cjs');
const pixel='data:image/png;base64,aGVsbG8=';
async function app(t){const a=await canvasApp(t);Object.assign(a.w,a.w.canvasAPI);a.w.eval(fs.readFileSync(path.join(__dirname,'../无限画布/production.js'),'utf8'));a.p=a.w.Production;a.p.init();t.after(()=>a.w.clearTimeout(a.p.refreshTimer));return a;}
test('candidate adoption preserves original and multiple results, undo and portable roundtrip retain selected result',async t=>{
 const a=await app(t),n=a.node('image'),down=a.node('image');
 n.el.querySelector('.media-container').innerHTML=`<img src="${pixel}">`;
 a.Interaction.createLinkBetween(n.el.querySelector('.conn-right'),down.el.querySelector('.conn-left'));
 const old=a.Interaction.captureScene().nodes[0],fp=a.p.fingerprint(n.el);
 a.p.recordResult(n.el,old,{url:pixel,urls:[pixel,'data:image/png;base64,d29ybGQ=']},fp);
 assert.equal(n.el._production.candidates.length,3);
 a.p.adopt(n.el,n.el._production.candidates[2].id);
 assert.match(n.el.querySelector('.media-container img').src,/d29ybGQ=/);
 assert.match(down.el._refs[0].src,/d29ybGQ=/);
 const clean=a.ProjectStore.sceneOf(a.Interaction.captureScene());
 assert.equal(clean.nodes[0].production.candidates.length,3);
 a.Interaction.undo();assert.equal(a.State.nodes[0].el.querySelector('.media-container img').src,pixel);
 a.Interaction.restoreScene(clean);assert.match(a.State.nodes[0].el.querySelector('.media-container img').src,/d29ybGQ=/);
});
test('input changes mark existing results stale, notes are excluded, and undo restores fingerprint',async t=>{
 const a=await app(t),up=a.node('text'),note=a.node('text'),down=a.node('image');
 up.el.querySelector('.text-node-input').value='character';note.el.querySelector('.text-node-input').value='ignore';note.el._production={note:true};
 for(const n of [up,note])a.Interaction.createLinkBetween(n.el.querySelector('.conn-right'),down.el.querySelector('.conn-left'));
 assert.ok(!a.Interaction.getUpstreamText(down.el).includes('ignore'));
 down.el._production={fingerprint:a.p.fingerprint(down.el)};
 a.Interaction.runSceneCommand({},()=>{up.el.querySelector('.text-node-input').value='new character';});a.p.refresh();
 assert.ok(down.el.querySelector('.input-stale'));
 a.Interaction.undo();a.p.refresh();assert.equal(a.State.nodes[2].el.querySelector('.input-stale'),null);
 const fp=a.p.fingerprint(a.State.nodes[2].el);a.State.nodes[1].el.querySelector('.text-node-input').value='changed note';assert.equal(a.p.fingerprint(a.State.nodes[2].el),fp);
});
test('scheduler respects dependencies and concurrency; failed branch is skipped and retry does not rerun successes',async t=>{
 const a=await app(t),one=a.node(),two=a.node(),three=a.node(),four=a.node();
 for(const [x,y] of [[one,two],[three,four]])a.Interaction.createLinkBetween(x.el.querySelector('.conn-right'),y.el.querySelector('.conn-left'));
 a.w.Workspace.config.models=[{id:one.el.dataset.model,available:true}];
 const calls=[],completed=[];let active=0,max=0,fail=true;
 a.Interaction.runAI=async node=>{const id=node.dataset.nodeId;calls.push(id);active++;max=Math.max(max,active);if(node===two.el)assert.ok(completed.includes(one.el.dataset.nodeId));await new Promise(r=>setTimeout(r,5));active--;if(node===three.el && fail)return false;completed.push(id);return true;};
 await a.p.run(a.State.nodes);assert.equal(max,2);assert.equal(calls.includes(four.el.dataset.nodeId),false);
 assert.deepEqual(Array.from(a.State.productionTasks,t=>t.state),['completed','completed','failed','skipped']);
 fail=false;await a.p.run([],true);assert.equal(calls.filter(id=>id===one.el.dataset.nodeId).length,1);assert.equal(calls.filter(id=>id===three.el.dataset.nodeId).length,2);assert.equal(calls.includes(four.el.dataset.nodeId),true);
});
test('scheduler fails unavailable configuration without hanging and cancellation does not execute descendants',async t=>{
 const a=await app(t),one=a.node(),two=a.node();
 a.Interaction.createLinkBetween(one.el.querySelector('.conn-right'),two.el.querySelector('.conn-left'));
 await a.p.run(a.State.nodes);assert.equal(a.State.productionTasks[0].state,'failed');assert.equal(a.State.productionTasks[1].state,'skipped');
 a.w.Workspace.config.models=[{id:one.el.dataset.model,available:true}];let resolve,calls=0;
 a.Interaction.runAI=()=>{calls++;return new Promise(r=>{resolve=r;});};
 const running=a.p.run(a.State.nodes);await Promise.resolve();a.p.cancelQueue();resolve(true);await running;
 assert.equal(calls,1);assert.equal(a.State.productionTasks[0].state,'cancelled');
});
test('production validation rejects unsafe media and bounds metadata; portable embeds candidate sources',async t=>{
 const a=await app(t);a.node();const scene=a.Interaction.captureScene();
 scene.nodes[0].production={candidates:[{media:{kind:'img',src:'javascript:alert(1)'}}]};assert.throws(()=>a.ProjectStore.sceneOf(scene),/素材地址/);
 scene.nodes[0].production={note:true,count:999,candidates:[{id:'old',media:{kind:'img',src:pixel}}],edit:{mask:pixel,source:pixel,width:100,height:100}};
 const clean=a.ProjectStore.sceneOf(scene);assert.equal(clean.nodes[0].production.count,4);assert.equal(clean.nodes[0].production.edit.width,100);
 const exported=await a.ProjectStore.portable({scene:clean});assert.equal(exported.scene.nodes[0].production.candidates[0].media.src,pixel);
});
test('candidate retention keeps the original through long editing sessions and configured budget blocks before submission',async t=>{
 const a=await app(t),n=a.node();n.el.querySelector('.media-container').innerHTML=`<img src="${pixel}">`;
 for(let i=0;i<30;i++)a.p.adoptMedia(n.el,{kind:'img',src:`data:image/png;base64,${Buffer.from('candidate '+i).toString('base64')}`},'edit '+i);
 assert.equal(n.el._production.candidates.length,24);assert.equal(n.el._production.candidates[0].media.src,pixel);
 const clean=a.ProjectStore.sceneOf(a.Interaction.captureScene());assert.equal(clean.nodes[0].production.candidates[0].media.src,pixel);
 a.w.Workspace.config.models=[{id:n.el.dataset.model,available:true,unitPrice:2,currency:'USD'}];a.p.budget.value='1';let calls=0;
 a.Interaction.runAI=async()=>{calls++;return true;};await a.p.run(a.State.nodes);assert.equal(calls,0);
});
