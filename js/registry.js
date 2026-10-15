const MANIFEST_FILE = 'manifest.json';

// Used when the manifest cannot be fetched (no server, bad path), so the
// viewer still boots with something on screen instead of an empty stage.
const BUILTIN = {
    id: 'o2tilt',
    name: 'S Curve',
    objects: [{
        type: 'o2tilt-frame',
        params: { gap: 3, pan: 0, pitch: 0, decline: 0, fabric: true },
        elements: []
    }]
};

const THEMES = ['light', 'dark'];

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Pure: no fetch, no three. Returns a list of human-readable problems.
// `types` is a Map of type -> { factory, params }.
export function validateDef(def, types) {
    const errs = [];
    if (!isPlainObject(def)) return ['definition must be a JSON object'];

    if (typeof def.id !== 'string' || !def.id) errs.push('missing "id"');
    if (typeof def.name !== 'string' || !def.name) errs.push('missing "name"');

    if (def.environment !== undefined) {
        if (!isPlainObject(def.environment)) errs.push('"environment" must be an object');
        else if (def.environment.theme !== undefined && !THEMES.includes(def.environment.theme)) {
            errs.push(`environment.theme must be one of ${THEMES.join(', ')}`);
        }
    }

    if (!Array.isArray(def.objects) || def.objects.length === 0) {
        errs.push('"objects" must be a non-empty array');
        return errs;
    }

    def.objects.forEach((o, i) => {
        const at = `objects[${i}]`;
        if (!isPlainObject(o)) { errs.push(`${at} must be an object`); return; }
        if (typeof o.type !== 'string' || !o.type) { errs.push(`${at}.type must be a string`); return; }

        const reg = types ? types.get(o.type) : null;
        if (types && !reg) { errs.push(`${at}.type "${o.type}" is not registered`); return; }
        if (!reg) return;

        const params = o.params === undefined ? {} : o.params;
        if (!isPlainObject(params)) { errs.push(`${at}.params must be an object`); return; }

        const schema = reg.params || {};
        for (const [k, v] of Object.entries(params)) {
            const p = schema[k];
            if (!p) { errs.push(`${at}.params: unknown "${k}"`); continue; }
            if (p.type === 'range') {
                if (typeof v !== 'number' || !Number.isFinite(v)) {
                    errs.push(`${at}.params.${k} must be a number`);
                } else if (v < p.min || v > p.max) {
                    errs.push(`${at}.params.${k}=${v} outside [${p.min}, ${p.max}]`);
                }
            } else if (p.type === 'toggle') {
                if (typeof v !== 'boolean') errs.push(`${at}.params.${k} must be true or false`);
            }
        }

        if (o.elements !== undefined && !Array.isArray(o.elements)) {
            errs.push(`${at}.elements must be an array`);
        } else if (Array.isArray(o.elements)) {
            // Elements attach to this object's anchors (lights, and anything
            // after them): same schema rules as the object itself.
            o.elements.forEach((el, j) => {
                const where = `${at}.elements[${j}]`;
                if (!isPlainObject(el)) { errs.push(`${where} must be an object`); return; }
                if (typeof el.type !== 'string' || !el.type) {
                    errs.push(`${where}.type must be a string`); return;
                }
                const ereg = types ? types.get(el.type) : null;
                if (types && !ereg) {
                    errs.push(`${where}.type "${el.type}" is not registered`); return;
                }
                if (!ereg) return;
                const eparams = el.params === undefined ? {} : el.params;
                if (!isPlainObject(eparams)) {
                    errs.push(`${where}.params must be an object`); return;
                }
                const eschema = ereg.params || {};
                for (const [k, v] of Object.entries(eparams)) {
                    const p = eschema[k];
                    if (!p) { errs.push(`${where}.params: unknown "${k}"`); continue; }
                    if (p.type === 'range') {
                        if (typeof v !== 'number' || !Number.isFinite(v)) {
                            errs.push(`${where}.params.${k} must be a number`);
                        } else if (v < p.min || v > p.max) {
                            errs.push(`${where}.params.${k}=${v} outside [${p.min}, ${p.max}]`);
                        }
                    } else if (p.type === 'toggle') {
                        if (typeof v !== 'boolean') {
                            errs.push(`${where}.params.${k} must be true or false`);
                        }
                    }
                }
                if (el.anchor !== undefined && typeof el.anchor !== 'string') {
                    errs.push(`${where}.anchor must be a string`);
                }
            });
        }
    });

    return errs;
}

export class Registry {
    constructor(base = './models') {
        this.base = String(base).replace(/\/+$/, '');
        this.types = new Map();
        this.entries = [];
        this.defs = new Map();
        this.source = 'builtin';
    }

    register(type, factory, params = {}) {
        this.types.set(type, { factory, params });
        return this;
    }

    get list() {
        if (this.entries.length) return this.entries;
        return [{ id: BUILTIN.id, name: BUILTIN.name, file: null, tags: ['builtin'] }];
    }

    // 'builtin' until a manifest has been fetched successfully.
    get manifestSource() { return this.source; }

    async loadManifest() {
        const url = `${this.base}/${MANIFEST_FILE}`;
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);

        let data;
        try { data = await res.json(); }
        catch (e) { throw new Error(`${MANIFEST_FILE} is not valid JSON: ${e.message}`); }

        if (!isPlainObject(data) || !Array.isArray(data.models)) {
            throw new Error(`${MANIFEST_FILE} needs a "models" array`);
        }
        if (!data.models.length) throw new Error(`${MANIFEST_FILE} lists no models`);

        const seen = new Set();
        const entries = data.models.map((m, i) => {
            if (!isPlainObject(m)) throw new Error(`models[${i}] must be an object`);
            const id = typeof m.id === 'string' ? m.id : '';
            const file = typeof m.file === 'string' ? m.file : '';
            if (!id) throw new Error(`models[${i}] needs an "id"`);
            if (!file) throw new Error(`models[${i}] needs a "file"`);
            if (seen.has(id)) throw new Error(`duplicate model id "${id}"`);
            if (file.includes('..') || file.startsWith('/') || file.includes(':')) {
                throw new Error(`models[${i}].file must stay inside the models folder`);
            }
            seen.add(id);
            return {
                id,
                name: typeof m.name === 'string' && m.name ? m.name : id,
                file,
                tags: Array.isArray(m.tags) ? m.tags.map(String) : []
            };
        });

        this.entries = entries;
        this.defs.clear();
        this.source = 'manifest';
        return entries;
    }

    async load(id) {
        const cached = this.defs.get(id);
        if (cached) return cached;

        let def;
        if (this.source !== 'manifest' && id === BUILTIN.id) {
            def = BUILTIN;
        } else {
            const entry = this.entries.find(e => e.id === id);
            if (!entry) throw new Error(`unknown model id "${id}"`);

            const url = `${this.base}/${entry.file}`;
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
            try { def = await res.json(); }
            catch (e) { throw new Error(`${entry.file} is not valid JSON: ${e.message}`); }
        }

        const errs = validateDef(def, this.types);
        if (errs.length) throw new Error(`${id}: ${errs.join('; ')}`);

        this.defs.set(id, def);
        return def;
    }

    // Turns a definition into live models. Returns both, because the viewer
    // and the environment (theme) are separate concerns.
    async instantiate(def) {
        const errs = validateDef(def, this.types);
        if (errs.length) throw new Error(`${def && def.id}: ${errs.join('; ')}`);

        const models = [];
        for (const [i, o] of def.objects.entries()) {
            const model = this.types.get(o.type).factory(o.params || {});
            model.id = def.id;
            model.name = def.name;
            model.objectIndex = i;
            model.def = def;
            models.push(model);
        }
        return { models, environment: def.environment || {} };
    }
}
