import * as THREE from 'three';

// The rooms a set can be staged in. Every scene keeps the model's own ground
// at y = 0 - frames are built to stand on it - so a raised stage is modelled
// as a floor that drops *below* y = 0 rather than lifting the models up.
// That way a scene swap never moves a frame, only the world around it.
export const SCENES = [
    { id: 'studio', name: 'Studio' },
    { id: 'white-stage', name: 'White Room Stage' },
    { id: 'ballroom', name: 'Ballroom Stage' },
    { id: 'garden-night', name: 'Garden at Night' },
    { id: 'terrace', name: 'Sunset Terrace' }
];

export const DEFAULT_SCENE = 'studio';

export function sceneName(id) {
    const hit = SCENES.find(s => s.id === id);
    return (hit || SCENES[0]).name;
}

export function isScene(id) {
    return SCENES.some(s => s.id === id);
}

// Feet. The stage is no longer a constant: it grows with whatever the set
// currently stands - `computeStageSize` turns a content footprint into a
// stage (and walls around it), so a wide cross-flow or a moved frame can
// never hang off the edge or hover over the lower floor. The defaults are
// what a classic SET needs, and the minimum a room is still a room.
export const DEFAULT_STAGE_SIZE = {
    w: 60, d: 16, h: 1.2, wallX: 30, wallZ: 16, wallH: 26
};
const MAT_T = 0.08;
const SIZE_MARGIN_X = 3.5;   // aisle between the outermost panel and the stage edge
const SIZE_MARGIN_Z = 3;     // room in front of / behind the deepest element
const SIZE_W_MIN = 44, SIZE_W_MAX = 140;
const SIZE_D_MIN = 18, SIZE_D_MAX = 60;

// Turn a content bounding box (feet, world) into the stage that holds it.
// Pure math, no three.js - the viewer feeds it a Box3's min/max and this
// returns the room dimensions. Odd sizes round UP to the next 2 ft so the
// stage never clips what it was measured against.
export function computeStageSize(fp) {
    if (!fp || !Number.isFinite(fp.minX) || !Number.isFinite(fp.maxX)
        || !Number.isFinite(fp.minZ) || !Number.isFinite(fp.maxZ)) {
        return Object.assign({}, DEFAULT_STAGE_SIZE);
    }
    const spanW = fp.maxX - fp.minX + SIZE_MARGIN_X * 2;
    const spanD = fp.maxZ - fp.minZ + SIZE_MARGIN_Z * 2;
    const w = Math.min(SIZE_W_MAX,
        Math.max(SIZE_W_MIN, Math.ceil(spanW / 2) * 2));
    const d = Math.min(SIZE_D_MAX,
        Math.max(SIZE_D_MIN, Math.ceil(spanD / 2) * 2));
    return {
        w, d,
        h: DEFAULT_STAGE_SIZE.h,
        wallX: w / 2 + 8,
        wallZ: Math.max(16, d / 2 + 8),
        wallH: Math.min(40, Math.max(24, Math.round(w / 2.3)))
    };
}

function sceneMat(color, extra) {
    return new THREE.MeshStandardMaterial(
        Object.assign({ color, roughness: 0.9, metalness: 0 }, extra || {}));
}

function sceneBox(group, w, h, d, mat, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

function sceneGround(group, w, d, mat, y) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

// A flat wall standing on its edge; ry turns its face into the room.
function sceneWall(group, w, h, mat, x, y, z, ry) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    group.add(mesh);
    return mesh;
}

function sceneLamp(group, x, y, z, intensity, distance, color) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    group.add(light);
    return light;
}

function sceneBulb(group, x, y, z, color) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshStandardMaterial({
            color: 0x2b2b2b, emissive: color, emissiveIntensity: 5, roughness: 0.4
        }));
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
}

// Vertical gradient, stretched across the screen by scene.background. Used
// for the skies; the flat scenes use a plain colour instead.
function sceneSky(top, mid, bottom) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    if (mid) grad.addColorStop(0.6, mid);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function cssHex(n) {
    return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

function shadeHex(n, f) {
    const c = (v) => Math.min(255, Math.max(0, Math.round(v * f)));
    return (c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8)
        | c(n & 255);
}

// Deterministic noise for baked textures: same seed, same surface, so a
// rebuild never shimmers.
function texRng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Soft mottled plaster/paint: hundreds of faint seeded flecks over the
// base so walls and floors stop reading as flat cards.
function sceneMottleTexture(color, amount, seed) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = cssHex(color);
    g.fillRect(0, 0, 128, 128);
    const rng = texRng(seed);
    for (let i = 0; i < 520; i++) {
        g.globalAlpha = 0.025 + rng() * (amount * 0.7);
        g.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
        const s = 2 + rng() * 5;
        g.fillRect(rng() * 128, rng() * 128, s, s);
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
}

// Linen weave: a faint cross-hatch, for drapery and table cloths.
function sceneWeaveTexture(color, seed) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = cssHex(color);
    g.fillRect(0, 0, 128, 128);
    const rng = texRng(seed);
    g.strokeStyle = 'rgba(0,0,0,0.05)';
    g.lineWidth = 1;
    for (let i = 0; i <= 128; i += 6) {
        g.globalAlpha = 0.5 + rng() * 0.5;
        g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 128); g.stroke();
        g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(128, i + 0.5); g.stroke();
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
}

// Bake a texture into a material: the map carries the colour, so the
// base tint goes white instead of multiplying the surface dark.
function sceneMap(mat, tex, rx, ry) {
    if (!tex) return mat;
    mat.map = tex;
    mat.color.setHex(0xffffff);
    if (rx) tex.repeat.set(rx, ry);
    return mat;
}

function scenePlankTexture(base, line, repeat) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line;
    g.lineWidth = 3;
    for (const y of [1, 43, 86]) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(128, y);
        g.stroke();
    }
    for (const [x, y0, y1] of [[64, 1, 43], [24, 43, 86], [96, 86, 128]]) {
        g.beginPath();
        g.moveTo(x, y0);
        g.lineTo(x, y1);
        g.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    return tex;
}

// Floor + three walls + a raised stage: the shell every indoor scene starts
// from. The carpet's top face is y = 0, so frames stand on the red mat.
// Every dimension comes from `size` - the room grows with its contents.
function sceneRoom(group, size, floorColor, wallColor, skirtColor, carpetColor, floorKind) {
    const groundW = Math.max(170, size.wallX * 2 + 50);
    const groundD = Math.max(120, size.wallZ * 2 + 40);
    const floorMat = sceneMat(floorColor, { roughness: 0.9 });
    if (floorKind === 'plank') {
        sceneMap(floorMat, scenePlankTexture(cssHex(floorColor),
            cssHex(shadeHex(floorColor, 0.72)), 1), 10, 6);
    } else {
        sceneMap(floorMat, sceneMottleTexture(floorColor, 0.05, 22), 12, 8);
    }
    sceneGround(group, groundW, groundD, floorMat, -size.h);
    const wall = sceneMat(wallColor, { roughness: 0.95 });
    sceneMap(wall, sceneMottleTexture(wallColor, 0.045, 11), 5, 2.5);
    const midY = size.wallH / 2 - size.h;
    sceneWall(group, size.wallX * 2 + 6, size.wallH, wall,
        0, midY, size.wallZ, Math.PI);
    sceneWall(group, size.wallZ + 28, size.wallH, wall,
        -size.wallX, midY, -6, Math.PI / 2);
    sceneWall(group, size.wallZ + 28, size.wallH, wall,
        size.wallX, midY, -6, -Math.PI / 2);
    sceneBox(group, size.w, size.h - MAT_T, size.d,
        sceneMat(skirtColor, { roughness: 0.85 }),
        0, -MAT_T - (size.h - MAT_T) / 2, 0);
    sceneBox(group, size.w - 1.4, MAT_T, size.d - 1.4,
        sceneMap(sceneMat(carpetColor, { roughness: 0.96 }),
            sceneMottleTexture(carpetColor, 0.1, 33), 6, 2),
        0, -MAT_T / 2, 0);
    return wall;
}

function sceneUplights(group, size) {
    const x = size.w * 0.117;   // ~7 ft on the default 60 ft stage
    sceneLamp(group, -x, 0.5, 2.5, 40, 30, 0xffd7a8);
    sceneLamp(group, x, 0.5, 2.5, 40, 30, 0xffd7a8);
}

function sceneSconce(group, size, x, y) {
    sceneBox(group, 0.9, 1.8, 0.2,
        sceneMat(0xfff6e2, { emissive: 0xffe7bd, emissiveIntensity: 1.2, roughness: 0.5 }),
        x, y, size.wallZ - 0.5);
    sceneLamp(group, x, y, size.wallZ - 1.4, 30, 22, 0xffdcae);
}

// ---- modern banquet hall (the white room) -----------------------------
// Flat ceiling with a recessed downlight grid and a cool cove, painted
// wall-panel trim, drapery folds flanking the stage, and shallow centre
// steps up onto it. The white-and-red identity stays.
function sceneModernCeiling(group, size) {
    const mark = group.children.length;
    const ceilY = size.wallH - size.h;
    const w = size.wallX * 2;
    const back = size.wallZ;
    const front = -(size.d / 2 + 14);
    const depth = back - front;
    const cz = (back + front) / 2;
    sceneBox(group, w + 4, 0.25, depth + 2,
        sceneMat(0xeae5dc, { roughness: 0.95 }), 0, ceilY + 0.85, cz);
    // Downlight grid: one instanced recessed can per cell - a warm pin,
    // not a bare bulb; the tone-mapped room keeps it from strobing.
    const cols = Math.max(4, Math.round(w / 10));
    const rows = Math.max(3, Math.round(depth / 12));
    const canGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.08, 12);
    const canMat = sceneMat(0xfff6e6,
        { emissive: 0xffe8c4, emissiveIntensity: 1.5, roughness: 0.4 });
    const cans = new THREE.InstancedMesh(canGeo, canMat, (cols + 1) * (rows + 1));
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= rows; j++) {
            m.makeTranslation(-w / 2 + (w / cols) * i, ceilY + 0.72,
                front + (depth / rows) * j);
            cans.setMatrixAt(k++, m);
        }
    }
    group.add(cans);
    // Warm cove line around the ceiling edge.
    const cove = sceneMat(0xf5efe2,
        { emissive: 0xffdfae, emissiveIntensity: 0.9, roughness: 0.6 });
    sceneBox(group, w, 0.12, 0.12, cove, 0, ceilY - 0.45, back - 0.35);
    for (const sx of [-1, 1]) {
        sceneBox(group, 0.12, 0.12, depth, cove,
            sx * (size.wallX - 0.35), ceilY - 0.45, cz);
    }
    // The ceiling shades the camera, not the room: these halls are lit
    // by their own lamps, so the key light passes through the roof
    // instead of parking the whole hall in one giant shadow.
    for (let i = mark; i < group.children.length; i++) {
        group.children[i].userData.noShadow = true;
    }
}

// Drapery: soft vertical folds of ivory, flanking the stage on the back
// wall - half-round columns of cloth, tight at the top, full at the hem.
function sceneDrapery(group, size) {
    const ivory = sceneMap(sceneMat(0xf7f3ea, { roughness: 0.95 }),
        sceneWeaveTexture(0xf7f3ea, 7), 2, 5);
    const h = size.wallH * 0.72;
    for (const sx of [-1, 1]) {
        const cx = sx * size.w * 0.33;
        for (let i = -3; i <= 3; i++) {
            // Half-round of cloth bulging toward the audience (theta z<=0).
            const fold = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.34, h, 10, 1, false,
                    Math.PI / 2, Math.PI), ivory);
            fold.position.set(cx + i * 0.42, -size.h + h / 2, size.wallZ - 0.7);
            fold.receiveShadow = true;
            group.add(fold);
        }
    }
}

// Two shallow steps up onto the stage, centred, carpet-topped.
function sceneStageSteps(group, size) {
    const stepW = Math.min(10, size.w * 0.3);
    const treadD = 1.1;
    const stepH = size.h / 2;
    const skirt = sceneMat(0xf2f0ea, { roughness: 0.9 });
    const carpet = sceneMat(0xb01818, { roughness: 0.96 });
    for (let i = 0; i < 2; i++) {
        const h = stepH * (i === 0 ? 1 : 2);
        const z = -size.d / 2 - treadD * (2 - i) - 0.05 * i;
        sceneBox(group, stepW, h, treadD, skirt, 0, -size.h + h / 2, z);
        sceneBox(group, stepW - 0.3, 0.05, treadD - 0.2, carpet,
            0, -size.h + h + 0.02, z);
    }
}

// Stacked banquet chairs along the side walls - the setup-day look every
// stage room really has. One chair drawn from three parts (seat, back,
// four legs), every part instanced: a whole wall of stacks is three draw
// calls. Deterministic jitter, no Math.random.
// One instanced chair army from a list of sites: { x, z, ry, lift }.
// Seats, backs and legs are three draw calls no matter how many chairs.
function sceneChairArmy(group, size, sites) {
    const seatMat = sceneMat(0x6e5f4a, { roughness: 0.9 });
    const frameMat = sceneMat(0x8f8574, { metalness: 0.6, roughness: 0.4 });
    const count = sites.length;
    const seats = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.6, 0.09, 1.5), seatMat, count);
    const backs = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.6, 1.55, 0.09), seatMat, count);
    const legs = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.46, 6), frameMat, count * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let si = 0, li = 0;
    for (const site of sites) {
        const c = Math.cos(site.ry), s = Math.sin(site.ry);
        const y = -size.h + 0.46 + (site.lift || 0);
        const jitter = (((si * 13) % 5) - 2) * 0.014;
        q.setFromAxisAngle(axis, site.ry + jitter);
        const place = (lx, ly, lz) => {
            v.set(site.x + lx * c + lz * s, y + ly,
                site.z - lx * s + lz * c);
            m.compose(v, q, one);
        };
        place(0, 0, 0);
        seats.setMatrixAt(si, m);
        place(0, 0.82, -0.7);
        backs.setMatrixAt(si, m);
        for (const [lx, lz] of [[-0.7, -0.6], [0.7, -0.6],
            [-0.7, 0.6], [0.7, 0.6]]) {
            place(lx, -0.23, lz);
            legs.setMatrixAt(li++, m);
        }
        si++;
    }
    group.add(seats, backs, legs);
}

// Round banquet tables set for service in front of the stage - the gala
// layout: dance floor nearest the stage, guest tables beyond it, every
// chair turned so the seated guest faces the program. Floor-length
// cloths, gold charger rim, a bloom centerpiece, eight seats a table.
// Everything instanced; positions scale off the derived room size.
function sceneDiningTables(group, size, aisle) {
    const clothMat = sceneMap(sceneMat(0xf2ead8, { roughness: 0.95 }),
        sceneWeaveTexture(0xf2ead8, 9), 3, 3);
    const topMat = sceneMat(0xf6f0e2, { roughness: 0.9 });
    const goldMat = sceneMat(0xd9c48a, { metalness: 0.55, roughness: 0.4 });
    const bloomMat = sceneMat(0x7a1f2b, { roughness: 0.85 });
    const sites = [];
    const rows = [-size.d / 2 - 4.5, -size.d / 2 - 13.5];
    if (aisle) {
        // Ceremony layout: two blocks of tables either side of a central
        // open aisle running straight to the stage steps.
        const inner = Math.max(9, size.w * 0.15);
        const outer = inner + 11;
        for (const sx of [-1, 1]) {
            for (const x of [inner, outer]) {
                for (const z of rows) {
                    sites.push({ x: sx * x, z });
                }
            }
        }
    } else {
        // Gala pockets: one column a side, flanking the dance floor; x
        // pulls in with the room so chairs never crowd the parquet edge.
        const x = Math.min(size.wallX - 8, size.w * 0.35);
        for (const sx of [-1, 1]) {
            for (const z of rows) {
                sites.push({ x: sx * x, z });
            }
        }
    }
    const n = sites.length;
    const cloths = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(2.45, 2.68, 2.5, 24), clothMat, n);
    const tops = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(2.5, 2.5, 0.12, 24), topMat, n);
    const rims = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(2.53, 2.53, 0.08, 24), goldMat, n);
    const blooms = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.38, 10, 8), bloomMat, n);
    const vases = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.14, 0.2, 0.75, 10), goldMat, n);
    const m = new THREE.Matrix4();
    const q0 = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const chairSites = [];
    const perTable = 8;
    const chairR = 3.7;
    let ci = 0;
    for (const t of sites) {
        const set = (mesh, y, scale) => {
            m.compose(
                new THREE.Vector3(t.x, -size.h + y, t.z), q0,
                scale ? new THREE.Vector3(scale, 1, scale) : one);
            mesh.setMatrixAt(ci, m);
        };
        set(cloths, 1.25);
        set(tops, 2.56);
        set(rims, 2.42);
        set(vases, 3.0);
        set(blooms, 3.55);
        ci++;                      // next table, next instance slot
        for (let k = 0; k < perTable; k++) {
            const a = (k / perTable) * Math.PI * 2;
            const cx = t.x + Math.cos(a) * chairR;
            const cz = t.z + Math.sin(a) * chairR;
            chairSites.push({
                x: cx,
                z: cz,
                // Every chair faces the stage (front of room is -z).
                ry: Math.atan2(-cx, -cz)
            });
        }
    }
    group.add(cloths, tops, rims, vases, blooms);
    sceneChairArmy(group, size, chairSites);
}

function buildWhiteStage(group, size) {
    // A banquet hall, not a lightbox: warm greige shell so the white
    // trims and the ivory drapery actually read, a floor a clear step
    // darker than the walls so tables and chairs sit ON something, and
    // layered lamps instead of one white blast.
    sceneRoom(group, size, 0xc7bfb2, 0xe6e1d8, 0xeae5dc, 0xb01818);
    sceneModernCeiling(group, size);
    sceneDrapery(group, size);
    sceneStageSteps(group, size);
    const trim = sceneMat(0xf4f0e8, { roughness: 0.6 });
    const panelIn = sceneMat(0xdcd6cb, { roughness: 0.85 });
    const wx = size.wallX / 30;  // fittings track the wall they hang on
    for (const x of [-18, -6, 6, 18]) {
        sceneBox(group, 8, 11, 0.1, trim, x * wx, 7.5, size.wallZ - 0.2);
    }
    // Painted panel trim along the side walls: proud frame, inset field.
    for (const sx of [-1, 1]) {
        const n = Math.max(2, Math.round(size.wallZ / 10));
        for (let i = 0; i < n; i++) {
            const z = -size.d / 2 - 5 + i * ((size.wallZ + 10) / n);
            sceneMoldingPanel(group, trim, panelIn,
                sx * (size.wallX - 0.12), 6.2, z,
                5, 5.2, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
    }
    sceneSconce(group, size, -13 * wx, 9);
    sceneSconce(group, size, 13 * wx, 9);
    sceneDiningTables(group, size, true);
    sceneUplights(group, size);
    return {
        background: new THREE.Color(0xe9e4db),
        fog: null,
        ambient: { color: 0xf2ede2, intensity: 0.42 },
        key: { color: 0xfff4e2, intensity: 1.0 },
        fill: { color: 0xffe9d2, intensity: 0.32 }
    };
}

// ---- ballroom dressing ------------------------------------------------
// The vocabulary of the real thing (grand ballrooms: coffered ceilings,
// crystal chandeliers, gilded moldings, marble columns, parquet dance
// floors) - all procedural, all sized off the room.

// A coffered ceiling: a slab with a grid of beams hanging below it, so the
// slab reads as recessed panels. Gold trim strips line the beam bottoms.
function sceneCofferedCeiling(group, size) {
    const mark = group.children.length;
    const ceilY = size.wallH - size.h;
    const back = size.wallZ;
    const front = -(size.d / 2 + 18);   // reaches over the dance floor
    const depth = back - front;
    const cz = (back + front) / 2;
    const w = size.wallX * 2;
    const cream = sceneMat(0xf7f1e4, { roughness: 0.95 });
    const gold = sceneMat(0xd9b45c, { metalness: 0.9, roughness: 0.3 });
    sceneBox(group, w + 4, 0.3, depth + 2, cream, 0, ceilY + 0.95, cz);
    const cols = Math.max(4, Math.round(w / 12));
    const rows = Math.max(3, Math.round(depth / 14));
    for (let i = 0; i <= cols; i++) {
        const x = -w / 2 + (w / cols) * i;
        sceneBox(group, 0.7, 0.9, depth, cream, x, ceilY + 0.35, cz);
        sceneBox(group, 0.34, 0.07, depth, gold, x, ceilY - 0.12, cz);
    }
    for (let j = 0; j <= rows; j++) {
        const z = front + (depth / rows) * j;
        sceneBox(group, w, 0.9, 0.7, cream, 0, ceilY + 0.35, z);
        sceneBox(group, w, 0.07, 0.34, gold, 0, ceilY - 0.12, z);
    }
    // Cove: a warm emissive line where the walls meet the ceiling.
    const cove = sceneMat(0xfff2d8,
        { emissive: 0xffdfae, emissiveIntensity: 1.6, roughness: 0.6 });
    sceneBox(group, w, 0.14, 0.14, cove, 0, ceilY - 0.5, back - 0.35);
    for (const sx of [-1, 1]) {
        sceneBox(group, 0.14, 0.14, depth, cove,
            sx * (size.wallX - 0.35), ceilY - 0.5, cz);
    }
    // The coffered roof shades the camera, not the hall - the practicals
    // do the lighting (see sceneModernCeiling).
    for (let i = mark; i < group.children.length; i++) {
        group.children[i].userData.noShadow = true;
    }
}

// Two-tier crystal chandelier: gold rings, chain to the ceiling, an
// emissive core, a ring of bulbs and a hanging strand ring. The centre
// piece also carries a lamp; the flankers are emissive-only so a big room
// does not stack point lights.
function sceneChandelier(group, size, x, z, s, withLamp) {
    const gold = sceneMat(0xd9b45c, { metalness: 0.9, roughness: 0.3 });
    const glass = sceneMat(0xfff4dd,
        { emissive: 0xffe3ae, emissiveIntensity: 5, roughness: 0.3 });
    const y = size.wallH * 0.6;
    const ceilY = size.wallH - size.h;
    const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(3.2 * s, 0.18 * s, 8, 40), gold);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.set(x, y, z);
    group.add(ring1);
    const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(2.0 * s, 0.13 * s, 8, 32), gold);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.set(x, y - 1.2 * s, z);
    group.add(ring2);
    const chain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, ceilY - y - 0.2, 6), gold);
    chain.position.set(x, y + (ceilY - y - 0.2) / 2, z);
    group.add(chain);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.05 * s, 16, 12), glass);
    core.position.set(x, y - 0.4 * s, z);
    group.add(core);
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        sceneBulb(group, x + Math.cos(a) * 3.2 * s, y - 0.2 * s,
            z + Math.sin(a) * 3.2 * s, 0xffe3ae);
    }
    // Crystal strands: instanced drops ringing the lower tier.
    const strandGeo = new THREE.CylinderGeometry(0.025 * s, 0.05 * s, 0.9 * s, 5);
    const strandMat = sceneMat(0xfff8ea,
        { emissive: 0xffedc8, emissiveIntensity: 1.4, roughness: 0.25 });
    const strands = new THREE.InstancedMesh(strandGeo, strandMat, 16);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + 0.2;
        m.makeTranslation(x + Math.cos(a) * 2.5 * s, y - 1.75 * s,
            z + Math.sin(a) * 2.5 * s);
        strands.setMatrixAt(i, m);
    }
    group.add(strands);
    if (withLamp) sceneLamp(group, x, y - 0.5 * s, z, 420 * s, 90, 0xffe3b8);
}

// A pilaster: square shaft, base and gold capital - the marble-column
// language of the grand ballrooms, kept planar so it hugs the wall.
function scenePilaster(group, size, x, z, h) {
    const cream = sceneMat(0xf3ecdc, { roughness: 0.7 });
    const gold = sceneMat(0xd9b45c, { metalness: 0.85, roughness: 0.35 });
    sceneBox(group, 1.6, h, 0.5, cream, x, -size.h + h / 2, z);
    sceneBox(group, 2.0, 0.5, 0.7, gold, x, -size.h + h - 0.2, z);
    sceneBox(group, 2.0, 0.4, 0.7, cream, x, -size.h + 0.18, z);
}

// Molding panels: a proud cream frame with a slightly recessed inner
// field. Two meshes per panel - the frame reads as applied plaster trim.
function sceneMoldingPanel(group, mat, inner, cx, cy, cz, fw, fh, ry) {
    const g = new THREE.Group();
    g.position.set(cx, cy, cz);
    g.rotation.y = ry;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.1), mat);
    const field = new THREE.Mesh(
        new THREE.BoxGeometry(fw - 0.55, fh - 0.55, 0.06), inner);
    field.position.z = 0.02;
    g.add(frame, field);
    group.add(g);
}

// Parquet: the Versailles basket-weave, two by two, on a small canvas.
// Without a DOM (the node harnesses) there is no canvas - callers fall
// back to a plain colour.
function sceneParquetTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const woods = ['#b5894f', '#a67a42'];
    const grain = ['#8a6435', '#7d592e'];
    for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
            const ox = tx * 64, oy = ty * 64;
            g.fillStyle = woods[(tx + ty) % 2];
            g.fillRect(ox, oy, 64, 64);
            g.strokeStyle = grain[(tx + ty) % 2];
            g.lineWidth = 2;
            const horiz = (tx + ty) % 2 === 0;
            for (let i = 1; i < 4; i++) {
                g.beginPath();
                if (horiz) {
                    g.moveTo(ox + 4, oy + i * 16);
                    g.lineTo(ox + 60, oy + i * 16);
                } else {
                    g.moveTo(ox + i * 16, oy + 4);
                    g.lineTo(ox + i * 16, oy + 60);
                }
                g.stroke();
            }
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// The dance floor, in front of the stage where the camera looks past the
// set: parquet field on a dark inlay border.
function sceneDanceFloor(group, size) {
    const z = -(size.d / 2 + 9);
    const border = sceneMat(0x5a4028, { roughness: 0.75 });
    sceneBox(group, 22, 0.06, 15, border, 0, -size.h + 0.03, z);
    const parquet = sceneMat(0xffffff, { roughness: 0.72 });
    const tex = sceneParquetTexture();
    if (tex) {
        parquet.map = tex;
        parquet.map.repeat.set(5, 3.5);
        parquet.userData.ownMap = true;
    } else {
        parquet.color.setHex(0xb5894f);
    }
    sceneBox(group, 20, 0.06, 13, parquet, 0, -size.h + 0.05, z);
}

function buildBallroom(group, size) {
    sceneRoom(group, size, 0xcbb694, 0xefe6d6, 0xf3ead9, 0xb98a56, 'plank');
    sceneCofferedCeiling(group, size);
    sceneDanceFloor(group, size);

    // Pilasters march along the back wall; sconces ride between them.
    const wx = size.wallX / 30;
    const backH = size.wallH - 3;
    for (const x of [-20, -8, 8, 20]) {
        scenePilaster(group, size, x * wx, size.wallZ - 0.35, backH);
    }
    for (const x of [-14, -5, 5, 14]) sceneSconce(group, size, x * wx, 8.5);

    // Chair-rail band and molding panels along the side walls.
    const rail = sceneMat(0xe8dcc2, { roughness: 0.7 });
    const panelIn = sceneMat(0xe6dcc6, { roughness: 0.85 });
    for (const sx of [-1, 1]) {
        sceneBox(group, 0.18, 0.35, size.wallZ + 20, rail,
            sx * (size.wallX - 0.1), 3.2, size.wallZ / 2 - 4);
        const n = Math.max(2, Math.round(size.wallZ / 9));
        for (let i = 0; i < n; i++) {
            const z = -size.d / 2 - 6 + i * ((size.wallZ + 12) / n);
            sceneMoldingPanel(group, rail, panelIn,
                sx * (size.wallX - 0.12), 6.6, z,
                5.5, 5.6, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
    }

    // Three chandeliers: the grand centre plus two flankers, scaled to
    // the room; only the centre carries a lamp.
    const s = Math.max(0.7, Math.min(1.35, size.w / 70));
    sceneChandelier(group, size, 0, 4, s, true);
    if (size.w >= 56) {
        sceneChandelier(group, size, -size.w * 0.28, 4, s * 0.62, false);
        sceneChandelier(group, size, size.w * 0.28, 4, s * 0.62, false);
    }
    sceneDiningTables(group, size);
    sceneUplights(group, size);

    return {
        background: new THREE.Color(0xefe6d6),
        fog: null,
        ambient: { color: 0xfff6ea, intensity: 0.65 },
        key: { color: 0xfff2e0, intensity: 1.25 },
        fill: { color: 0xffe9cf, intensity: 0.4 }
    };
}

function sceneTree(group, x, z, scale) {
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3 * scale, 0.45 * scale, 5 * scale, 8),
        sceneMat(0x3a2c1d, { roughness: 1 }));
    trunk.position.set(x, 2.5 * scale, z);
    group.add(trunk);
    for (const [y, r] of [[5.4 * scale, 3 * scale], [7.6 * scale, 2.1 * scale]]) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1),
            sceneMat(0x2b5530, { roughness: 1, flatShading: true }));
        crown.position.set(x, y, z);
        group.add(crown);
    }
}

// ---- garden dressing --------------------------------------------------
// A manicured approach: stone path, hedge rows with flower beds, lantern
// posts, a moon-and-stars sky, and a distant tree line so the garden has
// a horizon instead of empty night.

function sceneHedge(group, x, z0, z1) {
    const body = sceneMat(0x2e4a2b, { roughness: 1 });
    const crown = sceneMat(0x35542f, { roughness: 1 });
    const len = Math.abs(z1 - z0), cz = (z0 + z1) / 2;
    sceneBox(group, 1.3, 1.5, len, body, x, 0.75, cz);
    sceneBox(group, 1.0, 0.35, len - 0.2, crown, x, 1.6, cz);
}

function sceneStonePath(group) {
    const stone = sceneMat(0x8f8a80, { roughness: 0.95 });
    for (let i = 0; i < 9; i++) {
        const slab = sceneBox(group, 3.2, 0.1, 1.5, stone, 0, 0.05, -16 + i * 2.6);
        slab.receiveShadow = true;
    }
}

function scenePathLantern(group, x, z) {
    const dark = sceneMat(0x262624, { roughness: 0.75 });
    const glow = sceneMat(0xfff2d0,
        { emissive: 0xffd9a0, emissiveIntensity: 4, roughness: 0.4 });
    sceneBox(group, 0.09, 2.1, 0.09, dark, x, 1.05, z);
    sceneBox(group, 0.32, 0.3, 0.32, glow, x, 2.22, z);
    sceneBox(group, 0.4, 0.08, 0.4, dark, x, 2.4, z);
}

// Blossom clusters along the hedge tops - one instanced draw call.
function sceneFlowerBeds(group) {
    const geo = new THREE.IcosahedronGeometry(0.14, 0);
    const mat = sceneMat(0xe8a0b4, { roughness: 0.8, emissive: 0x40101c });
    const n = 32;
    const bed = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const sx of [-1, 1]) {
        for (let i = 0; i < n / 2; i++) {
            const z = -13.4 + (i / (n / 2 - 1)) * 15;
            m.makeTranslation(sx * 6.5 + (i % 2 ? 0.22 : -0.22), 1.92, z);
            bed.setMatrixAt(k++, m);
        }
    }
    group.add(bed);
}

// Moon and stars: emissive, fog-immune, hung on the sky dome.
function sceneMoonAndStars(group) {
    const moon = new THREE.Mesh(
        new THREE.CircleGeometry(7, 24),
        new THREE.MeshBasicMaterial({ color: 0xf5edc8, fog: false }));
    moon.position.set(55, 78, 110);
    moon.lookAt(0, 4, 0);
    group.add(moon);
    const starGeo = new THREE.SphereGeometry(0.09, 5, 4);
    const starMat = new THREE.MeshBasicMaterial(
        { color: 0xdfe8ff, fog: false });
    const stars = new THREE.InstancedMesh(starGeo, starMat, 70);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 70; i++) {
        const a = (i * 2.399) % (Math.PI * 2);   // golden-angle scatter
        const y = 28 + ((i * 37) % 90);
        const r = 145;
        m.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r);
        stars.setMatrixAt(i, m);
    }
    group.add(stars);
}

// A ring of dark silhouette crowns at the fog line - the garden ends in
// trees, not in nothing.
function sceneTreeLine(group) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = sceneMat(0x152417, { roughness: 1, flatShading: true });
    const n = 18;
    const line = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 92 + (i % 4) * 7;
        const sc = 11 + (i * 53) % 8;
        v.set(Math.cos(a) * r, sc * 0.55, Math.sin(a) * r);
        s.set(sc * 1.15, sc * 0.8, sc * 1.15);
        m.compose(v, q, s);
        line.setMatrixAt(i, m);
    }
    group.add(line);
}

function buildGardenNight(group, size) {
    sceneGround(group, 260, 200, sceneMat(0x466b34, { roughness: 1 }), 0);
    for (const [x, z, s] of [
        [-14, 12, 1.1], [14, 12, 1.2], [-22, 8, 0.9], [22, 8, 1],
        [-30, 5, 1.3], [30, 5, 1.15], [-26, 16, 1], [26, 16, 0.95]
    ]) sceneTree(group, x, z, s);

    // The approach: slabs between hedge rows, lanterns along the way.
    sceneStonePath(group);
    sceneHedge(group, -6.5, -14, 2);
    sceneHedge(group, 6.5, -14, 2);
    sceneFlowerBeds(group);
    for (const z of [-12, -6, 0]) {
        scenePathLantern(group, -3.6, z);
        scenePathLantern(group, 3.6, z);
    }
    sceneTreeLine(group);
    sceneMoonAndStars(group);

    // Two sagging strings of bulbs between the trees.
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        sceneBulb(group, -24 + 48 * t, 10 - 2.4 * Math.sin(Math.PI * t), 10, 0xffd9a0);
    }
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        sceneBulb(group, -26 + 52 * t, 10.6 - 2.6 * Math.sin(Math.PI * t), 16, 0xffd9a0);
    }
    sceneLamp(group, 0, 7.6, 10, 90, 46, 0xffd9a0);
    sceneLamp(group, -8, 0.5, 3, 110, 40, 0xffc98a);
    sceneLamp(group, 8, 0.5, 3, 110, 40, 0xffc98a);

    return {
        background: sceneSky('#040a1d', '#16264d', '#04070f'),
        fog: { color: 0x0d1730, near: 60, far: 240 },
        ambient: { color: 0x8ea2d8, intensity: 0.32 },
        key: { color: 0xb9cbff, intensity: 0.55 },
        fill: { color: 0x5f76c4, intensity: 0.18 }
    };
}

// ---- rooftop terrace dressing -----------------------------------------
// A glass balustrade along the view edge, a pergola with hanging bulbs,
// planters at the posts, lounge silhouettes on the deck, and a skyline
// band on the horizon so the roof has a city beyond it.

function sceneBalustrade(group) {
    const dark = sceneMat(0x514c44, { roughness: 0.6, metalness: 0.3 });
    const glass = sceneMat(0xbfd4e0,
        { roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.22 });
    const z = 26;
    sceneBox(group, 90, 0.18, 0.28, dark, 0, 3.1, z);         // top rail
    sceneBox(group, 90, 0.12, 0.2, dark, 0, 0.9, z);          // bottom rail
    for (let i = -11; i <= 11; i++) {
        sceneBox(group, 0.14, 3, 0.16, dark, i * 4, 1.5, z);   // posts
    }
    for (let i = -11; i < 11; i++) {
        sceneBox(group, 3.8, 1.9, 0.06, glass, i * 4 + 2, 1.9, z); // panes
    }
}

// Pergola: posts and a slatted roof over the lounge end, warm bulbs
// strung under the beams.
function scenePergola(group) {
    const wood = sceneMat(0x6f5a42, { roughness: 0.85 });
    const xs = [-18, -6, 6, 18];
    for (const x of xs) {
        sceneBox(group, 0.5, 10, 0.5, wood, x, 5, 8);
        sceneBox(group, 0.5, 10, 0.5, wood, x, 5, 18);
    }
    for (const x of xs) {
        sceneBox(group, 0.45, 0.4, 11, wood, x, 10.15, 13);   // rafters
    }
    sceneBox(group, 38, 0.45, 0.5, wood, 0, 10.5, 8);         // header beams
    sceneBox(group, 38, 0.45, 0.5, wood, 0, 10.5, 18);
    for (const z of [10.5, 15.5]) {
        for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            sceneBulb(group, -17 + 34 * t,
                9.6 - 1.1 * Math.sin(Math.PI * t), z, 0xffc98a);
        }
    }
}

function scenePlanter(group, x, z) {
    const box = sceneMat(0x4a463f, { roughness: 0.9 });
    const leaf = sceneMat(0x3d5c33, { roughness: 1, flatShading: true });
    sceneBox(group, 2.4, 1.1, 2.4, box, x, 0.55, z);
    const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), leaf);
    shrub.position.set(x, 1.7, z);
    group.add(shrub);
}

// The city: a band of varied block silhouettes at the fog line.
function sceneSkyline(group) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = sceneMat(0x3a3350, { roughness: 1 });
    const n = 22;
    const band = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const x = -150 + (i / (n - 1)) * 300 + ((i * 47) % 17) - 8;
        const h = 12 + ((i * 73) % 30);
        v.set(x, h / 2, 125 + ((i * 31) % 20));
        s.set(10 + ((i * 19) % 14), h, 10);
        m.compose(v, q, s);
        band.setMatrixAt(i, m);
    }
    group.add(band);
}

// Lounge silhouettes: low sofas and a table, dark against the sunset.
function sceneLounge(group) {
    const soft = sceneMat(0x5c5348, { roughness: 0.95 });
    for (const sx of [-1, 1]) {
        sceneBox(group, 7, 1.1, 2.6, soft, sx * 11, 0.55, 12);
        sceneBox(group, 7, 1.5, 0.5, soft, sx * 11, 1.35, 13.2);
        sceneBox(group, 7, 1.5, 0.5, soft, sx * 11, 1.35, 10.8);
    }
    const table = sceneMat(0x3f3a34, { roughness: 0.6, metalness: 0.2 });
    sceneBox(group, 4, 0.18, 2, table, 0, 0.9, 12);
    sceneBox(group, 0.3, 0.85, 0.3, table, 0, 0.42, 12);
}

function buildTerrace(group, size) {
    const planks = scenePlankTexture('#8a6a49', '#6b4f34', 16);
    const deck = sceneMat(0xffffff, { roughness: 0.8 });
    deck.map = planks;
    deck.userData.ownMap = true;
    sceneGround(group, 260, 200, deck, 0);

    sceneBalustrade(group);
    scenePergola(group);
    sceneLounge(group);
    sceneSkyline(group);
    for (const x of [-20, 20]) {
        scenePlanter(group, x, 22);
        scenePlanter(group, x * 0.6, 7);
    }
    for (const x of [-24, 24]) sceneBox(group, 6, 2.4, 3, sceneMat(0x6f6a60), x, 1.2, 20);
    sceneUplights(group, size);

    return {
        background: sceneSky('#22305f', '#c96a3a', '#f7c884'),
        fog: { color: 0xd98a5a, near: 70, far: 300 },
        ambient: { color: 0xffe6d0, intensity: 0.5 },
        key: { color: 0xffd9b0, intensity: 1.0 },
        fill: { color: 0xff9e6b, intensity: 0.35 }
    };
}

const SCENE_BUILDERS = {
    'white-stage': buildWhiteStage,
    'ballroom': buildBallroom,
    'garden-night': buildGardenNight,
    'terrace': buildTerrace
};

function disposeSceneTree(root) {
    root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (!o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m.userData && m.userData.ownMap && m.map) m.map.dispose();
            m.dispose();
        }
    });
}

// Owns everything that makes a scene a place: ground, walls, sky, the extra
// lights. The viewer keeps its three fixed lights and its studio floor, and
// only re-points them at whatever `settings` says.
export class SceneRig {
    constructor() {
        this.group = new THREE.Group();
        this.settings = null;
        this.id = DEFAULT_SCENE;
    }

    // `size` is the room the contents ask for (see computeStageSize);
    // null/undefined falls back to the classic defaults.
    build(id, size) {
        this.clear();
        this.id = isScene(id) ? id : DEFAULT_SCENE;
        const make = SCENE_BUILDERS[this.id];
        this.size = make
            ? (size || Object.assign({}, DEFAULT_STAGE_SIZE)) : null;
        this.settings = make ? make(this.group, this.size) : null;
        if (this.settings) {
            // Everything in the room lives in the key light's shadow:
            // cast unless you're a huge slab (the ground plane), receive
            // always - that's what gives walls their depth.
            this.group.traverse((o) => {
                if (!o.isMesh && !o.isInstancedMesh) return;
                o.receiveShadow = true;
                if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
                const r = o.geometry.boundingSphere
                    ? o.geometry.boundingSphere.radius : 0;
                // huge slabs never cast; ceilings opt out so the key
                // doesn't park the whole hall in one shadow
                o.castShadow = r < 80 && !o.userData.noShadow;
            });
        }
        return this.settings;
    }

    clear() {
        // The sky texture is referenced by the scene background, not by a
        // material, so nothing else would ever release it.
        if (this.settings && this.settings.background && this.settings.background.isTexture) {
            this.settings.background.dispose();
        }
        for (const child of [...this.group.children]) {
            disposeSceneTree(child);
            this.group.remove(child);
        }
        this.settings = null;
    }

    dispose() {
        this.clear();
        if (this.group.parent) this.group.parent.remove(this.group);
    }
}
