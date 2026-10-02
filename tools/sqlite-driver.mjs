// The only file a Postgres swap would replace. Everything above this line
// speaks the five-method dialect below, so the driver stays as dumb as the
// database allows and never grows application logic.
//
//   all(sql, params)  -> rows
//   get(sql, params)  -> one row or undefined
//   run(sql, params)  -> { changes, lastInsertRowid }
//   exec(sql)         -> DDL / multi-statement, no results
//   close()           -> flush and release the file
//
// Parameters are positional and always passed as an array. node:sqlite's named
// parameter prefix rules are a footgun and nothing here needs them.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DRIVER_DIALECT = ['all', 'get', 'run', 'exec', 'close'];

export function sqliteDriver(db) {
    return {
        all: (sql, params = []) => db.prepare(sql).all(...params),
        get: (sql, params = []) => db.prepare(sql).get(...params),
        run: (sql, params = []) => db.prepare(sql).run(...params),
        exec: sql => db.exec(sql),
        close: () => db.close()
    };
}

// Creates the parent folder on first run, so a clean checkout can boot without
// a setup step. WAL lets the homepage read while the editor writes.
export function openSqlite(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    return sqliteDriver(db);
}

// Test helper: a driver that never touches disk. Proves createStore only ever
// talks through the dialect above.
export function memoryDriver() {
    const tables = new Map();
    return {
        tables,
        all: () => [],
        get: () => undefined,
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        exec: sql => { tables.set(sql, true); },
        close: () => {}
    };
}
