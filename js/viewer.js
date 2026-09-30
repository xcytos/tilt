import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const FLOOR_SIZE = 200;
const GRID_CELLS = 100;

const THEME = {
    light: { bg: 0xf3f4f6, ambient: 0.8, key: 1.5, floorEnv: 0.1 },
    dark:  { bg: 0x18181b, ambient: 0.4, key: 2.0, floorEnv: 0.05 }
};

const FRAME_DIR = new THREE.Vector3(0, 4, -25).normalize();

const FALLBACK_BOUNDS =
    new THREE.Box3(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 9, 6));

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
        this.scene.background = new THREE.Color(THEME.light.bg);

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
        renderer.setSize(window.innerWidth, window.innerHeight);
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
        this.mainLight.shadow.camera.left = -20;
        this.mainLight.shadow.camera.right = 20;
        this.mainLight.shadow.camera.top = 20;
        this.mainLight.shadow.camera.bottom = -20;
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
        this.scene.add(floor);

        this._onResize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            // Ignore the URL bar showing/hiding; reframe on real aspect changes
            if (Math.abs(this.camera.aspect - this._framedAspect) > this._framedAspect * 0.3) {
                this._framedAspect = this.camera.aspect;
                this.frameScene();
            }
        };
        window.addEventListener('resize', this._onResize);

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

    addModel(model) {
        this.scene.add(model.object3D);
        this.models.push(model);
        if (model.setTheme) model.setTheme(this.isDark);
        this.frameScene();
        return model;
    }

    removeModel(model) {
        const i = this.models.indexOf(model);
        if (i < 0) return false;
        this.models.splice(i, 1);
        this.scene.remove(model.object3D);
        if (model.dispose) model.dispose();
        this.frameScene();
        return true;
    }

    clearModels() {
        while (this.models.length) this.removeModel(this.models[0]);
    }

    setTheme(isDark) {
        this.isDark = isDark;
        const t = isDark ? THEME.dark : THEME.light;

        document.documentElement.classList.toggle('dark', isDark);
        this.scene.background.setHex(t.bg);
        this.matFloor.map = this.floorTex[isDark ? 'dark' : 'light'];
        this.matFloor.envMapIntensity = t.floorEnv;
        this.ambientLight.intensity = t.ambient;
        this.mainLight.intensity = t.key;

        for (const m of this.models) if (m.setTheme) m.setTheme(isDark);
    }

    computeBounds() {
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        for (const m of this.models) {
            if (!m.object3D) continue;
            tmp.setFromObject(m.object3D);
            if (!tmp.isEmpty()) box.union(tmp);
        }
        if (box.isEmpty()) return FALLBACK_BOUNDS.clone();
        return box;
    }

    frameScene(bounds = this.computeBounds()) {
        frameCamera(this.camera, this.controls, bounds);
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
        this.clearModels();
        this.scene.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        [this.matFloor].forEach(m => m.dispose());
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
    }
}
