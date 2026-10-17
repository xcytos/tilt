import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SceneRig, DEFAULT_SCENE, isScene, computeStageSize, DEFAULT_STAGE_SIZE } from './scenes.js';

const FLOOR_SIZE = 200;
const GRID_CELLS = 100;

const THEME = {
    light: { bg: 0xf3f4f6, ambient: 0.8, key: 1.5, floorEnv: 0.1 },
    dark:  { bg: 0x18181b, ambient: 0.4, key: 2.0, floorEnv: 0.05 }
};

const FRAME_DIR = new THREE.Vector3(0, 4, -25).normalize();

// Breathing room between side-by-side models in "all at once" mode.
const OVERLAY_GAP = 2.5;

const FALLBACK_BOUNDS =
    new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 9, 6));

// Pure. Takes world spans ([minX, maxX]) measured with every model back at its
// base position and returns the X offset each one needs: packs them left to
// right with `gap` between neighbours, then shifts the whole row so its centre
// lands on the origin. A lone span comes back as a plain re-centring, so the
// single-model view keeps framing exactly as it did before overlay mode.
export function layoutOffsets(spans, gap = OVERLAY_GAP) {
    const offs = [];
    let cursor = 0;
    for (const span of spans) {
        const min = span[0], max = span[1];
        if (!(max > min)) { offs.push(0); continue; }
        offs.push(cursor - min);
        cursor += max - min + gap;
    }
    const back = -Math.max(0, cursor - gap) / 2;
    return offs.map(o => o + back);
}

// The grid is baked into the floor texture instead of drawn as separate lines.
// LineBasicMaterial cannot receive shadows, so standalone lines stayed bright
// inside a shadow and glared against the darkened floor.
function makeFloorTexture(base, line, anisotropy) {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.strokeRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(GRID_CELLS, GRID_CELLS);
    tex.anisotropy = anisotropy;
    return tex;
}

function failBoot(message) {
    if (window.__bootFail) clearTimeout(window.__bootFail);
    const box = document.getElementById('boot');
    const msg = document.getElementById('boot-msg');
    if (msg) msg.textContent = message;
    if (box) box.classList.add('failed');
}

// Fit `bounds` into the viewport along the fixed view bearing. Deriving the
// distance from the real bounds and the current aspect keeps the whole scene
// visible on portrait phones, where a fixed camera position crops it badly.
export function frameCamera(camera, controls, bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    const zAxis = FRAME_DIR.clone();
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const extent = v => Math.abs(v.x) * half.x + Math.abs(v.y) * half.y + Math.abs(v.z) * half.z;

    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = Math.max(extent(xAxis) / Math.tan(hHalf),
                          extent(yAxis) / Math.tan(vHalf))
               + extent(zAxis);

    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(FRAME_DIR, dist * 1.12);
    camera.updateProjectionMatrix();
    controls.update();
}

export class Viewer {
    constructor(container) {
        this.container = container;
        this.models = [];
        this.isDark = false;
        this.onFirstRender = null;
        this._booted = false;
        this._framedAspect = window.innerWidth / window.innerHeight;

        this.scene = new THREE.Scene();
        this._bgColor = new THREE.Color(THEME.light.bg);
        this.scene.background = this._bgColor;
        this.sceneId = null;

        this.camera = new THREE.PerspectiveCamera(
            45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 8, -25);

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch (err) {
            failBoot('WebGL is not available in this browser');
            throw err;
        }
        this.renderer = renderer;
        this.resize();
        this._framedAspect = this.camera.aspect;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // Image based lighting, otherwise metalness reads as flat black
        const pmrem = new THREE.PMREMGenerator(renderer);
        const roomEnv = new RoomEnvironment(renderer);
        this.scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
        roomEnv.dispose();
        pmrem.dispose();

        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 4, 0);
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(this.ambientLight);

        this.mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.mainLight.position.set(15, 25, -20);
        this.mainLight.castShadow = true;
        this.mainLight.shadow.mapSize.width = 2048;
        this.mainLight.shadow.mapSize.height = 2048;
        // Wide enough to cover a whole ballroom (walls at ±78 ft), tight
        // near/far for depth precision, bias so big flat walls don't acne.
        this.mainLight.shadow.camera.left = -56;
        this.mainLight.shadow.camera.right = 56;
        this.mainLight.shadow.camera.top = 56;
        this.mainLight.shadow.camera.bottom = -56;
        this.mainLight.shadow.camera.near = 2;
        this.mainLight.shadow.camera.far = 160;
        this.mainLight.shadow.normalBias = 0.06;
        this.mainLight.shadow.bias = -0.0004;
        this.scene.add(this.mainLight);

        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.fillLight.position.set(-15, 10, 20);
        this.scene.add(this.fillLight);

        const aniso = renderer.capabilities.getMaxAnisotropy();
        this.floorTex = {
            light: makeFloorTexture('#e5e7eb', '#c7ccd3', aniso),
            dark:  makeFloorTexture('#27272a', '#46464e', aniso)
        };
        this.matFloor = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 1, envMapIntensity: 0.1, map: this.floorTex.light
        });
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), this.matFloor);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.floor = floor;
        this.scene.add(floor);

        // The world around the models: ground, walls, sky and the extra
        // lights that make a room a room. The studio scene adds nothing and
        // keeps the grid floor above as it always was.
        this.rig = new SceneRig();
        this.scene.add(this.rig.group);
        this.setScene(DEFAULT_SCENE);

        // The canvas fills its container, not the window: on a phone the
        // control sheet takes the bottom of the screen and the render target
        // has to follow it. Window events still drive the reframe, since only
        // a real window change should re-aim the camera.
        this._onResize = () => {
            const aspect = this.resize();
            if (Math.abs(aspect - this._framedAspect) > this._framedAspect * 0.3) {
                this._framedAspect = aspect;
                this.frameScene();
            }
        };
        window.addEventListener('resize', this._onResize);

        this._watchBox = null;
        if (typeof ResizeObserver === 'function') {
            this._watchBox = new ResizeObserver(() => this.resize());
            this._watchBox.observe(container);
        }

        this._raf = 0;
        this._tick = () => {
            this._raf = requestAnimationFrame(this._tick);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);

            if (!this._booted) {
                this._booted = true;
                if (window.__bootFail) clearTimeout(window.__bootFail);
                const boot = document.getElementById('boot');
                if (boot) {
                    boot.classList.add('hidden');
                    setTimeout(() => boot.remove(), 500);
                }
                if (this.onFirstRender) this.onFirstRender();
            }
        };
    }

    // Mounting is decoupled from framing: overlay mode adds several models
    // and frames once, after layoutGroups has positioned them.
    addModel(model) {
        this.scene.add(model.object3D);
        this.models.push(model);
        if (model.setTheme) model.setTheme(this.isDark);
        return model;
    }

    removeModel(model) {
        const i = this.models.indexOf(model);
        if (i < 0) return false;
        this.models.splice(i, 1);
        this.scene.remove(model.object3D);
        if (model.dispose) model.dispose();
        return true;
    }

    clearModels() {
        while (this.models.length) this.removeModel(this.models[0]);
    }

    setTheme(isDark) {
        this.isDark = isDark;
        document.documentElement.classList.toggle('dark', isDark);
        this._setEnv();
        for (const m of this.models) if (m.setTheme) m.setTheme(isDark);
    }

    // The world the models stand in is sized by the models: every mesh's
    // world bounding box unions into one footprint, and the stage grows to
    // hold it (with aisles). Studio adds nothing - it has no stage.
    stageFootprint() {
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        let any = false;
        for (const m of this.models) {
            if (!m.object3D || !m.object3D.visible) continue;
            // Placements land on object3D between renders, so the cached
            // matrices can be a frame stale - refresh the chain first.
            m.object3D.updateWorldMatrix(true, true);
            tmp.setFromObject(m.object3D);
            if (tmp.isEmpty()) continue;
            box.union(tmp);
            any = true;
        }
        return any ? box : null;
    }

    // The size the current contents ask for. Quantized inside
    // computeStageSize, so tiny jitter never counts as a change.
    _stageSizeFor() {
        if (this.sceneId === 'studio') return null;
        const box = this.stageFootprint();
        return box ? computeStageSize({
            minX: box.min.x, maxX: box.max.x,
            minZ: box.min.z, maxZ: box.max.z
        }) : Object.assign({}, DEFAULT_STAGE_SIZE);
    }

    static _sizeKey(size) {
        return size ? `${size.w}x${size.d}/${size.wallX},${size.wallZ},${size.wallH}` : 'studio';
    }

    // Re-fit the room to whatever now stands on the stage - after a move,
    // an add, a SET switch or a load. Returns true when the room rebuilt.
    refreshStageSize() {
        if (this.sceneId === 'studio') return false;
        const size = this._stageSizeFor();
        if (Viewer._sizeKey(size) === this._stageKey) return false;
        this._stageKey = Viewer._sizeKey(size);
        this.rig.build(this.sceneId, size);
        this._setEnv();
        return true;
    }

    // Swap the world the models stand in. Unknown ids fall back to the
    // studio, so a hand-edited project can never leave an empty scene.
    setScene(id) {
        const next = isScene(id) ? id : DEFAULT_SCENE;
        if (next === this.sceneId) return next;
        this.sceneId = next;
        const size = next === 'studio' ? null : this._stageSizeFor();
        this._stageKey = Viewer._sizeKey(size);
        this.rig.build(next, size);
        this._setEnv();
        return next;
    }

    // Point the fixed lights, floor and background at whatever the current
    // scene asks for. Studio is driven by the light/dark toggle instead of a
    // scene definition, which is exactly the behaviour it had before scenes
    // existed.
    _setEnv() {
        const studio = this.sceneId === 'studio' || !this.rig.settings;
        this.floor.visible = studio;

        if (studio) {
            const t = this.isDark ? THEME.dark : THEME.light;
            // Studio keeps the exact response it always had.
            this.renderer.toneMapping = THREE.NoToneMapping;
            this.scene.background = this._bgColor.setHex(t.bg);
            this.scene.fog = null;
            this.matFloor.map = this.floorTex[this.isDark ? 'dark' : 'light'];
            this.matFloor.color.setHex(0xffffff);
            this.matFloor.roughness = 1;
            this.matFloor.envMapIntensity = t.floorEnv;
            this.ambientLight.color.setHex(0xffffff);
            this.ambientLight.intensity = t.ambient;
            this.mainLight.color.setHex(0xffffff);
            this.mainLight.intensity = t.key;
            this.fillLight.color.setHex(0xffffff);
            this.fillLight.intensity = 0.5;
            return;
        }

        const s = this.rig.settings;
        // Rooms clip without help: white walls plus a stack of lamps
        // flatten to paper. Filmic curve keeps the highlights honest -
        // sconces and downlights glow instead of blowing out.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.scene.background = s.background;
        this.scene.fog = s.fog ? new THREE.Fog(s.fog.color, s.fog.near, s.fog.far) : null;
        this.ambientLight.color.setHex(s.ambient.color);
        this.ambientLight.intensity = s.ambient.intensity;
        this.mainLight.color.setHex(s.key.color);
        this.mainLight.intensity = s.key.intensity;
        this.fillLight.color.setHex(s.fill.color);
        this.fillLight.intensity = s.fill.intensity;
    }

    // Match the camera and the drawing buffer to whatever box the canvas
    // currently occupies. Never reframes: the sheet opening and closing must
    // not throw the camera back to its default aim.
    resize() {
        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;
        if (!w || !h) return this.camera.aspect;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        return this.camera.aspect;
    }

    // World bounds of a set of models, before any overlay offset is applied.
    computeBoundsOf(models) {
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        for (const m of models) {
            if (!m.object3D) continue;
            tmp.setFromObject(m.object3D);
            if (!tmp.isEmpty()) box.union(tmp);
        }
        return box;
    }

    computeBounds() {
        const box = this.computeBoundsOf(this.models);
        if (box.isEmpty()) return FALLBACK_BOUNDS.clone();
        return box;
    }

    // `groups` is an array of model arrays (one per preset). Spacing is derived
    // from each group's own bounds so presets never overlap, and the row is
    // re-centred. Only X is touched: the floor stays a single shared stage.
    layoutGroups(groups, gap = OVERLAY_GAP) {
        for (const g of groups) {
            for (const m of g) {
                if (!m.object3D) continue;
                m.object3D.position.x -= m.layoutX || 0;
                m.layoutX = 0;
            }
        }
        const spans = groups.map(g => {
            const b = this.computeBoundsOf(g);
            return b.isEmpty() ? [0, 0] : [b.min.x, b.max.x];
        });
        const offs = layoutOffsets(spans, gap);
        groups.forEach((g, i) => {
            for (const m of g) {
                if (!m.object3D) continue;
                m.object3D.position.x += offs[i];
                m.layoutX = offs[i];
            }
        });
        return offs;
    }

    frameScene(bounds = this.computeBounds()) {
        frameCamera(this.camera, this.controls, bounds);
    }

    // Where the camera was left, as plain arrays so the value survives JSON.
    // Restored views must not fight damping, so setCameraState writes the
    // controls directly rather than animating.
    getCameraState() {
        const p = this.camera.position;
        const t = this.controls.target;
        return {
            position: [p.x, p.y, p.z],
            target: [t.x, t.y, t.z]
        };
    }

    setCameraState(state) {
        if (!state) return false;
        const set = (vec, values) => {
            if (!Array.isArray(values) || values.length !== 3) return false;
            if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) return false;
            vec.set(values[0], values[1], values[2]);
            return true;
        };
        const moved = set(this.camera.position, state.position);
        const aimed = set(this.controls.target, state.target);
        if (moved || aimed) {
            this.camera.updateProjectionMatrix();
            this.controls.update();
        }
        return moved || aimed;
    }

    // A 480px JPEG of the current frame, for the project list. The renderer
    // runs without preserveDrawingBuffer, so the canvas can only be read in
    // the same tick as a render - render here, then draw immediately.
    captureThumbnail(maxEdge = 480, quality = 0.72) {
        this.renderer.render(this.scene, this.camera);
        const source = this.renderer.domElement;
        const edge = Math.max(source.width, source.height) || 1;
        const scale = Math.min(1, maxEdge / edge);
        const w = Math.max(1, Math.round(source.width * scale));
        const h = Math.max(1, Math.round(source.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', quality);
    }

    start() {
        if (!this._raf) this._tick();
    }

    stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    }

    dispose() {
        this.stop();
        window.removeEventListener('resize', this._onResize);
        if (this._watchBox) this._watchBox.disconnect();
        this.clearModels();
        this.rig.dispose();
        this.scene.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        [this.matFloor].forEach(m => m.dispose());
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }
}
