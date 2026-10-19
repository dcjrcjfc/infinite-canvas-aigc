const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..','无限画布');

async function login(t,{failScene=false,rejectPlayback=false}={}){
    const dom=new JSDOM(fs.readFileSync(path.join(root,'login.html'),'utf8'),{url:'http://127.0.0.1:18793/zh-CN/login',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
    const w=dom.window,doc=w.document,frames=new Map(),media=new WeakMap();let seq=0,now=0,clock=0,lastTime=null,slot=-1;
    const reduced={matches:false,handlers:[],addEventListener(type,callback){this.handlers.push(callback);}};w.matchMedia=()=>reduced;
    w.requestAnimationFrame=callback=>{frames.set(++seq,callback);return seq;};w.cancelAnimationFrame=id=>frames.delete(id);
    w.performance.now=()=>now;
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
    Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{get(){return media.get(this)?.paused??true;}});
    w.HTMLMediaElement.prototype.pause=function(){media.set(this,{...media.get(this),paused:true});};
    w.HTMLMediaElement.prototype.play=function(){const current=media.get(this)||{};media.set(this,{...current,plays:(current.plays||0)+1,paused:rejectPlayback});return rejectPlayback?Promise.reject(new Error('autoplay blocked')):Promise.resolve();};
    w.fetch=async()=>({ok:true,json:async()=>({authenticationRequired:false,authenticated:false})});
    const helpers=await import('../client/login-motion.mjs');
    w.LoginScene={...helpers,create(canvas,options){
        if(failScene)throw new Error('test: WebGL unavailable');
        return {resize(){},resetClock(){lastTime=null;},needsFrame(){return !reduced.matches;},dispose(){},frame(time,{paused}){
            if(reduced.matches)clock=2.6;else if(!paused&&lastTime!==null)clock+=Math.min(.05,(time-lastTime)/1000);lastTime=time;
            const next=Math.floor(clock/helpers.CYCLE_SECONDS);
            if(slot!==next){slot=next;options.onFocus([options.models[29],options.models[6]],slot);}
            return {clock,age:clock%helpers.CYCLE_SECONDS,slot};
        }};
    }};
    w.eval(fs.readFileSync(path.join(root,'assets/pix/data.js'),'utf8'));
    if(failScene)w.console.error=()=>{};
    w.eval(fs.readFileSync(path.join(root,'login.js'),'utf8'));
    const tick=(count=1)=>{for(let i=0;i<count;i++){now+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(now));}};
    const settle=async(count=200)=>{for(let i=0;i<count;i++){tick();await Promise.resolve();}};
    return {w,doc,tick,settle,reduced,clock:()=>clock,plays:element=>media.get(element)?.plays||0};
}

test('showreel adjacent cards, wheel boundaries and return use one persistent media source per work',async(t)=>{
    const a=await login(t),{w,doc}=a,video=doc.getElementById('work-video');await a.settle();
    doc.getElementById('view-toggle').click();await a.settle();assert.equal(doc.getElementById('stage').dataset.stage,'work');
    assert.equal(video.getAttribute('src'),w.PIX_REFERENCE.works[0].url);assert.equal(video.playbackRate,1.5);assert.equal(video.paused,false);
    doc.getElementById('next-work').click();await a.settle();assert.match(doc.getElementById('work-counter').textContent,/02 \/ 05/);
    assert.equal(video.getAttribute('src'),w.PIX_REFERENCE.works[1].url);
    doc.querySelector('#work-rail button:last-child').click();await a.settle();const lastSource=video.getAttribute('src');
    let reloads=0;const observer=new w.MutationObserver(records=>{reloads+=records.filter(record=>record.attributeName==='src').length;});observer.observe(video,{attributes:true});
    doc.getElementById('orbit').dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:10000}));await a.settle();
    assert.equal(video.getAttribute('src'),lastSource);assert.equal(reloads,0,'overscroll at the final work must not reload or restart its video');observer.disconnect();
    doc.getElementById('view-toggle').click();await a.settle();assert.equal(doc.getElementById('stage').dataset.stage,'globe');assert.equal(video.paused,true);
});

test('login dialog pauses the shared clock, closes with focus restored, and language arrows run in both directions',async(t)=>{
    const a=await login(t),{w,doc}=a;await a.settle();const button=doc.querySelector('.hero [data-login]');button.click();await a.settle();
    const clock=a.clock(),copy=doc.getElementById('verb').textContent;await a.settle(100);
    assert.equal(a.clock(),clock);assert.equal(doc.getElementById('verb').textContent,copy);
    doc.getElementById('login-dialog').close();await a.settle(10);assert.ok(a.clock()>clock);assert.equal(doc.activeElement,button);
    const toggle=doc.getElementById('language');toggle.click();assert.equal(doc.activeElement.dataset.lang,'zh-CN');
    doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));assert.equal(doc.activeElement.dataset.lang,'en');
    doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(doc.activeElement.dataset.lang,'zh-CN');
    doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));doc.activeElement.click();await a.settle(5);
    assert.equal(doc.documentElement.lang,'en');assert.equal(doc.querySelector('.hero [data-login]').textContent,'Log in');assert.equal(doc.getElementById('language-menu').hidden,true);
});

test('reduced motion shows full copy and static cards without autoplay or a continuing RAF loop',async(t)=>{
    const a=await login(t);a.reduced.matches=true;a.reduced.handlers.forEach(callback=>callback());await a.settle(20);
    assert.equal(a.doc.getElementById('verb').textContent,'生成图片');
    a.doc.getElementById('view-toggle').click();await a.settle(2);
    assert.equal(a.doc.getElementById('stage').dataset.page,'1.000');assert.equal(a.doc.getElementById('work-video').paused,true);
});

test('blocked autoplay has bounded retries and unavailable WebGL preserves the local login form',async(t)=>{
    const a=await login(t,{rejectPlayback:true});a.doc.getElementById('view-toggle').click();await a.settle(700);
    assert.equal(a.plays(a.doc.getElementById('work-video')),3,'do not call play again on every animation frame after rejection');
    const fallback=await login(t,{failScene:true});await fallback.settle();assert.equal(fallback.doc.getElementById('orbit').dataset.engine,'unavailable');
    fallback.doc.querySelector('.hero [data-login]').click();await fallback.settle(10);
    assert.equal(fallback.doc.getElementById('login-dialog').hasAttribute('open'),true);assert.equal(fallback.doc.getElementById('password').disabled,true);
});
