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
        placements: [
            { kind: 'frame', x: -15, z: 0, ry: -10 },
            { kind: 'frame', x: 15, z: 0, ry: 10 }
        ]
    },
    {
        id: 'cross-flow',
        name: 'Cross-Flow Draping',
        subtitle: 'Intersecting curtains, flowing lines',
        placements: [
            { kind: 'frame', x: -15, z: 0, ry: -40 },
            { kind: 'frame', x: 15, z: 0, ry: 40 }
        ]
    },
    {
        id: 'depth-stagger',
        name: 'Depth Stagger',
        subtitle: 'Front-back placement for dimension',
        placements: [
            { kind: 'frame', x: -15, z: -4, ry: -15 },
            { kind: 'frame', x: 15, z: 5, ry: 10 }
        ]
    },
    {
        id: 'diagonal-flow',
        name: 'Diagonal Flow',
        subtitle: 'Dynamic angled composition',
        placements: [
            { kind: 'frame', x: -15, z: -3, ry: 30 },
            { kind: 'frame', x: 15, z: 3, ry: 30 }
        ]
    },
    {
        id: 'grand-entrance',
        name: 'Grand Entrance',
        subtitle: 'Two frames funnelling to a gateway',
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
