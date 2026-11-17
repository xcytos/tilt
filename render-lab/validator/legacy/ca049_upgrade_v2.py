# ca049_upgrade_v2.py -- CORRECTED luxury upgrade for ballroom_scene.blend
# Ground truth: ballroom.js (4 tables, 32 chairs, 1 chandelier), FT axis (x,-z,y).
# First attempt hid chairs/rig wrongly; this runs on a REGENERATED pristine blend.
# Usage: blender --background --factory-startup --python ca049_upgrade_v2.py -- <blend>
import bpy, math, os, sys
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BLEND = argv[0] if argv else r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
ROOT = r"C:\Users\syedm\Downloads\tools\TILT\render-lab"
FT = 0.3048
FLOOR_Z = -1.2 * FT                    # main floor top (ballroom.js chair legs bottom)
CEIL_TOP = (24.0 - 1.2 - 0.2) * FT     # original chain top: ceilY - 0.2 = 22.6 ft
CHAND_XY = (0.0, -4.0 * FT)            # three.js (0, 4 ft) -> blend (0, -1.2192)
CHAND_DROP_TARGET = 2.04               # m, uniform-scale drop so fixture hangs grandly
CHAIR_H_TARGET = 2.055 * FT            # stand-in total height 0.6263 m

def log(*a):
    print("UP2|", *a, flush=True)

def world_bbox(o):
    pts = [o.matrix_world @ __import__("mathutils").Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]

def join_parts(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return ob

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(BLEND))

# --- 0. verify regenerated pristine state -----------------------------------
cam = bpy.data.objects.get("cam_gui")
lens = cam.data.lens if cam and cam.data else None
log("cam_gui lens =", lens)
assert lens is not None and abs(lens - 30.0) < 0.01, "lens != 30; regenerate blend first"

objs = [o for o in bpy.data.objects if o.type == "MESH"]
cframes = [o for o in objs if o.name.lower().startswith("cframe")]
seats   = [o for o in objs if o.name.lower().startswith("seat")]
strands = [o for o in objs if o.name.lower().startswith("strand")]
bulbs   = [o for o in objs if o.name.lower().startswith("bulb")]
glasses = [o for o in objs if o.name.lower().startswith("glass")]
log("counts cframe=%d seat=%d strand=%d bulb=%d glass=%d"
    % (len(cframes), len(seats), len(strands), len(bulbs), len(glasses)))
assert (len(cframes), len(seats), len(strands), len(bulbs), len(glasses)) == (128, 64, 16, 10, 1), \
    "pristine counts mismatch -- blend is not the regenerated one"

def is_chand_gold(o):
    lo, hi = world_bbox(o)
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    cz = (lo[2] + hi[2]) / 2
    extx, exty = hi[0] - lo[0], hi[1] - lo[1]
    d = math.hypot(cx - CHAND_XY[0], cy - CHAND_XY[1])
    return d < 1.5 and cz > 3.5 and max(extx, exty) < 3.0

gold_chand = [o for o in objs if o.name.lower().startswith("gold") and is_chand_gold(o)]
log("chandelier gold parts:", [o.name for o in gold_chand])
assert len(gold_chand) == 3, "expected 3 chandelier gold parts (2 tori + chain), got %d" % len(gold_chand)

# --- 1. chair placements from ballroom.js math ------------------------------
sites = [(sx * 15.4, z) for sx in (-1, 1) for z in (-13.5, -22.5)]
placements = []
ci = 0
for t in sites:
    ci += 1                                     # table parts use ci, then increment
    for k in range(8):
        a = (k / 8) * 2 * math.pi
        cxK = t[0] + math.cos(a) * 3.7
        czK = t[1] + math.sin(a) * 3.7
        ry = math.atan2(-cxK, -czK) + ((((ci * 13) % 5) - 2) * 0.014)
        fx, fz = math.sin(ry), math.cos(ry)     # three.js local +Z front
        placements.append({"xy": (cxK * FT, -czK * FT), "front": (fx, -fz), "ci": ci})
        ci += 1
assert len(placements) == 32
log("chair placements ok, first=%s last=%s"
    % (tuple(round(v, 3) for v in placements[0]["xy"]),
       tuple(round(v, 3) for v in placements[-1]["xy"])))

# --- 2. luxury chair asset ---------------------------------------------------
parts = import_glb(os.path.join(ROOT, "assets", "chiavari_gold_chair.glb"))
log("chair glb parts:", len(parts))
V = []
for p in parts:
    mw = np.array(p.matrix_world.to_3x3())
    tr = np.array(p.matrix_world.translation)
    v = np.array([vv.co[:] for vv in p.data.vertices]) @ mw + tr
    V.append(v)
V = np.vstack(V)
zmin, zmax = V[:, 2].min(), V[:, 2].max()
bcxy = np.array([(V[:, 0].min() + V[:, 0].max()) / 2, (V[:, 1].min() + V[:, 1].max()) / 2])
tall = V[V[:, 2] > zmin + 0.55 * (zmax - zmin)]
Bxy = tall[:, :2].mean(axis=0)
back = Bxy - bcxy
if np.linalg.norm(back) < 0.01:
    F = np.array([0.0, -1.0]); log("WARN backrest ambiguous, fallback front=(0,-1)")
else:
    F = -back / np.linalg.norm(back)
log("raw chair height=%.4f front=(%.3f,%.3f)" % (zmax - zmin, F[0], F[1]))

ch = join_parts(parts, "lux_chair_00")
lo, hi = world_bbox(ch)
raw_h = hi[2] - lo[2]
chair_s = CHAIR_H_TARGET / raw_h
ch.scale = (chair_s, chair_s, chair_s)
cb = ch.bound_box
chair_zmin = min(c[2] for c in cb)
log("chair scale=%.4f (raw_h=%.4f) zmin_local=%.4f" % (chair_s, raw_h, chair_zmin))

# --- 3. place 32 chairs ------------------------------------------------------
for i, p in enumerate(placements):
    ob = ch if i == 0 else ch.copy()
    if i > 0:
        bpy.context.scene.collection.objects.link(ob)
        ob.name = "lux_chair_%03d" % i
    D = np.array(p["front"]); D = D / np.linalg.norm(D)
    rz = math.atan2(D[1], D[0]) - math.atan2(F[1], F[0])
    ob.rotation_euler = (0.0, 0.0, rz)
    ob.scale = (chair_s, chair_s, chair_s)
    ob.location = (p["xy"][0], p["xy"][1], FLOOR_Z - chair_s * chair_zmin)
log("placed 32 chairs")

# --- 4. luxury chandelier asset ---------------------------------------------
cparts = import_glb(os.path.join(ROOT, "assets", "chandelier.glb"))
log("chandelier glb parts:", len(cparts))
chand = join_parts(cparts, "lux_chandelier")
clo, chi = world_bbox(chand)
drop = chi[2] - clo[2]
chand_s = CHAND_DROP_TARGET / drop
chand.scale = (chand_s, chand_s, chand_s)
kb = chand.bound_box
kzmax = max(c[2] for c in kb)
chand.location = (CHAND_XY[0], CHAND_XY[1], CEIL_TOP - chand_s * kzmax)
chand.rotation_euler = (0.0, 0.0, 0.0)
log("chandelier scale=%.3f drop=%.3f loc=%s"
    % (chand_s, drop, tuple(round(v, 3) for v in chand.location)))

# --- 5. hide old stand-ins ---------------------------------------------------
hide_list = cframes + seats + strands + bulbs + glasses + gold_chand
assert len(hide_list) == 128 + 64 + 16 + 10 + 1 + 3
for o in hide_list:
    o.hide_render = True
    o.hide_viewport = True
log("hid %d stand-in parts (chairs+cframe, chandelier)" % len(hide_list))

# --- 6. save -----------------------------------------------------------------
bpy.ops.wm.save_mainfile(filepath=os.path.abspath(BLEND))
log("SAVED", BLEND)

# --- 7. verification dump ----------------------------------------------------
chairs_live = [o for o in bpy.data.objects if o.name.startswith("lux_chair") and not o.hide_render]
klo, khi = world_bbox(chand)
log("VERIFY lens=%s chairs_live=%d chand_bbox z=[%.2f,%.2f] xy=[%.2f,%.2f]"
    % (bpy.data.objects["cam_gui"].data.lens, len(chairs_live),
       klo[2], khi[2], (klo[0] + khi[0]) / 2, (klo[1] + khi[1]) / 2))
log("UPGRADE_V2_DONE")
