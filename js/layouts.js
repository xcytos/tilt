// The SETs from the design boards, written as placements instead of pictures.
// Each board carries a small top-view diagram; these are those diagrams in
// feet: x runs right, z runs toward the audience (the camera sits at -z), and
// ry turns a frame in plan, in degrees.
//
// A frame slot holds ONE S Curve, and one S Curve is already left + right: two
// mirrored rails of 12 ft running out from the centre gap, so the object spans
// about gap + 24 ft on its own. Frame slots are therefore spaced ~30 ft apart
// - far enough that two selected frames stand side by side instead of through
// each other - and a selection of one falls in the middle of them.
//
// A SET is a starting point, nothing more: it proposes where the frames go and
// then the coordinates belong to you. Pillars are not part of the drawings at
// all - you add one or two yourself and the lock puts them at the centre or
// at the end of each module (see js/app.js).
//
// No three.js in here: js/project.js imports the id list and it has to parse
// in plain Node, where three does not resolve.
export const LAYOUTS = [
    {
        // Merged set: the old Divided Entrance (±15°) lives here now - one
        // gentle gateway covers the 8-15° toe-in family.
        id: 'classic-symmetry',
        name: 'Classic Symmetry',
        subtitle: 'Balanced gateway & timeless composition',
        // Flat frontal wall: the merged 8-15 degree family lives in the
        // placement; the sliders stay at the classic defaults.
        params: { gap: 3, pan: 0, pitch: 0, decline: 0, lobes: 6 },
        placements: [
            { kind: 'frame', x: -15, z: 0, ry: -10 },
            { kind: 'frame', x: 15, z: 0, ry: 10 }
        ]
    },
    {
        id: 'cross-flow',
        name: 'Cross-Flow Draping',
        subtitle: 'Intersecting curtains, flowing lines',
        params: { gap: 2, pan: 45, pitch: 8, decline: 0, lobes: 6 },
        placements: [
            { kind: 'frame', x: -15, z: 0, ry: -40 },
            { kind: 'frame', x: 15, z: 0, ry: 40 }
        ]
    },
    {
        id: 'depth-stagger',
        name: 'Depth Stagger',
        subtitle: 'Front-back placement for dimension',
        params: { gap: 4, pan: 15, pitch: 0, decline: 25, lobes: 6 },
        placements: [
            { kind: 'frame', x: -15, z: -4, ry: -12 },
            { kind: 'frame', x: 15, z: 5, ry: 12 }
        ]
    },
    {
        id: 'diagonal-flow',
        name: 'Diagonal Flow',
        subtitle: 'Diagonal line, faces to the audience',
        // The slant is in the DEPTH, not in a turn: one frame steps forward,
        // the other back, and both stay mirrored to the audience like every
        // other SET. (Both frames used to share +30 - a corridor, not a set.)
        params: { gap: 3, pan: 30, pitch: 12, decline: 0, lobes: 6 },
        placements: [
            { kind: 'frame', x: -15, z: 4, ry: -10 },
            { kind: 'frame', x: 15, z: -4, ry: 10 }
        ]
    },
    {
        id: 'grand-entrance',
        name: 'Grand Entrance',
        subtitle: 'Two frames funnelling to a gateway',
        params: { gap: 6, pan: 20, pitch: 0, decline: 0, lobes: 6 },
        placements: [
            { kind: 'frame', x: -15, z: 0, ry: -25 },
            { kind: 'frame', x: 15, z: 0, ry: 25 }
        ]
    }
];

export const LAYOUT_IDS = LAYOUTS.map(l => l.id);

export function layoutById(id) {
    return LAYOUTS.find(l => l.id === id) || null;
}
