/* Opt-in, local interaction benchmark. Never runs in ordinary projects. */
(() => {
    if (new URLSearchParams(location.search).get('performance') !== '1') return;
    const panel = document.createElement('aside');
    panel.style.cssText = 'position:fixed;right:16px;bottom:70px;z-index:20000;width:350px;padding:16px;background:#191919;color:#eee;border:1px solid #555;border-radius:12px;font:12px/1.6 monospace';
    const button = document.createElement('button'); button.textContent = '运行 80 节点交互基准（约 7 秒）';
    const output = document.createElement('pre'); output.style.cssText='white-space:pre-wrap;margin-bottom:0'; output.id='performance-result';
    output.textContent = '临时测试场景；结束后恢复画布，不保存测试内容。'; panel.append(button, output); document.body.append(panel);
    let measuring=false, counters, renderTimes;
    for (const [object,key,label] of [[UI,'updateLines','edges'],[Engine,'getConnPos','geometryReads'],[Creative,'positionEditor','editorLayouts'],[Workspace,'scheduleSave','saveRequests']]) {
        const original=object[key]; object[key]=function(...args){const start=performance.now();if(measuring)counters[label]=(counters[label]||0)+1;const result=original.apply(this,args);if(measuring&&label!=='geometryReads')renderTimes.push(performance.now()-start);return result;};
    }
    const originalRequest=Interaction.requestRender;
    Interaction.requestRender=function(...args){const start=performance.now();const result=originalRequest.apply(this,args);if(measuring)renderTimes.push(performance.now()-start);return result;};
    const originalCanvas=UI.updateCanvas;
    UI.updateCanvas=function(...args){const start=performance.now();const result=originalCanvas.apply(this,args);if(measuring)renderTimes.push(performance.now()-start);return result;};
    button.onclick=async()=>{
        if (!Workspace.ready || Workspace.pending.size) {output.textContent='请等待项目加载或生成结束。';return;}
        button.disabled=true;
        await Workspace.save();
        const scene=Interaction.captureScene(), history=State.history, undo=State.undoStack, redo=State.redoStack;
        Workspace.ready=false; clearTimeout(Workspace.timer); Interaction.stopInertia();
        const nextFrame=()=>new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('动画帧未运行：请保持浏览器窗口可见后重试。')),3000);
            requestAnimationFrame((now)=>{clearTimeout(timer);resolve(now);});
        });
        const results=[];
        try {
            Interaction.restoreScene({nodes:[],links:[],canvas:{x:-4000,y:-4000,scale:.8}});
            State.view={}; Interaction.setAgentPanelOpen(false);
            for(let i=0;i<80;i++) {
                const x=4200+(i%10)*390,y=4200+Math.floor(i/10)*360;
                const el=UI.createNode('image',{x,y});State.nodes.push({el,x,y,type:'image'});
                if(i) Interaction.createLinkBetween(State.nodes[i-1].el.querySelector('.conn-right'),el.querySelector('.conn-left'));
            }
            const selected=State.nodes[0]; State.selection={type:'node',item:selected.el};selected.el.classList.add('selected');
            Creative.applyView(); Interaction.requestRender({canvas:true,lines:true});
            await nextFrame(); await nextFrame();
            Interaction.syncCanvasEmptyState();
            for(const stage of ['pan','zoom','drag']) {
                output.textContent=`正在测量 ${stage}…`;
                counters={};renderTimes=[];const frames=[];let last=await nextFrame();const started=performance.now();measuring=true;
                for(let frame=0;frame<120&&performance.now()-started<2000;frame++) {
                    const now=await nextFrame();frames.push(now-last);last=now;
                    if(stage==='pan'){const view=document.getElementById('viewport');view.onwheel({target:view,deltaX:Math.sin(frame/15)*3,deltaY:Math.cos(frame/15)*2,deltaMode:0,ctrlKey:false,preventDefault(){}});}
                    if(stage==='zoom')Interaction.zoomAt(innerWidth/2,innerHeight/2,frame<60?1.004:1/1.004);
                    if(stage==='drag'){Interaction.dragNode=selected;if(Interaction.moveNode)Interaction.moveNode(selected,Math.sin(frame/15)*3,Math.cos(frame/15)*2);else{selected.x+=Math.sin(frame/15)*3;selected.y+=Math.cos(frame/15)*2;selected.el.style.left=`${selected.x}px`;selected.el.style.top=`${selected.y}px`;}Interaction.requestRender({lines:true,nodePositions:true});}
                }
                await nextFrame(); measuring=false;
                const percentile=(list,p)=>[...list].sort((a,b)=>a-b)[Math.floor((list.length-1)*p)]||0;
                results.push({stage,frames:frames.length,elapsedMs:Math.round(performance.now()-started),frameP95:+percentile(frames,.95).toFixed(2),timingConstrained:percentile(frames,.95)>500,framesOver25ms:frames.filter(x=>x>25).length,renderP95:+percentile(renderTimes,.95).toFixed(2),...counters});
                output.textContent=JSON.stringify(results,null,2);
            }
        } catch(error) { results.push({error:error.message}); } finally {
            measuring=false;Interaction.dragNode=null;Interaction.restoreScene(scene);State.history=history;State.undoStack=undo;State.redoStack=redo;Workspace.ready=true;Workspace.dirty=false;clearTimeout(Workspace.timer);button.disabled=false;
            output.textContent=JSON.stringify(results,null,2);output.dataset.result=JSON.stringify(results);
        }
    };
})();
