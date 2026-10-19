/* Non-destructive local composition. Browser codecs are detected at export time. */
window.Timeline = {
    cache: new Map(), renderedImages:new WeakMap(), current:0, playing:false, exporting:false, ratio:'16:9',
    node(id) { return State.nodes.find((n)=>n.el.dataset.nodeId===id); },
    schedule() {
        let cursor=0; const items=[];
        for(const clip of State.timeline||[]) {
            const node=this.node(clip.nodeId), media=Creative.media(node?.el);
            if(!node||!media) continue;
            const audio=node.type==='audio', start=audio?Number(clip.start)||0:cursor;
            const duration=Math.max(.1,Number(clip.duration)||4);
            let src=media.src;
            if(media.tagName==='IMG'&&media.naturalWidth&&(media.style.filter||media.dataset.rotateDeg||media.dataset.flipX==='1')) {
                const key=`${media.style.filter}|${media.dataset.rotateDeg}|${media.dataset.flipX}|${media.src}`;
                const cached=this.renderedImages.get(media);
                if(cached?.key===key)src=cached.src;
                else {try{src=Interaction.getRenderedImageSource(node.el);this.renderedImages.set(media,{key,src});}catch(error){this.status(error.message);}}
            }
            items.push({...clip,start,end:start+duration,audio,type:node.type,src,name:node.el.dataset.nodeName});
            if(!audio)cursor+=duration;
        }
        return {items,duration:Math.max(cursor,...items.map((c)=>c.end),0)};
    },
    open() { document.getElementById('timeline-panel').hidden=false; this.render(); this.draw(0); Creative.layout(); },
    close() { if(this.exporting)return Interaction.toast('请先停止导出', 'warn');this.stop();document.getElementById('timeline-panel').hidden=true;Creative.layout(); },
    restore() { this.ratio=State.view?.timelineRatio||'16:9';document.getElementById('timeline-ratio').value=this.ratio;this.stop();this.cache.forEach((m)=>{if(m.tagName!=='IMG'){m.pause();m.removeAttribute('src');m.load();}});this.cache.clear();this.current=0;if(!document.getElementById('timeline-panel').hidden)this.render(); },
    addSelected() {
        const nodes=Interaction.getSelectedNodeElements();
        if(!nodes.length)return Interaction.toast('先选中图片、视频或音频素材', 'warn');
        let added=0;
        Interaction.runSceneCommand({},()=>{
            State.timeline ||= [];
            for(const node of nodes) {
                const media=Creative.media(node),type=node.dataset.nodeType;
                if(!media||!['image','scene','video','audio'].includes(type)||State.timeline.length>=200)continue;
                const duration=(type==='video'||type==='audio')&&Number.isFinite(media.duration)?Math.min(media.duration,3600):4;
                State.timeline.push({id:`clip_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,nodeId:node.dataset.nodeId,trim:0,duration:Math.max(.1,duration),start:0,volume:1});added++;
            }
        });
        this.open();if(!added)Interaction.toast('所选节点还没有可剪辑素材，或已达到 200 段上限','warn');
    },
    render() {
        const list=document.getElementById('timeline-clips');list.replaceChildren();
        const schedule=this.schedule();
        document.getElementById('timeline-seek').max=String(schedule.duration||1);
        for(const [index,clip] of (State.timeline||[]).entries()) {
            const node=this.node(clip.nodeId),row=document.createElement('div');row.className='timeline-clip';row.dataset.clipId=clip.id;row.draggable=!this.exporting;
            const name=document.createElement('strong');name.textContent=node?.el.dataset.nodeName||'素材已删除';name.title=name.textContent;row.appendChild(Creative.icon(node?.type==='audio'?'audio-lines':node?.type==='video'?'video':'image'));row.appendChild(name);
            for(const [field,label,min,max,step] of [['trim','入点',0,3600,.1],['duration','时长',.1,3600,.1],...(node?.type==='audio'?[['start','开始',0,7200,.1]]:[]),['volume','音量',0,1,.1]]) {
                if(field==='trim'&&(node?.type==='image'||node?.type==='scene'))continue;
                if(field==='volume'&&(node?.type==='image'||node?.type==='scene'))continue;
                const l=document.createElement('label');l.textContent=label+' ';const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.value=clip[field];input.disabled=this.exporting;input.setAttribute('aria-label',`${name.textContent} ${label}`);
                input.onchange=()=>{let v=Number(input.value);if(!Number.isFinite(v)||v<min||v>max){input.value=clip[field];return;}this.stop();Interaction.runSceneCommand({},()=>{clip[field]=v;});this.render();this.draw(this.current);};l.appendChild(input);row.appendChild(l);
            }
            for(const [action,icon,title] of [['up','chevron-left','前移'],['down','chevron-right','后移'],['remove','x','移除片段']]) {
                const b=document.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',`${title} ${name.textContent}`);b.disabled=this.exporting||(action==='up'&&index===0)||(action==='down'&&index===(State.timeline.length-1));b.appendChild(Creative.icon(icon));b.onclick=()=>this.editClip(index,action);row.appendChild(b);
            }
            row.ondragstart=(e)=>{if(e.target.closest('input'))return e.preventDefault();this.dragId=clip.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',clip.id);};row.ondragover=(e)=>{if(this.dragId)e.preventDefault();};row.ondrop=(e)=>{e.preventDefault();if(this.exporting)return;const from=State.timeline.findIndex((c)=>c.id===this.dragId);if(from<0)return;this.stop();Interaction.runSceneCommand({},()=>{const [item]=State.timeline.splice(from,1);State.timeline.splice(index,0,item);});this.dragId=null;this.render();};list.appendChild(row);
        }
        if(!list.children.length)list.textContent='选中画布素材，点击“添加选中素材”。';
        this.updateTime();
    },
    editClip(index,action) { if(this.exporting)return;this.stop();Interaction.runSceneCommand({},()=>{if(action==='remove')State.timeline.splice(index,1);else {const to=index+(action==='up'?-1:1);if(to>=0&&to<State.timeline.length)[State.timeline[index],State.timeline[to]]=[State.timeline[to],State.timeline[index]];}});this.render();this.draw(this.current); },
    load(item) {
        const key=`${item.id}|${item.src}`;
        if(this.cache.has(key))return Promise.resolve(this.cache.get(key));
        return new Promise((resolve,reject)=>{
            const isImage=item.type==='image'||item.type==='scene',el=document.createElement(isImage?'img':item.audio?'audio':'video');
            const timer=setTimeout(()=>{cleanup();el.removeAttribute('src');reject(new Error(`素材加载超时：${item.name}`));},15000);
            const cleanup=()=>{clearTimeout(timer);el.onload=null;el.onloadeddata=null;el.onerror=null;};
            const done=()=>{cleanup();el._clipId=item.id;this.cache.set(key,el);resolve(el);};
            el.onerror=()=>{cleanup();reject(new Error(`素材无法解码：${item.name}`));};
            if(isImage)el.onload=done;else {el.onloadeddata=done;el.preload='auto';el.playsInline=true;el.muted=false;el.onseeked=()=>{if(!this.playing&&!this.exporting)this.draw(this.current);};}
            el.crossOrigin='anonymous';el.src=item.src;
        });
    },
    async prepare() {
        const schedule=this.schedule();
        if(!schedule.items.length)throw new Error('先添加可用素材');
        if(schedule.items.length!==(State.timeline||[]).length)throw new Error('时间线包含已删除或无输出的素材，请先移除对应片段');
        await Promise.all(schedule.items.map((item)=>this.load(item)));
        for(const item of schedule.items) {
            const media=this.cache.get(`${item.id}|${item.src}`);
            if(item.type==='video'||item.audio)if(Number.isFinite(media.duration)&&item.trim+item.duration>media.duration+.1)throw new Error(`${item.name} 的入点和时长超过原素材（${media.duration.toFixed(1)} 秒），请调整`);
        }
        return schedule;
    },
    canvasSize() {
        const canvas=document.getElementById('timeline-preview');
        const [w,h]=this.ratio.split(':').map(Number);const width=w>=h?960:540,height=Math.round(width*h/w);
        if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
        return canvas;
    },
    draw(time=this.current) {
        const canvas=this.canvasSize(),ctx=canvas.getContext('2d');if(!ctx)return;
        ctx.fillStyle='#080808';ctx.fillRect(0,0,canvas.width,canvas.height);
        const schedule=this.schedule(),sample=Math.min(time,Math.max(0,schedule.duration-.001)),active=schedule.items.find((c)=>!c.audio&&sample>=c.start&&sample<c.end);
        if(active) {
            const media=this.cache.get(`${active.id}|${active.src}`);
            if(media) {
                if(active.type==='video'&&!this.playing){const desired=Math.min(active.trim+sample-active.start,Number.isFinite(media.duration)?media.duration:Infinity);if(Math.abs(media.currentTime-desired)>.02)media.currentTime=desired;}
                const w=media.videoWidth||media.naturalWidth,h=media.videoHeight||media.naturalHeight;
                if(w&&h){const r=Math.min(canvas.width/w,canvas.height/h);ctx.drawImage(media,(canvas.width-w*r)/2,(canvas.height-h*r)/2,w*r,h*r);}
            } else {this.load(active).then(()=>this.draw(this.current)).catch((error)=>this.status(error.message));}
        }
        document.querySelectorAll('.timeline-clip').forEach((row)=>row.classList.toggle('is-active',schedule.items.some((c)=>c.id===row.dataset.clipId&&time>=c.start&&time<c.end)));
        this.updateTime();
    },
    updateTime() { const total=this.schedule().duration;document.getElementById('timeline-time').textContent=`${this.current.toFixed(1)} / ${total.toFixed(1)} 秒`;document.getElementById('timeline-seek').value=String(this.current); },
    status(text) { document.getElementById('timeline-status').textContent=text; },
    pauseMedia() { for(const m of this.cache.values())if(m.tagName!=='IMG'){m.pause();m._playingClip=null;} },
    stop() { this.playing=false;cancelAnimationFrame(this.frame);this.pauseMedia();Creative.buttonIcon(document.getElementById('timeline-play'),'play'); },
    async play() {
        if(this.exporting)return;
        if(this.playing){this.stop();return;}
        try {const schedule=await this.prepare();if(this.current>=schedule.duration)this.current=0;await this.beginPlayback(schedule);}
        catch(error){this.stop();this.status(error.message);}
    },
    async beginPlayback(schedule,onEnd,recordingStart) {
        this.playing=true;const startTime=recordingStart??performance.now()-this.current*1000;Creative.buttonIcon(document.getElementById('timeline-play'),'square');
        const tick=()=>{
            if(!this.playing)return;
            this.current=Math.min(schedule.duration,(performance.now()-startTime)/1000);
            for(const media of this.cache.values())if(media.tagName!=='IMG') {
                const item=schedule.items.find((c)=>c.id===media._clipId&&this.current>=c.start&&this.current<c.end&&(c.audio||c.type==='video'));
                if(item) {
                    const desired=item.trim+this.current-item.start;media.volume=item.volume;
                    if(media._playingClip!==item.id||Math.abs(media.currentTime-desired)>.35)media.currentTime=desired;
                    if(media._playingClip!==item.id){media._playingClip=item.id;media.play().catch((error)=>{this.status(`播放被浏览器阻止：${error.message}`);this.stop();onEnd?.(error);});}
                }else if(media._playingClip){media.pause();media._playingClip=null;}
            }
            this.draw(this.current);
            this.recordingTrack?.requestFrame?.();
            if(this.current>=schedule.duration){this.stop();onEnd?.();return;}
            this.frame=requestAnimationFrame(tick);
        };
        tick();
    },
    async exportVideo() {
        if(this.exporting)return;
        let recorder,stream,controller,audioContext;this.stop();
        try {
            const schedule=await this.prepare(),canvas=this.canvasSize();
            if(schedule.duration>600)throw new Error('本地实时导出支持最长 10 分钟，请缩短时间线');
            const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find((m)=>window.MediaRecorder?.isTypeSupported(m));
            if(!mime||!canvas.captureStream)throw new Error('当前浏览器不支持 WebM 录制，请使用最新版 Chrome 或 Edge');
            this.current=0;this.draw(0);
            const videoStream=canvas.captureStream(0);this.recordingTrack=videoStream.getVideoTracks()[0];
            if(!this.recordingTrack.requestFrame)throw new Error('浏览器不支持逐帧画布导出，请更新 Chrome 或 Edge');
            const elements=[...this.cache.values()].filter((m)=>m.tagName!=='IMG');
            if(elements.length) {
                audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
                const dest=audioContext.createMediaStreamDestination();
                for(const m of elements){const source=audioContext.createMediaElementSource(m);source.connect(dest);}
                stream=new MediaStream([...videoStream.getVideoTracks(),...dest.stream.getAudioTracks()]);
            }else stream=videoStream;
            controller=new AbortController();Workspace.pending.set('timeline-export',controller);
            this.exporting=true;document.getElementById('timeline-export').disabled=true;document.getElementById('timeline-cancel-export').hidden=false;this.render();this.current=0;
            recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});const chunks=[];let size=0,failure;
            recorder.ondataavailable=(event)=>{if(event.data.size){size+=event.data.size;if(size>500*1024*1024){failure=new Error('导出文件超过 500MB，请缩短时间线');controller.abort();}else chunks.push(event.data);}};
            const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=(e)=>reject(e.error||new Error('浏览器录制失败'));});
            controller.signal.addEventListener('abort',()=>{this.stop();if(recorder.state!=='inactive')recorder.stop();},{once:true});
            const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('视频编码器未能启动，请保持页面在前台重试')),5000);recorder.onstart=()=>{clearTimeout(timer);resolve();};});
            const recordingStart=performance.now();recorder.start(1000);this.recordingTrack.requestFrame();this.status('正在实时导出，请保持此页面在前台。');
            await started;
            await this.beginPlayback(schedule,(error)=>{failure ||= error;setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},80);},recordingStart);
            await stopped;
            if(failure)throw failure;
            if(controller.signal.aborted){this.status('导出已停止，原素材与剪辑保留。');return;}
            let blob=new Blob(chunks,{type:'video/webm'});if(!blob.size)throw new Error('导出未产生视频数据');
            if(!window.MediaEncoding)throw new Error('视频编码组件未加载，请刷新页面重试');
            blob=await MediaEncoding.fixDuration(blob,schedule.duration*1000);
            Workspace.download(`${document.getElementById('project-name').value||'创作'}-剪辑.webm`,blob);this.status(`已导出 WebM（${blob.size<1024*1024?`${Math.ceil(blob.size/1024)} KB`:`${(blob.size/1024/1024).toFixed(1)} MB`}）。`);
            this.lastExport=blob;if(this.exportUrl)URL.revokeObjectURL(this.exportUrl);this.exportUrl=URL.createObjectURL(blob);document.getElementById('export-preview-video').src=this.exportUrl;document.getElementById('export-preview-dialog').showModal();
        }catch(error){this.status(error.message);Interaction.toast(error.message,'error',5000);}
        finally {
            this.stop();if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach((t)=>t.stop());
            this.recordingTrack?.stop();this.recordingTrack=null;
            if(audioContext){await audioContext.close();this.cache.clear();}
            this.exporting=false;Workspace.finishTask('timeline-export',controller);document.getElementById('timeline-export').disabled=false;document.getElementById('timeline-cancel-export').hidden=true;this.render();
        }
    },
    init() {
        State.timeline ||= [];
        document.getElementById('timeline-btn').onclick=()=>this.open();document.getElementById('timeline-close').onclick=()=>this.close();document.getElementById('timeline-add').onclick=()=>{if(!this.exporting)this.addSelected();};
        document.getElementById('timeline-play').onclick=()=>this.play();document.getElementById('timeline-stop').onclick=()=>{if(this.exporting)return;this.stop();this.current=0;this.draw(0);};
        document.getElementById('timeline-export').onclick=()=>this.exportVideo();document.getElementById('timeline-cancel-export').onclick=()=>Workspace.pending.get('timeline-export')?.abort();
        document.getElementById('timeline-seek').oninput=(e)=>{if(this.exporting)return;this.stop();this.current=Number(e.target.value);this.draw(this.current);};
        document.getElementById('timeline-ratio').onchange=(e)=>{if(this.exporting)return;this.ratio=e.target.value;State.view ||= {};State.view.timelineRatio=this.ratio;Workspace.scheduleSave();this.draw(this.current);};
        document.getElementById('export-preview-dialog').addEventListener('close',()=>document.getElementById('export-preview-video').pause());
        document.getElementById('export-add-to-canvas').onclick=async()=>{if(!this.lastExport)return;const button=document.getElementById('export-add-to-canvas');button.disabled=true;try{const src=await ProjectStore.fileDataUrl(this.lastExport),sources=[...new Set((State.timeline||[]).map((clip)=>this.node(clip.nodeId)?.el).filter(Boolean))];if(!Creative.addNode('video',src,'剪辑成片',sources))return;document.getElementById('export-preview-dialog').close();this.close();}catch(error){this.status(error.message);}finally{button.disabled=false;}};
        window.addEventListener('beforeunload',()=>this.stop());
    }
};
Timeline.init();
