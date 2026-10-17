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

// ---- the neon-flex strip assembly --------------------------------------
// One S-curve route in, three pieces out - an aluminium U-channel, the
// rounded neon flex seated inside it, and an optional soft halo. Every
// piece is swept from the SAME resampled path with an EXPLICIT upright
// frame (world-up transported into each binormal), never a Frenet frame:
// the channel always opens skyward, the cross-section never twists or
// pinches, and the neon sits a fixed height above the channel rim, so
// gaps, buried sections and drifting halves are impossible by
// construction. All dimensions in feet.
export const STRIP_PROFILE = {
    channel: { w: 0.15, h: 0.045, t: 0.016 },  // low-profile U-channel
    neon: { w: 0.1, h: 0.066, r: 0.028 },       // rounded neon flex
    glow: { r: 0.072 }                          // halo, just past the corners
};

// The channel's closed outline in the (side, up) plane: floor, two walls,
// two lips folded inward - an extruded mounting profile, not a hose.
export function channelOutline() {
    const { w, h, t } = STRIP_PROFILE.channel;
    const w2 = w / 2;
    return [
        [-w2, 0], [w2, 0], [w2, h], [w2 - t, h],
        [w2 - t, t], [-(w2 - t), t], [-(w2 - t), h], [-w2, h]
    ];
}

// The neon flex: a rounded rectangle seated on the channel floor - flat
// bottom, generous corner radius, its top rising clear above the rim.
export function neonOutline() {
    const { w, h, r } = STRIP_PROFILE.neon;
    const t0 = STRIP_PROFILE.channel.t;
    const w2 = w / 2;
    const u0 = t0, u1 = t0 + h;
    const seg = 6;
    const pts = [];
    const arc = (cx, cy, a0, a1) => {
        for (let i = 0; i <= seg; i++) {
            const a = a0 + (a1 - a0) * (i / seg);
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
    };
    // Counter-clockwise: bottom-left arc, bottom-right, top-right,
    // top-left. The straight edges fall out as the chords between
    // consecutive arcs - bottom, right, top, left.
    arc(-(w2 - r), u0 + r, Math.PI, Math.PI * 1.5);
    arc(w2 - r, u0 + r, Math.PI * 1.5, Math.PI * 2);
    arc(w2 - r, u1 - r, 0, Math.PI / 2);
    arc(-(w2 - r), u1 - r, Math.PI / 2, Math.PI);
    return pts;
}

// Resample the route and carry world-up through every binormal: T along
// the path, U as upright as the slope allows, S = T x U across. Returns
// the evenly spaced samples and their frames.
export function stripFrames(pathPts) {
    const pts = pathPts.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const N = Math.min(360, Math.max(144, pts.length * 16));
    const samples = curve.getSpacedPoints(N);
    const frames = [];
    for (let i = 0; i < samples.length; i++) {
        const prev = samples[Math.max(0, i - 1)];
        const next = samples[Math.min(samples.length - 1, i + 1)];
        const T = next.clone().sub(prev);
        if (T.lengthSq() < 1e-12) T.set(1, 0, 0);
        T.normalize();
        // Up projected off the tangent - never flips while the path stays
        // short of vertical.
        const U = new THREE.Vector3(0, 1, 0)
            .addScaledVector(T, -T.y);
        if (U.lengthSq() < 1e-12) U.set(0, 0, 1);
        U.normalize();
        const S = new THREE.Vector3().crossVectors(T, U).normalize();
        frames.push({ p: samples[i], T, S, U });
    }
    return { samples, frames };
}

// Sweep a closed 2D outline along the frames. `flat` shades each quad
// with its own face normal (crisp extruded metal); smooth mode carries
// the outline's own 2D outward normals (rounded flex). Caps close both
// ends so there are no abrupt open tips.
export function sweepOutline(outline, frames, opts = {}) {
    const flat = opts.flat === true;
    const caps = opts.caps !== false;
    const m = outline.length;
    // Outward normals per outline vertex (CCW polygon: edge normal =
    // (dy, -dx)); duplicated corners would sharpen - none needed here.
    const onrm = outline.map((p, k) => {
        const q = outline[(k + 1) % m];
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const r = Math.hypot(dx, dy) || 1;
        return [dy / r, -dx / r];
    });
    const verts = [];
    const nrms = [];
    const push = (v, n) => {
        verts.push(v.x, v.y, v.z);
        nrms.push(n.x, n.y, n.z);
    };
    const at = (f, o) => new THREE.Vector3()
        .copy(f.p)
        .addScaledVector(f.S, o[0])
        .addScaledVector(f.U, o[1]);
    for (let i = 0; i < frames.length - 1; i++) {
        const fa = frames[i], fb = frames[i + 1];
        for (let k = 0; k < m; k++) {
            const k2 = (k + 1) % m;
            const a = at(fa, outline[k]);
            const b = at(fa, outline[k2]);
            const c = at(fb, outline[k2]);
            const d = at(fb, outline[k]);
            if (flat) {
                const n = new THREE.Vector3().crossVectors(
                    new THREE.Vector3().subVectors(d, a),
                    new THREE.Vector3().subVectors(b, a)).normalize();
                push(a, n); push(d, n); push(c, n);
                push(a, n); push(c, n); push(b, n);
            } else {
                const na = new THREE.Vector3()
                    .addScaledVector(fa.S, onrm[k][0])
                    .addScaledVector(fa.U, onrm[k][1]).normalize();
                const nb = new THREE.Vector3()
                    .addScaledVector(fa.S, onrm[k2][0])
                    .addScaledVector(fa.U, onrm[k2][1]).normalize();
                const n2 = new THREE.Vector3()
                    .addScaledVector(fb.S, onrm[k2][0])
                    .addScaledVector(fb.U, onrm[k2][1]).normalize();
                const n2a = new THREE.Vector3()
                    .addScaledVector(fb.S, onrm[k][0])
                    .addScaledVector(fb.U, onrm[k][1]).normalize();
                push(a, na); push(d, n2a); push(c, n2);
                push(a, na); push(c, n2); push(b, nb);
            }
        }
    }
    if (caps && frames.length > 1) {
        const contour = outline.map(p => new THREE.Vector2(p[0], p[1]));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        const capsSpec = [
            { f: frames[0], flip: false },       // start: outward = -T
            { f: frames[frames.length - 1], flip: true }  // end: outward = +T
        ];
        for (const { f, flip } of capsSpec) {
            const n = flip ? f.T.clone() : f.T.clone().negate();
            const ring = outline.map(o => at(f, o));
            for (const tri of tris) {
                const order = flip ? [tri[0], tri[2], tri[1]]
                    : [tri[0], tri[1], tri[2]];
                for (const idx of order) push(ring[idx], n);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
        new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrms, 3));
    return geo;
}

// The whole assembly from one route: frames, channel, neon, halo.
export function stripAssembly(pathPts) {
    const { frames } = stripFrames(pathPts);
    const glowCircle = (() => {
        const r = STRIP_PROFILE.glow.r;
        const cu = STRIP_PROFILE.channel.t + STRIP_PROFILE.neon.h / 2;
        const out = [];
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            out.push([Math.cos(a) * r, cu + Math.sin(a) * r]);
        }
        return out;
    })();
    return {
        frames,
        channel: sweepOutline(channelOutline(), frames,
            { flat: true, caps: true }),
        neon: sweepOutline(neonOutline(), frames,
            { flat: false, caps: true }),
        glow: sweepOutline(glowCircle, frames,
            { flat: false, caps: false })
    };
}


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
    // The glow is a SEPARATE, optional shell around the physical neon -
    // additive and faint, so bloom never hides the profile's real shape.
    const matGlow = new THREE.MeshBasicMaterial({
        color: 0xfff4e2, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const matBeam = createBeamMaterial();

    let spot = null;
    let beam = null;
    // A real neon strip throws light onto whatever it grazes - the fabric
    // behind it, the stage under it. A few short-range points strung along
    // the tube fakes that throw without a wall of lights: three on a rail
    // strip, two on a straight one, all gated by the same power slider and
    // tinted by the same colour as the flex.
    let wash = [];
    const WASH_DIST = 9;
    const WASH_LUX = 9;   // per point, at full power
    let themeNow = 'light';
    // A strip on a stripline anchor rides its frame's own curve - the rail
    // serpentine or the hem - handed over in the fixture's local space by
    // the app on every re-place. null means a straight tube of `length`.
    let pathPts = null;
    let pathKey = '';

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
        matGlow.color.copy(tint);
        matBeam.uniforms.uColor.value.copy(tint);
        if (spot) spot.color.copy(tint);
        matLens.emissiveIntensity = power01() * LIGHT_THEME[themeNow].glow;
        matGlow.opacity = power01() * (themeNow === 'dark' ? 0.22 : 0.14);
        for (const l of wash) {
            l.color.copy(tint);
            l.intensity = power01() * WASH_LUX;
        }
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
        wash = [];
    }

    // String the wash points along the tube: local positions in, point
    // lights out - dim and short-throw, so neighbours only ever catch a
    // grazing spill like real flex does.
    function buildWash(points) {
        for (const p of points) {
            const l = new THREE.PointLight(0xffffff, 0, WASH_DIST, 2);
            l.position.set(p.x, p.y, p.z);
            root.add(l);
            wash.push(l);
        }
    }

    function build() {
        clearRoot();

        // A strip riding the frame's own curve IS its mounting assembly:
        // the extruded channel replaces the floor flange and spigot
        // entirely. Everything else keeps the universal anchor mount -
        // flange + spigot at the anchor point (pole top, rail, floor
        // plate); the fixture only knows its own local frame, +Y up,
        // aiming along -Z.
        const onRail = kind === 'strip' && !!pathPts && pathPts.length >= 2;
        if (!onRail) {
            const flange = new THREE.Mesh(
                new THREE.CylinderGeometry(0.13, 0.15, 0.04, 16), matHousing);
            flange.position.y = 0.02;
            const spigot = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), matHousing);
            spigot.position.y = 0.12;
            root.add(flange, spigot);
        }

        if (kind === 'strip') {
            if (onRail) {
                // The full neon-flex assembly, continuous end to end from
                // the one S-curve route: low-profile U-channel, rounded
                // emissive flex seated inside and rising clear of the rim,
                // faint halo shell - all swept on the same upright frames.
                const asm = stripAssembly(pathPts);
                const channel = new THREE.Mesh(asm.channel, matHousing);
                const neon = new THREE.Mesh(asm.neon, matLens);
                const glow = new THREE.Mesh(asm.glow, matGlow);
                glow.renderOrder = 1;
                root.add(channel, neon, glow);
                // The throw: points at the third, middle and two-thirds
                // marks of the route, riding the same frames as the flex.
                const last = asm.frames.length - 1;
                buildWash([0.18, 0.5, 0.82]
                    .map(t => asm.frames[Math.round(last * t)].p));
            } else {
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
                buildWash([{ x: -len * 0.28, y: -0.25, z: 0 },
                    { x: len * 0.28, y: -0.25, z: 0 }]);
            }
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
        [matHousing, matYoke, matLens, matBeam, matGlow].forEach(m => m.dispose());
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
        // The frame's rail (or hem) polyline for this strip, in the
        // fixture's own local space. Rebuilds at once when it changes so
        // a Swing Pan drag redraws the tube in the same frame, not the
        // next one.
        setPath(pts) {
            const next = Array.isArray(pts) && pts.length >= 2 ? pts : null;
            const key = next
                ? next.map(p => `${p.x},${p.y},${p.z}`).join(';') : '';
            if (key === pathKey) return false;
            pathKey = key;
            pathPts = next;
            build();
            return true;
        },
        dispose
    };

    build();
    return model;
}
