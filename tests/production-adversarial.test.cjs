const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {canvasApp}=require('./support/canvas-app.cjs');
const original='data:image/png;base64,b3JpZ2luYWw=';
const generated='data:image/png;base64,Z2VuZXJhdGVk';
const video='data:video/mp4;base64,dmlkZW8=';
const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
async function app(t){
    const a=await canvasApp(t);Object.assign(a.w,a.w.canvasAPI);
    a.w.eval(fs.readFileSync(path.join(__dirname,'../无限画布/production.js'),'utf8'));
    a.p=a.w.Production;a.p.init();t.after(()=>a.w.clearTimeout(a.p.refreshTimer));return a;
}
function configure(a,node){
    a.w.Workspace.config.models=[{id:node.dataset.model,available:true,maskEditing:true,maxOutputs:4}];
    node.querySelector('.ai-panel .ai-input').value='test prompt';
}

test('adversarial: a pending local edit cannot be overwritten by a second same-node generation request',async t=>{
    const a=await app(t),{el}=a.node('image');configure(a,el);
    el.querySelector('.media-container').innerHTML=`<img src="${original}">`;
    const pending=[];let requests=0;
    a.w.Workspace.request=()=>{requests++;return new Promise(resolve=>pending.push(resolve));};
    const edit=a.p.editImage(el,{prompt:'edit selection',mask:original,image:original});
    const controller=a.w.Workspace.pending.get(el.dataset.nodeId),normal=a.Interaction.runAI(el);
    await pause();const sameController=a.w.Workspace.pending.get(el.dataset.nodeId)===controller;
    pending.forEach(resolve=>resolve({url:generated}));await Promise.all([edit,normal]);
    assert.equal(requests,1,'one node must submit at most one provider request while already pending');
    assert.equal(sameController,true,'second request must not replace the running task controller');
});

test('adversarial: adopting the preserved original restores its image adjustments, rotation and mirror',async t=>{
    const a=await app(t),{el}=a.node('image');
    el.querySelector('.media-container').innerHTML=`<img src="${original}">`;
    const image=el.querySelector('img');image.style.filter='brightness(1.2) contrast(0.8)';image.dataset.rotateDeg='90';image.dataset.flipX='1';image.style.transform='rotate(90deg) scaleX(-1)';
    assert.equal(a.p.adoptMedia(el,{kind:'img',src:generated},'crop'),true);
    const candidate=el._production.candidates.find(candidate=>candidate.media.src===original);assert.ok(candidate);
    assert.equal(a.p.adopt(el,candidate.id),true);
    const restored=el.querySelector('img');assert.equal(restored.src,original);
    assert.equal(restored.style.filter,'brightness(1.2) contrast(0.8)');
    assert.equal(restored.dataset.rotateDeg,'90');assert.equal(restored.dataset.flipX,'1');
    assert.match(restored.style.transform,/90deg/);assert.match(restored.style.transform,/-1/);
});

test('adversarial: interrupted video retains submission fingerprint so a changed upstream remains stale after resume',async t=>{
    const a=await app(t),up=a.node('text'),node=a.node('video');configure(a,node.el);
    up.el.querySelector('.text-node-input').value='first version';
    a.Interaction.createLinkBetween(up.el.querySelector('.conn-right'),node.el.querySelector('.conn-left'));
    const submissionFingerprint=a.p.fingerprint(node.el);
    a.w.Workspace.request=async()=>({id:'job-1'});
    a.w.Workspace.pollVideo=async()=>{throw new Error('simulated temporary connection failure');};
    const ok=await a.Interaction.runAI(node.el);assert.equal(ok,false);assert.ok(node.el.dataset.videoTask);
    up.el.querySelector('.text-node-input').value='a different upstream after submission';
    a.w.Workspace.pollVideo=async()=>({url:video,status:'completed'});
    await a.w.Workspace.resumeVideo(node.el);a.p.refresh();
    assert.equal(node.el._production.fingerprint,submissionFingerprint,'completed video must describe inputs used at submission, not inputs present when polling finishes');
    assert.ok(node.el.querySelector('.input-stale'),'changed upstream must not be reported as up-to-date');
});

test('adversarial: restoring another scene cancels pending edit and drops late provider results',async t=>{
    const a=await app(t),{el}=a.node('image');configure(a,el);
    el.querySelector('.media-container').innerHTML=`<img src="${original}">`;
    let finish;a.w.Workspace.request=()=>new Promise(resolve=>{finish=resolve;});
    const edit=a.p.editImage(el,{prompt:'edit',mask:original,image:original});
    const other=a.Interaction.captureScene();other.nodes=[];other.links=[];a.Interaction.restoreScene(other);
    finish({url:generated});assert.equal(await edit,false);assert.equal(a.State.nodes.length,0);assert.equal(a.w.Workspace.pending.size,0);
});

test('adversarial: candidate expansion keeps each versions own visual adjustments',async t=>{
    const a=await app(t),{el}=a.node('image');el.querySelector('.media-container').innerHTML=`<img src="${original}">`;
    el.querySelector('img').style.filter='brightness(1.2)';el.querySelector('img').dataset.rotateDeg='90';el.querySelector('img').dataset.flipX='1';
    a.p.adoptMedia(el,{kind:'img',src:generated},'new result');a.p.expand(el);
    const expanded=a.State.nodes.filter(node=>node.el!==el).find(node=>node.el.querySelector('img')?.src===original);assert.ok(expanded);
    const image=expanded.el.querySelector('img');assert.equal(image.style.filter,'brightness(1.2)');assert.equal(image.dataset.rotateDeg,'90');assert.equal(image.dataset.flipX,'1');
});

test('adversarial: edited original with the same source URL is preserved as a distinct visual version',async t=>{
    const a=await app(t),{el}=a.node('image');el.querySelector('.media-container').innerHTML=`<img src="${original}">`;
    a.p.adoptMedia(el,{kind:'img',src:generated},'first result');const originalCandidate=el._production.candidates.find(candidate=>candidate.media.src===original);a.p.adopt(el,originalCandidate.id);
    el.querySelector('img').style.filter='brightness(1.7)';a.p.adoptMedia(el,{kind:'img',src:generated},'second result');
    assert.ok(el._production.candidates.some(candidate=>candidate.media.src===original&&candidate.imageFilter==='brightness(1.7)'),'same URL with changed adjustments is a different candidate, not a duplicate');
});

test('adversarial: result parameters retain submitted prompt and ratio while the user edits the next request',async t=>{
    const a=await app(t),{el}=a.node('image');configure(a,el);let finish,payload;
    a.w.Workspace.request=async(route,body)=>{payload=body;return new Promise(resolve=>{finish=resolve;});};
    const generation=a.Interaction.runAI(el);await pause();assert.ok(finish);
    el.querySelector('.ai-panel .ai-input').value='my NEXT request';el.dataset.ratio='9:16';finish({url:generated});await generation;
    const result=el._production.candidates.find(candidate=>candidate.media.src===generated);assert.equal(result.prompt,payload.prompt);assert.equal(result.ratio,payload.ratio);
});
