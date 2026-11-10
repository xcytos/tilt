// The manufactured decor inventory, transcribed from
// plans/decor_element_library_3d_assets.json - the authored source of
// truth (tests/test13.mjs pins this file against it with fs). Pure data:
// no three, no DOM. Dimensions carry both units the app speaks - metres
// as the plan records them, feet as TILT's scene unit - and depth stays
// null because the plan has not measured it; the factories own the
// clearly-commented visual estimate for that one axis.

export const M_PER_FT = 0.3048;

export const DECOR_CATEGORIES = [
    { id: 'pillars', label: 'Pillars' },
    { id: 'panels', label: 'Panels' }
];

// sizeM / sizeFt are [width_or_length, height, depth] in the plan's own
// dimensions_order; null means not_measured, never zero.
export const DECOR_ASSETS = [
    {
        id: 'pillar_rail_large',
        name: 'Pillar Rail - Large',
        category: 'pillars',
        qty: 2,
        defaults: 2,
        sizeM: [1.524, 0.381, null],
        sizeFt: [5, 1.25, null]
    },
    {
        id: 'pillar_rail_small',
        name: 'Pillar Rail - Small',
        category: 'pillars',
        qty: 4,
        defaults: 4,
        sizeM: [0.9144, 0.3048, null],
        sizeFt: [3, 1, null]
    },
    {
        id: 'decorative_arch_panel_sheet',
        name: 'Decorative Arch Panel Sheet',
        category: 'panels',
        qty: 1,
        defaults: 1,
        sizeM: [0.762, 1.8288, null],
        sizeFt: [2.5, 6, null]
    }
];

export const DECOR_BY_ID = Object.fromEntries(DECOR_ASSETS.map(a => [a.id, a]));

export function decorAsset(id) {
    return DECOR_BY_ID[id] || null;
}
