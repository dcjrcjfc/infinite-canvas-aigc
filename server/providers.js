const { lookup } = require('node:dns').promises;
const net = require('node:net');
const fail = (status, message) => Object.assign(new Error(message), { status });
const RATIOS = { '1:1': '1024x1024', '16:9': '1536x864', '9:16': '864x1536', '4:3': '1024x768', '3:4': '768x1024', '2:3': '1024x1536', '3:2': '1536x1024', '7:4': '1792x1024', '4:7': '1024x1792', '21:9': '1792x768' };
function createConfig(env) {
    const base = env.IMAGE_API_BASE || 'https://ai.t8star.org';
    const list = (value, fallback) => value ? String(value).split(',').map((v) => v.trim()).filter(Boolean) : fallback;
    const model = (id, label, type, prefix, fallback, defaultModel = '') => ({
        id, label, type, model: env[`${prefix}_MODEL`] || defaultModel,
        key: env[`${prefix}_API_KEY`] || fallback || '',
        base: env[`${prefix}_API_BASE`] || (type === 'video' ? env.VIDEO_API_BASE : type === 'text' ? env.AGENT_API_BASE : base) || base,
        protocol: env[`${prefix}_API_STYLE`] || (type === 'video' ? env.VIDEO_API_STYLE || 'openai' : 'openai'),
        createPath: env[`${prefix}_CREATE_PATH`] || env.VIDEO_CREATE_PATH,
        queryPath: env[`${prefix}_QUERY_PATH`] || env.VIDEO_QUERY_PATH
        ,ratios: type === 'video' ? list(env[`${prefix}_RATIOS`] || env.VIDEO_RATIOS, ['16:9', '9:16']) : [],
        durations: type === 'video' ? list(env[`${prefix}_DURATIONS`] || env.VIDEO_DURATIONS, ['4', '8', '12']).map(Number) : [],
        inputModes: type === 'video' ? list(env[`${prefix}_INPUT_MODES`] || env.VIDEO_INPUT_MODES, ['first-frame']) : [],
        resolutions: type === 'video' ? list(env[`${prefix}_RESOLUTIONS`] || env.VIDEO_RESOLUTIONS, []) : [],
        maxReferences: type === 'video' ? Math.max(1, Math.min(4, Number(env[`${prefix}_MAX_REFERENCES`] || env.VIDEO_MAX_REFERENCES) || 1)) : 16
    });
    const models = [
        model('gemini-3.1-flash-image-preview-4k', 'NanoBanana', 'image', 'NANOBANANA', '', 'gemini-3.1-flash-image-preview-4k'),
        model('gpt-image-2', 'gpt-image-2', 'image', 'GPT_IMAGE_2', '', 'gpt-image-2'),
        model('midjourney', 'Midjourney', 'image', 'MIDJOURNEY'),
        model('jimeng-ai', '即梦AI', 'image', 'JIMENG'),
        model('seedance', 'Seedance', 'video', 'SEEDANCE', env.VIDEO_API_KEY),
        model('keling', '可灵', 'video', 'KLING', env.VIDEO_API_KEY),
        model('gemini', 'Gemini', 'text', 'GEMINI', env.AGENT_API_KEY),
        model('chatgpt', 'ChatGPT', 'text', 'CHATGPT', env.AGENT_API_KEY),
        model('deepseek', 'DeepSeek', 'text', 'DEEPSEEK', env.AGENT_API_KEY),
        { ...model('audio-speech', '语音合成', 'audio', 'AUDIO'), protocol: env.AUDIO_API_STYLE || 'speech', createPath: env.AUDIO_CREATE_PATH || '/v1/audio/speech' }
    ];
    for (const item of models) {
        const url = new URL(item.base);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API_BASE 必须为不含凭据和查询参数的 HTTP(S) 地址');
        if (item.type === 'video' && !['openai', 'json-task'].includes(item.protocol)) throw new Error('VIDEO_API_STYLE 仅支持 openai 或 json-task');
        if (item.type === 'video' && (item.ratios.some((r) => !['21:9','16:9','4:3','1:1','3:4','9:16','9:21'].includes(r)) || item.durations.some((n) => !Number.isInteger(n) || n < 1 || n > 60) || item.inputModes.some((m) => !['first-frame','first-last-frame','reference'].includes(m)) || item.resolutions.some((r) => !['480p','720p','1080p'].includes(r)))) throw new Error('视频能力配置包含不支持的值');
        if (item.type === 'video' && item.protocol === 'openai' && (item.ratios.some((r) => !['16:9','9:16'].includes(r)) || item.durations.some((n) => ![4,8,12].includes(n)) || item.inputModes.some((m) => m !== 'first-frame') || item.resolutions.some((r) => r !== '720p'))) throw new Error('OpenAI 视频适配器仅支持 16:9/9:16、4/8/12 秒、首帧和 720p');
        if (item.type === 'image' && !['openai', 'aspect-ratio'].includes(item.protocol)) throw new Error('图片 API_STYLE 仅支持 openai 或 aspect-ratio');
        if (item.type === 'audio' && !['speech', 'json-audio'].includes(item.protocol)) throw new Error('AUDIO_API_STYLE 仅支持 speech 或 json-audio');
    }
    return { models, timeout: Math.max(100, Number(env.UPSTREAM_TIMEOUT_MS) || 180000) };
}
function publicConfig(config) {
    return { models: config.models.map(({ id, label, type, key, model, protocol, ratios, durations, maxReferences, inputModes, resolutions }) => ({ id, label, type, available: !!(key && model), reason: !key ? '服务端未配置 API Key' : !model ? '服务端未配置供应商的完整模型 ID' : '', ratios: type === 'image' ? Object.keys(RATIOS) : ratios, durations, maxReferences: type === 'video' ? maxReferences : type === 'image' ? 16 : 0, inputModes, resolutions: type === 'video' ? (resolutions.length ? resolutions : protocol === 'openai' ? ['720p'] : []) : [], audioStyle: type === 'audio' ? protocol : undefined })) };
}
function resolveModel(config, id, type) {
    const item = config.models.find((model) => model.id === id && model.type === type);
    if (!item) throw fail(400, '模型与节点类型不匹配');
    if (!item.key || !item.model) throw fail(503, `${item.label} 尚未配置，请在服务端 .env 设置密钥和模型 ID`);
    return item;
}
function endpoint(base, route) {
    if (!route.startsWith('/') || route.startsWith('//') || route.includes('?') || route.includes('#')) throw fail(503, '服务端接口路径配置无效');
    return base.replace(/\/$/, '').replace(/\/v1$/, '') + route;
}
async function request(config, model, route, options, fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);
    try {
        const response = await fetchImpl(endpoint(model.base, route), { ...options, redirect: 'error', signal: controller.signal, headers: { ...options.headers, Authorization: `Bearer ${model.key}` } });
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); } catch { throw fail(502, '上游返回了无法识别的响应，请检查 API 地址与协议'); }
        if (!response.ok) {
            const detail = String(result?.error?.message || result?.error || result?.message || '请求失败').split(model.key).join('[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 240);
            throw fail(response.status >= 400 && response.status <= 599 ? response.status : 502, `上游请求失败：${detail}`);
        }
        return result;
    } catch (error) {
        if (error.status) throw error;
        throw fail(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '上游请求超时；请先检查供应商任务记录，避免重复计费' : '连接上游失败，请检查服务地址和网络');
    } finally { clearTimeout(timer); }
}
function promptOf(body) {
    if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 30000) throw fail(400, '提示词不能为空且不得超过 30000 字符');
    return body.prompt.trim();
}
function references(body) {
    const refs = body.images || [];
    if (!Array.isArray(refs) || refs.length > 16 || refs.some((src) => typeof src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src))) throw fail(400, '参考图须为 PNG、JPEG 或 WebP，最多 16 张');
    return refs;
}
function imageBlob(src) {
    const [head, data] = src.split(',');
    return new Blob([Buffer.from(data, 'base64')], { type: head.slice(5).split(';')[0] });
}
function mediaUrl(value) {
    if (typeof value !== 'string') return null;
    try { return ['https:', 'http:'].includes(new URL(value).protocol) ? value : null; } catch { return null; }
}
async function generateImage(config, body, fetchImpl) {
    const model = resolveModel(config, body?.model, 'image'), prompt = promptOf(body), images = references(body);
    if (!RATIOS[body.ratio]) throw fail(400, '不支持的图片比例');
    const fields = { model: model.model, prompt, n: 1, ...(model.protocol === 'aspect-ratio' ? { aspect_ratio: body.ratio, image_size: '1K' } : { size: RATIOS[body.ratio] }) };
    let options;
    if (images.length) {
        const form = new FormData();
        Object.entries(fields).forEach(([name, value]) => form.append(name, String(value)));
        images.forEach((src, index) => { const blob = imageBlob(src); form.append('image', blob, `reference_${index}.${blob.type.split('/')[1]}`); });
        options = { method: 'POST', body: form };
    } else options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) };
    const result = await request(config, model, images.length ? '/v1/images/edits' : '/v1/images/generations', options, fetchImpl);
    const output = result?.data?.[0];
    const url = mediaUrl(output?.url) || (typeof output?.b64_json === 'string' && /^[a-z0-9+/=]+$/i.test(output.b64_json) ? `data:image/png;base64,${output.b64_json}` : null);
    if (!url) throw fail(502, '上游没有返回有效图片');
    return { url: url.startsWith('data:') ? url : await persistMedia(config, url, 'image', fetchImpl) };
}
async function chat(config, body, fetchImpl) {
    const model = resolveModel(config, body?.model, 'text'), prompt = promptOf(body);
    const context = typeof body.context === 'string' ? body.context.slice(0, 60000) : '';
    const payload = { model: model.model, stream: false, messages: [{ role: 'system', content: '你是设计创作助手。用简体中文直接回答用户，结合画布上下文给出可编辑的创作内容。不要声称执行了搜索、生成图片或修改画布。' }, { role: 'user', content: context ? `画布上下文：\n${context}\n\n用户要求：\n${prompt}` : prompt }] };
    const images = references(body);
    if (images.length) payload.messages[1].content = [{ type:'text', text:payload.messages[1].content }, ...images.slice(0, 4).map((url) => ({ type:'image_url', image_url:{ url } }))];
    const result = await request(config, model, '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, fetchImpl);
    const content = result?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text || '').join('\n') : '';
    if (!text.trim()) throw fail(502, '上游没有返回文本内容');
    return { text };
}
function videoResult(payload) {
    const result = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
    const status = String(result.status || result.state || '').toLowerCase();
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return { status: 'failed', error: '视频任务失败，请到供应商控制台查看详情' };
    const url = mediaUrl(result.video_url || result.output?.video_url || result.output?.url || result.url || result.data?.[0]?.url);
    if (url && (!status || ['completed', 'succeeded', 'success', 'done'].includes(status))) return { status: 'completed', url };
    const completed = ['completed', 'succeeded', 'success', 'done'].includes(status);
    const upstreamId = result.id || result.task_id;
    if (!upstreamId || !/^[\w.-]{1,200}$/.test(String(upstreamId))) throw fail(502, '上游未返回有效视频任务 ID');
    return { upstreamId: String(upstreamId), status: completed ? 'completed' : ['running', 'processing', 'in_progress'].includes(status) ? 'processing' : 'queued', progress: Math.min(100, Math.max(0, Number(result.progress) || 0)) };
}
async function generateVideo(config, body, fetchImpl) {
    const model = resolveModel(config, body?.model, 'video'), prompt = promptOf(body), images = references(body);
    if (!model.ratios.includes(body.ratio)) throw fail(400, `当前视频模型支持 ${model.ratios.join('、')}`);
    const duration = Number(body.duration || 4);
    if (!model.durations.includes(duration)) throw fail(400, `视频时长支持 ${model.durations.join('、')} 秒`);
    const mode = body.mode || 'first-frame';
    if (!model.inputModes.includes(mode)) throw fail(400, '该视频模型未配置此输入方式');
    const max = mode === 'first-frame' ? 1 : mode === 'first-last-frame' ? Math.min(2, model.maxReferences) : model.maxReferences;
    if (images.length > max) throw fail(400, `当前视频输入最多支持 ${max} 张参考图`);
    if (body.resolution && !(model.resolutions.length ? model.resolutions : model.protocol === 'openai' ? ['720p'] : []).includes(body.resolution)) throw fail(400, '当前视频模型不支持该清晰度');
    let options, route;
    if (model.protocol === 'openai') {
        route = model.createPath || '/v1/videos';
        const form = new FormData();
        Object.entries({ model: model.model, prompt, seconds: String(duration), size: body.ratio === '16:9' ? '1280x720' : '720x1280' }).forEach(([key, value]) => form.append(key, value));
        if (images[0]) form.append('input_reference', imageBlob(images[0]), 'first-frame.png');
        options = { method: 'POST', body: form };
    } else {
        route = model.createPath || '/v1/video/generations';
        options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.model, prompt, aspect_ratio: body.ratio, duration, images, input_mode: mode, ...(body.resolution ? { resolution:body.resolution } : {}) }) };
    }
    const result = videoResult(await request(config, model, route, options, fetchImpl));
    if (result.status === 'failed') throw fail(502, result.error);
    if (result.url) result.url = await persistMedia(config, result.url, 'video', fetchImpl);
    return { ...result, modelId: model.id };
}
async function queryVideo(config, job, fetchImpl) {
    const model = resolveModel(config, job.modelId, 'video');
    const route = (model.queryPath || (model.protocol === 'openai' ? '/v1/videos/{id}' : '/v1/video/generations/{id}')).replace('{id}', encodeURIComponent(job.upstreamId));
    const payload = await request(config, model, route, { method: 'GET' }, fetchImpl);
    // Some providers omit the id in a status response; it is already bound to this server job.
    const result = videoResult(payload?.data && !Array.isArray(payload.data) ? { ...payload, data: { id: job.upstreamId, ...payload.data } } : { id: job.upstreamId, ...payload });
    if (result.url) result.url = await persistMedia(config, result.url, 'video', fetchImpl);
    else if (result.status === 'completed') {
        if (model.protocol !== 'openai') throw fail(502, '视频任务完成，但供应商未返回视频地址');
        result.url = await mediaBytes(config, endpoint(model.base, `/v1/videos/${encodeURIComponent(job.upstreamId)}/content`), 'video', fetchImpl, model.key);
    }
    delete result.upstreamId;
    return result;
}
function publicAddress(address) {
    if (net.isIPv4(address)) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 198 || (a === 192 && b === 0));
    }
    return /^2[0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
async function persistMedia(config, source, kind, fetchImpl) {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) throw fail(502, '生成结果必须为公开 HTTPS 素材地址');
    const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw fail(502, '生成结果地址无法读取或不是公开地址');
    return mediaBytes(config, url.href, kind, fetchImpl);
}
async function mediaBytes(config, url, kind, fetchImpl, key) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeout);
    try {
        const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: key ? { Authorization: `Bearer ${key}` } : {} });
        const mime = response.headers.get('content-type')?.split(';')[0];
        const valid = kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : kind === 'audio' ? ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] : ['video/mp4', 'video/webm'];
        if (!response.ok || !valid.includes(mime)) throw fail(502, '生成结果无法下载为有效素材，请到供应商控制台取回结果');
        const chunks = [], maxBytes = kind === 'video' ? 100 * 1024 * 1024 : 24 * 1024 * 1024;
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) { controller.abort(); throw fail(502, '生成素材过大，请到供应商控制台取回结果'); }
            chunks.push(chunk);
        }
        return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
    } catch (error) {
        if (error.status) throw error;
        throw fail(502, '生成任务已返回，但素材下载失败；请先到供应商控制台取回结果，避免重复生成');
    } finally { clearTimeout(timer); }
}
async function generateAudio(config, body, fetchImpl) {
    const model = resolveModel(config, body?.model, 'audio'), prompt = promptOf(body);
    if (prompt.length > 4096) throw fail(400, '音频输入最多 4096 字符');
    const voice = String(body.voice || 'alloy');
    if (!['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].includes(voice)) throw fail(400, '不支持的音色');
    const speed = Number(body.speed || 1);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw fail(400, '语速必须在 0.25 到 4 之间');
    if (model.protocol === 'json-audio') {
        const result = await request(config, model, model.createPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.model, prompt, voice, speed }) }, fetchImpl);
        const output = result.data?.[0] || result;
        if (typeof output.b64_json === 'string' && /^[a-z0-9+/=]+$/i.test(output.b64_json) && output.b64_json.length < 45 * 1024 * 1024) return { url: `data:audio/mpeg;base64,${output.b64_json}` };
        const url = mediaUrl(output.audio_url || output.url);
        if (!url) throw fail(502, '音频接口未返回 audio_url、url 或 b64_json');
        return { url: await persistMedia(config, url, 'audio', fetchImpl) };
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeout);
    try {
        const response = await fetchImpl(endpoint(model.base, model.createPath), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${model.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.model, input: prompt, voice, speed, response_format: 'mp3' }) });
        if (!response.ok) throw fail(502, `语音接口请求失败（${response.status}），请检查模型、音色和账户权限`);
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'application/octet-stream'].includes(mime)) throw fail(502, '语音接口未返回音频文件');
        let length = 0; const chunks = [];
        for await (const chunk of response.body) { length += chunk.length; if (length > 32 * 1024 * 1024) throw fail(502, '音频结果超过 32MB'); chunks.push(chunk); }
        if (!length) throw fail(502, '语音接口返回空文件');
        return { url: `data:${mime === 'application/octet-stream' ? 'audio/mpeg' : mime};base64,${Buffer.concat(chunks).toString('base64')}` };
    } catch (error) { if (error.status) throw error; throw fail(controller.signal.aborted ? 504 : 502, '语音生成未完成，请检查供应商记录后再试'); }
    finally { clearTimeout(timer); }
}
module.exports = { createConfig, publicConfig, generateImage, generateVideo, queryVideo, generateAudio, chat, RATIOS, videoResult, publicAddress };
