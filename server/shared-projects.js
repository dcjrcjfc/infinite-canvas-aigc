const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
// Reuse the trusted client validator, so shared and local project contracts cannot drift.
// Only this repository source is evaluated; request data is passed as an object.
const validationContext = vm.createContext({ URL, structuredClone });
const validator = new vm.Script(fs.readFileSync(path.join(__dirname,'../无限画布/project-store.js'),'utf8')+'\nProjectStore.validate;').runInContext(validationContext);
const fail = (status,message) => Object.assign(new Error(message),{status});
/* Capability links are scoped to one project. Writes always require a revision. */
function sharedProjects(directory) {
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    const filename = id => { if(!/^[a-f0-9-]{36}$/.test(id))throw fail(404,'共享画布不存在');return path.join(directory,`${id}.json`); };
    const read = id => { try{return JSON.parse(fs.readFileSync(filename(id),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail(404,'共享画布不存在');throw e;} };
    const write = project => { fs.mkdirSync(directory,{recursive:true});const file=filename(project.id);fs.writeFileSync(file+'.tmp',JSON.stringify(project),{mode:0o600});fs.renameSync(file+'.tmp',file); };
    const validate = project => {
        try{return structuredClone(validator({...project,history:[]}));}
        catch{throw fail(400,'画布数据结构、素材地址或连线无效');}
    };
    const permission = (project,owner,token) => {
        if(owner && project.owner===owner)return 'owner';
        const digest=typeof token==='string' && /^[a-f0-9]{64}$/.test(token) ? hash(token) : '';
        return project.invites.find(i=>i.hash===digest && i.expires>Date.now())?.role || null;
    };
    const publicData=(p,role,metadata=false)=>({id:p.id,revision:p.revision,name:p.project.name,updatedAt:p.updatedAt,role,...(metadata?{}:{project:p.project})});
    return {
        async handle({route,method,owner,token,readBody}) {
            const match=/^\/api\/shared-projects(?:\/([a-f0-9-]{36})(?:\/(invites|status))?)?$/.exec(route);
            if(!match)return null;const [,id,action]=match;
            if(!id){
                if(!owner)throw fail(401,'请先登录');
                if(method==='GET') {const rows=fs.existsSync(directory)?fs.readdirSync(directory).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).map(f=>read(f.slice(0,-5))).filter(p=>p.owner===owner).map(p=>publicData(p,'owner',true)):[];return {projects:rows};}
                if(method!=='POST')throw fail(405,'不支持的请求方法');
                const body=await readBody();const p={id:crypto.randomUUID(),owner,revision:1,updatedAt:new Date().toISOString(),invites:[],project:validate(body.project)};write(p);return publicData(p,'owner');
            }
            const p=read(id),role=permission(p,owner,token);if(!role)throw fail(403,'共享链接无效、已过期或已撤销');
            if(action==='invites') {
                if(role!=='owner')throw fail(403,'只有创建者可以管理共享链接');
                if(method==='DELETE'){p.invites=[];write(p);return {revoked:true};}
                if(method!=='POST')throw fail(405,'不支持的请求方法');
                const body=await readBody();if(!['read','edit'].includes(body.role))throw fail(400,'请选择只读或可编辑');
                const current=read(id);if(permission(current,owner,token)!=='owner')throw fail(403,'共享权限已改变');
                const capability=crypto.randomBytes(32).toString('hex'),expires=Date.now()+7*86400000;
                current.invites=current.invites.filter(i=>i.expires>Date.now()).slice(-19);current.invites.push({hash:hash(capability),role:body.role,expires});write(current);
                return {id:p.id,token:capability,role:body.role,expires};
            }
            if(method==='GET')return publicData(p,role,action==='status');
            if(method!=='PUT'||action)throw fail(405,'不支持的请求方法');
            if(role==='read')throw fail(403,'此链接只有查看权限');
            const body=await readBody();
            // Body parsing yields; re-read to avoid a concurrent stale write.
            const current=read(id);if(permission(current,owner,token)!==role)throw fail(403,'共享权限已改变');
            if(!Number.isInteger(body.revision)||body.revision!==current.revision)throw fail(409,'共享画布已被其他人更新。请先备份本地改动，再载入最新版本');
            current.project=validate(body.project);current.revision++;current.updatedAt=new Date().toISOString();write(current);return publicData(current,role,true);
        }
    };
}
module.exports={sharedProjects};
