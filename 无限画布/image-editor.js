/* Local, reversible image editing. No provider call is made without an explicit edit action. */
(() => {
    'use strict';
    const MAX_PIXELS = 24000000, MAX_HISTORY = 16, MAX_HISTORY_BYTES = 40 * 1024 * 1024;
    const state = { session:null, sequence:0, ready:false };
    const element = (tag, className, text) => { const el=document.createElement(tag);if(className)el.className=className;if(text)el.textContent=text;return el; };
    const button = (text, action) => {const el=element('button','image-editor-button',text);el.type='button';el.dataset.editAction=action;return el;};
    const asElement = node => node?.el || node;
    const selected = () => typeof State !== 'undefined' && State.multiSelection?.length <= 1 && State.selection?.type === 'node' ? State.selection.item : null;
    const projectId = () => window.Workspace?.projectId;
    const canGenerate = node => {
        if(typeof window.Production?.editImage!=='function')return false;
        if(typeof window.Production.canEditImage==='function')return !!window.Production.canEditImage(node);
        const model=window.Workspace?.config?.models?.find(item=>item.id===node.dataset.model);
        return !!(model?.available&&model.maskEditing);
    };
    const sourceOf = node => node?.querySelector('.media-container img')?.src || '';
    const adjustments = node => {const image=node?.querySelector('.media-container img');return {filter:image?.style.filter||'',rotate:Number(image?.dataset.rotateDeg)||0,flip:image?.dataset.flipX==='1'};};
    const visualKey = node => JSON.stringify(adjustments(node));
    const valid = s => state.session === s && s.node.isConnected && projectId() === s.projectId && sourceOf(s.node) === s.originalSource && visualKey(s.node)===s.originalVisual;
    const ctx = canvas => {const context=canvas.getContext('2d');if(!context)throw new Error('浏览器无法创建图片编辑画布');return context;};
    const png = canvas => {try{return canvas.toDataURL('image/png');}catch{throw new Error('图片来源不允许跨域编辑，请先下载图片再上传到画布');}};
    const loadImage = src => new Promise((resolve,reject) => {
        const image=new Image(),timer=setTimeout(()=>{image.onload=image.onerror=null;reject(new Error('图片加载超时，请重新打开编辑器'));},15000);
        image.crossOrigin='anonymous';
        image.onload=()=>{clearTimeout(timer);image.onload=image.onerror=null;resolve(image);};
        image.onerror=()=>{clearTimeout(timer);image.onload=image.onerror=null;reject(new Error('图片加载失败，远程图片需要允许跨域访问；也可下载后重新上传'));};
        image.src=src;
    });
    const canvas = (width,height) => {const el=document.createElement('canvas');el.width=width;el.height=height;return el;};
    const comparisonSource = value => typeof value==='string'?value:value?.media?.src||value?.src||'';
    async function comparisonPixels(value) {
        const src=comparisonSource(value);if(typeof value==='string'||(!value.imageFilter&&!Number(value.rotateDeg)&&value.flipX!=='1'))return src;
        const image=await loadImage(src),angle=(Number(value.rotateDeg)||0)*Math.PI/180;
        const cos=Math.abs(Math.cos(angle))<1e-10?0:Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle))<1e-10?0:Math.abs(Math.sin(angle));
        const width=Math.ceil(image.naturalWidth*cos+image.naturalHeight*sin),height=Math.ceil(image.naturalWidth*sin+image.naturalHeight*cos);
        if(width*height>MAX_PIXELS)throw new Error('对比图片超过 2400 万像素，请先缩小图片');
        const output=canvas(width,height),context=ctx(output);context.translate(width/2,height/2);context.scale(value.flipX==='1'?-1:1,1);context.rotate(angle);context.filter=value.imageFilter||'none';context.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);return png(output);
    }
    const report = error => {
        const text=typeof error==='string'?error:error.message;
        if(state.dialog?.open){state.status.textContent=text;state.status.dataset.error='true';}
        else if(typeof Interaction!=='undefined')Interaction.toast(text,'error');
    };
    const guarded = work => async event => {try{await work(event);}catch(error){report(error);}};
    const requireSession = () => {const s=state.session;if(!s||!valid(s))throw new Error('图片或画布已改变，请重新打开编辑器');return s;};
    const point = (event,s=state.session) => {
        const r=state.surface.getBoundingClientRect();
        return {x:Math.max(0,Math.min(s.width,(event.clientX-r.left)*s.width/(r.width||1))),y:Math.max(0,Math.min(s.height,(event.clientY-r.top)*s.height/(r.height||1)))};
    };
    const rectangle = (a,b) => ({x:Math.floor(Math.min(a.x,b.x)),y:Math.floor(Math.min(a.y,b.y)),width:Math.ceil(Math.abs(a.x-b.x)),height:Math.ceil(Math.abs(a.y-b.y))});
    const clampRect = (rect,s) => {const x=Math.max(0,Math.min(s.width-1,Math.floor(rect.x))),y=Math.max(0,Math.min(s.height-1,Math.floor(rect.y)));return {x,y,width:Math.max(1,Math.min(s.width-x,Math.ceil(rect.width))),height:Math.max(1,Math.min(s.height-y,Math.ceil(rect.height)))};};
    function resize() {
        const s=state.session;if(!s || s.mode==='compare')return;
        const bounds=state.viewport.getBoundingClientRect(),scale=Math.min(1,(bounds.width||800)/s.width,(bounds.height||600)/s.height);
        state.surface.style.width=`${Math.max(1,s.width*scale)}px`;state.surface.style.height=`${Math.max(1,s.height*scale)}px`;
        renderSelection();
    }
    function renderSelection() {
        const s=state.session,rect=s?.selection;state.selection.hidden=!rect;
        if(!rect)return;
        Object.assign(state.selection.style,{left:`${rect.x/s.width*100}%`,top:`${rect.y/s.height*100}%`,width:`${rect.width/s.width*100}%`,height:`${rect.height/s.height*100}%`});
    }
    function refresh() {
        const s=state.session;if(!s)return;
        state.dialog.querySelectorAll('[data-edit-tool]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.editTool===s.tool)));
        state.dialog.querySelector('[data-edit-action="undo"]').disabled=s.loading||s.cursor<=0;
        state.dialog.querySelector('[data-edit-action="redo"]').disabled=s.loading||s.cursor>=s.history.length-1;
        state.dialog.querySelector('[data-edit-action="crop"]').disabled=s.loading||!s.selection||s.selection.width<2||s.selection.height<2;
        state.dialog.querySelector('[data-edit-action="mask-box"]').disabled=s.loading||!s.selection;
        state.dialog.querySelector('[data-edit-action="apply"]').disabled=s.loading||s.imageSource===s.initialSource;
        state.surface.dataset.tool=s.tool;
        renderSelection();
    }
    function snapshot(s) {return {imageSource:s.imageSource,mask:png(state.mask),width:s.width,height:s.height,operationLabel:s.operationLabel||'编辑图片',selection:s.selection?{...s.selection}:null};}
    function remember(s) {
        const next=snapshot(s),last=s.history[s.cursor];
        if(last&&last.imageSource===next.imageSource&&last.mask===next.mask&&JSON.stringify(last.selection)===JSON.stringify(next.selection)){refresh();return;}
        s.history.splice(s.cursor+1);s.history.push(next);
        const weight = () => new Set(s.history.map(item=>item.imageSource)).values();
        const bytes = () => [...weight()].reduce((n,src)=>n+src.length*2,0)+s.history.reduce((n,item)=>n+item.mask.length*2,0);
        while(s.history.length>1&&(s.history.length>MAX_HISTORY||bytes()>MAX_HISTORY_BYTES))s.history.shift();
        s.cursor=s.history.length-1;refresh();
    }
    async function restore(s,frame) {
        s.loading=true;refresh();const ticket=++s.restoreTicket;
        try {
            const [image,maskImage]=await Promise.all([loadImage(frame.imageSource),loadImage(frame.mask)]);
            if(!valid(s)||ticket!==s.restoreTicket)return;
            s.width=frame.width;s.height=frame.height;s.imageSource=frame.imageSource;s.operationLabel=frame.operationLabel;s.selection=frame.selection?{...frame.selection}:null;
            state.base.width=state.mask.width=s.width;state.base.height=state.mask.height=s.height;
            ctx(state.base).drawImage(image,0,0,s.width,s.height);ctx(state.mask).drawImage(maskImage,0,0,s.width,s.height);
            resize();
        } finally {if(state.session===s&&ticket===s.restoreTicket){s.loading=false;refresh();}}
    }
    async function moveHistory(delta) {
        const s=requireSession();if(s.loading)return;
        const next=Math.max(0,Math.min(s.history.length-1,s.cursor+delta));if(next===s.cursor)return;
        await restore(s,s.history[next]);if(valid(s))s.cursor=next;refresh();
    }
    function stroke(s,from,to) {
        const context=ctx(state.mask);context.save();context.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';
        context.strokeStyle='#fff';context.fillStyle='#fff';context.lineWidth=Number(state.brush.value);context.lineCap='round';context.lineJoin='round';
        if(from.x===to.x&&from.y===to.y){context.beginPath();context.arc(to.x,to.y,context.lineWidth/2,0,Math.PI*2);context.fill();}
        else{context.beginPath();context.moveTo(from.x,from.y);context.lineTo(to.x,to.y);context.stroke();}context.restore();
    }
    function pointerStart(event) {
        const s=state.session;if(!s||s.loading||s.mode!=='edit'||event.button!==0||!valid(s))return;
        event.preventDefault();event.stopPropagation();const p=point(event,s);s.gesture={id:event.pointerId,start:p,last:p,previousSelection:s.selection?{...s.selection}:null};
        state.surface.setPointerCapture?.(event.pointerId);
        if(s.tool==='select'){s.selection={x:p.x,y:p.y,width:0,height:0};renderSelection();}else stroke(s,p,p);
    }
    function pointerMove(event) {
        const s=state.session;if(!s?.gesture||s.gesture.id!==event.pointerId)return;
        event.preventDefault();const p=point(event,s);
        if(s.tool==='select'){s.selection=rectangle(s.gesture.start,p);renderSelection();}else stroke(s,s.gesture.last,p);
        s.gesture.last=p;
    }
    async function pointerEnd(event) {
        const s=state.session;if(!s?.gesture||s.gesture.id!==event.pointerId)return;
        if(event.type==='pointercancel'){s.gesture=null;await restore(s,s.history[s.cursor]);return;}
        pointerMove(event);state.surface.releasePointerCapture?.(event.pointerId);s.gesture=null;
        if(s.selection)s.selection=clampRect(s.selection,s);remember(s);
    }
    function crop() {
        const s=requireSession();if(s.loading||!s.selection||s.selection.width<2||s.selection.height<2)return;
        const rect=clampRect(s.selection,s),image=canvas(rect.width,rect.height),mask=canvas(rect.width,rect.height);
        ctx(image).drawImage(state.base,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
        ctx(mask).drawImage(state.mask,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
        const newSource=png(image);state.base.width=state.mask.width=s.width=rect.width;state.base.height=state.mask.height=s.height=rect.height;
        ctx(state.base).drawImage(image,0,0);ctx(state.mask).drawImage(mask,0,0);s.imageSource=newSource;s.operationLabel='裁剪图片';s.selection=null;remember(s);resize();
        state.status.textContent=`已裁剪为 ${s.width} × ${s.height}，应用后保留为新候选`;state.status.dataset.error='false';
    }
    function resizeImage() {
        const s=requireSession();if(s.loading)return;const width=s.width*2,height=s.height*2;
        if(width*height>MAX_PIXELS)throw new Error('放大后超过 2400 万像素，请先裁剪或使用较小图片');
        const image=canvas(width,height),mask=canvas(width,height),c=ctx(image);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(state.base,0,0,width,height);ctx(mask).drawImage(state.mask,0,0,width,height);
        commitCanvasChange(s,image,mask,'已按 2 倍尺寸重采样；这是本地插值放大，不增加真实细节','本地放大 2×');
    }
    function expandImage() {
        const s=requireSession();if(s.loading)return;
        const padding=Number(state.expandSize.value);if(!Number.isInteger(padding)||padding<1||padding>2048)throw new Error('扩边尺寸须为 1–2048 像素');
        const width=s.width+padding*2,height=s.height+padding*2;if(width*height>MAX_PIXELS)throw new Error('扩边后超过 2400 万像素，请减少扩边尺寸');
        const image=canvas(width,height),mask=canvas(width,height),c=ctx(image),m=ctx(mask);
        const fill=state.expandFill.value;
        if(fill!=='transparent'){c.fillStyle=fill==='white'?'#fff':'#000';c.fillRect(0,0,width,height);}c.drawImage(state.base,padding,padding);
        // New margins are selected for a subsequent explicit local-edit request.
        m.fillStyle='#fff';m.fillRect(0,0,width,padding);m.fillRect(0,height-padding,width,padding);m.fillRect(0,padding,padding,s.height);m.fillRect(width-padding,padding,padding,s.height);m.drawImage(state.mask,padding,padding);
        commitCanvasChange(s,image,mask,`已向四边扩展 ${padding} 像素；新增区域已标为蒙版，可自行保存或提交局部编辑`,'图片扩边');
    }
    function commitCanvasChange(s,image,mask,message,label) {
        const source=png(image);state.base.width=state.mask.width=s.width=image.width;state.base.height=state.mask.height=s.height=image.height;
        ctx(state.base).drawImage(image,0,0);ctx(state.mask).drawImage(mask,0,0);s.imageSource=source;s.operationLabel=label;s.selection=null;remember(s);resize();state.status.textContent=message;state.status.dataset.error='false';
    }
    function boxMask() {const s=requireSession();if(s.loading||!s.selection)return;const r=clampRect(s.selection,s),c=ctx(state.mask);c.fillStyle='#fff';c.fillRect(r.x,r.y,r.width,r.height);remember(s);}
    function editMetadata(s) {return {source:s.imageSource,mask:png(state.mask),width:s.width,height:s.height,updatedAt:new Date().toISOString()};}
    async function saveMask() {
        const s=requireSession();if(s.loading)return;
        const edit=editMetadata(s),write=()=>{s.node._production||={};s.node._production.edit=edit;};
        if(typeof Interaction!=='undefined'&&Interaction.runSceneCommand){const result=Interaction.runSceneCommand({},write);if(result===false)return;}else write();
        window.Workspace?.scheduleSave();state.status.textContent='蒙版已保存，可继续编辑或关闭';state.status.dataset.error='false';
    }
    async function apply() {
        const s=requireSession();if(s.loading||s.imageSource===s.initialSource)return;
        if(!window.Production?.adoptMedia)throw new Error('候选保存模块尚未就绪');
        const image=png(state.base),edit=editMetadata(s);
        s.applying=true;
        try{const result=await window.Production.adoptMedia(s.node,{kind:'img',src:image},s.operationLabel||'编辑图片',{edit});if(result===false)throw new Error('未能保存图片，请重试');close();}
        finally{s.applying=false;}
    }
    async function generate() {
        const s=requireSession(),prompt=state.prompt.value.trim();if(s.loading)return;
        if(!canGenerate(s.node))throw new Error('当前模型不支持局部图片编辑');
        if(!prompt)throw new Error('请描述选区内要修改的内容');
        const pixels=ctx(state.mask).getImageData(0,0,s.width,s.height).data;
        let hasSelection=false;for(let index=3;index<pixels.length;index+=4)if(pixels[index]){hasSelection=true;break;}
        if(!hasSelection)throw new Error('请先用画笔或「选区转蒙版」标记要修改的区域');
        // Provider convention: transparent pixels are editable. The local overlay stores
        // white selected pixels so brush/eraser previews and exported selections stay clear.
        const providerMask=canvas(s.width,s.height),maskContext=ctx(providerMask);
        maskContext.fillStyle='#000';maskContext.fillRect(0,0,s.width,s.height);maskContext.globalCompositeOperation='destination-out';maskContext.drawImage(state.mask,0,0);
        const payload={prompt,mask:png(providerMask),image:png(state.base)};
        s.loading=true;s.applying=true;refresh();state.status.textContent='正在提交局部编辑…';
        try {const result=await window.Production.editImage(s.node,payload);if(state.session!==s)return;if(result===false)throw new Error('局部编辑未完成，请检查任务状态');close();}
        finally{if(state.session===s){s.loading=false;s.applying=false;refresh();}}
    }
    function close() {
        const s=state.session;state.session=null;state.sequence++;clearInterval(state.guardTimer);
        if(state.dialog?.open)state.dialog.close();
        if(s){s.restoreTicket++;if(s.focus?.isConnected)s.focus.focus({preventScroll:true});}
        if(state.base){state.base.width=state.mask.width=1;state.base.height=state.mask.height=1;}
        if(state.before){state.before.removeAttribute('src');state.after.removeAttribute('src');}
    }
    function init() {
        if(state.ready)return;state.ready=true;
        const dialog=element('dialog','image-editor-dialog');dialog.id='image-focus-editor';dialog.setAttribute('aria-labelledby','image-editor-title');
        const header=element('header','image-editor-header');const title=element('h2','','聚焦图片编辑');title.id='image-editor-title';header.append(title,button('关闭','close'));
        const tools=element('div','image-editor-tools');tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','图片编辑工具');
        for(const [tool,label] of [['select','框选'],['brush','画笔'],['eraser','橡皮']]){const b=button(label,`tool-${tool}`);b.dataset.editTool=tool;b.setAttribute('aria-pressed','false');tools.append(b);}
        const brushLabel=element('label','image-editor-brush','笔刷大小');const brush=element('input');brush.type='range';brush.min='1';brush.max='240';brush.value='32';brush.setAttribute('aria-label','笔刷大小（图片像素）');const size=element('output','','32 px');brushLabel.append(brush,size);brush.oninput=()=>size.textContent=`${brush.value} px`;tools.append(brushLabel,button('选区转蒙版','mask-box'),button('裁剪选区','crop'),button('撤销','undo'),button('重做','redo'),button('重置','reset'));
        const expand=element('details','image-editor-expand'),expandSummary=element('summary','','扩边');const expandLabel=element('label','','四边增加');const expandSize=element('input');expandSize.type='number';expandSize.min='1';expandSize.max='2048';expandSize.value='128';expandSize.setAttribute('aria-label','四边扩展像素');expandLabel.append(expandSize,document.createTextNode('px'));
        const expandFill=element('select');expandFill.setAttribute('aria-label','扩边填充');for(const [value,label] of [['transparent','透明'],['white','白色'],['black','黑色']]){const option=element('option','',label);option.value=value;expandFill.append(option);}expand.append(expandSummary,expandLabel,expandFill,button('应用扩边','expand'));tools.append(expand,button('放大 2×','resize'));
        const viewport=element('div','image-editor-viewport'),surface=element('div','image-editor-surface'),base=canvas(1,1),mask=canvas(1,1),selection=element('div','image-editor-selection');
        base.className='image-editor-base';mask.className='image-editor-mask';selection.hidden=true;surface.append(base,mask,selection);viewport.append(surface);
        const comparison=element('div','image-editor-comparison');comparison.hidden=true;
        const before=element('img','image-editor-before'),after=element('img','image-editor-after');before.alt='原图';after.alt='当前图片';
        const beforeTag=element('span','image-editor-before-label','原图'),afterTag=element('span','image-editor-after-label','当前');
        const slider=element('input','image-editor-compare-slider');slider.type='range';slider.min='0';slider.max='100';slider.value='50';slider.setAttribute('aria-label','原图与当前图片比较分割位置');
        const divider=element('div','image-editor-divider');comparison.append(before,after,beforeTag,afterTag,divider,slider);slider.oninput=()=>{after.style.clipPath=`inset(0 0 0 ${slider.value}%)`;divider.style.left=`${slider.value}%`;};slider.oninput();
        const status=element('p','image-editor-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
        const footer=element('footer','image-editor-footer');footer.append(button('原图对比','preview'),button('导出蒙版','export-mask'),button('保存蒙版','save-mask'),button('应用为新候选','apply'));
        const provider=element('div','image-editor-provider');provider.hidden=true;const prompt=element('input');prompt.type='text';prompt.placeholder='描述选区内要修改的内容';prompt.setAttribute('aria-label','局部编辑提示词');provider.append(prompt,button('生成局部编辑','generate'));
        dialog.append(header,tools,viewport,comparison,status,provider,footer);document.body.append(dialog);
        Object.assign(state,{dialog,title,tools,viewport,surface,base,mask,selection,comparison,before,after,slider,divider,status,footer,brush,provider,prompt,expandSize,expandFill});
        dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(state.session)close();});
        dialog.addEventListener('keydown',event=>{
            event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();return;}
            if(state.session?.mode!=='edit'||event.target.matches('input,textarea'))return;
            if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();guarded(()=>moveHistory(event.shiftKey?1:-1))();}
            if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();guarded(()=>moveHistory(1))();}
        });
        for(const type of ['pointerdown','mousedown','wheel'])dialog.addEventListener(type,event=>event.stopPropagation());
        dialog.addEventListener('click',guarded(async event=>{
            const action=event.target.closest('[data-edit-action]')?.dataset.editAction;if(!action)return;
            if(action==='close')return close();
            const s=requireSession();if(s.loading)return;
            if(action.startsWith('tool-')){s.tool=action.slice(5);refresh();}
            else if(action==='crop')crop();else if(action==='mask-box')boxMask();
            else if(action==='expand')expandImage();else if(action==='resize')resizeImage();
            else if(action==='undo')await moveHistory(-1);else if(action==='redo')await moveHistory(1);
            else if(action==='reset'){await restore(s,s.originalFrame);if(valid(s))remember(s);}
            else if(action==='save-mask')await saveMask();else if(action==='apply')await apply();
            else if(action==='generate')await generate();
            else if(action==='export-mask'){
                const link=element('a');link.download=`${s.node.dataset.nodeName||'图片'}-mask.png`;link.href=png(state.mask);link.click();state.status.textContent='已导出透明背景、白色选区的蒙版 PNG';
            }else if(action==='preview'){
                const showing=state.comparison.hidden;state.comparison.hidden=!showing;state.viewport.hidden=showing;state.tools.hidden=showing;state.provider.hidden=showing||!s.canGenerate;
                event.target.textContent=showing?'返回编辑':'原图对比';
                if(showing){state.before.src=s.initialSource;state.after.src=png(state.base);}else resize();
            }
        }));
        surface.addEventListener('pointerdown',pointerStart);surface.addEventListener('pointermove',pointerMove);
        surface.addEventListener('pointerup',guarded(pointerEnd));surface.addEventListener('pointercancel',guarded(pointerEnd));
        window.addEventListener('resize',resize);
        const actions=document.getElementById('node-actions');
        if(actions){const entry=button('聚焦编辑','open-focus');entry.id='image-editor-open';entry.hidden=true;entry.title='聚焦编辑图片';entry.addEventListener('click',event=>{event.stopPropagation();open(selected());});actions.append(entry);state.entry=entry;
            new MutationObserver(syncAction).observe(actions,{attributes:true,attributeFilter:['hidden']});
            for(const type of ['pointerup','keyup','click'])document.addEventListener(type,()=>queueMicrotask(syncAction));
        }
        syncAction();
    }
    function syncAction() {if(state.entry){const node=selected(),hidden=!node||node.dataset.nodeType!=='image'||!sourceOf(node);if(state.entry.hidden!==hidden)state.entry.hidden=hidden;}}
    async function open(node) {
        init();close();node=asElement(node);if(!node?.isConnected||node.dataset.nodeType!=='image'||!sourceOf(node)){report('请选择有图片的图片节点');return false;}
        const s={node,projectId:projectId(),originalSource:sourceOf(node),originalVisual:visualKey(node),focus:document.activeElement,mode:'edit',tool:'select',history:[],cursor:-1,loading:true,restoreTicket:0,gesture:null,selection:null};state.session=s;
        state.title.textContent='聚焦图片编辑';state.dialog.showModal();state.tools.hidden=false;state.viewport.hidden=false;state.comparison.hidden=true;state.footer.hidden=false;state.prompt.value='';
        state.dialog.querySelector('[data-edit-action="preview"]').textContent='原图对比';state.status.textContent='正在加载图片…';state.status.dataset.error='false';
        s.canGenerate=canGenerate(node);state.provider.hidden=!s.canGenerate;
        state.guardTimer=setInterval(()=>{if(state.session===s&&!s.applying&&!valid(s)){close();report('图片或画布已改变，编辑已取消');}},400);
        try {
            const image=await loadImage(s.originalSource);if(!valid(s))return false;
            const imageWidth=image.naturalWidth||image.width,imageHeight=image.naturalHeight||image.height,adjust=adjustments(node),angle=adjust.rotate*Math.PI/180;
            const cos=Math.abs(Math.cos(angle))<1e-10?0:Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle))<1e-10?0:Math.abs(Math.sin(angle));
            s.width=Math.ceil(imageWidth*cos+imageHeight*sin);s.height=Math.ceil(imageWidth*sin+imageHeight*cos);
            if(!s.width||!s.height||s.width*s.height>MAX_PIXELS)throw new Error('图片尺寸无效或超过 2400 万像素，请先缩小后编辑');
            state.base.width=state.mask.width=s.width;state.base.height=state.mask.height=s.height;const context=ctx(state.base);
            const transformed=!!(adjust.filter||adjust.rotate||adjust.flip);
            if(transformed){context.save();context.translate(s.width/2,s.height/2);context.scale(adjust.flip?-1:1,1);context.rotate(angle);context.filter=adjust.filter||'none';context.drawImage(image,-imageWidth/2,-imageHeight/2);context.restore();}
            else context.drawImage(image,0,0);
            s.imageSource=s.initialSource=png(state.base);
            const edit=node._production?.edit;
            if(edit?.mask&&edit.width===s.width&&edit.height===s.height&&((!transformed&&edit.source===s.originalSource)||edit.source===s.imageSource)){
                const savedMask=await loadImage(edit.mask);if(!valid(s))return false;ctx(state.mask).drawImage(savedMask,0,0,s.width,s.height);
            }
            s.loading=false;remember(s);s.originalFrame=s.history[0];resize();
            state.status.textContent=`${s.width} × ${s.height} · 框选后裁剪，或用画笔标记需要编辑的区域`;state.status.dataset.error='false';
            state.dialog.querySelector('[data-edit-tool="select"]').focus();return true;
        }catch(error){if(state.session===s){close();report(error);}return false;}
    }
    function compare(node,beforeSrc,afterSrc) {
        init();close();node=asElement(node);if(!node?.isConnected||!comparisonSource(beforeSrc)||!comparisonSource(afterSrc))return false;
        state.session={node,projectId:projectId(),originalSource:sourceOf(node),originalVisual:visualKey(node),focus:document.activeElement,mode:'compare',restoreTicket:0};
        state.title.textContent='图片候选对比';state.tools.hidden=true;state.viewport.hidden=true;state.comparison.hidden=false;state.footer.hidden=true;state.provider.hidden=true;
        state.slider.value='50';state.slider.oninput();
        state.before.onerror=state.after.onerror=()=>report('对比图片加载失败，请检查素材是否仍可访问');
        state.status.textContent='正在加载对比图片…';state.status.dataset.error='false';state.dialog.showModal();state.slider.focus();
        const s=state.session;
        Promise.all([comparisonPixels(beforeSrc),comparisonPixels(afterSrc)]).then(([before,after])=>{if(!valid(s))return;state.before.src=before;state.after.src=after;state.status.textContent='拖动分割线比较原图和当前候选；也可用方向键调整';}).catch(error=>{if(state.session===s)report(error);});
        state.guardTimer=setInterval(()=>{if(!valid(s))close();},400);return true;
    }
    window.ImageEditor={init,open,compare,close,syncAction};
})();
