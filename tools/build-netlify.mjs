import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
await import('./build-client.mjs');
await mkdir('.local/netlify-publish',{recursive:true});
await cp('无限画布','.local/netlify-publish',{recursive:true});
const file='.local/netlify-publish/index.html',html=await readFile(file,'utf8');
await writeFile(file,html.replace('未配置的模型需要在本机服务的 .env 中设置 API Key 和供应商模型 ID，然后重启服务。详细配置见项目 README；密钥不会保存到浏览器。','未配置的模型需要在 Netlify 站点的环境变量中设置 API Key 和供应商模型 ID，再重新部署。密钥只在服务端使用。'));
await mkdir('netlify/lib',{recursive:true});
await writeFile('netlify/lib/project-validator.mjs',(await readFile('无限画布/project-store.js','utf8'))+'\nexport const validateProject=ProjectStore.validate;\n');
console.log('Netlify public assets built; source, local data and secrets are outside the publish directory.');
