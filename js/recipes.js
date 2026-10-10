// One-tap Looks: the planner's favourite bundles of SET + scene + fabric
// palette. Pure data like layouts.js and colorways.js - the ids are checked
// against those lists and this module has to parse in plain Node. A Look is
// not stored of its own: the project remembers it through the three fields
// it writes, and the panel highlights the chip that matches the current
// combination.
export const RECIPES = [
    { id: 'ivory-ballroom', name: 'Ivory Ballroom', scene: 'ballroom', colorway: 'ivory', set: 'classic-symmetry' },
    { id: 'blush-garden', name: 'Blush Garden', scene: 'garden-night', colorway: 'blush', set: 'grand-entrance' },
    { id: 'sage-terrace', name: 'Sage Sunset', scene: 'terrace', colorway: 'sage', set: 'cross-flow' },
    { id: 'navy-gala', name: 'Navy Gala', scene: 'white-stage', colorway: 'navy', set: 'diagonal-flow' },
    { id: 'midnight-luxe', name: 'Midnight Luxe', scene: 'studio', colorway: 'midnight', set: 'depth-stagger' }
];

export function recipeById(id) {
    return RECIPES.find(r => r.id === id) || null;
}

export function recipeFor(scene, colorway, set) {
    return RECIPES.find(r => r.scene === scene && r.colorway === colorway
        && r.set === set) || null;
}
