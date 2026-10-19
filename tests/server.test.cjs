const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../proxy-server');
const { RATIOS, publicAddress } = require('../server/providers');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N2kAAAAASUVORK5CYII=';
const env = { GPT_IMAGE_2_API_KEY: 'test-key-do-not-log', AGENT_API_KEY: 'test-chat', CHATGPT_MODEL: 'fixture-chat', VIDEO_API_KEY: 'test-video', SEEDANCE_MODEL: 'fixture-video' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(t, options = {}) {
    const logs = [], calls = [];
    const server = createServer({ env, jobFile: null, audit: (entry) => logs.push(entry), fetch: async (url, options) => { calls.push({ url, ...options }); return json({ data: [{ b64_json: pixel }] }); }, ...options });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.close(); server.closeAllConnections(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, value, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    return { base, post, server, calls, logs };
}
test('Windows root, assets and HEAD work; malformed URL does not terminate the server', async (t) => {
    const { base } = await setup(t);
    for (const route of ['/', '/index.html', '/script.js', '/style.css', '/project-store.js', '/workspace.js']) assert.equal((await fetch(base + route)).status, 200);
    const head = await fetch(base, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const raw = (requestPath) => new Promise((resolve) => { http.get(base + requestPath, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); });
    assert.equal(await raw('/%ZZ'), 400);
    assert.equal(await raw('/%2e%2e%5c.env'), 400);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base)).status, 200);
});
test('all displayed image ratios reach upstream, edits send exactly one copy per reference', async (t) => {
    const { post, calls } = await setup(t);
    for (const [ratio, size] of Object.entries(RATIOS)) {
        const response = await post('/api/images/generations', { model: 'gpt-image-2', prompt: 'test', ratio });
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(calls.at(-1).body).size, size);
        assert.match((await response.json()).url, /^data:image\/png;base64,/);
    }
    const image = `data:image/png;base64,${pixel}`;
    const response = await post('/api/images/edits', { model: 'gpt-image-2', prompt: 'edit', ratio: '3:4', images: [image, image] });
    assert.equal(response.status, 200);
    const call = calls.at(-1);
    assert.match(call.url, /\/v1\/images\/edits$/);
    assert.equal(call.body.get('size'), '768x1024'); assert.equal(call.body.getAll('image').length, 2);
});
test('invalid/unconfigured models, inputs and upstream errors are explicit; keys never reach API clients/logs', async (t) => {
    const { base, post, logs } = await setup(t);
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.models.find((item) => item.id === 'midjourney').available, false);
    assert.ok(!JSON.stringify(config).includes(env.GPT_IMAGE_2_API_KEY));
    assert.equal((await post('/api/images/generations', { model: 'seedance', prompt: 'x', ratio: '1:1' })).status, 400);
    assert.equal((await post('/api/images/generations', { model: 'midjourney', prompt: 'x', ratio: '1:1' })).status, 503);
    assert.equal((await post('/api/images/generations', { model: 'gpt-image-2', prompt: '', ratio: '1:1' })).status, 400);
    assert.equal((await post('/api/images/edits', { model: 'gpt-image-2', prompt: 'x', ratio: '1:1', images: ['https://private.invalid/x'] })).status, 400);
    assert.ok(!JSON.stringify(logs).includes('test-key'));
    const bad = await setup(t, { fetch: async () => json({ error: { message: `Bearer ${env.GPT_IMAGE_2_API_KEY}` } }, 401) });
    const error = await bad.post('/api/images/generations', { model: 'gpt-image-2', prompt: 'x', ratio: '1:1' });
    assert.equal(error.status, 401); assert.ok(!(await error.text()).includes(env.GPT_IMAGE_2_API_KEY));
});
test('session authentication, lock, cross-site protection and login rate limit', async (t) => {
    const { base, post } = await setup(t, { env: { ...env, APP_PASSWORD: 'fixture-password', RATE_LIMIT_PER_MINUTE: '4' } });
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'test' })).status, 401);
    assert.equal((await post('/api/session', { password: 'wrong' })).status, 401);
    const login = await post('/api/session', { password: 'fixture-password' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await (await fetch(base + '/api/config', { headers: { Cookie: cookie } })).json()).authenticated, true);
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'test' }, { Origin: 'https://evil.invalid', Cookie: cookie })).status, 403);
    await fetch(base + '/api/session', { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'test' }, { Cookie: cookie })).status, 401);
    for (let i = 0; i < 3; i++) await post('/api/session', { password: 'wrong' });
    assert.equal((await post('/api/session', { password: 'wrong' })).status, 429);
    assert.throws(() => createServer({ env: { HOST: '0.0.0.0' } }), /APP_PASSWORD/);
});

test('login routes and local visual assets remain public while generation requires a session', async (t) => {
    const { base, post } = await setup(t, { env: { ...env, APP_PASSWORD: 'login-page-fixture' }, fetch: async () => json({ choices: [{ message: { content: 'session accepted' } }] }) });
    for (const route of ['/login', '/zh-CN/login', '/login.html']) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /id="login-form"/);
        assert.ok(!html.includes('login-page-fixture'));
        assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    }
    for (const [route, type] of [['/assets/pix/logo.jpg', 'image/jpeg'], ['/assets/pix/orbit-headline-sc.woff2', 'font/woff2'], ['/assets/pix/work-0.mp4', 'video/mp4'], ['/login.js', 'application/javascript; charset=utf-8'], ['/login-scene.js', 'application/javascript; charset=utf-8']]) {
        const head = await fetch(base + route, { method: 'HEAD' });
        assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), type);
        assert.ok(Number(head.headers.get('content-length')) > 0); assert.equal(await head.text(), '');
    }
    const before = await (await fetch(base + '/api/config')).json();
    assert.equal(before.authenticationRequired, true); assert.equal(before.authenticated, false);
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'test' })).status, 401);
    const login = await post('/api/session', { password: 'login-page-fixture' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(base + '/api/config', { headers: { Cookie: cookie } })).json()).authenticated, true);
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'test' }, { Cookie: cookie })).status, 200);
});
test('Agent uses the configured upstream model and real returned text', async (t) => {
    let payload;
    const { post } = await setup(t, { fetch: async (url, options) => { assert.match(url, /\/v1\/chat\/completions$/); payload = JSON.parse(options.body); return json({ choices: [{ message: { content: '真实模拟回复' } }] }); } });
    const response = await post('/api/chat', { model: 'chatgpt', prompt: '写角色', context: '角色：蓝色外套' });
    assert.equal((await response.json()).text, '真实模拟回复'); assert.equal(payload.model, 'fixture-chat'); assert.match(payload.messages[1].content, /蓝色外套/);
});
test('video submits once, polls its task, downloads completed video, survives proxy restart', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-jobs-'));
    t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
    const jobFile = path.join(directory, 'jobs.json');
    let creates = 0, polls = 0;
    const mock = async (url, options) => {
        assert.ok(!url.includes('/images/'));
        if (url.endsWith('/content')) return new Response(Buffer.from('fixture-video-bytes'), { headers: { 'Content-Type': 'video/mp4' } });
        if (options.method === 'POST') { creates++; assert.equal(options.body.get('model'), 'fixture-video'); return json({ id: 'upstream-1', status: 'queued' }); }
        polls++; return json({ id: 'upstream-1', status: 'completed' });
    };
    const first = await setup(t, { jobFile, fetch: mock });
    const task = await (await first.post('/api/videos', { model: 'seedance', prompt: 'video', ratio: '16:9', duration: 4 })).json();
    assert.ok(task.id); assert.equal(creates, 1);
    const second = await setup(t, { jobFile, fetch: mock });
    const output = await (await fetch(second.base + `/api/videos/${task.id}`)).json();
    assert.equal(output.status, 'completed'); assert.match(output.url, /^data:video\/mp4;base64,/); assert.equal(creates, 1); assert.equal(polls, 1);
});
test('timeout is bounded and generation is not automatically resubmitted', async (t) => {
    let attempts = 0;
    const { post } = await setup(t, { env: { ...env, UPSTREAM_TIMEOUT_MS: '100' }, fetch: async (url, options) => { attempts++; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })); } });
    const result = await post('/api/images/generations', { model: 'gpt-image-2', prompt: 'x', ratio: '1:1' });
    assert.equal(result.status, 504); assert.equal(attempts, 1);
});
test('private, loopback and reserved result addresses are rejected', () => {
    for (const value of ['127.0.0.1', '10.1.2.3', '169.254.1.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(value), false);
    assert.equal(publicAddress('8.8.8.8'), true);
});

test('oversized, malformed and non-JSON requests return bounded actionable errors', async (t) => {
    const { base, post } = await setup(t, { env: { ...env, MAX_REQUEST_BYTES: '1024' } });
    assert.equal((await post('/api/chat', { model: 'chatgpt', prompt: 'x'.repeat(2000) })).status, 413);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', body: 'plain text' })).status, 415);
    assert.equal((await fetch(base)).status, 200);
});

test('JSON video adapter honors explicit paths, ratio and first frame without image endpoints', async (t) => {
    const calls = [];
    const { post, base } = await setup(t, {
        env: { ...env, VIDEO_API_STYLE: 'json-task', VIDEO_CREATE_PATH: '/custom/video/tasks', VIDEO_QUERY_PATH: '/custom/video/tasks/{id}' },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return options.method === 'POST' ? json({ data: { task_id: 'json-task-1', status: 'processing' } }) : json({ data: { status: 'failed' } });
        }
    });
    const task = await (await post('/api/videos', { model: 'seedance', prompt: 'motion', ratio: '9:16', duration: 8, images: [`data:image/png;base64,${pixel}`] })).json();
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.aspect_ratio, '9:16'); assert.equal(body.duration, 8); assert.equal(body.images.length, 1);
    assert.match(calls[0].url, /\/custom\/video\/tasks$/);
    const status = await (await fetch(base + `/api/videos/${task.id}`)).json();
    assert.equal(status.status, 'failed'); assert.match(calls[1].url, /\/custom\/video\/tasks\/json-task-1$/);
});
