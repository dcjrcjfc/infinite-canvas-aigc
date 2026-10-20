const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { sharedProjects } = require('./server/shared-projects');
const { createConfig, publicConfig, generateImage, generateVideo, queryVideo, generateAudio, chat } = require('./server/providers');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const LEGAL_FILES = new Set(['/THIRD_PARTY_NOTICES.txt', '/vendor-icons.js.LEGAL.txt', '/scene3d.js.LEGAL.txt', '/media-encoder.js.LEGAL.txt']);
const fail = (status, message) => Object.assign(new Error(message), { status });

function requestPath(raw) {
    let decoded;
    try { decoded = decodeURIComponent(String(raw || '/').split('?')[0]); }
    catch { throw fail(400, 'URL 编码无效'); }
    if (!decoded.startsWith('/') || /[\\\0]/.test(decoded) || decoded.split('/').includes('..')) throw fail(400, '请求路径无效');
    return decoded === '/' ? '/index.html' : decoded;
}
async function readJson(req, limit) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, '请发送 JSON 请求');
    const bytes = await new Promise((resolve, reject) => {
        let length = 0, exceeded = false;
        const chunks = [];
        req.on('data', (chunk) => {
            length += chunk.length;
            if (length > limit) {
                if (!exceeded) reject(fail(413, '请求过大，请减少参考图或压缩素材'));
                exceeded = true;
            } else if (!exceeded) chunks.push(chunk);
        });
        req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
    });
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw fail(400, 'JSON 格式无效'); }
}
function createServer(options = {}) {
    const env = options.env || process.env;
    const config = createConfig(env);
    const fetchImpl = options.fetch || fetch;
    const shared = sharedProjects(options.sharedDir || path.join(env.DATA_DIR || path.join(__dirname, '.local'), 'shared-projects'));
    const root = path.resolve(options.staticRoot || path.join(__dirname, '无限画布'));
    const sessions = new Map(), buckets = new Map(), jobs = new Map();
    const jobFile = options.jobFile === null ? null : options.jobFile || path.join(env.DATA_DIR || path.join(__dirname, '.local'), 'video-jobs.json');
    if (jobFile && fs.existsSync(jobFile)) {
        try {
            const saved = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
            if (Array.isArray(saved)) saved.slice(-1000).forEach(([id, job]) => {
                if (/^[a-f0-9-]{36}$/.test(id) && job?.expires > Date.now() && /^[\w.-]{1,200}$/.test(job.upstreamId) && typeof job.owner === 'string') jobs.set(id, job);
            });
        } catch { throw new Error('视频任务记录无法读取，请保留文件并检查 DATA_DIR'); }
    }
    function persistJobs() {
        if (!jobFile) return;
        fs.mkdirSync(path.dirname(jobFile), { recursive: true });
        const entries = [...jobs].map(([id, job]) => [id, { upstreamId: job.upstreamId, modelId: job.modelId, owner: job.owner, expires: job.expires }]);
        fs.writeFileSync(jobFile + '.tmp', JSON.stringify(entries), { mode: 0o600 });
        fs.renameSync(jobFile + '.tmp', jobFile);
    }
    const password = env.APP_PASSWORD || '';
    const host = env.HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !password) throw new Error('对外监听必须设置 APP_PASSWORD');
    const limit = Math.max(1024, Number(env.MAX_REQUEST_BYTES) || 32 * 1024 * 1024);
    const rateMax = Math.max(1, Number(env.RATE_LIMIT_PER_MINUTE) || 30);
    const audit = options.audit || ((entry) => console.log(JSON.stringify(entry)));
    const server = http.createServer(async (req, res) => {
        const requestId = crypto.randomUUID(), started = Date.now();
        let route = '';
        const json = (status, body, extra = {}) => {
            if (res.writableEnded || res.destroyed) return;
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
            res.end(JSON.stringify(body));
        };
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'self' data: blob: https: http:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        res.setHeader('X-Request-Id', requestId);
        try {
            route = requestPath(req.url);
            if (!route.startsWith('/api/')) {
                if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method Not Allowed');
                const staticRoute = ['/login', '/zh-CN/login'].includes(route) ? '/login.html' : route;
                const filePath = path.resolve(root, '.' + staticRoute), relative = path.relative(root, filePath);
                const contentType = TYPES[path.extname(filePath)] || (LEGAL_FILES.has(route) ? 'text/plain; charset=utf-8' : null);
                if (relative.startsWith('..') || path.isAbsolute(relative) || !contentType) throw fail(404, 'Not Found');
                let body;
                try { body = await fs.promises.readFile(filePath); } catch { throw fail(404, 'Not Found'); }
                res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
                res.end(req.method === 'HEAD' ? undefined : body); return;
            }
            const expectedOrigin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
            const hostname = new URL(`http://${req.headers.host}`).hostname;
            if (!password && !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) throw fail(403, '本机服务不接受该 Host');
            if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '请从本站页面发起请求');
            const sessionId = /(?:^|;\s*)canvas_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
            const session = sessions.get(sessionId);
            const authenticated = !password || !!(session && session.expires > Date.now());
            const owner = password ? crypto.createHash('sha256').update(password).digest('hex') : 'local';
            if (route === '/api/config' && req.method === 'GET') {
                json(200, { ...publicConfig(config), sharedProjects: true, authenticationRequired: !!password, authenticated }); return;
            }
            for (const [key, value] of buckets) if (value.until <= Date.now()) buckets.delete(key);
            for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
            for (const [key, value] of jobs) if (value.expires <= Date.now()) jobs.delete(key);
            const isPoll = route.startsWith('/api/videos/') && req.method === 'GET';
            const bucketKey = `${req.socket.remoteAddress}:${route === '/api/session' ? 'login' : isPoll ? 'poll' : 'generate'}`;
            const bucket = buckets.get(bucketKey) || { count: 0, until: Date.now() + 60000 };
            bucket.count++; buckets.set(bucketKey, bucket);
            if (bucket.count > (isPoll ? 180 : rateMax)) { res.setHeader('Retry-After', '60'); throw fail(429, '请求过于频繁，请一分钟后再试'); }
            if (route === '/api/session' && req.method === 'POST') {
                const body = await readJson(req, Math.min(limit, 4096));
                const actual = crypto.createHash('sha256').update(String(body.password || '')).digest();
                const expected = crypto.createHash('sha256').update(password).digest();
                if (!crypto.timingSafeEqual(actual, expected)) throw fail(401, '访问密码不正确');
                const id = crypto.randomBytes(32).toString('hex');
                sessions.set(id, { expires: Date.now() + 12 * 3600000 });
                json(200, { authenticated: true }, { 'Set-Cookie': `canvas_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${expectedOrigin.startsWith('https:') ? '; Secure' : ''}` }); return;
            }
            if (route === '/api/session' && req.method === 'DELETE') {
                sessions.delete(sessionId);
                json(200, { authenticated: !password }, { 'Set-Cookie': 'canvas_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return;
            }
            if (route.startsWith('/api/shared-projects')) {
                const result = await shared.handle({route,method:req.method,owner:authenticated ? owner : null,token:req.headers['x-canvas-share'],readBody:()=>readJson(req,limit)});
                if(!result)throw fail(404,'共享接口不存在');json(200,result);return;
            }
            if (!authenticated) throw fail(401, '请先输入本站访问密码');
            let result;
            if (req.method === 'POST' && ['/api/images/generations', '/api/images/edits'].includes(route)) result = await generateImage(config, await readJson(req, limit), fetchImpl);
            else if (req.method === 'POST' && route === '/api/chat') result = await chat(config, await readJson(req, Math.min(limit, 256 * 1024)), fetchImpl);
            else if (req.method === 'POST' && route === '/api/audio') result = await generateAudio(config, await readJson(req, Math.min(limit, 256 * 1024)), fetchImpl);
            else if (req.method === 'POST' && route === '/api/videos') {
                if (jobs.size >= 1000) throw fail(429, '视频任务数量已达上限，请等待旧任务过期');
                const submitted = await generateVideo(config, await readJson(req, limit), fetchImpl);
                if (submitted.url) result = { status: 'completed', url: submitted.url };
                else {
                    const id = crypto.randomUUID();
                    jobs.set(id, { ...submitted, owner, expires: Date.now() + 24 * 3600000 });
                    result = { id, status: submitted.status };
                    try { persistJobs(); } catch { result.warning = '视频任务仅在本次服务运行期间可查询，请勿重启服务'; }
                }
            } else if (req.method === 'GET' && /^\/api\/videos\/[a-f0-9-]+$/.test(route)) {
                const id = route.split('/').pop(), job = jobs.get(id);
                if (!job || job.owner !== owner) throw fail(404, '任务不存在或已过期，请检查生成历史');
                result = job.url ? { status: 'completed', url: job.url } : await queryVideo(config, job, fetchImpl);
                if (result.url) job.url = result.url;
                result.id = id;
            } else throw fail(404, '接口不存在或请求方法不正确');
            json(200, result);
        } catch (error) {
            const status = Number(error.status) || 500;
            json(status, { error: { message: status === 500 ? '代理内部错误，请检查服务端配置' : error.message }, requestId });
        } finally {
            if (route.startsWith('/api/')) audit({ requestId, route: route.startsWith('/api/videos/') ? '/api/videos/:id' : route, status: res.statusCode, durationMs: Date.now() - started });
        }
    });
    server.requestTimeout = 30000; server.headersTimeout = 15000;
    return server;
}
if (require.main === module) {
    const envFile = path.join(__dirname, '.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
    try {
        const server = createServer(), host = process.env.HOST || '127.0.0.1';
        server.listen(Number(process.env.PORT || 8787), host, () => console.log(`[canvas] http://${host}:${server.address().port}`));
        for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createServer, requestPath };
