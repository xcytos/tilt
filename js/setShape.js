// SET drawings are S Curve drawings. These are the only shape keys a SET
// preset carries: app.js writes them when a frame slider moves, and
// project.js accepts them from disk. Frame application itself reads each
// model's own registered params schema, so this list never becomes the
// generic frame-shape contract.
export const SET_SHAPE_KEYS = Object.freeze([
    'gap', 'pan', 'pitch', 'decline', 'declineIn', 'lobes'
]);
