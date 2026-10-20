const {test}=require('node:test');
const assert=require('node:assert/strict');
test('Netlify sessions survive cold starts and reject tampering, expiration and a changed password',async()=>{
    const {sessionResponse,ownerFromSession}=await import('../netlify/lib/session.mjs');
    const env={APP_PASSWORD:'test-only-password'};
    const request=(password)=>new Request('https://canvas.test/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal((await sessionResponse(request('wrong'),env,1000)).status,401);
    const response=await sessionResponse(request(env.APP_PASSWORD),env,1000);
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const signed=new Request('https://canvas.test/api/config',{headers:{cookie}});
    assert.ok(ownerFromSession(signed,env,2000));
    assert.equal(ownerFromSession(signed,env,12*3600000+1001),null);
    assert.equal(ownerFromSession(signed,{APP_PASSWORD:'changed'},2000),null);
    assert.equal(ownerFromSession(new Request('https://canvas.test',{headers:{cookie:cookie.slice(0,-4)+'xxxx'}}),env,2000),null);
    assert.equal((await sessionResponse(request('anything'),{},1000)).status,503);
    const logout=await sessionResponse(new Request('https://canvas.test/api/session',{method:'DELETE'}),env);
    assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('Netlify public config works anonymously while identity-header forgery and cross-origin API calls fail',async()=>{
    const {default:handler}=await import('../netlify/functions/api.mjs');
    const config=await handler(new Request('https://canvas.test/api/config'));
    assert.equal(config.status,200);const capabilities=await config.json();
    assert.equal(capabilities.authenticated,false);assert.equal(capabilities.sharedProjects,false);
    assert.equal(capabilities.cloudStorageAvailable,!!process.env.NETLIFY_DB_URL);
    const forged=await handler(new Request('https://canvas.test/api/shared-projects',{headers:{'x-canvas-authenticated-owner':'admin','oai-authenticated-user-id':'admin'}}));
    assert.equal(forged.status,401);
    const cross=await handler(new Request('https://canvas.test/api/session',{method:'POST',headers:{Origin:'https://evil.test'}}));
    assert.equal(cross.status,403);
});
