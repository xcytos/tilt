import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const PROJECT_FILE = path.join(ROOT, 'project.json');
const MAX_BODY = 128 * 1024;

// Anything that feeds the bundle or the shell triggers a browser reload.
// project.json is deliberately absent: saving it must not reload the page.
const WATCHED = ['js', 'js/objects', 'models', 'TILT.html'];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm'
};

// ---------------------------------------------------------------- live reload
const watchers = [];
const clients = new Set();
let reloadTimer = 0;

function broadcast() {
    for (const res of clients) {
        try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
    }
}

function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(broadcast, 150);
}

for (const rel of WATCHED) {
    try {
        const w = fs.watch(path.join(ROOT, rel), () => scheduleReload());
        if (typeof w.unref === 'function') w.unref();
        watchers.push(w);
    } catch (err) {
        console.warn(`cannot watch ${rel}: ${err.message}`);
    }
}

const heartbeat = setInterval(() => {
    for (const res of clients) {
        try { res.write(': ping\n\n'); } catch { clients.delete(res); }
    }
}, 25000);
if (typeof heartbeat.unref === 'function') heartbeat.unref();

function handleSSE(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write('retry: 2000\n\n');
    res.write('data: hello\n\n');
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
}

// --------------------------------------------------------------- project file
function handleProjectPost(req, res) {
    const chunks = [];
    let size = 0;
    let refused = false;

    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) {
            refused = true;
            res.writeHead(413, { 'Content-Type': 'application/json' })
               .end(JSON.stringify({ error: 'project too large' }));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('error', () => {});
    req.on('end', () => {
        if (refused) return;
        try {
            fs.writeFileSync(PROJECT_FILE, Buffer.concat(chunks));
            res.writeHead(200, { 'Content-Type': 'application/json' })
               .end(JSON.stringify({ ok: true, bytes: size }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
               .end(JSON.stringify({ error: err.message }));
        }
    });
}

function handleProjectDelete(res) {
    try { fs.unlinkSync(PROJECT_FILE); } catch { /* already gone */ }
    res.writeHead(204).end();
}

// -------------------------------------------------------------------- server
const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }

    if (pathname === '/__events') { handleSSE(req, res); return; }
    if (pathname === '/project.json') {
        if (req.method === 'POST') { handleProjectPost(req, res); return; }
        if (req.method === 'DELETE') { handleProjectDelete(res); return; }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405');
        return;
    }

    // Path traversal: resolve, then insist the result stays under ROOT.
    const target = path.resolve(ROOT, '.' + pathname);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    let file = target;
    try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
           .end(`404 Not Found: ${pathname}`);
        return;
    }

    let body;
    try {
        body = fs.readFileSync(file);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
           .end(`404 Not Found: ${pathname}`);
        return;
    }

    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        // The bundle and the source modules must never go stale in the cache.
        'Cache-Control': 'no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
});

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`port ${PORT} is already in use - stop it first: ./serve.sh stop`);
    } else {
        console.error(err.message);
    }
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log(`O2-TILT viewer serving ${ROOT}`);
    console.log(`  http://localhost:${PORT}/TILT.html`);
    console.log(`  http://localhost:${PORT}/TILT.standalone.html`);
    console.log(`  live reload on: ${WATCHED.join(', ')}`);
    console.log(`  project file: ${path.relative(ROOT, PROJECT_FILE)}`);
    console.log(`listening on ${HOST}:${server.address().port}`);
});
