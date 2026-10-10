// Fabric palettes straight from the design boards. Pure data - the project
// parser checks the saved id against this list and it has to parse in plain
// Node, where three does not resolve. `fabric` is the curtain colour; the
// pillar's stone stays stone in every palette.
export const COLORWAYS = [
    { id: 'ivory', name: 'Ivory / Champagne', fabric: 0xf2e8d5 },
    { id: 'blush', name: 'Blush', fabric: 0xe8b4b8 },
    { id: 'sage', name: 'Sage', fabric: 0xb7c4a8 },
    { id: 'navy', name: 'Royal Navy', fabric: 0x243456 },
    { id: 'midnight', name: 'Midnight Luxe', fabric: 0x14161d }
];

export const DEFAULT_COLORWAY = 'ivory';
export const COLORWAY_IDS = COLORWAYS.map(c => c.id);

export function colorwayById(id) {
    return COLORWAYS.find(c => c.id === id) || null;
}
