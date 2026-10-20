const {test}=require('node:test');const assert=require('node:assert/strict');
const {createConfig,publicConfig,generateImage}=require('../server/providers');
test('multi-image capability validates counts and preserves all returned results and numeric usage',async()=>{
 const config=createConfig({GPT_IMAGE_2_API_KEY:'secret',GPT_IMAGE_2_MAX_OUTPUTS:'4',GPT_IMAGE_2_PRICE_PER_REQUEST:'0.2',GPT_IMAGE_2_PRICE_CURRENCY:'USD'});let sent;
 const fetch=async(url,opts)=>{sent=JSON.parse(opts.body);return new Response(JSON.stringify({data:[{b64_json:'eA=='},{b64_json:'eQ=='}],usage:{total_tokens:12,secret:'no'}}));};
 const result=await generateImage(config,{model:'gpt-image-2',prompt:'test',ratio:'1:1',count:2},fetch);
 assert.equal(sent.n,2);assert.equal(result.urls.length,2);assert.deepEqual(result.usage,{total_tokens:12});
 assert.equal(publicConfig(config).models.find(m=>m.id==='gpt-image-2').unitPrice,.2);
 await assert.rejects(()=>generateImage(config,{model:'gpt-image-2',prompt:'test',ratio:'1:1',count:5},fetch),/最多生成/);
});
test('mask editing is capability gated and sends a multipart PNG mask',async()=>{
 const body={model:'gpt-image-2',prompt:'edit',ratio:'1:1',images:['data:image/png;base64,eA=='],mask:'data:image/png;base64,eQ=='};
 const env={GPT_IMAGE_2_API_KEY:'secret'};
 await assert.rejects(()=>generateImage(createConfig(env),body,()=>{}),/蒙版编辑/);
 let form;const result=await generateImage(createConfig({...env,GPT_IMAGE_2_MASK_EDITING:'true'}),body,async(url,opts)=>{form=opts.body;return new Response(JSON.stringify({data:[{b64_json:'eA=='}]}));});
 assert.equal(form.get('mask').type,'image/png');assert.equal(form.getAll('image').length,1);assert.ok(result.url);
});
