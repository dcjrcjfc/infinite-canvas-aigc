/* Production state is part of the portable scene. No task is resumed implicitly. */
window.Production = {
    sequence: 0, epoch: 0, queue: null, concurrency: 2,
    id() { return `result_${Date.now()}_${++this.sequence}_${Math.random().toString(36).slice(2,7)}`; },
    data(node) { return node._production ||= {}; },
    hash(text) {
        let a = 2166136261, b = 5381;
        for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
        return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
    },
    digest(src) {
        this.hashes ||= new Map();
        if (!this.hashes.has(src)) { if (this.hashes.size > 64) this.hashes.clear(); this.hashes.set(src, this.hash(src || '')); }
        return this.hashes.get(src);
    },
    fingerprint(node) {
        const seen = new Set(), inputs = [];
        const visit = (target) => {
            for (const link of State.links) {
                if (link.toEl.closest('.node') !== target) continue;
                const source = link.fromEl.closest('.node');
                if (!source || source._production?.note || seen.has(source.dataset.nodeId)) continue;
                seen.add(source.dataset.nodeId); visit(source);
                const media = source.querySelector('.media-container img, .media-container video, .media-container audio');
                inputs.push([source.dataset.nodeId, source.querySelector('.text-node-input')?.value || '', this.digest(media?.src), media?.style.filter || '', media?.style.transform || '']);
            }
        };
        visit(node);
        return this.hash(JSON.stringify([inputs, node.querySelector('.ai-panel .ai-input')?.value || '', node.dataset.model, node.dataset.ratio, node.dataset.inputMode || 'first-frame', node.dataset.resolution || '',
            node.querySelector('.video-duration')?.value, node.querySelector('.audio-voice')?.value, node.querySelector('.audio-speed')?.value,
            (node._refs || []).map(r => [r.sourceNodeId, this.digest(r.src), r.isPrimary, r.order]) ]));
    },
    snapshotCandidate(snapshot, label) {
        return { id: this.id(), label, createdAt: new Date().toISOString(), media: structuredClone(snapshot.media || {kind:'none',src:null}), text: snapshot.textValue || '',
            prompt: snapshot.prompt || '', model: snapshot.model || '', ratio: snapshot.ratio || '', fingerprint: snapshot.production?.fingerprint || '', usage: null,
            imageFilter:snapshot.imageFilter || '', rotateDeg:snapshot.rotateDeg || '0', flipX:snapshot.flipX || '0' };
    },
    preserveOriginal(node, snapshot) {
        const p = this.data(node); p.candidates ||= [];
        if ((snapshot.media?.src || snapshot.textValue) && !p.candidates.some(c => c.media?.src === snapshot.media?.src && c.text === (snapshot.textValue || '') && (c.imageFilter||'')===(snapshot.imageFilter||'') && (c.rotateDeg||'0')===(snapshot.rotateDeg||'0') && (c.flipX||'0')===(snapshot.flipX||'0'))) {
            p.candidates.push(this.snapshotCandidate(snapshot, p.candidates.length ? '编辑前版本' : '原始版本'));
        }
    },
    recordResult(node, previous, result, fingerprint, parameters) {
        const p = this.data(node); this.preserveOriginal(node, previous);
        const current = Interaction.captureScene().nodes.find(n => n.id === node.dataset.nodeId);
        const urls = result.urls?.length ? result.urls : [result.url || null];
        const candidates = urls.map((url, i) => {
            const c = this.snapshotCandidate(current, `生成结果 ${i + 1}`);
            if(parameters){c.prompt=parameters.prompt;c.model=parameters.model;c.ratio=parameters.ratio;}
            if (url) c.media.src = ProjectStore.safeSource(url);
            c.fingerprint = fingerprint || this.fingerprint(node); c.usage = result.usage || null; return c;
        });
        p.candidates.push(...candidates); if(p.candidates.length>24)p.candidates = [p.candidates[0],...p.candidates.slice(-23)];
        p.adoptedId = candidates[0].id; p.fingerprint = candidates[0].fingerprint; p.dismissed = '';
        this.scheduleRefresh();
    },
    recordUpload(node, previous) {
        this.preserveOriginal(node,previous);
        const current=Interaction.captureScene().nodes.find(n=>n.id===node.dataset.nodeId),p=this.data(node);
        const candidate=this.snapshotCandidate({...current,prompt:'',model:'',production:{}},'上传素材');p.candidates.push(candidate);
        if(p.candidates.length>24)p.candidates=[p.candidates[0],...p.candidates.slice(-23)];
        p.adoptedId=candidate.id;p.fingerprint='';p.dismissed='';this.scheduleRefresh();
    },
    replace(node, candidate) {
        const text = node.querySelector('.text-node-input');
        if (text && candidate.text !== undefined) text.value = candidate.text;
        if (candidate.media?.src) {
            const container = node.querySelector('.media-container'); container.replaceChildren();
            const media = document.createElement(candidate.media.kind); media.src = ProjectStore.safeSource(candidate.media.src);
            if (candidate.media.kind === 'img') {media.alt = node.dataset.nodeName || '采用的图片';media.style.filter=candidate.imageFilter || '';media.dataset.rotateDeg=candidate.rotateDeg || '0';media.dataset.flipX=candidate.flipX || '0';Interaction.applyImageTransform(media);}
            else { media.controls = true; media.preload = 'metadata'; }
            media.onload = media.onloadedmetadata = () => { UI.invalidateNodeGeometry(node); Interaction.requestRender({ lines:true }); };
            container.append(media); node._rawFile = null;
        }
        const p = this.data(node); p.adoptedId = candidate.id; p.fingerprint = candidate.fingerprint || ''; p.dismissed = '';
        Interaction.updateNodeStatus(node, '已采用'); Interaction.refreshDownstreamReferences(node);
    },
    adopt(node, candidateId) {
        if (!node.isConnected) return false;
        const candidate = node._production?.candidates?.find(c => c.id === candidateId); if (!candidate) return false;
        const changed = Interaction.runSceneCommand({ historyText:'采用候选版本',nodeId:node.dataset.nodeId }, () => this.replace(node, candidate));
        this.refresh(); return changed;
    },
    adoptMedia(node, media, label = '编辑结果', extra = {}) {
        if (!node?.isConnected) return false;
        const before = Interaction.captureScene().nodes.find(n => n.id === node.dataset.nodeId);
        return Interaction.runSceneCommand({ historyText:label, nodeId:node.dataset.nodeId }, () => {
            this.preserveOriginal(node, before);
            const candidate = this.snapshotCandidate({...before, media, model:'', prompt:'', imageFilter:'', rotateDeg:'0', flipX:'0'}, label); candidate.fingerprint = this.fingerprint(node);
            const p = this.data(node); p.candidates.push(candidate); if(p.candidates.length>24)p.candidates = [p.candidates[0],...p.candidates.slice(-23)];
            if (extra.edit) p.edit = extra.edit;
            this.replace(node, candidate); this.scheduleRefresh();
        });
    },
    async editImage(node, { prompt, mask, image }) {
        const cap = Workspace.config.models.find(m => m.id === node.dataset.model);
        if (!cap?.available || !cap.maskEditing) throw new Error('当前模型未配置蒙版编辑');
        if (Workspace.pending.has(node.dataset.nodeId)) throw new Error('此节点已有生成任务');
        const controller = new AbortController(), fingerprint = this.fingerprint(node), project = Workspace.projectId;
        const parameters={prompt,model:node.dataset.model,ratio:node.dataset.ratio};
        Workspace.pending.set(node.dataset.nodeId, controller);
        try {
            const result = await Workspace.request('/api/images/edits', { ...parameters, images:[image], mask }, controller.signal);
            if (controller.signal.aborted || !node.isConnected || project !== Workspace.projectId) return false;
            const before = Interaction.captureScene().nodes.find(n => n.id === node.dataset.nodeId);
            Interaction.runSceneCommand({historyText:'局部重绘',nodeId:node.dataset.nodeId}, () => {
                this.replace(node,{media:{kind:'img',src:result.url}}); this.recordResult(node,before,result,fingerprint,parameters);
            });
            this.refresh(); return true;
        } finally { Workspace.finishTask(node.dataset.nodeId,controller); }
    },
    expand(node) {
        const p = this.data(node), candidates = p.candidates || [];
        if (State.nodes.length + candidates.length > ProjectStore.MAX_NODES) return Interaction.toast('候选展开后会超过节点上限','warn');
        const snapshot = Interaction.captureScene().nodes.find(n => n.id === node.dataset.nodeId);
        Interaction.runSceneCommand({historyText:'展开所有候选'}, () => candidates.forEach((c,i) => {
            const copy = structuredClone(snapshot); copy.id = `node_${this.id()}`; copy.x += 340 * (i + 1); copy.media = c.media; copy.textValue = c.text;
            copy.imageFilter=c.imageFilter||'';copy.rotateDeg=c.rotateDeg||'0';copy.flipX=c.flipX||'0';
            copy.refs = []; copy.production = { candidates:[c], adoptedId:c.id }; copy.groupId = ''; copy.withPrompt = false;
            Interaction.instantiateNodeFromSnapshot(copy);
        }));
        Interaction.syncCanvasEmptyState(); Creative.layout();
    },
    button(label, callback, parent) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.onclick = () => Promise.resolve().then(callback).catch(e => Interaction.toast(e.message,'error')); parent?.append(b); return b;
    },
    openCandidates(node) {
        if (!node) return; this.candidateNode = node; this.candidateDialog.replaceChildren();
        const header = document.createElement('div'); header.className = 'dialog-header'; const title = document.createElement('h2'); title.textContent = '候选与采用版本'; header.append(title);
        this.button('关闭',()=>this.candidateDialog.close(),header); this.candidateDialog.append(header);
        const candidates = this.data(node).candidates || [];
        if (!candidates.length) { const p=document.createElement('p');p.textContent='生成或编辑后，旧版本和新结果会保留在这里。';this.candidateDialog.append(p); }
        const grid = document.createElement('div'); grid.className = 'candidate-grid'; this.candidateDialog.append(grid);
        for (const c of candidates) {
            const card=document.createElement('article');card.className='candidate-card'; card.classList.toggle('adopted', c.id === node._production.adoptedId);
            if (c.media?.src) { const media=document.createElement(c.media.kind);media.src=c.media.src; if(c.media.kind!=='img'){media.controls=true;media.preload='metadata';}else {media.alt=c.label;media.style.filter=c.imageFilter||'';media.dataset.rotateDeg=c.rotateDeg||'0';media.dataset.flipX=c.flipX||'0';Interaction.applyImageTransform(media);}card.append(media); }
            else {const p=document.createElement('p');p.textContent=c.text;card.append(p);}
            const label=document.createElement('strong');label.textContent=c.label; card.append(label);
            const detail=document.createElement('small');detail.textContent=`${c.model || '本地素材'} · ${new Date(c.createdAt).toLocaleString()}${c.usage ? ' · 用量 '+JSON.stringify(c.usage) : ''}`;card.append(detail);
            const prompt=document.createElement('details'), summary=document.createElement('summary'), pre=document.createElement('p');summary.textContent='生成参数';pre.textContent=`${c.ratio || ''}\n${c.prompt || '未使用提示词'}`;prompt.append(summary,pre);card.append(prompt);
            const adopt=this.button(c.id === node._production.adoptedId ? '已采用' : '采用',()=>{this.adopt(node,c.id);this.openCandidates(node);},card); adopt.disabled=c.id===node._production.adoptedId;
            if(c.media?.kind==='img' && candidates[0]?.media?.kind==='img') this.button('对比原图',()=>window.ImageEditor?.compare(node,candidates[0],c),card);
            grid.append(card);
        }
        if(candidates.length) this.button('全部展开为节点',()=>{this.expand(node);this.candidateDialog.close();},this.candidateDialog);
        if(!this.candidateDialog.open) this.candidateDialog.showModal();
    },
    scheduleRefresh() { clearTimeout(this.refreshTimer); this.refreshTimer=setTimeout(()=>this.refresh(),120); },
    refresh() {
        for(const {el} of State.nodes) {
            const p=this.data(el), fp=p.fingerprint ? this.fingerprint(el) : '', stale=!!p.fingerprint && fp!==p.fingerprint && p.dismissed!==fp;
            let badge=el.querySelector('.input-stale');
            if(stale && !badge) {badge=this.button('输入已更新',()=>this.openStale(el),el.querySelector('.node-head'));badge.className='input-stale';badge.title='旧结果已保留；点击查看更新操作';}
            if(!stale) badge?.remove();
            el.classList.toggle('reference-note',!!p.note);
        }
        const node=Creative.selected(); this.candidateButton.hidden=!node;
        const panel=node?.querySelector('.ai-panel');
        if(panel && node.dataset.nodeType==='image' && !panel.querySelector('.candidate-count')) {
            const label=document.createElement('label');label.className='candidate-count';label.textContent='候选数量 ';
            const select=document.createElement('select');select.setAttribute('aria-label','生成候选数量');
            const max=Workspace.config.models.find(m=>m.id===node.dataset.model)?.maxOutputs || 1;
            for(let i=1;i<=max;i++){const o=document.createElement('option');o.value=i;o.textContent=`${i} 张`;select.append(o);}
            select.value=String(Math.min(max,node._production?.count||1));select.onchange=()=>Interaction.runSceneCommand({},()=>{this.data(node).count=Number(select.value);});label.append(select);panel.append(label);
        }
        window.ProductionLibrary?.refresh();
    },
    openStale(node) {
        this.openCandidates(node);
        const p=document.createElement('p');p.textContent='上游素材、引用或生成参数已改变。旧结果保留，手写提示词不会被覆盖。';this.candidateDialog.append(p);
        this.button('用当前输入重新生成',async()=>{this.candidateDialog.close();await Interaction.runAI(node);},this.candidateDialog);
        this.button('保留结果并忽略这次变更',()=>{Interaction.runSceneCommand({},()=>{this.data(node).dismissed=this.fingerprint(node);});this.candidateDialog.close();this.refresh();},this.candidateDialog);
    },
    dependencies(nodeId) {
        return State.links.filter(l=>l.toEl.closest('.node')?.dataset.nodeId===nodeId && !l.fromEl.closest('.node')?._production?.note).map(l=>l.fromEl.closest('.node').dataset.nodeId);
    },
    cancelQueue() {
        this.epoch++;
        if(this.queue) for(const task of this.queue.tasks) {
            if(task.state==='running') Workspace.pending.get(task.nodeId)?.abort();
            if(['waiting','running'].includes(task.state)) task.state='cancelled';
        }
        this.queue=null;
    },
    plan(nodes) {
        return nodes.filter(n=>n.el.querySelector('.send-btn') && !n.el._production?.note && n.type!=='scene').map(n=>{
            const cap=Workspace.config.models.find(m=>m.id===n.el.dataset.model);
            return {id:this.id(),nodeId:n.el.dataset.nodeId,name:n.el.dataset.nodeName,state:'waiting',dependencies:this.dependencies(n.el.dataset.nodeId),error:'',
                estimate:cap?.unitPrice ?? null,currency:cap?.currency || ''};
        });
    },
    async run(nodes, retry = false) {
        if(this.queue) return Interaction.toast('已有批量任务正在运行','warn');
        if(Workspace.pending.size) return Interaction.toast('请等待当前单节点任务完成，再执行批量流程','warn');
        const tasks=retry ? (State.productionTasks||[]).filter(t=>['failed','skipped','interrupted','cancelled'].includes(t.state)).map(t=>({...t,state:'waiting',error:''})) : this.plan(nodes);
        if(!tasks.length) return Interaction.toast('没有可执行的生成节点','warn');
        const budget=Number(this.budget?.value), currencies=new Set(tasks.filter(t=>t.estimate!==null).map(t=>t.currency));
        if(this.budget?.value && tasks.every(t=>t.estimate!==null) && currencies.size===1 && tasks.reduce((sum,t)=>sum+t.estimate,0)>budget)return Interaction.toast('本次估算超过预算上限，请调整任务或预算','warn');
        State.productionTasks=tasks; const epoch=++this.epoch, queue={tasks};this.queue=queue;this.renderTasks();Workspace.scheduleSave();
        const active=new Map(), selected=new Set(tasks.map(t=>t.nodeId));
        const runOne=async task=>{
            task.state='running';task.startedAt=new Date().toISOString();this.renderTasks();
            const node=State.nodes.find(n=>n.el.dataset.nodeId===task.nodeId)?.el;
            try {
                if(!node) throw new Error('节点已删除');
                if(!Workspace.config.models.some(m=>m.id===node.dataset.model && m.available)) throw new Error('生成模型未配置');
                const ok=await Interaction.runAI(node);
                if(epoch!==this.epoch)return;
                task.state=ok ? 'completed' : node.dataset.videoTask ? 'interrupted' : 'failed';
                task.error=ok ? '' : node._generationError || '生成未完成，请检查提示词与服务设置';
            } catch(e){if(epoch===this.epoch){task.state='failed';task.error=e.message;}}
            finally {task.endedAt=new Date().toISOString();active.delete(task.nodeId);if(epoch===this.epoch){this.renderTasks();Workspace.scheduleSave();}}
        };
        while(epoch===this.epoch && tasks.some(t=>['waiting','running'].includes(t.state))) {
            let started=false;
            for(const task of tasks.filter(t=>t.state==='waiting')) {
                const deps=task.dependencies.filter(id=>selected.has(id)).map(id=>tasks.find(t=>t.nodeId===id));
                if(deps.some(t=>['failed','skipped','cancelled','interrupted'].includes(t.state))){task.state='skipped';task.error='上游任务未完成';continue;}
                if(deps.some(t=>t.state!=='completed'))continue;
                if(active.size>=this.concurrency)break;
                started=true;const promise=Promise.resolve().then(()=>runOne(task));task.state='running';active.set(task.nodeId,promise);
            }
            if(active.size)await Promise.race(active.values());
            else if(!started){for(const t of tasks.filter(t=>t.state==='waiting')){t.state='skipped';t.error='依赖无法执行';}break;}
        }
        if(epoch===this.epoch){this.queue=null;this.renderTasks();Workspace.scheduleSave();this.refresh();}
    },
    renderTasks() {
        if(!this.taskBody)return;this.taskBody.replaceChildren();
        const names={waiting:'等待上游',running:'运行中',completed:'已完成',failed:'失败',skipped:'已跳过',cancelled:'已停止',interrupted:'待确认／恢复'};
        document.querySelectorAll('.production-state').forEach(el=>el.remove());
        for(const t of State.productionTasks||[]) {
            const row=document.createElement('div');row.className='production-task';
            this.button(t.name,()=>{const n=State.nodes.find(n=>n.el.dataset.nodeId===t.nodeId);if(n)Interaction.focusNode(n.el);},row);
            const info=document.createElement('span');info.textContent=`${names[t.state]}${t.error ? ' · '+t.error : ''}`;row.append(info);
            const price=document.createElement('small');price.textContent=t.estimate===null || t.estimate===undefined ? '费用未提供' : `估算 ${t.estimate} ${t.currency} / 请求（非账单）`;row.append(price);this.taskBody.append(row);
            if(t.state!=='completed'){const node=State.nodes.find(n=>n.el.dataset.nodeId===t.nodeId)?.el;if(node){const badge=document.createElement('span');badge.className='production-state';badge.textContent=names[t.state];badge.title=t.error||'';node.querySelector('.node-head')?.append(badge);}}
        }
        this.taskStatus.textContent=this.queue ? '执行中；停止仅中止本地等待，已提交任务可能继续运行。' : '按连线顺序执行；仅失败及其跳过的下游会重试。远程状态不明时请先查供应商记录。';
    },
    estimate(nodes) {
        const tasks=this.plan(nodes), totals=new Map();let unknown=0;
        for(const t of tasks){if(t.estimate===null)unknown++;else totals.set(t.currency,(totals.get(t.currency)||0)+t.estimate);}
        return `${tasks.length} 个生成节点；${[...totals].map(([c,v])=>`${v.toFixed(3)} ${c}`).join(' + ')||'没有已知单价'}${unknown?`；${unknown} 个任务费用未提供，预算无法保证`:''}`;
    },
    openTasks() {this.preview.textContent=`选中：${this.estimate(CanvasLayout.selected())}\n全部：${this.estimate(State.nodes)}\n估算按服务配置的每请求价格；实际用量以供应商账单为准。`;this.renderTasks();if(!this.taskDialog.open)this.taskDialog.showModal();},
    init() {
        if(this.initialized)return;this.initialized=true;
        this.candidateButton=this.button('候选',()=>this.openCandidates(Creative.selected()),document.getElementById('node-actions'));this.candidateButton.className='production-candidates';
        this.candidateDialog=document.createElement('dialog');this.candidateDialog.className='production-dialog';this.candidateDialog.setAttribute('aria-label','候选版本');document.body.append(this.candidateDialog);
        const dock=document.createElement('div');dock.className='production-dock';dock.setAttribute('aria-label','制作工具');document.body.append(dock);this.dock=dock;
        this.button('任务中心',()=>this.openTasks(),dock);
        this.taskDialog=document.createElement('dialog');this.taskDialog.className='production-dialog';this.taskDialog.setAttribute('aria-label','任务中心');document.body.append(this.taskDialog);
        const header=document.createElement('div');header.className='dialog-header';const title=document.createElement('h2');title.textContent='任务中心';header.append(title);this.button('关闭',()=>this.taskDialog.close(),header);this.taskDialog.append(header);
        const controls=document.createElement('div');controls.className='production-controls';this.taskDialog.append(controls);
        const label=document.createElement('label');label.textContent='同时运行 ';const select=document.createElement('select');select.setAttribute('aria-label','生成并发数量');[1,2,3].forEach(i=>{const o=document.createElement('option');o.value=i;o.textContent=i;select.append(o);});select.value=this.concurrency;select.onchange=()=>{this.concurrency=Number(select.value);};label.append(select);controls.append(label);
        this.button('执行选中节点／组',()=>this.run(CanvasLayout.selected()),controls);
        this.button('执行全部生成节点',()=>this.run(State.nodes),controls);
        this.button('重试未完成任务',()=>this.run([],true),controls);
        this.button('停止队列',()=>{this.cancelQueue();this.renderTasks();Workspace.scheduleSave();},controls);
        this.taskStatus=document.createElement('p');this.taskStatus.className='panel-note';this.taskDialog.append(this.taskStatus);
        this.preview=document.createElement('p');this.preview.className='panel-note';this.preview.style.whiteSpace='pre-line';this.taskDialog.append(this.preview);
        const budgetLabel=document.createElement('label');budgetLabel.textContent='预算上限（仅全部费用已知、同币种时生效） ';this.budget=document.createElement('input');this.budget.type='number';this.budget.min='0';this.budget.step='0.01';this.budget.placeholder='不限';this.budget.setAttribute('aria-label','批量生成预算上限');budgetLabel.append(this.budget);this.taskDialog.append(budgetLabel);
        this.taskBody=document.createElement('div');this.taskDialog.append(this.taskBody);
        for(const dialog of [this.candidateDialog,this.taskDialog]) {dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('mousedown',e=>e.stopPropagation());}
        const original=Interaction.pushCommand.bind(Interaction);Interaction.pushCommand=(...args)=>{original(...args);this.scheduleRefresh();};
        const position=Creative.positionEditor.bind(Creative);Creative.positionEditor=(...args)=>{position(...args);const node=Creative.selected();this.candidateButton.hidden=!node;if(this.lastSelected!==node){this.lastSelected=node;this.scheduleRefresh();}};
        document.addEventListener('input',e=>{if(e.target.closest('.node'))this.scheduleRefresh();});
        document.addEventListener('change',e=>{if(e.target.closest('.node'))this.scheduleRefresh();});
        const selectModel=Interaction.selectNodeModel.bind(Interaction);Interaction.selectNodeModel=(node,...args)=>{selectModel(node,...args);node.querySelector('.candidate-count')?.remove();this.scheduleRefresh();};
        this.scheduleRefresh();
    }
};
