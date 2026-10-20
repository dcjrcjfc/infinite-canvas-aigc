import providers from '../../server/providers.js';
import {validateProject} from './project-validator.mjs';
const {createConfig,publicConfig,generateImage,generateVideo,queryVideo,generateAudio,chat}=providers;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function bodyOf(request,limit=32*1024*1024) {
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw fail(415,'请发送 JSON 请求');
    if(Number(request.headers.get('content-length'))>limit)throw fail(413,'请求过大，请压缩素材');
    const reader=request.body?.getReader(); if(!reader)throw fail(400,'请求正文为空');
    let length=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw fail(413,'请求过大，请压缩素材');}chunks.push(value);}
    const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
    try{return JSON.parse(new TextDecoder().decode(data));}catch{throw fail(400,'JSON 格式无效');}
}
const cleanProject=project=>{try{return validateProject({...project,history:[]});}catch{throw fail(400,'画布数据结构、素材地址或连线无效');}};
const metadata=(row,role)=>({id:row.id,revision:row.revision,name:row.name,updatedAt:row.updated_at,role});
async function permission(row,owner,capability) {
    if(owner===row.owner)return 'owner';
    if(!/^[a-f0-9]{64}$/.test(capability||''))return null;
    const hashed=await digest(capability);
    return JSON.parse(row.invites).find(i=>i.hash===hashed&&i.expires>Date.now())?.role||null;
}
async function shared(request,env,owner,route) {
    const match=/^\/api\/shared-projects(?:\/([a-f0-9-]{36})(?:\/(invites|status))?)?$/.exec(route);
    if(!match)throw fail(404,'共享接口不存在');
    const [,id,action]=match,method=request.method;
    if(!id){
        if(method==='GET'){const {results}=await env.DB.prepare('SELECT * FROM canvas_projects WHERE owner = ? ORDER BY updated_at DESC').bind(owner).all();return {projects:results.map(row=>metadata(row,'owner'))};}
        if(method!=='POST')throw fail(405,'不支持的请求方法');
        const project=cleanProject((await bodyOf(request)).project),id=crypto.randomUUID(),key=`projects/${id}/${crypto.randomUUID()}.json`,now=new Date().toISOString();
        await env.BUCKET.put(key,JSON.stringify(project),{httpMetadata:{contentType:'application/json'}});
        try{await env.DB.prepare('INSERT INTO canvas_projects (id,owner,revision,name,object_key,updated_at,invites) VALUES (?,?,1,?,?,?,?)').bind(id,owner,project.name,key,now,'[]').run();}
        catch(error){await env.BUCKET.delete(key);throw error;}
        return {id,revision:1,name:project.name,updatedAt:now,role:'owner',project};
    }
    const row=await env.DB.prepare('SELECT * FROM canvas_projects WHERE id = ?').bind(id).first();
    if(!row)throw fail(404,'共享画布不存在');
    const role=await permission(row,owner,request.headers.get('x-canvas-share'));if(!role)throw fail(403,'共享链接无效、已过期或已撤销');
    if(action==='invites'){
        if(role!=='owner')throw fail(403,'只有创建者可以管理共享链接');
        if(method==='DELETE'){await env.DB.prepare('UPDATE canvas_projects SET invites = ? WHERE id = ? AND owner = ?').bind('[]',id,owner).run();return {revoked:true};}
        if(method!=='POST')throw fail(405,'不支持的请求方法');
        const body=await bodyOf(request,4096);if(!['read','edit'].includes(body.role))throw fail(400,'请选择只读或可编辑');
        const capability=token(),expires=Date.now()+7*86400000;
        const invites=JSON.parse(row.invites).filter(i=>i.expires>Date.now()).slice(-19);
        invites.push({hash:await digest(capability),role:body.role,expires});
        const result=await env.DB.prepare('UPDATE canvas_projects SET invites = ? WHERE id = ? AND invites = ?').bind(JSON.stringify(invites),id,row.invites).run();
        if(!result.meta.changes)throw fail(409,'共享链接已改变，请重试');
        return {id,token:capability,role:body.role,expires};
    }
    if(method==='GET'){
        if(action==='status')return metadata(row,role);
        const stored=await env.BUCKET.get(row.object_key);if(!stored)throw fail(503,'画布暂时无法读取，请稍后重试');
        return {...metadata(row,role),project:await stored.json()};
    }
    if(method!=='PUT'||action)throw fail(405,'不支持的请求方法');
    if(role==='read')throw fail(403,'此链接只有查看权限');
    const body=await bodyOf(request);
    if(!Number.isInteger(body.revision)||body.revision!==row.revision)throw fail(409,'共享画布已更新，请先备份本地改动，再载入最新版本');
    const project=cleanProject(body.project),key=`projects/${id}/${crypto.randomUUID()}.json`,now=new Date().toISOString();
    await env.BUCKET.put(key,JSON.stringify(project),{httpMetadata:{contentType:'application/json'}});
    // Compare both revision and capabilities after body parsing/storage yields.
    const result=await env.DB.prepare('UPDATE canvas_projects SET revision = revision + 1, name = ?, object_key = ?, updated_at = ? WHERE id = ? AND revision = ? AND invites = ?').bind(project.name,key,now,id,row.revision,row.invites).run();
    if(!result.meta.changes){await env.BUCKET.delete(key);throw fail(409,'共享画布或权限已改变，请载入最新版本');}
    // Keep the preceding immutable snapshot readable by concurrent readers.
    return {id,revision:row.revision+1,name:project.name,updatedAt:now,role};
}
export async function canvasApi(request,env,fetchImpl=fetch) {
    const requestId=crypto.randomUUID();
    try{
        const url=new URL(request.url),route=url.pathname,origin=request.headers.get('origin');
        if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')throw fail(403,'请从本站页面发起请求');
        // These identity headers are set by Sites dispatch, never by frontend code.
        const owner=request.headers.get('x-canvas-authenticated-owner');
        const config=createConfig(env);
        if(route==='/api/config'&&request.method==='GET')return json({...publicConfig(config),sharedProjects:!!owner,authenticationRequired:true,authenticated:!!owner,hosting:'netlify'});
        if(!owner)throw fail(401,'请先使用本站访问密码登录');
        if(route==='/api/session'&&['POST','DELETE'].includes(request.method))return json({authenticated:true,managedBy:'sites'});
        const now=Date.now(),poll=route.startsWith('/api/videos/')&&request.method==='GET';
        const bucket=`${owner}:${poll?'poll':'write'}:${Math.floor(now/60000)}`;
        await env.DB.prepare('DELETE FROM canvas_limits WHERE expires < ?').bind(now).run();
        const count=await env.DB.prepare('INSERT INTO canvas_limits (id,count,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+120000).first();
        if(count.count>(poll?180:60))throw fail(429,'请求过于频繁，请一分钟后再试');
        if(route.startsWith('/api/shared-projects'))return json(await shared(request,env,owner,route));
        let result;
        if(request.method==='POST'&&['/api/images/generations','/api/images/edits'].includes(route))result=await generateImage(config,await bodyOf(request),fetchImpl);
        else if(request.method==='POST'&&route==='/api/chat')result=await chat(config,await bodyOf(request,256*1024),fetchImpl);
        else if(request.method==='POST'&&route==='/api/audio')result=await generateAudio(config,await bodyOf(request,256*1024),fetchImpl);
        else if(request.method==='POST'&&route==='/api/videos'){
            await env.DB.prepare('DELETE FROM canvas_jobs WHERE expires < ?').bind(now).run();
            const {count}=await env.DB.prepare('SELECT count(*) AS count FROM canvas_jobs WHERE owner = ?').bind(owner).first();
            if(count>=1000)throw fail(429,'视频任务数量已达上限');
            const submitted=await generateVideo(config,await bodyOf(request),fetchImpl);
            if(submitted.url)result={status:'completed',url:submitted.url};
            else{const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO canvas_jobs (id,owner,payload,expires) VALUES (?,?,?,?)').bind(id,owner,JSON.stringify(submitted),now+86400000).run();result={id,status:submitted.status};}
        }else if(request.method==='GET'&&/^\/api\/videos\/[a-f0-9-]{36}$/.test(route)){
            const id=route.split('/').pop(),job=await env.DB.prepare('SELECT payload FROM canvas_jobs WHERE id = ? AND owner = ? AND expires > ?').bind(id,owner,now).first();
            if(!job)throw fail(404,'任务不存在或已过期');
            result={...await queryVideo(config,JSON.parse(job.payload),fetchImpl),id};
        }else throw fail(404,'接口不存在或请求方法不正确');
        return json(result);
    }catch(error){const status=Number(error.status)||500;return json({error:{message:status===500?'服务暂时不可用，请稍后重试':error.message},requestId},status);}
}
