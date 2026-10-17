import * as THREE from 'three';
import { FlowerModel } from '../flowermodel.js';
import { FlowerScene } from '../flowers/scene.js';

// A flower panel authored in the Studio and dropped into the scene as a
// floor-standing object. The arrangement itself is deep nested settings (colours,
// border layers, greenery) authored in the Studio, so it is NOT stored in `params`
// (which validateDef keeps to range/toggle knobs). It is injected via
// setParams({ settings }) / setSettings() and, at rest, lives in a dedicated
// top-level field of the project doc (see Phase 5).
export const FLOWERPANEL_ID = 'flowerpanel';
export const FLOWERPANEL_NAME = 'Flower Panel';
export const FLOWERPANEL_SUBTITLE = 'Arrangement';

// No auto-renderable knobs: the TILT panel only places and shows the panel; the
// arrangement is edited in the Studio. Empty schema keeps the persisted params
// object clean.
export const FLOWERPANEL_PARAMS = {};

// World units per foot. The panel is authored in feet and built 1:1 (the studio
// used a 0.72 world scale; TILT uses full scale).
const FT = 1;

export function createFlowerPanelModel(initial = {}) {
    const root = new THREE.Group();
    root.name = FLOWERPANEL_ID;

    // Inner group carries the panel's own orientation and lift; the framework owns
    // root's placement transform (position + rotation.y from the scene placement).
    const panel = new THREE.Group();
    // Flowers are built pointing +Z; turn the whole panel so they face -Z, toward
    // the camera at (0, 8, -25). Users spin it further via the placement's ry.
    panel.rotation.y = Math.PI;
    root.add(panel);

    const scene = FlowerScene.create({ scale: FT, quality: initial.quality });
    panel.add(scene.group);

    const state = {
        settings: FlowerModel.normalize(initial.settings || {}),
        arrangementId: initial.arrangementId || null,
        quality: scene.getQuality()
    };

    function build() {
        const s = state.settings;
        scene.build(s);
        // Stand the panel on the floor. Its vertical centre sits at y = 0 in the
        // panel-local frame, so lift by half the height (feet == world units, FT=1).
        panel.position.y = (s.height * FT) / 2;
        model.dirty = false;
    }

    // Flowers keep their authored colours; the light/dark theme does not recolour
    // the arrangement (unlike the stone/fabric of the pillar and S-curve).
    function setTheme() {}

    function dispose() {
        scene.dispose();
        root.clear();
    }

    const model = {
        id: FLOWERPANEL_ID,
        name: FLOWERPANEL_NAME,
        subtitle: FLOWERPANEL_SUBTITLE,
        object3D: root,
        params: FLOWERPANEL_PARAMS,
        state,
        dirty: true,
        build,
        setTheme,
        setParams(partial) {
            if (partial && partial.settings) {
                state.settings = FlowerModel.normalize(partial.settings);
            }
            if (partial && 'arrangementId' in partial) {
                state.arrangementId = partial.arrangementId;
            }
            model.dirty = true;
        },
        getSettings() { return state.settings; },
        setSettings(settings) {
            state.settings = FlowerModel.normalize(settings);
            model.dirty = true;
        },
        // Quality is scene-global (the host passes the same level to every panel).
        // Marks dirty only when the level actually changes, so a rebuild follows.
        setQuality(q) {
            if (scene.setQuality(q)) {
                state.quality = scene.getQuality();
                model.dirty = true;
                return true;
            }
            return false;
        },
        getQuality() { return scene.getQuality(); },
        dispose
    };

    build();
    return model;
}
