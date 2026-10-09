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

// Feet. The stage is wide enough for the widest "all at once" row, and the
// room wraps it so the camera never looks at empty sky from inside a wall.
const STAGE_W = 60;
const STAGE_D = 16;
const STAGE_H = 1.2;
const MAT_T = 0.08;
const WALL_Z = 16;
const WALL_X = 30;
const WALL_H = 26;

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

function scenePlankTexture(base, line, repeat) {
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
function sceneRoom(group, floorColor, wallColor, skirtColor, carpetColor) {
    sceneGround(group, 170, 120, sceneMat(floorColor, { roughness: 0.9 }), -STAGE_H);
    const wall = sceneMat(wallColor, { roughness: 0.95 });
    const midY = WALL_H / 2 - STAGE_H;
    sceneWall(group, WALL_X * 2 + 6, WALL_H, wall, 0, midY, WALL_Z, Math.PI);
    sceneWall(group, WALL_Z + 28, WALL_H, wall, -WALL_X, midY, -6, Math.PI / 2);
    sceneWall(group, WALL_Z + 28, WALL_H, wall, WALL_X, midY, -6, -Math.PI / 2);
    sceneBox(group, STAGE_W, STAGE_H - MAT_T, STAGE_D,
        sceneMat(skirtColor, { roughness: 0.85 }),
        0, -MAT_T - (STAGE_H - MAT_T) / 2, 0);
    sceneBox(group, STAGE_W - 1.4, MAT_T, STAGE_D - 1.4,
        sceneMat(carpetColor, { roughness: 0.96 }), 0, -MAT_T / 2, 0);
    return wall;
}

function sceneUplights(group) {
    sceneLamp(group, -7, 0.5, 2.5, 70, 34, 0xffd7a8);
    sceneLamp(group, 7, 0.5, 2.5, 70, 34, 0xffd7a8);
}

function sceneSconce(group, x, y) {
    sceneBox(group, 0.9, 1.8, 0.2,
        sceneMat(0xfff6e2, { emissive: 0xffe7bd, emissiveIntensity: 2, roughness: 0.5 }),
        x, y, WALL_Z - 0.5);
    sceneLamp(group, x, y, WALL_Z - 1.4, 55, 26, 0xffdcae);
}

function buildWhiteStage(group) {
    sceneRoom(group, 0xe7e5e0, 0xf4f2ee, 0xf2f0ea, 0xb01818);
    const trim = sceneMat(0xffffff, { roughness: 0.6 });
    for (const x of [-18, -6, 6, 18]) sceneBox(group, 8, 11, 0.1, trim, x, 7.5, WALL_Z - 0.2);
    sceneSconce(group, -13, 9);
    sceneSconce(group, 13, 9);
    sceneUplights(group);
    return {
        background: new THREE.Color(0xf4f2ee),
        fog: null,
        ambient: { color: 0xffffff, intensity: 0.7 },
        key: { color: 0xffffff, intensity: 1.3 },
        fill: { color: 0xfff1de, intensity: 0.45 }
    };
}

function buildBallroom(group) {
    sceneRoom(group, 0xcbb694, 0xefe6d6, 0xf3ead9, 0xb98a56);
    for (const x of [-20, -8, 8, 20]) {
        sceneBox(group, 1.6, 20, 0.5, sceneMat(0xf7f0e2), x, 10, WALL_Z - 0.4);
    }
    for (const x of [-14, -5, 5, 14]) sceneSconce(group, x, 8.5);

    // Chandelier: ring, chain, core and a ring of bulbs, with one lamp to
    // carry it onto the floor.
    const gold = sceneMat(0xd9b45c, { metalness: 0.9, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 8, 40), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 15.5, 4);
    group.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 8, 6), gold);
    chain.position.set(0, 19.6, 4);
    group.add(chain);
    const core = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 16, 12),
        sceneMat(0xfff4dd, { emissive: 0xffe3ae, emissiveIntensity: 6, roughness: 0.3 }));
    core.position.set(0, 15, 4);
    group.add(core);
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        sceneBulb(group, Math.cos(a) * 3.2, 15.3, 4 + Math.sin(a) * 3.2, 0xffe3ae);
    }
    sceneLamp(group, 0, 15, 4, 420, 90, 0xffe3b8);
    sceneUplights(group);

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

function buildGardenNight(group) {
    sceneGround(group, 260, 200, sceneMat(0x466b34, { roughness: 1 }), 0);
    for (const [x, z, s] of [
        [-14, 12, 1.1], [14, 12, 1.2], [-22, 8, 0.9], [22, 8, 1],
        [-30, 5, 1.3], [30, 5, 1.15], [-26, 16, 1], [26, 16, 0.95]
    ]) sceneTree(group, x, z, s);

    // A sagging string of bulbs between the trees.
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        sceneBulb(group, -24 + 48 * t, 10 - 2.4 * Math.sin(Math.PI * t), 10, 0xffd9a0);
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

function buildTerrace(group) {
    const planks = scenePlankTexture('#8a6a49', '#6b4f34', 16);
    const deck = sceneMat(0xffffff, { roughness: 0.8 });
    deck.map = planks;
    deck.userData.ownMap = true;
    sceneGround(group, 260, 200, deck, 0);

    sceneBox(group, 90, 3, 1, sceneMat(0xd9d2c7, { roughness: 0.9 }), 0, 1.5, 26);
    for (const x of [-24, 24]) sceneBox(group, 6, 2.4, 3, sceneMat(0x6f6a60), x, 1.2, 20);
    sceneUplights(group);

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

    build(id) {
        this.clear();
        this.id = isScene(id) ? id : DEFAULT_SCENE;
        const make = SCENE_BUILDERS[this.id];
        this.settings = make ? make(this.group) : null;
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
