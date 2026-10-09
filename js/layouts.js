// The SETs from the design boards, written as placements instead of pictures.
// Each board carries a small top-view diagram; these are those diagrams in
// feet: x runs right, z runs toward the audience (the camera sits at -z), and
// ry turns a frame in plan, in degrees. A left frame at -20 and its mirror at
// +20 open into the funnel the grand-entrance boards show.
//
// No three.js in here: js/project.js imports the id list and it has to parse
// in plain Node, where three does not resolve.
export const LAYOUTS = [
    {
        id: 'classic-symmetry',
        name: 'Classic Symmetry',
        subtitle: 'Balanced & timeless composition',
        placements: [
            { kind: 'frame', x: -5.5, z: 0, ry: -20 },
            { kind: 'frame', x: 5.5, z: 0, ry: 20 },
            { kind: 'pillar', x: -9.5, z: 2.5, ry: 0 },
            { kind: 'pillar', x: 9.5, z: 2.5, ry: 0 }
        ]
    },
    {
        id: 'cross-flow',
        name: 'Cross-Flow Draping',
        subtitle: 'Intersecting curtains, flowing lines',
        placements: [
            { kind: 'frame', x: -4.5, z: 0, ry: 30 },
            { kind: 'frame', x: 4.5, z: 0, ry: -30 },
            { kind: 'pillar', x: -8.5, z: 2, ry: 0 },
            { kind: 'pillar', x: 8.5, z: 2, ry: 0 }
        ]
    },
    {
        id: 'divided-entrance',
        name: 'Divided Entrance',
        subtitle: 'Two side frames, central opening',
        placements: [
            { kind: 'frame', x: -8, z: 0, ry: -8 },
            { kind: 'frame', x: 8, z: 0, ry: 8 }
        ]
    },
    {
        id: 'depth-stagger',
        name: 'Depth Stagger',
        subtitle: 'Front-back placement for dimension',
        placements: [
            { kind: 'frame', x: -6, z: -3, ry: -12 },
            { kind: 'frame', x: 6, z: 4, ry: 12 }
        ]
    },
    {
        id: 'diagonal-flow',
        name: 'Diagonal Flow',
        subtitle: 'Dynamic angled composition',
        placements: [
            { kind: 'frame', x: -7, z: -2, ry: 35 },
            { kind: 'frame', x: 7, z: 2, ry: 35 }
        ]
    },
    {
        id: 'grand-entrance',
        name: 'Grand Entrance',
        subtitle: 'Two pillars with two frame units',
        placements: [
            { kind: 'frame', x: -7, z: 0, ry: -28 },
            { kind: 'frame', x: 7, z: 0, ry: 28 },
            { kind: 'pillar', x: -12.5, z: -2, ry: 0 },
            { kind: 'pillar', x: 12.5, z: -2, ry: 0 }
        ]
    }
];

export const LAYOUT_IDS = LAYOUTS.map(l => l.id);

export function layoutById(id) {
    return LAYOUTS.find(l => l.id === id) || null;
}
