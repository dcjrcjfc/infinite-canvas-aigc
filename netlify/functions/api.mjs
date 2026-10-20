import {canvasApi} from '../lib/canvas-api.mjs';
import {storageBindings} from '../lib/storage.mjs';
import {ownerFromSession,sessionResponse} from '../lib/session.mjs';
import providers from '../../server/providers.js';
export default async function handler(request) {
    const env=process.env,url=new URL(request.url),origin=request.headers.get('origin');
    const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:{message:'请从本站页面发起请求'}},403);
    if(url.pathname==='/api/session')return sessionResponse(request,env);
    const owner=ownerFromSession(request,env);
    const cloudStorageAvailable=!!env.NETLIFY_DB_URL;
    if(url.pathname==='/api/config'&&request.method==='GET')return json({...providers.publicConfig(providers.createConfig(env)),authenticationRequired:true,authenticated:!!owner,sharedProjects:!!owner&&cloudStorageAvailable,cloudStorageAvailable,hosting:'netlify'});
    if(!owner)return json({error:{message:'请先使用本站访问密码登录'}},401);
    if(!cloudStorageAvailable)return json({error:{message:'Netlify 云数据库尚未开通，请先使用浏览器本地画布保存。'}},503);
    const headers=new Headers(request.headers);
    // Ignore all caller-supplied identity headers; only a signed cookie establishes ownership.
    headers.delete('oai-authenticated-user-id');headers.set('x-canvas-authenticated-owner',owner);
    try{return await canvasApi(new Request(request,{headers}),storageBindings(env));}
    catch{return json({error:{message:'云端存储暂时不可用，请稍后重试'}},503);}
}
export const config={path:'/api/*',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:120}};
