import * as THREE from 'three';

// O1 in the inventory printed on every board: the fixed classical column the
// curtain frames are staged against. Stands on the model ground at y = 0 like
// everything else, so a set can drop it straight into a layout slot.
export const PILLAR_ID = 'pillar';
export const PILLAR_NAME = 'Classical Pillar';
export const PILLAR_SUBTITLE = 'Set component';

export const PILLAR_PARAMS = {
    height:   { label: 'Height',   type: 'range', min: 4, max: 16, step: 0.5, value: 9, unit: ' ft' },
    diameter: { label: 'Diameter', type: 'range', min: 0.8, max: 3, step: 0.1, value: 1.4, unit: ' ft' },
    capital:  { label: 'Capital',  type: 'toggle', value: true },
    plinth:   { label: 'Plinth Base', type: 'toggle', value: true },
    flutes:   { label: 'Fluted Shaft', type: 'toggle', value: true, advanced: true }
};

// The pillar has no preset file of its own - a set asks for it by name, so
// its definition travels with the model instead of with models/.
export const PILLAR_DEF = {
    id: PILLAR_ID,
    name: PILLAR_NAME,
    objects: [{ type: PILLAR_ID, params: {}, elements: [] }]
};

const PILLAR_THEME = {
    light: { stone: 0xf3f0ea, env: 0.35 },
    dark:  { stone: 0xd6d2c8, env: 0.18 }
};

export function createPillarModel(initial = {}) {
    const root = new THREE.Group();
    root.name = PILLAR_ID;

    const state = {};
    for (const k of Object.keys(PILLAR_PARAMS)) state[k] = PILLAR_PARAMS[k].value;
    Object.assign(state, initial);

    const stone = new THREE.MeshStandardMaterial({
        color: PILLAR_THEME.light.stone, roughness: 0.65, metalness: 0
    });

    function build() {
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        root.clear();

        const d = state.diameter;
        const h = state.height;
        stone.flatShading = !!state.flutes;
        stone.needsUpdate = true;

        let y = 0;
        if (state.plinth) {
            const ph = Math.min(0.6, h * 0.07);
            const plinth = new THREE.Mesh(new THREE.BoxGeometry(d * 1.5, ph, d * 1.5), stone);
            plinth.position.y = ph / 2;
            root.add(plinth);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(d * 0.5, d * 0.1, 8, 24), stone);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = ph + d * 0.04;
            root.add(ring);
            y = ph + d * 0.08;
        }

        const capH = state.capital ? Math.min(0.9, h * 0.1) : 0;
        const shaftH = Math.max(1, h - y - capH);
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(d / 2, d / 2 * 1.08, shaftH, state.flutes ? 20 : 32, 1),
            stone);
        shaft.position.y = y + shaftH / 2;
        root.add(shaft);

        if (state.capital) {
            const neck = new THREE.Mesh(new THREE.TorusGeometry(d * 0.52, d * 0.07, 8, 24), stone);
            neck.rotation.x = Math.PI / 2;
            neck.position.y = y + shaftH + d * 0.04;
            root.add(neck);
            const cap = new THREE.Mesh(
                new THREE.BoxGeometry(d * 1.4, capH * 0.55, d * 1.4), stone);
            cap.position.y = y + shaftH + capH * 0.28;
            root.add(cap);
            const abacus = new THREE.Mesh(
                new THREE.BoxGeometry(d * 1.55, capH * 0.25, d * 1.55), stone);
            abacus.position.y = y + shaftH + capH * 0.68;
            root.add(abacus);
        }

        for (const m of root.children) {
            if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        }
        model.dirty = false;
    }

    function setTheme(isDark) {
        const t = isDark ? PILLAR_THEME.dark : PILLAR_THEME.light;
        stone.color.setHex(t.stone);
        stone.envMapIntensity = t.env;
    }

    function dispose() {
        root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        root.clear();
        stone.dispose();
    }

    const model = {
        id: PILLAR_ID,
        name: PILLAR_NAME,
        subtitle: PILLAR_SUBTITLE,
        object3D: root,
        params: PILLAR_PARAMS,
        state,
        dirty: true,
        build,
        setTheme,
        setParams(partial) { Object.assign(state, partial); model.dirty = true; },
        dispose
    };

    build();
    return model;
}
