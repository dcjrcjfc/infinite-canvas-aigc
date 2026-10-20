const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../无限画布/image-editor.js'),'utf8');
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
const encoded=(width,height,pixels)=>`data:image/png;base64,${Buffer.from(JSON.stringify({width,height,pixels})).toString('base64')}`;
const decode=src=>JSON.parse(Buffer.from(src.split(',')[1],'base64').toString());
function setup(t,options={}) {
    const dom=new JSDOM('<button id="previous">原焦点</button><div id="node-actions"></div><div class="node" data-node-type="image" data-node-name="测试图片" data-model="test"><div class="media-container"><img></div></div>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
    t.after(()=>dom.window.close());const w=dom.window,doc=w.document,node=doc.querySelector('.node'),calls={adopts:[],edits:[],commands:[],saves:0,messages:[]};
    node.querySelector('img').src=encoded(1000,500,'source');
    w.State={selection:{type:'node',item:node},multiSelection:[]};
    w.Workspace={projectId:'a',config:{models:[{id:'test',available:true,maskEditing:!!options.editAvailable}]},scheduleSave(){calls.saves++;}};
    w.Interaction={toast(message){calls.messages.push(message);},runSceneCommand(_,fn){const before=JSON.stringify(node._production||{});fn();calls.commands.push({before,after:JSON.stringify(node._production)});return true;}};
    w.Production={adoptMedia:async(...args)=>{calls.adopts.push(args);return true;},editImage:async(...args)=>{calls.edits.push(args);return true;}};
    w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    const descriptors={width:Object.getOwnPropertyDescriptor(w.HTMLCanvasElement.prototype,'width'),height:Object.getOwnPropertyDescriptor(w.HTMLCanvasElement.prototype,'height')};
    for(const key of ['width','height'])Object.defineProperty(w.HTMLCanvasElement.prototype,key,{get(){return descriptors[key].get.call(this);},set(value){descriptors[key].set.call(this,value);this._pixels='';},configurable:true});
    w.HTMLCanvasElement.prototype.getContext=function(){
        if(this._ctx)return this._ctx;const target=this;
        const c={globalCompositeOperation:'source-over',lineWidth:1,save(){this._old=this.globalCompositeOperation;},restore(){this.globalCompositeOperation=this._old;},translate(x,y){this.lastTranslate=[x,y];},scale(x,y){this.lastScale=[x,y];},rotate(angle){this.lastRotation=angle;},beginPath(){},moveTo(x,y){this.lastMove=[x,y];},lineTo(x,y){this.lastLine=[x,y];},arc(x,y,r){this.lastArc=[x,y,r];},stroke(){target._pixels+=`stroke:${JSON.stringify(this.lastMove)}:${JSON.stringify(this.lastLine)}:${this.globalCompositeOperation}`;},fill(){target._pixels+=`fill:${JSON.stringify(this.lastArc)}:${this.globalCompositeOperation}`;},fillRect(...args){target._pixels+=`rect:${JSON.stringify(args)}:${this.globalCompositeOperation}`;},drawImage(image,...args){
            const pixels=image._pixels||'';
            if(args.length===2||args.length===4){if(this.globalCompositeOperation==='source-over')target._pixels=pixels;else target._pixels+=`draw:${pixels}:${this.globalCompositeOperation}`;}
            else target._pixels=`crop:${pixels}:${JSON.stringify(args)}`;
            this.lastDraw=args;this.lastDrawFilter=this.filter;
        },getImageData(){return {data:Uint8ClampedArray.from([255,255,255,target._pixels?255:0])};
        }};this._ctx=c;return c;
    };
    w.HTMLCanvasElement.prototype.toDataURL=function(){if(options.tainted)throw new w.DOMException('Tainted','SecurityError');return encoded(this.width,this.height,this._pixels||'');};
    w.Image=class{set src(value){this._src=value;queueMicrotask(()=>{if(options.imageError){this.onerror?.();return;}const data=decode(value);this.naturalWidth=data.width;this.naturalHeight=data.height;this._pixels=data.pixels;this.onload?.();});}};
    w.eval(source);w.ImageEditor.init();
    const surface=doc.querySelector('.image-editor-surface');surface.getBoundingClientRect=()=>({left:100,top:50,width:500,height:250});
    function pointer(type,x,y){const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:1});surface.dispatchEvent(e);}
    function click(action){doc.querySelector(`[data-edit-action="${action}"]`).click();}
    return {w,doc,node,calls,pointer,click,surface};
}

test('image focus action follows image selection and unavailable local-edit providers remain hidden',async t=>{
    const a=setup(t);assert.equal(a.doc.getElementById('image-editor-open').hidden,false);
    a.w.State.selection.item=null;a.w.ImageEditor.syncAction();assert.equal(a.doc.getElementById('image-editor-open').hidden,true);
    assert.equal(await a.w.ImageEditor.open(a.node),true);assert.equal(a.doc.querySelector('.image-editor-provider').hidden,true);
    a.click('close');assert.equal(a.doc.querySelector('dialog').open,false);
});

test('selection maps display coordinates to original pixels, crop creates a candidate and preserves original',async t=>{
    const a=setup(t),original=a.node.querySelector('img').src;
    await a.w.ImageEditor.open(a.node);
    a.pointer('pointerdown',150,75);a.pointer('pointermove',350,200);a.pointer('pointerup',350,200);await pause();
    a.click('crop');await pause();
    const image=a.doc.querySelector('.image-editor-base');assert.equal(image.width,400);assert.equal(image.height,250);
    assert.match(decode(image.toDataURL()).pixels,/\[100,50,400,250,0,0,400,250\]/);
    a.click('apply');await pause();assert.equal(a.calls.adopts.length,1);
    assert.equal(a.calls.adopts[0][1].kind,'img');
    assert.equal(decode(a.calls.adopts[0][1].src).width,400);assert.equal(a.calls.adopts[0][3].edit.width,400);
    assert.equal(a.node.querySelector('img').src,original);assert.equal(a.doc.querySelector('dialog').open,false);
});

test('local undo and redo restore both crop dimensions and selection without changing the node',async t=>{
    const a=setup(t);await a.w.ImageEditor.open(a.node);
    a.pointer('pointerdown',150,75);a.pointer('pointerup',350,200);await pause();a.click('crop');await pause();
    assert.equal(a.doc.querySelector('.image-editor-base').width,400);
    a.click('undo');await pause();assert.equal(a.doc.querySelector('.image-editor-base').width,1000);assert.equal(a.doc.querySelector('.image-editor-selection').hidden,false);
    a.click('redo');await pause();assert.equal(a.doc.querySelector('.image-editor-base').width,400);assert.equal(a.doc.querySelector('.image-editor-selection').hidden,true);
    a.click('reset');await pause();assert.equal(a.doc.querySelector('.image-editor-base').width,1000);assert.equal(a.calls.adopts.length,0);
});

test('brush uses image pixels, saves explicit mask metadata with undo, and Escape cancels further edits',async t=>{
    const a=setup(t);a.doc.getElementById('previous').focus();await a.w.ImageEditor.open(a.node);
    a.click('tool-brush');a.pointer('pointerdown',150,75);a.pointer('pointerup',160,85);await pause();
    const mask=a.doc.querySelector('.image-editor-mask');assert.deepEqual(mask.getContext('2d').lastArc,[100,50,16]);
    assert.equal(a.node._production,undefined);a.click('save-mask');await pause();
    assert.equal(a.node._production.edit.width,1000);assert.equal(a.node._production.edit.height,500);assert.equal(a.calls.commands.length,1);assert.equal(a.calls.saves,1);
    const saved=a.node._production.edit.mask;
    a.click('tool-eraser');a.pointer('pointerdown',200,100);a.pointer('pointerup',210,110);await pause();
    assert.match(decode(mask.toDataURL()).pixels,/destination-out/);assert.equal(a.node._production.edit.mask,saved);
    a.doc.querySelector('dialog').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(a.doc.querySelector('dialog').open,false);assert.equal(a.doc.activeElement.id,'previous');assert.equal(a.node._production.edit.mask,saved);assert.equal(a.calls.adopts.length,0);
});

test('mask is inverted only at provider boundary and explicit generation uses configured capability',async t=>{
    const a=setup(t,{editAvailable:true});await a.w.ImageEditor.open(a.node);assert.equal(a.doc.querySelector('.image-editor-provider').hidden,false);
    a.doc.querySelector('.image-editor-provider input').value='改为红色';a.click('generate');await pause();assert.equal(a.calls.edits.length,0);assert.match(a.doc.querySelector('.image-editor-status').textContent,/标记/);
    a.click('tool-brush');a.pointer('pointerdown',150,75);a.pointer('pointerup',160,85);await pause();
    a.doc.querySelector('.image-editor-provider input').value='改为红色';a.click('generate');await pause();
    assert.equal(a.calls.edits.length,1);assert.equal(a.calls.edits[0][1].prompt,'改为红色');
    assert.match(decode(a.calls.edits[0][1].mask).pixels,/rect:\[0,0,1000,500\]/);assert.match(decode(a.calls.edits[0][1].mask).pixels,/destination-out/);
});

test('changed project or removed node invalidates saves and cannot write into another canvas',async t=>{
    const a=setup(t);await a.w.ImageEditor.open(a.node);a.w.Workspace.projectId='b';a.click('save-mask');await pause();assert.equal(a.calls.saves,0);assert.equal(a.node._production,undefined);assert.match(a.doc.querySelector('.image-editor-status').textContent,/画布已改变/);
    a.w.ImageEditor.close();a.w.Workspace.projectId='a';await a.w.ImageEditor.open(a.node);a.node.remove();a.click('save-mask');await pause();assert.equal(a.calls.saves,0);
});

test('CORS taint fails explicitly without modifying media or committing a command',async t=>{
    const a=setup(t,{tainted:true}),original=a.node.querySelector('img').src;assert.equal(await a.w.ImageEditor.open(a.node),false);
    assert.equal(a.doc.querySelector('dialog').open,false);assert.equal(a.calls.commands.length,0);assert.equal(a.calls.adopts.length,0);assert.equal(a.node.querySelector('img').src,original);assert.match(a.calls.messages[0],/跨域编辑/);
});

test('candidate comparison has keyboard-operable split and close restores focus',async t=>{
    const a=setup(t);a.doc.getElementById('previous').focus();assert.equal(a.w.ImageEditor.compare(a.node,encoded(1000,500,'original'),encoded(1000,500,'new')),true);
    const slider=a.doc.querySelector('.image-editor-compare-slider');slider.value='75';slider.dispatchEvent(new a.w.Event('input'));
    assert.equal(a.doc.querySelector('.image-editor-after').style.clipPath,'inset(0 0 0 75%)');assert.equal(a.doc.querySelector('.image-editor-tools').hidden,true);
    a.click('close');assert.equal(a.doc.activeElement.id,'previous');
});

test('existing image rotation, mirror and filter are baked into the editor before any crop',async t=>{
    const a=setup(t),image=a.node.querySelector('img'),rawSource=image.src;
    image.style.filter='brightness(1.3)';image.dataset.rotateDeg='90';image.dataset.flipX='1';
    assert.equal(await a.w.ImageEditor.open(a.node),true);
    const base=a.doc.querySelector('.image-editor-base'),context=base.getContext('2d');
    assert.equal(base.width,500);assert.equal(base.height,1000);assert.deepEqual(context.lastTranslate,[250,500]);assert.deepEqual(context.lastScale,[-1,1]);assert.equal(context.lastRotation,Math.PI/2);assert.equal(context.lastDrawFilter,'brightness(1.3)');
    a.pointer('pointerdown',100,50);a.pointer('pointerup',300,150);await pause();a.click('crop');await pause();a.click('apply');await pause();
    assert.equal(decode(a.calls.adopts[0][1].src).width,200);assert.equal(decode(a.calls.adopts[0][1].src).height,400);assert.equal(image.src,rawSource);assert.equal(image.dataset.rotateDeg,'90');
});

test('local canvas expansion and 2x interpolation update pixels and masks and remain undoable',async t=>{
    const a=setup(t);await a.w.ImageEditor.open(a.node);
    a.doc.querySelector('[aria-label="四边扩展像素"]').value='100';a.click('expand');await pause();
    const base=a.doc.querySelector('.image-editor-base');assert.equal(base.width,1200);assert.equal(base.height,700);assert.equal(a.calls.adopts.length,0);
    a.click('resize');await pause();assert.equal(base.width,2400);assert.equal(base.height,1400);assert.match(a.doc.querySelector('.image-editor-status').textContent,/本地插值/);
    a.click('undo');await pause();assert.equal(base.width,1200);assert.equal(base.height,700);
    a.click('apply');await pause();assert.equal(a.calls.adopts[0][2],'图片扩边');assert.equal(a.calls.adopts[0][3].edit.width,1200);
});

test('changing the original visual adjustments while editing invalidates a pending save',async t=>{
    const a=setup(t);await a.w.ImageEditor.open(a.node);a.node.querySelector('img').dataset.rotateDeg='90';a.click('save-mask');await pause();
    assert.equal(a.calls.saves,0);assert.match(a.doc.querySelector('.image-editor-status').textContent,/图片或画布已改变/);
});

test('candidate comparison accepts saved visual adjustments and bakes them before displaying',async t=>{
    const a=setup(t),src=encoded(1000,500,'candidate');
    assert.equal(a.w.ImageEditor.compare(a.node,{media:{src},rotateDeg:'90',flipX:'1',imageFilter:'brightness(1.2)'},src),true);await pause();
    const before=decode(a.doc.querySelector('.image-editor-before').src);assert.equal(before.width,500);assert.equal(before.height,1000);
    assert.equal(a.doc.querySelector('.image-editor-after').src,src);
});
