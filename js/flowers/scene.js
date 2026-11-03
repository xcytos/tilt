import * as THREE from 'three';
import { FlowerModel } from '../flowermodel.js';
import { FlowerEngine } from './flower-factory.js';
import { GreeneryEngine } from '../greenery/greenery-factory.js';

/* Flower Panel Studio — shared arrangement renderer.
   Builds a flower panel (foam backing slab + flower field + border layers + greenery)
   into a THREE.Group, in a PANEL-LOCAL frame: X = width, Y = height, Z = depth, with
   flower heads pointing +Z and the foam slab top face at z = 0.
   `scale` is world units per foot (the studio used 0.72; TILT uses 1.0); it threads
   through every model placement call and every piece of geometry so one code path
   serves any world scale.
   three r160 note: ColorManagement converts sRGB hex to the linear working space
   automatically, so the old r128 `.convertSRGBToLinear()` calls are dropped.
   Consumed by the TILT `flowerpanel` object (js/objects/flowerpanel.js). The studio's
   app.js can adopt this module later so both share a single assembly. */
export const FlowerScene = (function () {
  'use strict';
  const T = THREE;
  const model = FlowerModel;
  const engine = FlowerEngine;
  const greenEngine = GreeneryEngine;

  // Quality levels -> geometry detail factor (1 = full tessellation). These scale every
  // petal/leaf segment count down for weaker GPUs. 'medium' is the safe mobile default.
  const QUALITY_DETAIL = { high: 1, medium: 0.5, low: 0.33 };
  function detailFor(q) {
    const k = String(q || 'medium').toLowerCase();
    return QUALITY_DETAIL[k] != null ? QUALITY_DETAIL[k] : QUALITY_DETAIL.medium;
  }
  function normalizeQuality(q) {
    const k = String(q || 'medium').toLowerCase();
    return QUALITY_DETAIL[k] != null ? k : 'medium';
  }

  function hashSeed(str) {
    let h = 0; str = String(str);
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h || 1;
  }
  function seededRand(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // options: { scale = world units per foot (default 1), quality = 'high'|'medium'|'low'
  //           (default 'medium'), log(msg,data), warn(msg) }
  function create(options) {
    const opts = options || {};
    const scale = opts.scale != null ? opts.scale : 1;
    const log = opts.log || function () {};
    const warn = opts.warn || function () {};
    let quality = normalizeQuality(opts.quality);
    let detail = detailFor(quality);

    const group = new T.Group();
    let activeFlowerMeshes = [];
    let backingMesh = null;
    let borderFrameMeshes = {};
    let borderFlowerMeshes = {};
    let borderGreeneryMeshes = {};
    let greeneryMeshes = [];
    let greeneryGroup = null;

    function disposeMesh(m) {
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(mm => mm && mm.dispose && mm.dispose());
        else if (m.material.dispose) m.material.dispose();
      }
    }
    // Arrangements rebuild after the host mounted the panel, so the
    // shadow flags have to be set here too - the viewer's mount-time
    // sweep never sees these meshes.
    function addMesh(parent, m) {
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
    }
    function releaseFlowerMeshes() {
      if (activeFlowerMeshes.length) { try { engine.release(activeFlowerMeshes); } catch (e) { log('flower release failed', e); } activeFlowerMeshes = []; }
    }
    function releaseBacking() {
      if (backingMesh) { group.remove(backingMesh); disposeMesh(backingMesh); backingMesh = null; }
    }
    function releaseBorderFrames() {
      for (const id of Object.keys(borderFrameMeshes)) { const m = borderFrameMeshes[id]; if (m) { group.remove(m); disposeMesh(m); } }
      borderFrameMeshes = {};
    }
    function releaseFlowerBorder(id) {
      const arr = borderFlowerMeshes[id];
      if (arr && arr.length) { try { engine.release(arr); } catch (e) { log('flower border release failed', e); } delete borderFlowerMeshes[id]; }
    }
    function releaseAllFlowerBorders() { for (const id of Object.keys(borderFlowerMeshes)) releaseFlowerBorder(id); }
    function releaseGreeneryBorder(id) {
      const arr = borderGreeneryMeshes[id];
      if (arr && arr.length) { try { greenEngine.release(arr); } catch (e) { log('greenery border release failed', e); } delete borderGreeneryMeshes[id]; }
    }
    function releaseAllGreeneryBorders() { for (const id of Object.keys(borderGreeneryMeshes)) releaseGreeneryBorder(id); }
    function releaseGreenery() {
      if (greeneryMeshes.length) { try { greenEngine.release(greeneryMeshes); } catch (e) { log('greenery release failed', e); } greeneryMeshes = []; }
    }

    // Interior greenery, grouped per type so each model draws as one InstancedMesh.
    // The group stays at z=0; depth comes from each item's z (interleaves with flowers).
    function buildGreenery(s) {
      releaseGreenery();
      if (s.designMode === 'flowers') return { count: 0, triangles: 0, types: [] };
      if (!greeneryGroup) { greeneryGroup = new T.Group(); group.add(greeneryGroup); }
      greeneryGroup.position.z = 0;
      const inst = model.greeneryPositions(s, scale);
      if (!inst.length) return { count: 0, triangles: 0, types: [] };
      const byType = {};
      for (const p of inst) { (byType[p.type] = byType[p.type] || []).push(p); }
      const active = model.greeneryActiveItems(s.greenery);
      let count = 0, tri = 0; const types = [];
      for (const type of Object.keys(byType)) {
        const meta = model.GREENERY_META[type];
        const item = active.find(a => a.type === type) || { colorVariation: 0.3 };
        const res = greenEngine.build({
          type, items: byType[type],
          color: meta ? meta.color : '#4a7c3f',
          colorVariation: item.colorVariation != null ? item.colorVariation : 0.3,
          orientOutward: !!(meta && meta.orientOutward),
          orientAngle: (s.greenery && s.greenery.orientAngle != null) ? s.greenery.orientAngle : 90,
          detail,
          showLeaves: item.showLeaves !== false
        });
        for (let i = 0; i < res.meshes.length; i++) addMesh(greeneryGroup, res.meshes[i]);
        greeneryMeshes = greeneryMeshes.concat(res.meshes);
        count += res.instances; tri += res.triangles; types.push(type);
      }
      return { count, triangles: tri, types };
    }

    // Frame border layer: an extruded ring between its outerInset and innerInset bands.
    function buildFrame(s, layer, band) {
      if (!layer || !layer.enabled || !band) return;
      const W = s.width * scale, H = s.height * scale;
      const outerHW = W / 2 - band.outerInsetFt * scale, outerHH = H / 2 - band.outerInsetFt * scale;
      const innerHW = W / 2 - band.innerInsetFt * scale, innerHH = H / 2 - band.innerInsetFt * scale;
      if (innerHW <= 0.01 || innerHH <= 0.01) return;
      const depth = (layer.depth / 12) * scale;
      const outer = new T.Shape();
      outer.moveTo(-outerHW, -outerHH); outer.lineTo(outerHW, -outerHH); outer.lineTo(outerHW, outerHH); outer.lineTo(-outerHW, outerHH); outer.closePath();
      const hole = new T.Path();
      hole.moveTo(-innerHW, -innerHH); hole.lineTo(innerHW, -innerHH); hole.lineTo(innerHW, innerHH); hole.lineTo(-innerHW, innerHH); hole.closePath();
      outer.holes.push(hole);
      const geo = new T.ExtrudeGeometry(outer, { depth, bevelEnabled: false });
      const mat = new T.MeshStandardMaterial({ color: new T.Color(layer.color), roughness: 0.55, metalness: 0.08 });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.z = 0.006 * scale; // just above foam top (z=0) to avoid z-fighting
      mesh.userData.layerId = layer.id;
      addMesh(group, mesh);
      borderFrameMeshes[layer.id] = mesh;
    }

    // One flower border layer: hex grid clipped to its band, per-flower rotation + colours.
    function buildOneFlowerBorder(s, layer, mainHexes) {
      if (!layer || !layer.enabled || layer.type !== 'flower') return { count: 0, triangles: 0 };
      const pos = model.borderPositions(s, layer.id, scale);
      if (!pos.length) return { count: 0, triangles: 0 };
      const palHex = model.borderEffectivePalette(s, layer.id, mainHexes);
      const palette = palHex.map(h => new T.Color(h));
      const cIdx = model.borderColorIndices(pos.length, palHex.length, layer.arrangement, s.seed);
      const rotMax = (layer.rotation || 0) * Math.PI / 180;
      const lh = hashSeed(layer.id);
      const lift = model.flowerProjection(s, scale);
      const flowers = pos.map((xy, j) => {
        const r = seededRand((s.seed + 10007 * lh + j * 2654435761) >>> 0);
        const seed = 100000 + j + lh * 977;
        return {
          x: xy[0], y: xy[1], seed, colorIndex: cIdx[j] || 0,
          spin: rotMax ? (r() * 2 - 1) * rotMax : 0,
          z: lift > 0 ? lift * model.projectionJitter(seed) : 0
        };
      });
      const S = (layer.flowerSize / 12) * scale;
      const result = engine.build({ type: layer.flowerType, flowers, colors: palette, S, detail, leaves: s.flowerLeaves });
      borderFlowerMeshes[layer.id] = result.meshes;
      for (let i = 0; i < result.meshes.length; i++) addMesh(group, result.meshes[i]);
      return { count: flowers.length, triangles: result.triangles };
    }

    // One greenery border layer: a band of leaves clipped to its ring (fans outward).
    function buildGreeneryBorder(s, layer) {
      if (!layer || !layer.enabled || layer.type !== 'greenery') return { count: 0, triangles: 0 };
      const inst = model.greeneryBorderPositions(s, layer.id, scale);
      if (!inst.length) return { count: 0, triangles: 0 };
      const meta = model.GREENERY_META[layer.species];
      const res = greenEngine.build({
        type: layer.species, items: inst,
        color: meta ? meta.color : '#4a7c3f',
        colorVariation: layer.colorVariation != null ? layer.colorVariation : 0.3,
        detail
      });
      borderGreeneryMeshes[layer.id] = res.meshes;
      for (let i = 0; i < res.meshes.length; i++) addMesh(group, res.meshes[i]);
      return { count: res.instances, triangles: res.triangles };
    }

    // Rebuild the whole arrangement into `group`. Returns build stats (no camera fit,
    // status text or diagnostics side effects — those stay in the host app/object).
    function build(settings) {
      releaseFlowerMeshes(); releaseBacking(); releaseBorderFrames();
      releaseAllFlowerBorders(); releaseAllGreeneryBorders(); releaseGreenery();

      const s = settings;
      const W = s.width * scale, H = s.height * scale;
      const foamDepth = (2 / 12) * scale;
      const showFlowers = s.designMode !== 'greenery';

      // Foam slab: a real shallow box whose top face sits at z=0, under the flower heads.
      backingMesh = new T.Mesh(
        new T.BoxGeometry(W, H, foamDepth),
        new T.MeshStandardMaterial({ color: new T.Color(0x245034), roughness: 1 })
      );
      backingMesh.position.z = -foamDepth / 2;
      addMesh(group, backingMesh);

      const allPositions = model.positions(s, scale);
      const counts = model.counts(s, allPositions.length);
      const assign = model.assignColors(s, allPositions);
      const colorIndex = assign.colorIndex;
      // Projection band: heads ride off the foam on green stems (per-flower z jitter).
      const lift = model.flowerProjection(s, scale);
      const flowers = allPositions.map((xy, i) => ({
        x: xy[0], y: xy[1], seed: i, colorIndex: colorIndex[i] || 0,
        z: lift > 0 ? lift * model.projectionJitter(i) : 0
      }));
      const palette = counts.map(c => new T.Color(c.hex));
      const S = (s.flowerSize / 12) * scale; // nominal head diameter, world units

      let result = { meshes: [], triangles: 0, petalsPerFlower: 0 };
      if (showFlowers) {
        result = engine.build({ type: s.flowerType, flowers, colors: palette, S, detail, leaves: s.flowerLeaves });
        activeFlowerMeshes = result.meshes;
        for (let i = 0; i < activeFlowerMeshes.length; i++) addMesh(group, activeFlowerMeshes[i]);
      }

      // Border layers (outside -> inside). Independent of Flowers/Greenery toggles:
      // each layer renders on its own `enabled` flag.
      const mainHexes = counts.map(c => c.hex);
      const bandsById = {};
      for (const bd of model.borderBands(s).bands) bandsById[bd.id] = bd;
      let borderFlowerTotal = 0, borderGreeneryTotal = 0, fbTriangles = 0, gbTriangles = 0, frameCount = 0;
      for (const layer of s.border.layers) {
        if (!layer.enabled) continue;
        if (layer.type === 'frame') { buildFrame(s, layer, bandsById[layer.id]); frameCount++; }
        else if (layer.type === 'greenery') { const res = buildGreeneryBorder(s, layer); borderGreeneryTotal += res.count; gbTriangles += res.triangles; }
        else if (layer.type === 'flower') { const res = buildOneFlowerBorder(s, layer, mainHexes); borderFlowerTotal += res.count; fbTriangles += res.triangles; }
      }

      const gre = buildGreenery(s);
      const totalFlowers = allPositions.length + borderFlowerTotal;
      const greeneryShown = gre.count + borderGreeneryTotal;
      const triangles = result.triangles + fbTriangles + gbTriangles + gre.triangles;

      return {
        designMode: s.designMode,
        widthFt: s.width, heightFt: s.height,
        flowers: showFlowers ? totalFlowers : 0,
        borderFlowers: borderFlowerTotal,
        borderGreenery: borderGreeneryTotal,
        greenery: gre.count,
        greeneryTypes: gre.types,
        petalsPerFlower: result.petalsPerFlower,
        quality,
        triangles, frames: frameCount
      };
    }

    // Swap the quality level. Returns true if it changed (caller should rebuild);
    // geometry caches are keyed per detail level so switching back is instant.
    function setQuality(q) {
      const next = normalizeQuality(q);
      if (next === quality) return false;
      quality = next;
      detail = detailFor(next);
      return true;
    }
    function getQuality() { return quality; }

    function dispose() {
      releaseFlowerMeshes(); releaseBacking(); releaseBorderFrames();
      releaseAllFlowerBorders(); releaseAllGreeneryBorders(); releaseGreenery();
      if (greeneryGroup) { group.remove(greeneryGroup); greeneryGroup = null; }
      while (group.children.length) group.remove(group.children[0]);
    }

    return { group, build, dispose, setQuality, getQuality };
  }

  return { create };
})();
