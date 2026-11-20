import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SceneRig, DEFAULT_SCENE, isScene, computeStageSize, DEFAULT_STAGE_SIZE } from './scenes.js';

const FLOOR_SIZE = 200;
const GRID_CELLS = 100;

const THEME = {
    light: { bg: 0xf3f4f6, ambient: 0.8, key: 1.5, floorEnv: 0.1 },
    dark:  { bg: 0x18181b, ambient: 0.4, key: 2.0, floorEnv: 0.05 }
};

// One device-level contract for the render controls the Look shelf exposes.
// The old quality key is still read once so existing sessions keep their
// choice; new writes go to the versioned object.
const RENDER_PREFS_KEY = 'tilt-render-prefs-v1';
const LEGACY_QUALITY_KEY = 'tilt-render-quality';
const DEFAULT_RENDER_PREFS = Object.freeze({
    quality: 'standard',
    shadows: true,
    shadowBox: false
});

function readRenderPrefs() {
    const prefs = { ...DEFAULT_RENDER_PREFS };
    try {
        if (typeof localStorage === 'undefined') return prefs;
        const raw = localStorage.getItem(RENDER_PREFS_KEY);
        if (raw) {
            const saved = JSON.parse(raw);
            if (saved && typeof saved === 'object') {
                if (saved.quality === 'standard' || saved.quality === 'cinematic') {
                    prefs.quality = saved.quality;
                }
                if (saved.shadows === true || saved.shadows === false) {
                    prefs.shadows = saved.shadows;
                }
                if (saved.shadowBox === true || saved.shadowBox === false) {
                    prefs.shadowBox = saved.shadowBox;
                }
            }
        } else {
            const legacy = localStorage.getItem(LEGACY_QUALITY_KEY);
            if (legacy === 'standard' || legacy === 'cinematic') {
                prefs.quality = legacy;
            }
        }
    } catch (e) { /* storage can be denied; the defaults stand */ }
    return prefs;
}

function writeRenderPrefs(patch) {
    const next = { ...readRenderPrefs(), ...patch };
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(RENDER_PREFS_KEY, JSON.stringify(next));
            // Keep the old key in step for bundles opened before this change.
            localStorage.setItem(LEGACY_QUALITY_KEY, next.quality);
        }
    } catch (e) { /* storage can be denied; the session still works */ }
}

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

        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 0.08;
        this._pickModels = new Map();
        this._selectionRoot = null;
        this.outlinePass = null;

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
        const savedRenderPrefs = readRenderPrefs();
        this.resize();
        this._framedAspect = this.camera.aspect;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = savedRenderPrefs.shadows;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // Render quality. "standard" is the baseline WebGL2 look;
        // "cinematic" renders through an MSAA composer with bloom and
        // doubles the key light's shadow resolution. The choice is a UI
        // toggle (Look shelf) - the composer itself is built lazily the
        // first time cinematic is picked, so standard never pays for it.
        // Selection also needs a composer for OutlinePass; that reuses the
        // same chain with bloom switched off.
        this.quality = 'standard';

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
        // Wide enough to cover the biggest room the stage-size formula
        // builds (walls at +-80 ft), tight near/far for depth precision,
        // bias so big flat walls don't acne at the coarser texels.
        this.mainLight.shadow.camera.left = -80;
        this.mainLight.shadow.camera.right = 80;
        this.mainLight.shadow.camera.top = 80;
        this.mainLight.shadow.camera.bottom = -80;
        this.mainLight.shadow.camera.near = 2;
        this.mainLight.shadow.camera.far = 200;
        this.mainLight.shadow.normalBias = 0.1;
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

        // Re-apply saved render preferences once camera, lights and scene
        // all exist - the cinematic lane touches the key light's shadow and
        // mounts the composer, neither of which is valid any earlier. Boot
        // restore never writes back: storage is only touched by a user edit.
        this.setQuality(savedRenderPrefs.quality, false);
        this.setShadowsEnabled(savedRenderPrefs.shadows, false);
        this.setShadowBoxVisible(savedRenderPrefs.shadowBox, false);

        this._raf = 0;
        this._tick = () => {
            this._raf = requestAnimationFrame(this._tick);
            this.controls.update();
            const outlining = !!(this.outlinePass
                && this.outlinePass.selectedObjects.length);
            if (this._composer
                && (this.quality === 'cinematic' || outlining)) {
                this._composer.render();
                // Camera may have moved: RenderPass binds this camera each
                // frame anyway, so no extra bookkeeping is needed.
            } else {
                this.renderer.render(this.scene, this.camera);
            }

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
        // Every mounted model lives in the key light's shadow the same way
        // the room does: cast and receive, unless the mesh opts out. Light
        // fixtures, flower panels and greenery never set the flags in
        // their own builders, so they used to float shadowless on stage.
        model.object3D.traverse((o) => {
            if (!(o.isMesh || o.isInstancedMesh)) return;
            if (o.userData && o.userData.noShadow) return;
            o.castShadow = true;
            o.receiveShadow = true;
        });
        this.models.push(model);
        this._pickModels.set(model.object3D, model);
        if (model.setTheme) model.setTheme(this.isDark);
        return model;
    }

    removeModel(model) {
        const i = this.models.indexOf(model);
        if (i < 0) return false;
        this.models.splice(i, 1);
        this._pickModels.delete(model.object3D);
        if (this._selectionRoot === model.object3D
            || (this.outlinePass
                && this.outlinePass.selectedObjects.includes(model.object3D))) {
            this.clearSelection();
        }
        this.scene.remove(model.object3D);
        if (model.dispose) model.dispose();
        return true;
    }

    clearModels() {
        while (this.models.length) this.removeModel(this.models[0]);
    }

    _modelForObject(object) {
        let o = object;
        while (o) {
            const model = this._pickModels.get(o);
            if (model) return model;
            o = o.parent;
        }
        return null;
    }

    _pickableObject(object) {
        let o = object;
        while (o) {
            if (o.userData && (o.userData.noFraming || o.userData.noPick)) {
                return false;
            }
            o = o.parent;
        }
        return true;
    }

    pickAt(clientX, clientY, tolerance = 18) {
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;

        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1);
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(ndc, this.camera);

        const roots = this._pickRoots();
        const hits = this.raycaster.intersectObjects(roots, true);
        for (const hit of hits) {
            const model = this._modelForObject(hit.object);
            if (model && model.object3D.visible && this._pickableObject(hit.object)) {
                return { model, object: hit.object, point: hit.point };
            }
        }

        return this._pickAround(ndc, rect, tolerance);
    }

    _pickRoots() {
        const roots = [];
        for (const model of this.models) {
            if (model.object3D && model.object3D.visible) roots.push(model.object3D);
        }
        return roots;
    }

    _pickAround(ndc, rect, tolerance) {
        const roots = this._pickRoots();
        if (!roots.length || !(tolerance > 0)) return null;
        const step = Math.max(4, tolerance / 3);
        for (let radius = step; radius <= tolerance + 0.01; radius += step) {
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const x = (ndc.x * 0.5 + 0.5) * rect.width
                    + Math.cos(angle) * radius;
                const y = (-ndc.y * 0.5 + 0.5) * rect.height
                    + Math.sin(angle) * radius;
                const sample = new THREE.Vector2(
                    (x / rect.width) * 2 - 1,
                    -((y / rect.height) * 2 - 1));
                this.raycaster.setFromCamera(sample, this.camera);
                const hits = this.raycaster.intersectObjects(roots, true);
                for (const hit of hits) {
                    const model = this._modelForObject(hit.object);
                    if (model && model.object3D.visible
                        && this._pickableObject(hit.object)) {
                        return { model, object: hit.object, point: hit.point };
                    }
                }
            }
        }
        return null;
    }

    setSelection(roots) {
        const list = (Array.isArray(roots) ? roots : [roots])
            .filter(Boolean);
        if (list.length && !this._composer) this._buildComposer();
        this._selectionRoot = list[0] || null;
        if (this.outlinePass) this.outlinePass.selectedObjects = list;
    }

    clearSelection() {
        this._selectionRoot = null;
        if (this.outlinePass) this.outlinePass.selectedObjects = [];
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
            if (this._shadowBox) this._shadowBox.visible = false;
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

    // Shadow debugging for the Look shelf. "Shadows sometimes vanish" is
    // almost never the renderer - it is furniture stepped outside the key
    // light's ortho box, so the counts below separate the two cases.
    shadowInfo() {
        const L = this.mainLight;
        const cam = L.shadow.camera;
        const dir = new THREE.Vector3()
            .subVectors(L.target.position, L.position).normalize();
        const seed = Math.abs(dir.y) > 0.99
            ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(seed, dir).normalize();
        const up = new THREE.Vector3().crossVectors(dir, right).normalize();
        let meshes = 0, casters = 0, receivers = 0, outside = 0;
        const p = new THREE.Vector3();
        this.scene.traverse((o) => {
            if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return;
            meshes++;
            if (o.castShadow) casters++;
            if (o.receiveShadow) receivers++;
            o.getWorldPosition(p).sub(L.position);
            const x = p.dot(right), y = p.dot(up), z = p.dot(dir);
            if (Math.abs(x) > cam.right + 1 || Math.abs(y) > cam.top + 1
                || z < cam.near || z > cam.far) outside++;
        });
        return {
            enabled: this.renderer.shadowMap.enabled,
            boxVisible: !!(this._shadowBox && this._shadowBox.visible),
            meshes, casters, receivers, outside,
            box: `${Math.round(cam.right - cam.left)}x`
                + `${Math.round(cam.top - cam.bottom)}x`
                + `${Math.round(cam.far - cam.near)}`
        };
    }

    // Toggling shadowMap.enabled needs every material recompiled, or the
    // old lighting programs keep running with stale defines.
    setShadowsEnabled(on, persist = true) {
        const next = !!on;
        this.renderer.shadowMap.enabled = next;
        this.scene.traverse((o) => {
            if (!(o.isMesh || o.isInstancedMesh)) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (m) m.needsUpdate = true;
        });
        if (persist) writeRenderPrefs({ shadows: next });
        return next;
    }

    // Wireframe of the key light's shadow frustum, so a camera orbit
    // shows exactly which tables sit inside the box and which do not.
    setShadowBoxVisible(on, persist = true) {
        if (on && !this._shadowBox) {
            const L = this.mainLight;
            const cam = L.shadow.camera;
            const dir = new THREE.Vector3()
                .subVectors(L.target.position, L.position).normalize();
            const seed = Math.abs(dir.y) > 0.99
                ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(seed, dir).normalize();
            const up = new THREE.Vector3().crossVectors(dir, right).normalize();
            const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(
                cam.right - cam.left, cam.top - cam.bottom, cam.far - cam.near));
            const box = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
                color: 0x38bdf8, transparent: true, opacity: 0.85, depthTest: false
            }));
            box.renderOrder = 999;
            box.quaternion.setFromRotationMatrix(
                new THREE.Matrix4().makeBasis(right, up, dir));
            box.position.copy(L.position)
                .addScaledVector(dir, cam.near + (cam.far - cam.near) / 2);
            this._shadowBox = box;
            this.scene.add(box);
        }
        if (this._shadowBox) this._shadowBox.visible = !!on;
        if (persist) writeRenderPrefs({ shadowBox: !!on });
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
        if (this._composer) {
            this._composer.setSize(w, h);
            this._composer.setPixelRatio(this.renderer.getPixelRatio());
        }
        return this.camera.aspect;
    }

    // "Look shelf" quality switch. Builds the cinematic chain on first use:
    // scenes render into a 4x-MSAA half-float target, UnrealBloom lifts
    // emissive lamps above the threshold, OutputPass re-applies this
    // renderer's tone mapping so rooms and the studio keep their looks.
    setQuality(q, persist = true) {
        const next = q === 'cinematic' ? 'cinematic' : 'standard';
        if (this.quality === next) return next;
        this.quality = next;
        if (next === 'cinematic') {
            if (!this._composer) this._buildComposer();
            if (this._bloom) this._bloom.enabled = true;
            // Deeper shadows only pay off under bloom, where the tone
            // curve judges them; swap the ortho shadow's memory accordingly.
            this.mainLight.shadow.mapSize.set(4096, 4096);
        } else {
            if (this._bloom) this._bloom.enabled = false;
            this.mainLight.shadow.mapSize.set(2048, 2048);
        }
        if (this.mainLight.shadow.map) {
            this.mainLight.shadow.map.dispose();
            this.mainLight.shadow.map = null;
        }
        if (persist) writeRenderPrefs({ quality: next });
        return next;
    }

    _buildComposer() {
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const ratio = this.renderer.getPixelRatio();
        // WebGL2 gives the target real MSAA; HalfFloat keeps bloom's
        // thresholds working above 1.0 like the emissives actually read.
        const target = new THREE.WebGLRenderTarget(
            size.x * ratio, size.y * ratio,
            { samples: 4, type: THREE.HalfFloatType });
        this._composer = new EffectComposer(this.renderer, target);
        this._composer.setPixelRatio(ratio);
        this._composer.setSize(size.x, size.y);
        this._composer.addPass(new RenderPass(this.scene, this.camera));
        this._bloom = new UnrealBloomPass(size, 0.32, 0.55, 0.85);
        this._bloom.enabled = this.quality === 'cinematic';
        this._composer.addPass(this._bloom);
        this.outlinePass = new OutlinePass(
            new THREE.Vector2(1, 1), this.scene, this.camera);
        this.outlinePass.edgeStrength = 3.5;
        this.outlinePass.edgeGlow = 0;
        this.outlinePass.edgeThickness = 1;
        this.outlinePass.pulsePeriod = 0;
        this.outlinePass.visibleEdgeColor.set(0x38bdf8);
        this.outlinePass.hiddenEdgeColor.set(0x0284c7);
        this._composer.addPass(this.outlinePass);
        this._composer.addPass(new OutputPass());
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
        this.clearSelection();
        this.clearModels();
        if (this._composer) this._composer.dispose();
        this.rig.dispose();
        this.scene.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        [this.matFloor].forEach(m => m.dispose());
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }
}
