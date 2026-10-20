/* Explicit shared revisions preserve the local draft on conflicts. */
window.SharedWorkspace = {
    binding:null,
    async request(route,method='GET',body,token=this.binding?.token) {
        const response=await fetch(`/api/shared-projects${route}`,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Canvas-Share':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'共享服务请求失败');return result;
    },
    remember() {try{localStorage.setItem('canvas.shared.binding',JSON.stringify(this.binding));}catch{}},
    guard() {
        const id=Workspace.projectId,nodes=State.nodes,binding=this.binding;
        return ()=>{if(id!==Workspace.projectId || nodes!==State.nodes || binding!==this.binding)throw new Error('当前画布或共享连接已改变，操作已停止；原画布未覆盖');};
    },
    async publish() {
        const check=this.guard(),localId=Workspace.projectId;
        await Workspace.flushSave();check();const project=await ProjectStore.portable(Workspace.project());check();
        const result=await this.request('','POST',{project});check();this.binding={id:result.id,revision:result.revision,role:'owner',localId,token:''};this.remember();await this.render();
        Interaction.toast('已保存到共享服务');
    },
    async push() {
        if(!this.binding || this.binding.localId!==Workspace.projectId)throw new Error('当前画布未连接共享版本');
        if(this.binding.role==='read')throw new Error('此共享链接只有查看权限；本地副本可编辑但无法覆盖共享版本');
        const check=this.guard(),binding=this.binding;
        await Workspace.flushSave();check();const project=await ProjectStore.portable(Workspace.project());check();
        const result=await this.request(`/${binding.id}`,'PUT',{revision:binding.revision,project},binding.token);check();
        this.binding.revision=result.revision;this.remember();this.message.textContent=`已同步 · 版本 ${result.revision}`;await this.render();
    },
    async pull() {
        const binding=this.binding;if(!binding)throw new Error('未选择共享画布');
        if(binding.localId!==Workspace.projectId)throw new Error('请先打开对应的共享画布');
        const check=this.guard();
        const result=await this.request(`/${binding.id}`,'GET',undefined,binding.token);check();const project=ProjectStore.validate(result.project);
        const serialized=JSON.stringify(project);
        await Workspace.importProject({size:serialized.length,text:async()=>serialized}, check);
        this.binding={...binding,role:result.role,revision:result.revision,localId:Workspace.projectId};this.remember();Workspace.scheduleSave();
        this.message.textContent=`已载入共享版本 ${result.revision}，可用撤销返回本地修改。`;await this.render();
    },
    async openRemote(id,token='') {
        const check=this.guard();await Workspace.flushSave();check();
        const wasInert=document.body.inert;let committing=false;
        try {
            const result=await this.request(`/${id}`,'GET',undefined,token);check();const project=ProjectStore.validate(result.project);
            if(Workspace.pending.size)throw new Error('请先停止当前生成任务');
            document.body.inert=true;await Workspace.flushSave();check();
            // Use a new local identity so joining never overwrites an existing saved canvas.
            const localId=`project_${crypto.randomUUID()}`;project.id=localId;
            Workspace.saving=true;committing=true;Workspace.savePromise=ProjectStore.save(project,Workspace.revision);
            const revision=await Workspace.savePromise;
            Workspace.projectId=localId;Workspace.revision=revision;Interaction.restoreScene(project.scene);
            State.undoStack=[];State.redoStack=[];State.history=[];Interaction.renderHistory();Interaction.updateUndoRedoUI();
            document.getElementById('project-name').value=project.name;const brand=document.querySelector('.brand-name');if(brand)brand.textContent=project.name;
            this.binding={id,token,localId,revision:result.revision,role:result.role};this.remember();Workspace.scheduleSave();await this.render();
        }finally{if(committing)Workspace.saving=false;document.body.inert=wasInert;}
    },
    async invite(role) {
        if(!this.binding || this.binding.role!=='owner')throw new Error('仅创建者可生成邀请');
        const result=await this.request(`/${this.binding.id}/invites`,'POST',{role});
        const url=new URL(location.origin+'/');url.hash=`shared=${result.id}&key=${result.token}`;
        this.link.value=url.href;this.link.hidden=false;this.link.select();
        this.message.textContent=`${role==='read'?'只读':'可编辑'}链接已生成，7 天内有效。使用同一服务地址访问；localhost 地址仅限本机。`;
    },
    async render() {
        if(!this.body)return;this.body.replaceChildren();const binding=this.binding;
        const connected=binding?.localId===Workspace.projectId;
        const p=document.createElement('p');p.textContent=connected?`当前连接：版本 ${binding.revision} · ${binding.role==='owner'?'创建者':binding.role==='edit'?'可编辑':'只读共享 / 本地可编辑副本'}`:'当前是本地画布，可保存到共享服务。';this.body.append(p);
        const controls=document.createElement('div');controls.className='production-controls';this.body.append(controls);
        Production.button('保存为新的共享画布',()=>this.publish(),controls);
        if(connected){
            const push=Production.button('同步本地修改',()=>this.push(),controls);push.disabled=binding.role==='read';
            Production.button('载入最新版本（可撤销）',()=>this.pull(),controls);
            if(binding.role==='owner'){
                Production.button('生成只读链接',()=>this.invite('read'),controls);Production.button('生成编辑链接',()=>this.invite('edit'),controls);
                Production.button('撤销所有邀请链接',async()=>{await this.request(`/${binding.id}/invites`,'DELETE');this.link.value='';this.link.hidden=true;Interaction.toast('邀请已撤销');},controls);
            }
            Production.button('断开共享',()=>{this.binding=null;this.remember();this.render();},controls);
        }
        const heading=document.createElement('h3');heading.textContent='共享服务中的画布';this.body.append(heading);
        try{const result=await this.request('');for(const project of result.projects){const row=document.createElement('div');row.className='production-task';Production.button(`${project.name} · v${project.revision}`,()=>this.openRemote(project.id),row);this.body.append(row);}}
        catch(e){const note=document.createElement('p');note.textContent=e.message;this.body.append(note);}
    },
    async open(){this.message.textContent='共享修改使用版本检查；冲突时保留本地草稿。载入最新版本后仍可撤销。';this.dialog.showModal();await this.render();},
    init(){
        this.dialog=document.createElement('dialog');this.dialog.className='production-dialog';this.dialog.setAttribute('aria-label','共享画布');
        const header=document.createElement('div');header.className='dialog-header';const title=document.createElement('h2');title.textContent='共享画布';header.append(title);Production.button('关闭',()=>this.dialog.close(),header);
        this.message=document.createElement('p');this.message.className='panel-note';this.message.setAttribute('role','status');this.body=document.createElement('div');
        this.link=document.createElement('input');this.link.readOnly=true;this.link.hidden=true;this.link.setAttribute('aria-label','共享链接');this.link.style.width='100%';
        this.dialog.append(header,this.message,this.body,this.link);document.body.append(this.dialog);
        this.dialog.addEventListener('keydown',e=>e.stopPropagation());this.dialog.addEventListener('mousedown',e=>e.stopPropagation());
        Production.button('共享画布',()=>this.open(),Production.dock);
        try{const saved=JSON.parse(localStorage.getItem('canvas.shared.binding')||'null');if(saved && /^[a-f0-9-]{36}$/.test(saved.id))this.binding=saved;}catch{}
        const params=new URLSearchParams(location.hash.slice(1));
        if(params.has('shared')){
            const id=params.get('shared'),token=params.get('key');history.replaceState(history.state,'',location.pathname+location.search);
            if(/^[a-f0-9-]{36}$/.test(id||'') && /^[a-f0-9]{64}$/.test(token||'')){
                const ready=()=>{if(!Workspace.ready)return setTimeout(ready,100);this.openRemote(id,token).then(()=>Interaction.toast('已打开共享画布')).catch(e=>Interaction.toast(e.message,'error',8000));};ready();
            }
        }
        // Check metadata only while the panel is visible; never silently replace a draft.
        this.timer=setInterval(async()=>{if(!this.dialog.open||!this.binding||this.binding.localId!==Workspace.projectId)return;try{const status=await this.request(`/${this.binding.id}/status`);if(status.revision!==this.binding.revision)this.message.textContent=`共享版本已更新到 ${status.revision}，你的本地修改已保留。可载入最新版本。`;}catch(e){this.message.textContent=e.message;}},5000);
    }
};
