/* TILT asset library — the catalog behind models.html.
   Pure data: no three, no DOM, no fetch. The page feeds it the registries'
   real contents (manifest entries + def usage, registered types with their
   exported names, flower/greenery species lists); this module classifies and
   normalizes them so the UI never hardcodes a taxonomy and the tests can run
   the same builder under node. Exposes: buildCatalog, ASSET_TYPES. */

export const ASSET_TYPES = ['model', 'object', 'element', 'component'];

// Display order for the category rail. A category not listed here (only the
// unknown-type catch-all today) is appended after these, never dropped.
const CATEGORY_META = [
    { name: 'Sets & Stages', blurb: 'Complete stage and entrance assemblies' },
    { name: 'Structures', blurb: 'Frames, arches and support assemblies' },
    { name: 'Pillars & Columns', blurb: 'Classical columns and variants' },
    { name: 'Panels', blurb: 'Decorative infill sheets and cutwork' },
    { name: 'Floral Arrangements', blurb: 'Authored flower compositions' },
    { name: 'Flowers', blurb: 'Procedural bloom species' },
    { name: 'Greenery', blurb: 'Procedural foliage species' },
    { name: 'Lighting', blurb: 'PAR, wash and strip fixtures' },
    { name: 'Objects', blurb: 'Unclassified registered objects' }
];

// What the asset is used for, keyed by evidence gathered from the real
// sources: def membership (objects[] vs elements[]), module exports
// (PILLAR_SUBTITLE, FLOWERPANEL_SUBTITLE, LIGHT_NAMES) and, for species,
// which engine registry they came from. An id that matches none of these
// rules still lands in Objects with uncertain=true for review.
function classify(input) {
    const { typeId, usedAsObject, usedAsElement, subtitle } = input;
    const t = String(typeId || '');

    if (t.startsWith('light-')) {
        return { primaryCategory: 'Lighting', subcategory: 'Fixtures', assetType: 'element',
                 tags: ['lighting', 'fixture', 'anchor-element'] };
    }
    if (t === 'pillar') {
        return { primaryCategory: 'Pillars & Columns', subcategory: 'Classical',
                 assetType: 'component', tags: ['pillar', 'structure', 'set-component'] };
    }
    // The manufactured decor inventory: free-placed rails and sheets from
    // plans/decor_element_library_3d_assets.json (see js/decorlib.js).
    if (t === 'pillar_rail_large' || t === 'pillar_rail_small') {
        return { primaryCategory: 'Pillars & Columns', subcategory: 'Rails',
                 assetType: 'object', tags: ['pillar', 'rail', 'lattice', 'decor'] };
    }
    if (t === 'decorative_arch_panel_sheet') {
        return { primaryCategory: 'Panels', subcategory: 'Cutwork',
                 assetType: 'object', tags: ['panel', 'sheet', 'cutwork', 'decor'] };
    }
    if (t === 'flowerpanel') {
        return { primaryCategory: 'Floral Arrangements', subcategory: 'Panels',
                 assetType: 'object', tags: ['floral', 'arrangement', 'placeable'] };
    }
    if (t === 'o2tilt-frame') {
        return { primaryCategory: 'Structures', subcategory: 'Frames',
                 assetType: 'object', tags: ['frame', 'curtain', 'structure'] };
    }

    // Def-schema evidence: an element that never mounts as an object is an
    // element; anything in objects[] is an object regardless of other use.
    if (usedAsObject) {
        return { primaryCategory: 'Objects', subcategory: null, assetType: 'object',
                 tags: [], uncertain: true };
    }
    if (usedAsElement) {
        return { primaryCategory: 'Objects', subcategory: null, assetType: 'element',
                 tags: [], uncertain: true };
    }
    if (subtitle && /component/i.test(subtitle)) {
        return { primaryCategory: 'Objects', subcategory: null, assetType: 'component',
                 tags: [], uncertain: true };
    }
    return { primaryCategory: 'Objects', subcategory: null, assetType: 'object',
             tags: [], uncertain: true };
}

function pushUnique(arr, v) {
    if (v && !arr.includes(v)) arr.push(v);
}

/* input:
   {
     manifest: { entries: [{ id, name, file, tags }],
                 defs:    { [modelId]: { objects: [type], elements: [type] } } },
     types:    [{ type, name, subtitle, source: { kind, path }, params: [name] }],
     flowers:  [{ type, label }],
     greenery: [{ type, label }]
   }
   Returns { assets, categories, stats, problems }. */
export function buildCatalog(input) {
    const problems = [];
    const assets = [];
    const seen = new Set();
    const manifest = (input && input.manifest) || { entries: [], defs: {} };
    const types = (input && input.types) || [];
    const flowers = (input && input.flowers) || [];
    const greenery = (input && input.greenery) || [];

    // Which registered types the shipped model defs actually use, and how.
    const objectUse = new Set(), elementUse = new Set();
    for (const def of Object.values(manifest.defs || {})) {
        for (const o of (def && def.objects) || []) if (o && o.type) objectUse.add(o.type);
        for (const e of (def && def.elements) || []) if (e && e.type) elementUse.add(e.type);
    }

    const add = (rec) => {
        if (!rec || !rec.id) { problems.push('asset without an id'); return; }
        if (seen.has(rec.id)) { problems.push('duplicate asset id "' + rec.id + '"'); return; }
        seen.add(rec.id);
        assets.push(rec);
    };

    // 1. Manifest models — complete assemblies, one card per model.
    for (const entry of manifest.entries || []) {
        const def = manifest.defs && manifest.defs[entry.id];
        const deps = [];
        for (const o of (def && def.objects) || []) pushUnique(deps, o.type);
        for (const e of (def && def.elements) || []) pushUnique(deps, e.type);
        add({
            id: entry.id,
            name: entry.name || entry.id,
            assetType: 'model',
            primaryCategory: 'Sets & Stages',
            subcategory: 'Complete sets',
            tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
            source: { kind: 'file', path: 'models/' + entry.file },
            capabilities: { loadable: true, placeable: true, configurable: true },
            dependencies: deps,
            counts: {
                objects: ((def && def.objects) || []).length,
                elements: ((def && def.elements) || []).length
            }
        });
    }

    // 2. Registered types — objects, elements and components the editor mounts.
    for (const t of types) {
        if (!t || !t.type) { problems.push('type entry without a type id'); continue; }
        if (seen.has(t.type)) continue; // a manifest model id and a type id never share a card
        const c = classify({
            typeId: t.type,
            usedAsObject: objectUse.has(t.type),
            usedAsElement: elementUse.has(t.type),
            subtitle: t.subtitle
        });
        const deps = [];
        if (objectUse.has(t.type) || elementUse.has(t.type)) {
            for (const entry of manifest.entries || []) {
                const def = manifest.defs && manifest.defs[entry.id];
                const used = ((def && def.objects) || []).concat((def && def.elements) || []);
                if (used.some(o => o && o.type === t.type)) pushUnique(deps, 'model:' + entry.id);
            }
        }
        add({
            id: t.type,
            name: t.name || t.type,
            assetType: c.assetType,
            primaryCategory: c.primaryCategory,
            subcategory: c.subcategory,
            tags: c.tags,
            uncertain: !!c.uncertain,
            source: t.source || { kind: 'component' },
            capabilities: {
                loadable: true,
                placeable: c.assetType === 'object' || c.assetType === 'component',
                configurable: !!(t.params && t.params.length)
            },
            params: (t.params || []).slice(),
            dependencies: deps
        });
    }

    // 3. Species — procedural ingredients built by the flower/greenery engines.
    for (const s of flowers || []) {
        if (!s || !s.type) continue;
        add({
            id: 'flower:' + s.type,
            name: s.label || s.type,
            assetType: 'element',
            primaryCategory: 'Flowers',
            subcategory: 'Species',
            tags: ['floral', 'procedural', 'species'],
            source: { kind: 'procedural', path: 'js/flowers/' + s.type + '.js',
                      generator: 'FlowerEngine.build' },
            capabilities: { loadable: true, placeable: false, configurable: true }
        });
    }
    for (const s of greenery || []) {
        if (!s || !s.type) continue;
        add({
            id: 'greenery:' + s.type,
            name: s.label || s.type,
            assetType: 'element',
            primaryCategory: 'Greenery',
            subcategory: 'Species',
            tags: ['greenery', 'procedural', 'species'],
            source: { kind: 'procedural', path: 'js/greenery/' + s.type + '.js',
                      generator: 'GreeneryEngine.build' },
            capabilities: { loadable: true, placeable: false, configurable: true }
        });
    }

    // Category list: declared order, but only what the inventory filled.
    const counts = new Map();
    for (const a of assets) counts.set(a.primaryCategory, (counts.get(a.primaryCategory) || 0) + 1);
    const known = CATEGORY_META.filter(m => counts.has(m.name));
    const extra = [...counts.keys()].filter(n => !CATEGORY_META.some(m => m.name === n));
    const categories = known
        .concat(extra.map(name => ({ name, blurb: '' })))
        .map(m => ({ name: m.name, blurb: m.blurb, count: counts.get(m.name) }));

    return {
        assets,
        categories,
        stats: {
            assets: assets.length,
            categories: categories.length,
            byType: ASSET_TYPES.map(type => ({
                type, count: assets.filter(a => a.assetType === type).length
            })).filter(t => t.count > 0)
        },
        problems
    };
}

// Case-insensitive match across the fields the search box claims to cover.
export function matchesQuery(asset, q) {
    if (!q) return true;
    const s = String(q).toLowerCase();
    return [asset.name, asset.id, asset.primaryCategory, asset.subcategory]
        .concat(asset.tags || [])
        .some(v => v && String(v).toLowerCase().includes(s));
}

/* Filter + facet helpers, so the UI can show counts that are true for what
   the user would actually get. The trick: a facet never applies its own
   filter - the type chips count under category+query, the category chips
   count under type+query - so every advertised number is reachable, and a
   cross-filter that empties the grid leaves working escape routes. */

export function filterAssets(assets, state) {
    const type = (state && state.type) || 'all';
    const category = (state && state.category) || 'all';
    const query = (state && state.query) || '';
    return assets.filter(a =>
        (type === 'all' || a.assetType === type)
        && (category === 'all' || a.primaryCategory === category)
        && matchesQuery(a, query));
}

// -> { types, categories, visible }
//   types[assetType]  count under category+query (type filter NOT applied)
//   types.all         count under category+query
//   categories[name]  count under type+query (category filter NOT applied)
//   categories.all    count under type+query
//   visible           count under all three (what the grid shows)
export function facetCounts(assets, state) {
    const type = (state && state.type) || 'all';
    const category = (state && state.category) || 'all';
    const query = (state && state.query) || '';
    const types = {};
    for (const t of ASSET_TYPES) types[t] = 0;
    types.all = 0;
    const categories = { all: 0 };
    let visible = 0;
    for (const a of assets) {
        const byCat = category === 'all' || a.primaryCategory === category;
        const byType = type === 'all' || a.assetType === type;
        const byQ = matchesQuery(a, query);
        if (byCat && byQ) {
            types[a.assetType] = (types[a.assetType] || 0) + 1;
            types.all++;
        }
        if (byType && byQ) {
            categories[a.primaryCategory] = (categories[a.primaryCategory] || 0) + 1;
            categories.all++;
        }
        if (byCat && byType && byQ) visible++;
    }
    return { types, categories, visible };
}
