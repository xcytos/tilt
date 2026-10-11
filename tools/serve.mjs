import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, defaultDbPath } from './store.mjs';
import { createApi } from './api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const PROJECT_FILE = path.join(ROOT, 'project.json');
// The same string the panel footer shows - read from js/version.js so the
// log and the UI can never name two different builds.
const VERSION = (() => {
    try {
        const src = fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8');
        return /VERSION\s*=\s*'([^']+)'/.exec(src)[1] || 'dev';
    } catch { return 'dev'; }
})();
const MAX_BODY = 128 * 1024;

// Anything that feeds the bundle, the homepage or either shell triggers a
// browser reload. project.json and data/ are deliberately absent: saving a
// project must not reload the page.
const WATCHED = ['js', 'js/objects', 'models', 'home', 'TILT.html', 'index.html',
    'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png'];

// The database is state, not an asset. Neither it nor the repo's own
// metadata may be downloaded through this server.
const PRIVATE_DIR = /(^|\/)(data|\.git)(\/|$)/;
const PRIVATE_EXT = /\.(db|db-wal|db-shm|sqlite|sqlite3|log|pid)$/i;
const isPrivate = p => PRIVATE_DIR.test(p) || PRIVATE_EXT.test(p);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
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

// Watched only once the socket is listening: on a FUSE mount (this lives on
// /storage/emulated) the inotify handshakes take long enough to push a spawn
// past a test's boot deadline, and none of them are needed to accept a request.
function startWatching() {
    for (const rel of WATCHED) {
        try {
            const w = fs.watch(path.join(ROOT, rel), () => scheduleReload());
            if (typeof w.unref === 'function') w.unref();
            watchers.push(w);
        } catch (err) {
            console.warn(`cannot watch ${rel}: ${err.message}`);
        }
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
// One store for the process; the API is a thin closure over it.
const store = openStore();
const api = createApi(store);

const server = http.createServer((req, res) => {
    let url;
    let pathname;
    try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        pathname = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }

    if (pathname.startsWith('/api/')) {
        Promise.resolve(api(req, res, pathname, url)).catch(err => {
            console.error('[api]', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
                   .end('{"error":"internal error"}');
            }
        });
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

    if (isPrivate(pathname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403');
        return;
    }

    // Path traversal: resolve, then insist the result stays under ROOT.
    const target = path.resolve(ROOT, '.' + pathname);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    let file = target;
    let stat;
    try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        stat = fs.statSync(file);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
           .end(`404 Not Found: ${pathname}`);
        return;
    }

    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const cache = {
        // The bundle and the source modules must never go stale in the cache.
        // no-store is what actually guarantees it: no-validator no-cache was
        // leaving the browser free to replay an old copy of js/*.js, which
        // made the shell and its scripts disagree about what had loaded.
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ETag: etag,
        'Last-Modified': stat.mtime.toUTCString(),
        'Access-Control-Allow-Origin': '*'
    };
    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, cache).end();
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
        ...cache
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

// Closing on SIGTERM keeps the WAL checkpointed, so `serve.sh stop` never
// leaves a half-written database behind.
function shutdown() {
    try { store.close(); } catch { /* already closed */ }
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
    console.log(`TILT v${VERSION} serving ${ROOT}`);
    console.log(`  http://localhost:${PORT}/`);
    console.log(`  http://localhost:${PORT}/TILT.html`);
    console.log(`  http://localhost:${PORT}/TILT.standalone.html`);
    console.log(`  live reload on: ${WATCHED.join(', ')}`);
    console.log(`  project file: ${path.relative(ROOT, PROJECT_FILE)}`);
    console.log(`  database: ${path.relative(ROOT, defaultDbPath())}`);
    console.log(`listening on ${HOST}:${server.address().port}`);
    startWatching();
});
