import * as THREE from 'three';

// The lighting element family: ONE universal fixture model with a type
// adaptor per event light - a PAR can (focused beam), an LED wash panel
// and a linear strip. Registered as three types (light-par, light-led,
// light-strip) so the panel renders each from its own schema, and mounted
// on ANY model's anchors through the def's `elements` list - the anchor
// contract (getAnchors) is what makes this system model-agnostic.
export const LIGHT_TYPES = ['light-par', 'light-led', 'light-strip'];
export const LIGHT_NAMES = {
    'light-par': 'PAR Light',
    'light-led': 'LED Wash',
    'light-strip': 'Strip Light'
};

// Params stay range/toggle so registry validation, the panel and the
// project clamps all keep their current contract. Hue + Saturation are the
// fixture's RGBW colour mixing as two sliders: Saturation 0 is plain white,
// low saturation with Hue ~40 is warm white, high saturation is amber/gold
// (hue 40) or deep purple (hue 280) - the palettes an entrance actually
// asks for. Defaults are the wedding look: warm white.
export const LIGHT_PARAMS = {
    par: {
        power: { label: 'Power',  type: 'range', min: 0,    max: 100, step: 1,   value: 100, unit: '%' },
        pan:   { label: 'Pan',    type: 'range', min: -180, max: 180, step: 1,   value: 0,   unit: '°' },
        tilt:  { label: 'Tilt',   type: 'range', min: -90,  max: 90,  step: 1,   value: 45,  unit: '°' },
        focus: { label: 'Focus',  type: 'range', min: 10,   max: 60,  step: 1,   value: 30,  unit: '°' },
        hue:   { label: 'Hue',    type: 'range', min: 0,    max: 360, step: 1,   value: 40,  unit: '°' },
        sat:   { label: 'Saturation', type: 'range', min: 0, max: 100, step: 1,  value: 35,  unit: '%' }
    },
    led: {
        power: { label: 'Power',  type: 'range', min: 0,    max: 100, step: 1,   value: 100, unit: '%' },
        pan:   { label: 'Pan',    type: 'range', min: -180, max: 180, step: 1,   value: 0,   unit: '°' },
        tilt:  { label: 'Tilt',   type: 'range', min: -90,  max: 90,  step: 1,   value: 55,  unit: '°' },
        wash:  { label: 'Spread', type: 'range', min: 20,   max: 120, step: 1,   value: 70,  unit: '°' },
        hue:   { label: 'Hue',    type: 'range', min: 0,    max: 360, step: 1,   value: 40,  unit: '°' },
        sat:   { label: 'Saturation', type: 'range', min: 0, max: 100, step: 1,  value: 35,  unit: '%' }
    },
    strip: {
        power:  { label: 'Power',  type: 'range', min: 0,  max: 100, step: 1,   value: 100, unit: '%' },
        length: { label: 'Length', type: 'range', min: 1,  max: 12,  step: 0.5, value: 6,   unit: ' ft' },
        hue:    { label: 'Hue',    type: 'range', min: 0, max: 360, step: 1,   value: 40,  unit: '°' },
        sat:    { label: 'Saturation', type: 'range', min: 0, max: 100, step: 1, value: 35, unit: '%' }
    }
};

const LIGHT_THEME = {
    light: { env: 0.5, glow: 1.0 },
    dark:  { env: 0.2, glow: 1.8 }
};
const LIGHT_DEG = Math.PI / 180;
// One real spotlight per PAR/LED fixture, never more, never shadowed:
// the scene's own rig owns shadows and the bounded count keeps a stage
// full of fixtures harmless. The strip is emissive only.
const SPOT_BASE = { par: 2.2, led: 1.4 };

// The visible beam: not a solid cone, but light in haze. The shader fades
// the surface out at the silhouette (fresnel) and toward the mouth, so the
// cone has no hard edge - it reads as a glow around the real spotlight.
function createBeamMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0xffeecf) },
            uOpacity: { value: 0.15 },
            uLen: { value: 1 }
        },
        vertexShader: `
            uniform float uLen;
            varying float vT;
            varying vec3 vN, vV;
            void main() {
                vT = clamp(position.y / uLen, 0.0, 1.0);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vT;
            varying vec3 vN, vV;
            void main() {
                float fres = abs(dot(normalize(vN), normalize(vV)));
                float edge = pow(fres, 1.8);
                float axial = smoothstep(0.0, 0.12, vT) * (1.0 - 0.8 * vT);
                gl_FragColor = vec4(uColor, uOpacity * edge * axial);
            }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
}

export function createLightModel(type = 'light-par', initial = {}) {
    const kind = LIGHT_TYPES.includes(type) ? type.slice(6) : 'par';
    const regType = 'light-' + kind;
    const params = LIGHT_PARAMS[kind];

    const root = new THREE.Group();
    root.name = regType;

    const state = {};
    for (const k of Object.keys(params)) state[k] = params[k].value;
    Object.assign(state, initial);

    const matHousing = new THREE.MeshStandardMaterial({
        color: 0x141418, metalness: 0.65, roughness: 0.45
    });
    const matYoke = new THREE.MeshStandardMaterial({
        color: 0x2a2a30, metalness: 0.7, roughness: 0.4
    });
    const matLens = new THREE.MeshStandardMaterial({
        color: 0x0c0c10, emissive: 0xfff4e2, emissiveIntensity: 1,
        roughness: 0.3, metalness: 0
    });
    const matBeam = createBeamMaterial();

    let spot = null;
    let beam = null;
    let themeNow = 'light';

    const power01 = () => Math.max(0, Math.min(100, state.power)) / 100;

    // The fixture's own colour, from its two mixing sliders. Saturation 0 is
    // white; otherwise lightness eases down as saturation climbs so a deep
    // amber or purple still reads as light. The SAME tint colours the lens,
    // the visible beam and the real spotlight - what you see is what glows.
    function tintColor() {
        const s01 = Math.max(0, Math.min(100, state.sat)) / 100;
        const h = ((Number(state.hue) % 360) + 360) % 360;
        const l = 0.92 - 0.34 * s01;
        return new THREE.Color().setHSL(h / 360, s01, l, THREE.SRGBColorSpace);
    }

    function applyGlow() {
        const tint = tintColor();
        matLens.emissive.copy(tint);
        matBeam.uniforms.uColor.value.copy(tint);
        if (spot) spot.color.copy(tint);
        matLens.emissiveIntensity = power01() * LIGHT_THEME[themeNow].glow;
        if (spot) spot.intensity = power01() * SPOT_BASE[kind];
        if (beam) {
            beam.visible = power01() > 0;
            matBeam.uniforms.uOpacity.value = power01() * 0.14;
        }
    }

    // Shared yoke: two clevis arms and a bridge the head pivots between.
    // The head aims along -Z; tilt 0 is horizontal, +90 is straight down,
    // -90 straight up (floor uplights).
    function buildYoke() {
        const panG = new THREE.Group();
        panG.position.y = 0.2;
        panG.rotation.y = state.pan * LIGHT_DEG;
        for (const s of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.07), matYoke);
            arm.position.set(s * 0.17, 0.17, 0);
            panG.add(arm);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.375, 0.035, 0.07), matYoke);
        bridge.position.y = 0.357;
        panG.add(bridge);

        const tiltG = new THREE.Group();
        tiltG.position.y = 0.17;
        tiltG.rotation.x = -state.tilt * LIGHT_DEG;
        panG.add(tiltG);
        return { panG, tiltG };
    }

    // The real light: one SpotLight, no shadow, decay 0 so the dimmer
    // reads predictably at any throw distance. The 12 ft cutoff fades the
    // beam out just past the 8 ft curtain top - no spill onto guests or
    // scenery beyond the wall the fixture was aimed at.
    function addSpot(tiltG, halfAngleRad) {
        spot = new THREE.SpotLight(0xfff2dd, 0, 12, halfAngleRad, 0.35, 0);
        spot.position.set(0, 0, -0.2);
        spot.castShadow = false;
        const target = new THREE.Object3D();
        target.position.set(0, 0, -4);
        spot.target = target;
        tiltG.add(spot, target);
    }

    function clearRoot() {
        for (const o of [...root.children]) {
            o.traverse(c => { if (c.isMesh) c.geometry.dispose(); });
            root.remove(o);
        }
        spot = null;
        beam = null;
    }

    function build() {
        clearRoot();

        // Universal mount: flange + spigot at the anchor point. The app
        // decides where that is (pole top, rail, floor plate); the fixture
        // only knows its own local frame, +Y up, aiming along -Z.
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(0.13, 0.15, 0.04, 16), matHousing);
        flange.position.y = 0.02;
        const spigot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), matHousing);
        spigot.position.y = 0.12;
        root.add(flange, spigot);

        if (kind === 'strip') {
            // Linear tube hanging below the mount; emissive face on the
            // underside. No pan/tilt - its orientation comes from the rail.
            const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), matHousing);
            stem.position.y = -0.07;
            const len = state.length;
            const tube = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.12), matHousing);
            tube.position.y = -0.2;
            const face = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.035, 0.07), matLens);
            face.position.y = -0.262;
            root.add(stem, tube, face);
        } else if (kind === 'par') {
            const { panG, tiltG } = buildYoke();
            root.add(panG);
            // The can: cylinder turned so its axis runs along Z, flared
            // end (the lens) forward at -Z.
            const can = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.36, 24), matHousing);
            can.rotation.x = Math.PI / 2;
            tiltG.add(can);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 24), matYoke);
            ring.position.z = -0.185;
            tiltG.add(ring);
            const face = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), matLens);
            face.position.z = -0.184;
            face.rotation.y = Math.PI;
            tiltG.add(face);

            addSpot(tiltG, (state.focus / 2) * LIGHT_DEG);

            // Visible beam cone: tip at the lens, mouth toward the aim,
            // radius grown to the focus angle over a 6.5 ft throw - it tops
            // out just under the 8 ft curtain rail instead of poking out.
            const len = 6.5;
            const r = Math.tan((state.focus / 2) * LIGHT_DEG) * len;
            const geo = new THREE.CylinderGeometry(r, 0.001, len, 24, 1, true);
            geo.translate(0, len / 2, 0);
            matBeam.uniforms.uLen.value = len;
            beam = new THREE.Mesh(geo, matBeam);
            beam.rotation.x = -Math.PI / 2;
            beam.position.z = -0.19;
            tiltG.add(beam);
        } else { // led: flat wash panel on the same yoke
            const { panG, tiltG } = buildYoke();
            root.add(panG);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.46, 0.07), matHousing);
            tiltG.add(panel);
            const dotGeo = new THREE.PlaneGeometry(0.08, 0.08);
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++) {
                    const dot = new THREE.Mesh(dotGeo, matLens);
                    dot.position.set(-0.24 + c * 0.12, 0.14 - r * 0.14, -0.037);
                    dot.rotation.y = Math.PI;
                    tiltG.add(dot);
                }
            }
            addSpot(tiltG, (state.wash / 2) * LIGHT_DEG);
        }

        applyGlow();
        model.dirty = false;
    }

    function setTheme(isDark) {
        themeNow = isDark ? 'dark' : 'light';
        const t = LIGHT_THEME[themeNow];
        matHousing.envMapIntensity = t.env;
        matYoke.envMapIntensity = t.env;
        matLens.envMapIntensity = t.env;
        applyGlow();
    }

    function dispose() {
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        root.clear();
        spot = null;
        beam = null;
        [matHousing, matYoke, matLens, matBeam].forEach(m => m.dispose());
    }

    const model = {
        id: regType,
        name: LIGHT_NAMES[regType],
        subtitle: 'Stage light',
        object3D: root,
        params,
        state,
        dirty: true,
        build,
        setTheme,
        setParams(partial) {
            Object.assign(state, partial);
            model.dirty = true;
        },
        dispose
    };

    build();
    return model;
}
