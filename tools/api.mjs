// The HTTP surface of the project system. Nothing here touches the database
// directly - it speaks to a store from tools/store.mjs and translates results
// into status codes. Route matching is deliberately literal-first: `import`
// has to be matched before `:id`, or a project called "import" could never
// be imported over.

import { projectToJSON } from '../js/project.js';

export const API_MAX_BODY = 512 * 1024;

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function raw(res, status, body, type, extra = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    res.writeHead(status, Object.assign({}, HEADERS, {
        'Content-Type': type,
        'Content-Length': payload.length
    }, extra));
    res.end(payload);
}

function json(res, status, value, extra = {}) {
    raw(res, status, JSON.stringify(value), 'application/json; charset=utf-8', extra);
}

function empty(res, status, extra = {}) {
    res.writeHead(status, Object.assign({}, HEADERS, extra));
    res.end();
}

function methodNotAllowed(res, methods) {
    json(res, 405, { error: 'method not allowed' }, { Allow: methods.join(', ') });
}

function statusFor(err) {
    switch (err && err.code) {
        case 'not_found': return 404;
        case 'invalid': return 400;
        case 'too_large': return 413;
        case 'bad_request': return 400;
        default: return 500;
    }
}

function messageFor(err) {
    if (statusFor(err) === 500) return 'internal error';
    return (err && err.message) || 'request failed';
}

function readBody(req, limit = API_MAX_BODY) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > limit) {
                const err = new Error('request body is too large');
                err.code = 'too_large';
                // No destroy here: the caller still has to write the 413
                // and flushing that beats keeping the socket open.
                reject(err);
                return;
            }
            chunks.push(chunk);
        });
        req.on('error', () => {
            const err = new Error('request failed');
            err.code = 'bad_request';
            reject(err);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function parseJson(buf) {
    if (!buf || !buf.length) return {};
    try {
        const value = JSON.parse(buf.toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

// Export files are named after the project, so they sort sensibly in a
// downloads folder.
function slug(name) {
    const clean = String(name || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return clean || 'project';
}

// An exported file is a bare document, but accepting {name, doc} as well
// means a backup written by something else still opens.
function unwrap(body) {
    if (body && body.doc && typeof body.doc === 'object' && !Array.isArray(body.doc)) {
        return { name: body.name, doc: body.doc };
    }
    return { name: body.name, doc: body };
}

// Everything except the thumbnail: the list and the editor both want the
// document, and the thumbnail has its own endpoint so it never rides along
// on a save.
function payload(p) {
    return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        hasThumb: !!p.thumb,
        doc: p.doc
    };
}

export function createApi(store) {
    return async function handleApi(req, res, pathname, url) {
        try {
            const method = (req.method || 'GET').toUpperCase();
            if (method === 'OPTIONS') {
                return empty(res, 204, { Allow: 'GET, POST, PATCH, PUT, DELETE, OPTIONS' });
            }

            const seg = pathname.split('/').filter(Boolean);
            if (seg[0] !== 'api' || seg[1] !== 'projects') {
                return json(res, 404, { error: 'no such endpoint' });
            }

            const tail = seg.slice(2);

            // ---- /api/projects
            if (tail.length === 0) {
                if (method === 'GET') {
                    const order = (url && url.searchParams.get('order')) || 'recent';
                    return json(res, 200, { projects: store.list({ order }) });
                }
                if (method === 'POST') {
                    const body = parseJson(await readBody(req));
                    if (body === null) return json(res, 400, { error: 'body must be JSON' });
                    const created = store.create({
                        name: body.name,
                        doc: body.doc !== undefined ? body.doc : {}
                    });
                    return json(res, 201, created);
                }
                return methodNotAllowed(res, ['GET', 'POST']);
            }

            // ---- /api/projects/import (before :id on purpose)
            if (tail.length === 1 && tail[0] === 'import') {
                if (method !== 'POST') return methodNotAllowed(res, ['POST']);
                const body = parseJson(await readBody(req));
                if (body === null) return json(res, 400, { error: 'body must be JSON' });
                const { name, doc } = unwrap(body);
                const created = store.create({ name: name || 'Imported project', doc });
                return json(res, 201, created);
            }

            // ---- /api/projects/:id
            if (tail.length === 1) {
                const id = decodeURIComponent(tail[0]);

                if (method === 'GET') return json(res, 200, payload(store.get(id)));

                if (method === 'PATCH') {
                    const body = parseJson(await readBody(req));
                    if (body === null) return json(res, 400, { error: 'body must be JSON' });
                    const patch = {};
                    if (body.name !== undefined && body.name !== null) patch.name = body.name;
                    if (body.doc !== undefined && body.doc !== null) patch.doc = body.doc;
                    if (!Object.keys(patch).length) {
                        return json(res, 400, { error: 'nothing to update' });
                    }
                    return json(res, 200, payload(store.update(id, patch)));
                }

                if (method === 'DELETE') {
                    store.remove(id);
                    return empty(res, 204);
                }
                return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
            }

            // ---- /api/projects/:id/<sub>
            if (tail.length === 2) {
                const id = decodeURIComponent(tail[0]);
                const what = tail[1];

                if (what === 'duplicate') {
                    if (method !== 'POST') return methodNotAllowed(res, ['POST']);
                    const body = parseJson(await readBody(req));
                    if (body === null) return json(res, 400, { error: 'body must be JSON' });
                    return json(res, 201, store.duplicate(id, body.name));
                }

                if (what === 'export') {
                    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
                    const project = store.get(id);
                    return raw(res, 200, projectToJSON(project.doc),
                        'application/json; charset=utf-8',
                        { 'Content-Disposition': `attachment; filename="${slug(project.name)}.tilt.json"` });
                }

                if (what === 'thumb') {
                    if (method === 'GET') {
                        const thumb = store.getThumb(id);
                        const comma = thumb.indexOf(',');
                        // "image/jpeg;base64" -> send back just the media type.
                        const mime = thumb.slice(5, comma).split(';')[0];
                        const bytes = Buffer.from(thumb.slice(comma + 1), 'base64');
                        return raw(res, 200, bytes, mime, { 'Cache-Control': 'public, max-age=300' });
                    }
                    if (method === 'PUT') {
                        const body = parseJson(await readBody(req));
                        if (body === null) return json(res, 400, { error: 'body must be JSON' });
                        store.setThumb(id, body.thumb);
                        return empty(res, 204);
                    }
                    if (method === 'DELETE') {
                        store.clearThumb(id);
                        return empty(res, 204);
                    }
                    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
                }

                return json(res, 404, { error: 'no such endpoint' });
            }

            return json(res, 404, { error: 'no such endpoint' });
        } catch (err) {
            const status = statusFor(err);
            if (status === 500) console.error('[api]', err);
            json(res, status, { error: messageFor(err) });
            if (err && err.code === 'too_large') req.destroy();
            return undefined;
        }
    };
}
