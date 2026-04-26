const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const STATIC_ROOT = path.join(__dirname, "无限画布");
const UPSTREAM_HOST = "ai.t8star.cn";

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp"
};

const MODEL_KEY_ENV = {
    "gpt-image-2": "GPT_IMAGE_2_API_KEY",
    "gemini-3.1-flash-image-preview-4k": "NANOBANANA_API_KEY"
};

function getCorsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, x-model-id",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };
}

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...getCorsHeaders()
    });
    res.end(body);
}

function sanitizePath(urlPath) {
    const safePath = decodeURIComponent(urlPath.split("?")[0] || "/");
    const normalized = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, "");
    return normalized === "/" ? "/index.html" : normalized;
}

function serveStatic(req, res) {
    const normalizedPath = sanitizePath(req.url || "/");
    const filePath = path.join(STATIC_ROOT, normalizedPath.replace(/^\/+/, ""));
    if (!filePath.startsWith(STATIC_ROOT)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not Found");
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-store"
        });
        res.end(data);
    });
}

function getApiKeyByModel(modelId) {
    const envName = MODEL_KEY_ENV[modelId] || "NANOBANANA_API_KEY";
    return process.env[envName] || "";
}

function proxyImageApi(req, res) {
    if (req.method === "OPTIONS") {
        res.writeHead(204, getCorsHeaders());
        res.end();
        return;
    }
    if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
    }

    const requestPath = sanitizePath(req.url || "");
    const upstreamPath = requestPath === "/api/images/edits"
        ? "/v1/images/edits"
        : requestPath === "/api/images/generations"
            ? "/v1/images/generations"
            : null;
    if (!upstreamPath) {
        sendJson(res, 404, { error: "Invalid API route" });
        return;
    }

    const modelId = String(req.headers["x-model-id"] || "").trim();
    if (!modelId) {
        sendJson(res, 400, { error: "Missing x-model-id header" });
        return;
    }
    const apiKey = getApiKeyByModel(modelId);
    if (!apiKey) {
        sendJson(res, 500, {
            error: `Missing server environment key for model: ${modelId}`
        });
        return;
    }

    const upstreamHeaders = {
        Authorization: `Bearer ${apiKey}`
    };
    if (req.headers["content-type"]) upstreamHeaders["Content-Type"] = req.headers["content-type"];
    if (req.headers["content-length"]) upstreamHeaders["Content-Length"] = req.headers["content-length"];

    const upstreamReq = https.request(
        {
            protocol: "https:",
            hostname: UPSTREAM_HOST,
            path: upstreamPath,
            method: "POST",
            headers: upstreamHeaders
        },
        (upstreamRes) => {
            const responseHeaders = {
                "Content-Type": upstreamRes.headers["content-type"] || "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                ...getCorsHeaders()
            };
            if (upstreamRes.headers["content-length"]) {
                responseHeaders["Content-Length"] = upstreamRes.headers["content-length"];
            }
            res.writeHead(upstreamRes.statusCode || 500, responseHeaders);
            upstreamRes.pipe(res);
        }
    );

    upstreamReq.on("error", (error) => {
        sendJson(res, 502, { error: `Proxy upstream request failed: ${error.message}` });
    });

    req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
    const requestPath = sanitizePath(req.url || "");
    if (requestPath.startsWith("/api/images/")) {
        proxyImageApi(req, res);
        return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
    }
    serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
    console.log(`[proxy] running at http://${HOST}:${PORT}`);
    console.log("[proxy] static root:", STATIC_ROOT);
    console.log("[proxy] set env keys: NANOBANANA_API_KEY / GPT_IMAGE_2_API_KEY");
});
