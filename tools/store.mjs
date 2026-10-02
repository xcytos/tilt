// Named projects, stored in SQLite behind a driver seam.
//
// Everything the app knows about a project row lives here: how a document is
// sanitised (through js/project.js, the same helpers the browser uses), how a
// name is normalised, and how rows come back as API-shaped objects. Nothing
// here knows about HTTP, and nothing here imports node:sqlite - swap the
// driver in sqlite-driver.mjs and this file is unchanged.

import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseProject, projectToJSON } from '../js/project.js';
import { openSqlite } from './sqlite-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SCHEMA_VERSION = 1;
export const MAX_NAME = 80;
export const MAX_THUMB = 512 * 1024;
export const DEFAULT_NAME = 'Untitled project';

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    thumb      TEXT,
    doc        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_updated ON projects(updated_at DESC);
`;

const COLUMNS = 'id, name, created_at, updated_at, thumb IS NOT NULL AS has_thumb';
const FULL_COLUMNS = 'id, name, created_at, updated_at, thumb, doc';

const LIST_SQL = {
    recent: `SELECT ${COLUMNS} FROM projects ORDER BY updated_at DESC`,
    oldest: `SELECT ${COLUMNS} FROM projects ORDER BY created_at ASC`,
    name: `SELECT ${COLUMNS} FROM projects ORDER BY name COLLATE NOCASE ASC, created_at DESC`
};

// Carried on the error so callers can map codes to status codes without
// string-matching messages.
export class StoreError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'StoreError';
        this.code = code;
    }
}

export function defaultDbPath() {
    return process.env.DB_PATH || path.join(ROOT, 'data', 'o2tilt.db');
}

export function normalizeName(name, fallback = DEFAULT_NAME) {
    if (typeof name !== 'string') return fallback;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return clean || fallback;
}

function migrate(driver) {
    const row = driver.get('PRAGMA user_version');
    const current = row ? Number(row.user_version) || 0 : 0;
    if (current >= SCHEMA_VERSION) return;
    driver.exec(DDL);
    driver.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// Time as base36 plus five random bytes: short enough for a URL, unlikely
// enough to collide across sessions without a sequence column.
const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString('hex');

const notFound = id => new StoreError('not_found', `no project with id ${id}`);

const toSummary = row => ({
    id: row.id,
    name: row.name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    hasThumb: row.has_thumb ? true : false
});

export function createStore(driver) {
    migrate(driver);

    const rowOf = id => driver.get(`SELECT ${FULL_COLUMNS} FROM projects WHERE id = ?`, [id]);

    const store = {
        driver,

        create({ name, doc = {} } = {}) {
            const clean = normalizeName(name);
            const parsed = parseProject(doc);
            if (!parsed) {
                throw new StoreError('invalid', 'project document is not a valid project');
            }
            parsed.name = clean;
            const id = newId();
            const now = Date.now();
            driver.run(
                'INSERT INTO projects (id, name, created_at, updated_at, thumb, doc) '
                + 'VALUES (?, ?, ?, ?, ?, ?)',
                [id, clean, now, now, null, projectToJSON(parsed)]);
            return { id, name: clean, createdAt: now, updatedAt: now, hasThumb: false };
        },

        list({ order = 'recent' } = {}) {
            return driver.all(LIST_SQL[order] || LIST_SQL.recent).map(toSummary);
        },

        get(id) {
            const row = rowOf(id);
            if (!row) throw notFound(id);
            return {
                id: row.id,
                name: row.name,
                createdAt: Number(row.created_at),
                updatedAt: Number(row.updated_at),
                thumb: row.thumb || null,
                doc: parseProject(row.doc) || parseProject({})
            };
        },

        // One read plus one write, so the document and the name column can
        // never drift: whatever comes back has doc.name === name.
        update(id, patch = {}) {
            const row = rowOf(id);
            if (!row) throw notFound(id);

            const hasName = patch.name !== undefined && patch.name !== null;
            const hasDoc = patch.doc !== undefined && patch.doc !== null;
            if (!hasName && !hasDoc) return store.get(id);

            let doc = parseProject(row.doc) || parseProject({});
            if (hasDoc) {
                const parsed = parseProject(patch.doc);
                if (!parsed) {
                    throw new StoreError('invalid', 'project document is not a valid project');
                }
                doc = parsed;
            }
            const name = hasName ? normalizeName(patch.name) : row.name;
            doc.name = name;
            const now = Date.now();

            driver.run('UPDATE projects SET name = ?, updated_at = ?, doc = ? WHERE id = ?',
                [name, now, projectToJSON(doc), id]);
            return store.get(id);
        },

        remove(id) {
            const res = driver.run('DELETE FROM projects WHERE id = ?', [id]);
            if (!Number(res.changes)) throw notFound(id);
            return true;
        },

        duplicate(id, name) {
            const src = store.get(id);
            const target = normalizeName(name !== undefined ? name : `Copy of ${src.name}`);
            const doc = parseProject(src.doc) || parseProject({});
            doc.name = target;
            const newProjectId = newId();
            const now = Date.now();
            driver.run(
                'INSERT INTO projects (id, name, created_at, updated_at, thumb, doc) '
                + 'VALUES (?, ?, ?, ?, ?, ?)',
                [newProjectId, target, now, now, src.thumb, projectToJSON(doc)]);
            return {
                id: newProjectId,
                name: target,
                createdAt: now,
                updatedAt: now,
                hasThumb: !!src.thumb
            };
        },

        setThumb(id, thumb) {
            if (typeof thumb !== 'string' || !thumb) {
                throw new StoreError('invalid', 'thumbnail must be a base64 image');
            }
            if (!/^data:image\/(jpeg|png|webp);base64,/.test(thumb)) {
                throw new StoreError('invalid', 'thumbnail must be a base64 image');
            }
            if (thumb.length > MAX_THUMB) {
                throw new StoreError('invalid', 'thumbnail is too large');
            }
            const res = driver.run('UPDATE projects SET thumb = ? WHERE id = ?', [thumb, id]);
            if (!Number(res.changes)) throw notFound(id);
            return true;
        },

        getThumb(id) {
            const row = driver.get('SELECT thumb FROM projects WHERE id = ?', [id]);
            if (!row) throw notFound(id);
            if (!row.thumb) throw new StoreError('not_found', 'project has no thumbnail');
            return row.thumb;
        },

        clearThumb(id) {
            const res = driver.run('UPDATE projects SET thumb = NULL WHERE id = ?', [id]);
            if (!Number(res.changes)) throw notFound(id);
            return true;
        },

        count() {
            return Number(driver.get('SELECT COUNT(*) AS n FROM projects').n);
        },

        close() { driver.close(); }
    };

    return store;
}

// DB_PATH lets the tests point at a throwaway file instead of the real one.
export function openStore(file = defaultDbPath()) {
    return createStore(openSqlite(file));
}
