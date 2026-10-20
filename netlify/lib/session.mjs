import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export function ownerFromSession(request,env,now=Date.now()) {
    if(!env.APP_PASSWORD)return null;
    const value=/(?:^|;\s*)canvas_session=([\w.-]+)(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1];
    if(!value)return null;
    const [payload,signature,...extra]=value.split('.');if(!payload||!signature||extra.length)return null;
    const expected=createHmac('sha256',env.APP_PASSWORD).update(payload).digest();
    const actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
    let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{return null;}
    if(!Number.isFinite(data.expires)||data.expires<=now)return null;
    return createHash('sha256').update(env.APP_PASSWORD).digest('hex');
}
export async function sessionResponse(request,env,now=Date.now()) {
    const headers={'Cache-Control':'no-store'};
    if(request.method==='DELETE')return Response.json({authenticated:false},{headers:{...headers,'Set-Cookie':'canvas_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'}});
    if(request.method!=='POST')return Response.json({error:{message:'不支持的请求方法'}},{status:405,headers});
    if(!env.APP_PASSWORD)return Response.json({error:{message:'管理员尚未配置访问密码。可以先逛逛，使用本地画布。'}},{status:503,headers});
    if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:{message:'请发送 JSON 请求'}},{status:415,headers});
    const text=await request.text();if(text.length>4096)return Response.json({error:{message:'请求过大'}},{status:413,headers});
    let body;try{body=JSON.parse(text);}catch{return Response.json({error:{message:'JSON 格式无效'}},{status:400,headers});}
    const hash=value=>createHash('sha256').update(String(value||'')).digest();
    if(!timingSafeEqual(hash(body.password),hash(env.APP_PASSWORD)))return Response.json({error:{message:'访问密码不正确'}},{status:401,headers});
    const payload=Buffer.from(JSON.stringify({expires:now+12*3600000})).toString('base64url');
    const signature=createHmac('sha256',env.APP_PASSWORD).update(payload).digest('base64url');
    return Response.json({authenticated:true},{headers:{...headers,'Set-Cookie':`canvas_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`}});
}
