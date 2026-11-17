# Blender 5.x headless: photoreal BALLROOM + S-Curve render lane.
# Usage: blender --background --factory-startup --python render_ballroom.py -- <obj> <outdir> <preset|all>
# Materials/lamps/mood are the faithful port of TILT js/scenes.js buildBallroom (P-006).

import bpy
import bmesh
import json
import math
import os
import re
import sys
import time
import mathutils
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OBJ = os.path.abspath(argv[0])
OUTDIR = os.path.abspath(argv[1])
PRESET = argv[2] if len(argv) > 2 else "all"
DATA = os.path.abspath(argv[3]) if len(argv) > 3 else os.path.join(os.path.dirname(OBJ), "ballroom_data.json")

FT = 0.3048
os.makedirs(OUTDIR, exist_ok=True)
with open(DATA, "r", encoding="utf8") as f:
    BD = json.load(f)
MOOD = BD["mood"]

# stage size from the export (single source of truth: ballroom.js
# computeStageSize) - rows, furniture, mats, strips and cameras key off
# it so a recalc'd stage stays internally coherent.
SIZE = BD.get("size") or {"w": 44, "d": 18, "h": 1.2, "wallX": 30,
                          "wallZ": 17, "wallH": 24}
ROWZ_FT = (-(SIZE["d"] / 2 + 5.25), -(SIZE["d"] / 2 + 14.25))
XCOL_FT = min(SIZE["wallX"] - 8, SIZE["w"] * 0.35)
SKIRT_X = SIZE["w"] / 2 * FT
SKIRT_Y = SIZE["d"] / 2 * FT

# ---------- import ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=OBJ)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.shade_smooth()

for o in meshes:
    o.scale = (FT, FT, FT)
    o.select_set(True)
bpy.ops.object.transform_apply(scale=True)

mins = [min((o.location[c] + o.bound_box[v][c] for o in meshes for v in range(8)), key=abs) for c in range(3)]
dims = {o.name: o.dimensions for o in meshes if o.dimensions.length > 0.1}
big = sorted(dims.items(), key=lambda kv: -kv[1].length)[:12]
print("DEBUG largest meshes (m):", [(k, [round(x, 2) for x in tuple(v)]) for k, v in big])

def hexc(h):
    v = int(h, 16)
    return ((v >> 16 & 255) / 255.0, (v >> 8 & 255) / 255.0, (v & 255) / 255.0)

def principled(name, rgb, rough=0.85, metal=0.0, sheen=0.0,
               sheen_rough=None, sheen_tint=None,
               emission_rgb=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
        if sheen_rough is not None:
            b.inputs["Sheen Roughness"].default_value = sheen_rough
        if sheen_tint is not None:
            b.inputs["Sheen Tint"].default_value = (*sheen_tint, 1.0)
    if emission_rgb is not None:
        b.inputs["Emission Color"].default_value = (*emission_rgb, 1.0)
        b.inputs["Emission Strength"].default_value = emission_strength
    return m

def emission(name, rgb, strength, base_rgb=None, base_rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1.0)
    em.inputs["Strength"].default_value = strength
    if base_rgb:
        mix = nt.nodes.new("ShaderNodeMixShader")
        pr = principled(name + "_b", base_rgb, base_rough, 0.0)
        pb = pr.node_tree.nodes["Principled BSDF"]
        mix.inputs[0].default_value = 0.5
        nt.links.new(pb.outputs["BSDF"], mix.inputs[1])
        nt.links.new(em.outputs["Emission"], mix.inputs[2])
        nt.links.new(mix.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    else:
        nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    return m

MATSET = {
    # rig
    "d4af37": principled("gold_rail", hexc("d4af37"), 0.22, 1.0),
    "ffffff": principled("cloth", hexc("c7ad85"), 0.32, 0.0, sheen=0.6,
                         sheen_rough=0.25, sheen_tint=(1.0, 0.97, 0.92)),
    "9ca3af": principled("pole", hexc("9ca3af"), 0.35, 1.0),
    "374151": principled("base", hexc("374151"), 0.5, 0.8),
    "6b7280": principled("joint", hexc("6b7280"), 0.4, 0.9),
    # ballroom
    "floor": principled("floor", hexc("cbb694"), 0.62),
    "wall": principled("wall", hexc("efe6d6"), 0.92),
    "skirt": principled("skirt", hexc("f3ead9"), 0.85),
    "carpet": principled("carpet", hexc("b98a56"), 0.96),
    "cream": principled("cream", hexc("f7f1e4"), 0.93),
    "gold": principled("gold", hexc("d9b45c"), 0.3, 0.90),
    "parquetBorder": principled("parquetBorder", hexc("5a4028"), 0.6),
    "parquet": principled("parquet", hexc("b5894f"), 0.55),
    "pilaster": principled("pilaster", hexc("f3ecdc"), 0.70),
    "trim": principled("trim", hexc("e8dcc2"), 0.70),
    "panelIn": principled("panelIn", hexc("e6dcc6"), 0.85),
    "cloth": principled("cloth_tbl", hexc("f2ead8"), 0.95),
    "tableTop": principled("tableTop", hexc("f6f0e2"), 0.90),
    "goldRim": principled("goldRim", hexc("d9c48a"), 0.40, 0.55),
    "bloom": principled("bloom", hexc("7a1f2b"), 0.85,
                        emission_rgb=(1.0, 0.78, 0.52), emission_strength=22.0),
    "seat": principled("seat", hexc("6e5f4a"), 0.90),
    "cframe": principled("cframe", hexc("8f8574"), 0.40, 0.60),
    # emissive surfaces
    "cove": emission("cove", hexc("ffdfae"), 18.0, base_rgb=hexc("fff2d8")),
    "sconce": emission("sconce", hexc("ffe7bd"), 12.0, base_rgb=hexc("fff6e2")),
    "glass": emission("glass", hexc("ffe3ae"), 60.0, base_rgb=hexc("fff4dd")),
    "bulb": emission("bulb", hexc("ffe3ae"), 42.0, base_rgb=hexc("2b2b2b")),
    "strand": emission("strand", hexc("ffedc8"), 16.0, base_rgb=hexc("fff8ea")),
}

import re as _re

_fab_cache = {}
for o in meshes:
    base = o.name.lower().split('-')[0]
    # The client colorway names fabric meshes by their own 6-hex prefix
    # (e.g. "d4a9a0-3"): anything hex-shaped that is not one of the fixed
    # materials gets a full sheen cloth material in that actual colour,
    # so every palette the user picks stays the colour they picked.
    if _re.fullmatch(r'[0-9a-f]{6}', base) and base not in MATSET:
        if base not in _fab_cache:
            _fab_cache[base] = principled("cloth_" + base, hexc(base), 0.32, 0.0,
                                          sheen=0.6, sheen_rough=0.25)
        o.data.materials.clear()
        o.data.materials.append(_fab_cache[base])
        continue
    key = None
    for k in MATSET:
        if o.name.lower().startswith(k):
            key = k
            break
    if key is None:
        key = "wall"
        o.name = "wall_" + o.name
    o.data.materials.clear()
    o.data.materials.append(MATSET[key])

# ---------- world ----------
world = bpy.data.worlds.new("ballroom")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (*hexc("%x" % MOOD["background"]), 1.0)
bg.inputs[1].default_value = 0.12
bpy.context.scene.world = world

# ---------- lights: codebase exact lamps ----------
# OBJ import lands three.js (x, y, z) feet at blender (x, -z, y) meters, so
# every authored three-Z below is negated on entry (P-018 geometry audit).
for i, L in enumerate(BD["lamps"]):
    d = bpy.data.lights.new("lamp%d" % i, type="POINT")
    d.energy = L["watts"] * 6.0
    d.color = hexc("%x" % L["color"])
    d.shadow_soft_size = 0.3
    o = bpy.data.objects.new("lamp%d" % i, d)
    o.location = (L["x"] * FT, -L["z"] * FT, L["y"] * FT)
    bpy.context.collection.objects.link(o)

def add_area_light(name, loc_ft, target_ft, size_ft, watts, rgbhex):
    d = bpy.data.lights.new(name, type="AREA")
    d.shape = "SQUARE"
    d.size = size_ft * FT * 2
    d.energy = watts
    d.color = hexc(rgbhex)
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    x, y, z = (loc_ft[0] * FT, -loc_ft[2] * FT, loc_ft[1] * FT)
    o.location = (x, y, z)
    tx, ty, tz = (target_ft[0] * FT, -target_ft[2] * FT, target_ft[1] * FT)
    di = mathutils.Vector((tx - x, ty - y, tz - z))
    o.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
    return o

# mood key/fill from buildBallroom return (warm cream/gold接过) + portal bounce
add_area_light("key", (0, 0, 24), (0, 0, 0), 26, 1400, "%x" % MOOD["key"]["color"])
add_area_light("fillL", (-22, 0, -14), (0, 0, 0), 26, 320, "%x" % MOOD["fill"]["color"])
add_area_light("fillR", (22, 0, -14), (0, 0, 0), 26, 320, "%x" % MOOD["fill"]["color"])
add_area_light("bounceF", (0, 0, -30), (0, 2, 0), 30, 260, "%x" % MOOD["fill"]["color"])

# ---------- cameras ----------
# loc/look in FEET: (x, height, z-negative=front). Camera looks at the rig/room focus.
SHOTS = {
    "grand-wide":   {"loc": (-5.5, 5.2, -24.5), "look": (0, 7.5, 1), "lens": 30, "f": 6.3},
    "grand-front":  {"loc": (0, 5.5, -28), "look": (0, 7, 0), "lens": 38, "f": 6.3},
    "grand-threeQ": {"loc": (-9, 6.2, -22), "look": (0.5, 6.5, 1.5), "lens": 42, "f": 4.5},
    "grand-low":    {"loc": (0, 2.2, -21), "look": (0, 8.5, 1), "lens": 45, "f": 5.6},
    "grand-high":   {"loc": (2.5, 13.5, -27), "look": (0, 5.5, 0), "lens": 30, "f": 5.6},
    "grand-side":   {"loc": (-15.5, 5.8, -16), "look": (1, 6.8, 3.5), "lens": 40, "f": 4.5},
    "det-rail":     {"loc": (1.1, 5.6, -4.2), "look": (0.05, 6.15, 0.3), "lens": 85, "f": 2.8},
    "det-drape":    {"loc": (2.6, 4.4, -4.6), "look": (0.4, 4.5, 0.2), "lens": 85, "f": 2.8},
    "det-joint":    {"loc": (2.2, 3.0, -4.6), "look": (0.6, 3.4, 0.2), "lens": 85, "f": 2.8},
    "det-chand":    {"loc": (0, 5.5, -10), "look": (0, 14.4, 3.5), "lens": 45, "f": 5.6},
    "det-table":    {"loc": (7, 4.4, ROWZ_FT[1] + 5.0),
                     "look": (XCOL_FT, 3.0, ROWZ_FT[1]), "lens": 55, "f": 4.0},
    "det-mood":     {"loc": (11, 3.8, -14), "look": (-2, 4.6, 2), "lens": 55, "f": 4.5},
    "debug-top":    {"loc": (0, 55, -2), "look": (0, 0, -0.5), "lens": 24, "f": 11.0},
    "debug-front":  {"loc": (0, 9, -55), "look": (0, 8, 0), "lens": 35, "f": 11.0},
}
PRESETS = list(SHOTS) if PRESET == "all" else [PRESET]

# ---------- luxury upgrade (P-004) + wedding furniture (P-005) ----------
# Regeneration parity with the hand-upgraded blend: ballroom.js math for the
# 32 chiavari seats and ceiling chandelier, 222 stand-ins hidden, then the
# wedding stage set (2 wingback thrones + 2 sofas facing the +Y audience).
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

def world_bbox(o):
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

def glb_join(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    # glTF roots may parent the joined mesh to an empty -- drop the parent
    # (keeping world transform) so later location/bbox math is world-space.
    if ob.parent is not None:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # glTF imports arrive in QUATERNION mode where rotation_euler writes are
    # silently ignored -- switch to XYZ so placement rotations actually apply.
    ob.rotation_mode = "XYZ"
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return ob

FLOOR_Z = -1.2 * FT
CEIL_TOP = (SIZE["wallH"] - 1.4) * FT      # 22.6 ft at wallH=24 (was 24.0-1.2-0.2)
CHAND_XY = (0.0, -4.0 * FT)
CHAND_DROP_TARGET = 2.04
CHAIR_H_TARGET = 2.055 * FT

objs = [o for o in bpy.data.objects if o.type == "MESH"]
cframes = [o for o in objs if o.name.lower().startswith("cframe")]
seats   = [o for o in objs if o.name.lower().startswith("seat")]
strands = [o for o in objs if o.name.lower().startswith("strand")]
bulbs   = [o for o in objs if o.name.lower().startswith("bulb")]
glasses = [o for o in objs if o.name.lower().startswith("glass")]
assert (len(cframes), len(seats), len(strands), len(bulbs), len(glasses)) == (128, 64, 16, 10, 1), \
    "pristine stand-in counts mismatch"

def is_chand_gold(o):
    lo, hi = world_bbox(o)
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    cz = (lo[2] + hi[2]) / 2
    extx, exty = hi[0] - lo[0], hi[1] - lo[1]
    d = math.hypot(cx - CHAND_XY[0], cy - CHAND_XY[1])
    return d < 1.5 and cz > 3.5 and max(extx, exty) < 3.0

gold_chand = [o for o in objs if o.name.lower().startswith("gold") and is_chand_gold(o)]
assert len(gold_chand) == 3, "expected 3 chandelier gold parts, got %d" % len(gold_chand)

sites = [(sx * XCOL_FT, z) for sx in (-1, 1) for z in ROWZ_FT]
placements = []
ci = 0
for t in sites:
    ci += 1
    for k in range(8):
        a = (k / 8) * 2 * math.pi
        cxK = t[0] + math.cos(a) * 3.7
        czK = t[1] + math.sin(a) * 3.7
        ry = math.atan2(-cxK, -czK) + ((((ci * 13) % 5) - 2) * 0.014)
        fx, fz = math.sin(ry), math.cos(ry)
        placements.append({"xy": (cxK * FT, -czK * FT), "front": (fx, -fz)})
        ci += 1
assert len(placements) == 32

ch = glb_join(os.path.join(ASSETS, "chiavari_gold_chair.glb"), "lux_chair_00")
V = np.array([(ch.matrix_world @ v.co)[:] for v in ch.data.vertices])
zmin, zmax = V[:, 2].min(), V[:, 2].max()
bcxy = np.array([(V[:, 0].min() + V[:, 0].max()) / 2, (V[:, 1].min() + V[:, 1].max()) / 2])
tall = V[V[:, 2] > zmin + 0.55 * (zmax - zmin)]
Bxy = tall[:, :2].mean(axis=0)
back = Bxy - bcxy
F = np.array([0.0, -1.0]) if np.linalg.norm(back) < 0.01 else -back / np.linalg.norm(back)
lo, hi = world_bbox(ch)
raw_h = hi[2] - lo[2]
chair_s = CHAIR_H_TARGET / raw_h
ch.scale = (chair_s, chair_s, chair_s)
chair_zmin = min(c[2] for c in ch.bound_box)

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

chand = glb_join(os.path.join(ASSETS, "chandelier.glb"), "lux_chandelier")
clo, chi = world_bbox(chand)
chand_s = CHAND_DROP_TARGET / (chi[2] - clo[2])
chand.scale = (chand_s, chand_s, chand_s)
kzmax = max(c[2] for c in chand.bound_box)
chand.location = (CHAND_XY[0], CHAND_XY[1], CEIL_TOP - chand_s * kzmax)
chand.rotation_euler = (0.0, 0.0, 0.0)

hide_list = cframes + seats + strands + bulbs + glasses + gold_chand
assert len(hide_list) == 128 + 64 + 16 + 10 + 1 + 3
for o in hide_list:
    o.hide_render = True
    o.hide_viewport = True

def place_at(o, x, y, rz_deg):
    lo, hi = world_bbox(o)
    o.location.z -= lo[2]
    o.rotation_euler[2] = math.radians(rz_deg)
    bpy.context.view_layer.update()
    lo, hi = world_bbox(o)
    o.location.x += x - (lo[0] + hi[0]) / 2
    o.location.y += y - (lo[1] + hi[1]) / 2
    bpy.context.view_layer.update()
    lo, hi = world_bbox(o)
    # inside the stage at any recalc'd size (floor to the same 6.7/2.74
    # grid the hand-placed blend used at 44x18)
    xb = math.floor(SKIRT_X * 100) / 100
    yb = math.floor(SKIRT_Y * 100) / 100
    assert abs(lo[2]) < 0.02 and lo[0] > -xb and hi[0] < xb \
        and lo[1] > -yb and hi[1] < yb, o.name + " off stage"

# wedding set: both pieces share a back line at the design gap (0.605 m
# = 1.99 ft) behind the rig's front face, so a rig that swings toward
# the audience pushes the furniture with it (defaults land at y=1.361 /
# 1.687 exactly as the hand-placed blend did; FURN_DY shifts the
# ray-contact pillow probes by the same offset).
RIG_HEX_RE = re.compile(r"^[0-9a-f]{6}(-|$)", re.I)
rig_objs = [o for o in meshes
            if RIG_HEX_RE.match(o.name.lower())
            or o.name.lower().startswith("wall_stand")]
rig_front = max(world_bbox(o)[1][1] for o in rig_objs)
furn_back = rig_front + 0.605
FURN_DY = furn_back - 0.946
thr_y = furn_back + 0.415               # throne depth 0.83 m
sofa_y = furn_back + 0.741              # loveseat depth 1.482 m

for nm, fn, x, y, rz in (
    ("wed_throne_L", "shelter_wingback.glb", -0.60, thr_y, 180),
    ("wed_throne_R", "shelter_wingback.glb",  0.60, thr_y, 180),
    ("wed_sofa_L",   "haven_loveseat.glb",   -2.873, sofa_y, 165),
    ("wed_sofa_R",   "haven_loveseat.glb",    2.873, sofa_y, 195),
):
    place_at(glb_join(os.path.join(ASSETS, fn), nm), x, y, rz)

# throne<->sofa edge-to-edge x gap must be exactly 2 ft (0.6096 m)
for a, b in (("wed_throne_R", "wed_sofa_R"), ("wed_throne_L", "wed_sofa_L")):
    tlo, thi = world_bbox(bpy.data.objects[a])
    slo, shi = world_bbox(bpy.data.objects[b])
    gap = (slo[0] - thi[0]) if thi[0] > 0 else (tlo[0] - shi[0])
    assert abs(gap - 0.6096) < 0.01, (a, b, round(gap, 4))

# ---------- stage backdrop panel + analog clock, wall paintings, marble floor (P-007) ----------
TEX = os.path.join(ASSETS, "tex")
PNT = os.path.join(ASSETS, "paintings")

def set_image_pbr(m, diff, scale, rough=None, nor=None, uv_size=None):
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    if uv_size:
        # vertical quads: flat projection samples X/Y, so drive from UV
        # scaled to world size (tiles = size * scale)
        mp.inputs["Scale"].default_value = (uv_size[0] * scale, uv_size[1] * scale, 1.0)
        nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    else:
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    dt = nt.nodes.new("ShaderNodeTexImage")
    dt.image = bpy.data.images.load(diff)
    nt.links.new(mp.outputs["Vector"], dt.inputs["Vector"])
    nt.links.new(dt.outputs["Color"], b.inputs["Base Color"])
    if rough:
        rt = nt.nodes.new("ShaderNodeTexImage")
        rt.image = bpy.data.images.load(rough)
        nt.links.new(mp.outputs["Vector"], rt.inputs["Vector"])
        nt.links.new(rt.outputs["Color"], b.inputs["Roughness"])
    else:
        b.inputs["Roughness"].default_value = 0.3
    if nor:
        ni = nt.nodes.new("ShaderNodeTexImage")
        ni.image = bpy.data.images.load(nor)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(mp.outputs["Vector"], ni.inputs["Vector"])
        nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m

def image_pbr(name, diff, scale, rough=None, nor=None, uv_size=None):
    return set_image_pbr(bpy.data.materials.new(name), diff, scale, rough, nor, uv_size)

def wall_quad(name, verts, mat, uvr=(0.0, 1.0, 0.0, 1.0)):
    # verts: 4 world-space corners in order producing the desired normal
    u0, u1, v0, v1 = uvr
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    coords = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for i, _ in enumerate(me.loops):
        uv.data[i].uv = coords[i]
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def cover_uv(w, h, qw, qh):
    ai, aq = w / h, qw / qh
    if ai > aq:
        du = 0.5 * aq / ai
        return (0.5 - du, 0.5 + du, 0.0, 1.0)
    dv = 0.5 * ai / aq
    return (0.0, 1.0, 0.5 - dv, 0.5 + dv)

def painting_mat(name, path, crop):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.45
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (crop[1] - crop[0], crop[3] - crop[2], 1.0)
    mp.inputs["Location"].default_value = (crop[0], crop[2], 0.0)
    it = nt.nodes.new("ShaderNodeTexImage")
    it.image = bpy.data.images.load(path)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], it.inputs["Vector"])
    nt.links.new(it.outputs["Color"], b.inputs["Base Color"])
    return m

# 3) Italian marble main floor (Polyhaven marble_01, CC0)
set_image_pbr(bpy.data.materials["floor"],
              os.path.join(TEX, "marble_01_diff_2k.jpg"), 0.15,
              rough=os.path.join(TEX, "marble_01_rough_2k.jpg"),
              nor=os.path.join(TEX, "marble_01_nor_gl_2k.jpg"))

# 1) stage background wall: walnut wood panel + marble-finish inset + big analog clock
wood_m = image_pbr("MAT-panel_walnut", os.path.join(TEX, "walnut_diff_2k.jpg"), 0.5,
                   rough=os.path.join(TEX, "walnut_rough_2k.jpg"),
                   nor=os.path.join(TEX, "walnut_nor_2k.jpg"),
                   uv_size=(12.8, 6.266))
marb_m = image_pbr("MAT-panel_marble", os.path.join(TEX, "marble_01_diff_2k.jpg"), 0.3,
                   rough=os.path.join(TEX, "marble_01_rough_2k.jpg"),
                   nor=os.path.join(TEX, "marble_01_nor_gl_2k.jpg"),
                   uv_size=(11.9, 5.3))
# wall face at y=-5.163; panel layers sit proud of it, behind sconces/pilasters
wall_quad("stage_panel_wood",
          [(-6.4, -5.14, -0.366), (6.4, -5.14, -0.366),
           (6.4, -5.14, 5.9), (-6.4, -5.14, 5.9)], wood_m)
wall_quad("stage_panel_marble",
          [(-5.95, -5.12, 0.15), (5.95, -5.12, 0.15),
           (5.95, -5.12, 5.45), (-5.95, -5.12, 5.45)], marb_m)

clk = glb_join(os.path.join(ASSETS, "wall_clock", "wall_clock_2k.gltf"), "stage_clock")
# P-008: luxury restyle — black/gold Roman dial atlas replaces the stock photo
_lux = bpy.data.images.load(os.path.join(ASSETS, "wall_clock", "textures",
                                         "wall_clock_diff_luxury_2k.jpg"))
for _sl in clk.material_slots:
    _m = _sl.material
    if _m and _m.node_tree:
        for _n in _m.node_tree.nodes:
            if _n.type == "TEX_IMAGE" and _n.image and _n.image.name.startswith("wall_clock_diff"):
                _n.image = _lux
            if _n.type == "BSDF_PRINCIPLED":
                # P-008: dim the white specular blob the black dial now shows
                if _m.name == "wall_clock_glass":
                    _n.inputs["Specular IOR Level"].default_value = 0.12
                else:
                    _n.inputs["Specular IOR Level"].default_value = 0.25
                    _n.inputs["Roughness"].default_value = 0.62
clk.rotation_euler = (0.0, 0.0, math.pi)  # model face points -Y -> +Y audience
bpy.context.view_layer.update()
clo, chi = world_bbox(clk)
clk.scale = (1.2 / (chi[0] - clo[0]),) * 3  # P-008: halved 2.4m -> 1.2m dia
bpy.context.view_layer.update()
clo, chi = world_bbox(clk)
clk.location.x += 0.0 - (clo[0] + chi[0]) / 2
clk.location.z += 3.9 - (clo[2] + chi[2]) / 2
clk.location.y += -5.115 - clo[1]  # back flush to marble inset face
bpy.context.view_layer.update()
clo, chi = world_bbox(clk)
assert abs((clo[0] + chi[0]) / 2) < 0.02 and abs((clo[2] + chi[2]) / 2 - 3.9) < 0.02
assert chi[1] < -4.7 and clo[1] > -5.163, (clo[1], chi[1])

# 2) side walls: each square trim-block pair gets a framed painting
for tn in ("trim.001", "trim.002", "trim.004", "trim.005"):
    t = bpy.data.objects[tn]
    t.data = t.data.copy()
    t.data.materials.clear()
    t.data.materials.append(MATSET["gold"])

PAINTS = [
    ("wall_panelIn.002", "trim.002", "klimt_kiss.jpg"),
    ("wall_panelIn",     "trim.001", "renoir_flowers.jpg"),
    ("wall_panelIn.003", "trim.004", "starry_night.jpg"),
    ("wall_panelIn.001", "trim.005", "ryder_sea.jpg"),
]
for i, (onm, tnm, fn) in enumerate(PAINTS):
    po = bpy.data.objects[onm]
    plo, phi = world_bbox(po)
    tlo, thi = world_bbox(bpy.data.objects[tnm])
    y0, y1 = plo[1] + 0.03, phi[1] - 0.03
    z0, z1 = plo[2] + 0.02, phi[2] - 0.02
    qw, qh = y1 - y0, z1 - z0
    img = bpy.data.images.load(os.path.join(PNT, fn))
    crop = cover_uv(img.size[0], img.size[1], qw, qh)
    pm = painting_mat("MAT_paint_%d" % i, os.path.join(PNT, fn), crop)
    if plo[0] < 0:  # left wall, normal +X; hang proud of the gold trim face
        px = thi[0] + 0.005
        wall_quad("painting_%d" % i,
                  [(px, y0, z0), (px, y1, z0), (px, y1, z1), (px, y0, z1)],
                  pm)
    else:           # right wall, normal -X
        px = tlo[0] - 0.005
        wall_quad("painting_%d" % i,
                  [(px, y1, z0), (px, y0, z0), (px, y0, z1), (px, y1, z1)],
                  pm)

# ---------- P-008: TILT-spec PAR uplights, 4 per side along the S-curve drape ----------
# Geometry/params ported from TILT js/elements/light.js (type "light-par"):
#   yoke arms 0.035x0.34x0.07 at x+-0.17, bridge 0.375x0.035x0.07 at y0.357,
#   can cylinder r0.15->0.17 len 0.36 (flared lens end), lens circle r0.14 at
#   y-0.185, ring torus 0.15/0.02; spot: focus 30deg, penumbra/blend 0.35,
#   throw 12ft, warm tint (hue40/sat35 ~ #fff2dd). Yoke sits on the stage
#   floor: TILT's panG y+0.2 offset removed. P-012 r3 overrides: glass lens +
#   LED diodes + bracket flange/knobs + spot shadows ON.
par_house = bpy.data.materials.new("MAT_par_housing")
par_house.use_nodes = True
_pb = par_house.node_tree.nodes["Principled BSDF"]
_pb.inputs["Base Color"].default_value = (0.0077, 0.0077, 0.0094, 1)  # 0x141418
_pb.inputs["Metallic"].default_value = 0.65
_pb.inputs["Roughness"].default_value = 0.45

par_yoke = bpy.data.materials.new("MAT_par_yoke")
par_yoke.use_nodes = True
_pb = par_yoke.node_tree.nodes["Principled BSDF"]
_pb.inputs["Base Color"].default_value = (0.0231, 0.0231, 0.0295, 1)  # 0x2a2a30
_pb.inputs["Metallic"].default_value = 0.70
_pb.inputs["Roughness"].default_value = 0.40

# P-012 r3: glass lens (transmissive) with an active face emission so the
# lamp face reads as lit glass while the LED array behind it shows through.
par_lens = bpy.data.materials.new("MAT_par_lens")
par_lens.use_nodes = True
_pb = par_lens.node_tree.nodes["Principled BSDF"]
_pb.inputs["Base Color"].default_value = (0.86, 0.89, 0.93, 1)
_pb.inputs["Roughness"].default_value = 0.04
if "Transmission Weight" in _pb.inputs:
    _pb.inputs["Transmission Weight"].default_value = 1.0
_pb.inputs["IOR"].default_value = 1.45
_pb.inputs["Emission Color"].default_value = (1.0, 0.905, 0.765, 1)   # 0xfff4e2
_pb.inputs["Emission Strength"].default_value = 1.6  # P-013: warm lit-glass glow (0.25 read as dead gray); diodes at 100 stay hotter under AgX

# P-012 r3: visible LED diode array sitting behind the glass lens
par_led = bpy.data.materials.new("MAT_par_led")
par_led.use_nodes = True
_pb = par_led.node_tree.nodes["Principled BSDF"]
_pb.inputs["Base Color"].default_value = (1.0, 0.95, 0.86, 1)
_pb.inputs["Emission Color"].default_value = (1.0, 0.95, 0.86, 1)
_pb.inputs["Emission Strength"].default_value = 100.0  # P-013: stay visibly hotter than the lit lens glass under AgX

def _par_cube(name, half, loc, parent, mat):
    bpy.ops.mesh.primitive_cube_add(size=2.0)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = half
    ob.parent = parent
    ob.location = loc
    ob.data.materials.append(mat)
    return ob

def _led_array(name, parent):
    """7-lobe LED emitter plate on the local y=-0.16 plane (behind the lens)."""
    verts, faces = [], []
    lobes = [(0.0, 0.0)] + [(0.055 * math.cos(k * math.pi / 3.0),
                             0.055 * math.sin(k * math.pi / 3.0))
                            for k in range(6)]
    for dx, dz in lobes:
        c0 = len(verts)
        verts.append((dx, -0.160, dz))
        for k in range(8):
            a = k * math.pi / 4.0
            verts.append((dx + 0.02 * math.cos(a), -0.160,
                          dz + 0.02 * math.sin(a)))
        for k in range(8):
            faces.append((c0, c0 + 1 + k, c0 + 1 + (k + 1) % 8))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.parent = parent
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(par_led)
    return ob

def par_uplight(i, x, y=0.75, ztgt=1.6, aimy=0.336):
    """One floor-standing PAR at (x, y) aimed at the drape face (aimy, ztgt)."""
    root = bpy.data.objects.new("par_%d" % i, None)
    root.location = (x, y, 0.0)
    bpy.context.scene.collection.objects.link(root)
    # yoke: two side arms + top bridge (TILT buildYoke, panG offset removed).
    # P-012: bridge sits BEHIND the 74deg-tilted lens plane (not above it)
    # and arms deepen/reach to it, so no yoke bar ever crosses the lens
    # face or the LED array (arms are outside the lens x-range anyway).
    _par_cube("par_%d_armL" % i, (0.0175, 0.075, 0.181), (-0.17, 0.04, 0.181), root, par_yoke)
    _par_cube("par_%d_armR" % i, (0.0175, 0.075, 0.181), (0.17, 0.04, 0.181), root, par_yoke)
    _par_cube("par_%d_bridge" % i, (0.1875, 0.035, 0.0175), (0.0, 0.08, 0.345), root, par_yoke)
    # P-012 r3: adjustable mounting bracket -- floor flange + pivot knobs
    _par_cube("par_%d_base" % i, (0.23, 0.10, 0.015), (0.0, 0.0, 0.015),
              root, par_yoke)
    for _kn, _kx in (("par_%d_knobL" % i, -0.163), ("par_%d_knobR" % i, 0.163)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.045,
                                            depth=0.10,
                                            rotation=(0.0, math.pi / 2.0, 0.0))
        kn = bpy.context.active_object
        kn.name = _kn
        kn.parent = root
        kn.location = (_kx, 0.0, 0.17)
        kn.data.materials.append(par_yoke)
    # aim: from lens (z=0.17) to the drape face at ztgt
    d = mathutils.Vector((0.0, aimy - y, ztgt - 0.17)).normalized()
    theta = math.atan2(-d.z, -d.y)  # tilt empty rotX maps local -Y -> d
    tilt = bpy.data.objects.new("par_%d_tilt" % i, None)
    bpy.context.scene.collection.objects.link(tilt)  # must be in scene to evaluate
    tilt.rotation_euler = (theta, 0.0, 0.0)
    tilt.parent = root
    tilt.location = (0.0, 0.0, 0.17)
    # can: cone r0.15 (back) -> r0.17 (lens end at -Y), axis along Y
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.15, radius2=0.17, depth=0.36)
    can = bpy.context.active_object
    can.name = "par_%d_can" % i
    can.rotation_euler = (math.pi / 2, 0.0, 0.0)
    can.parent = tilt
    can.location = (0.0, 0.0, 0.0)
    can.data.materials.append(par_house)
    # P-012: open the front cap (real PAR can is open under the lens) so the
    # glass lens transmits a view of the LED array instead of the solid cap
    _bm = bmesh.new()
    _bm.from_mesh(can.data)
    _zmax = max(v.co.z for v in _bm.verts)
    _caps = [f for f in _bm.faces
             if all(v.co.z > _zmax - 1e-4 for v in f.verts)]
    bmesh.ops.delete(_bm, geom=_caps, context="FACES")
    _bm.to_mesh(can.data)
    _bm.free()
    # front ring
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.02,
                                     major_segments=24, minor_segments=8)
    ring = bpy.context.active_object
    ring.name = "par_%d_ring" % i
    ring.rotation_euler = (math.pi / 2, 0.0, 0.0)
    ring.parent = tilt
    ring.location = (0.0, -0.185, 0.0)
    ring.data.materials.append(par_house)
    # glass lens disc (P-012 r3), cylinder axis -> local -Y, inside the ring
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.135, depth=0.014,
                                        rotation=(math.pi / 2, 0.0, 0.0))
    lens = bpy.context.active_object
    lens.name = "par_%d_lens" % i
    lens.parent = tilt
    lens.location = (0.0, -0.184, 0.0)
    lens.data.materials.append(par_lens)
    # visible LED diode array behind the glass (P-012 r3)
    _led_array("par_%d_led" % i, tilt)
    # spot: faces local -Y (rotX -90), inherits tilt rotation
    ld = bpy.data.lights.new("par_%d_spot" % i, "SPOT")
    ld.energy = 150.0  # P-013: 45W washed out by ambient -- 150W reads as visible drape scallops
    ld.color = (1.0, 0.89, 0.77)          # hue40/sat35 ~ #fff2dd
    ld.spot_size = math.radians(30.0)     # focus 30deg
    ld.spot_blend = 0.35                  # penumbra/blend 0.35
    ld.cutoff_distance = 4.0              # throw ~12ft
    ld.shadow_soft_size = 0.05
    if hasattr(ld, "use_shadow"):
        ld.use_shadow = True              # P-012 r3: realistic throws/shadows
    sp = bpy.data.objects.new("par_%d_light" % i, ld)
    sp.parent = tilt
    sp.location = (0.0, -0.2, 0.0)
    sp.rotation_euler = (-math.pi / 2, 0.0, 0.0)  # local -Z -> -Y
    bpy.context.scene.collection.objects.link(sp)

# quartile centers under each drape panel - derived from the imported
# fabric so any recalc'd rig width keeps the wash on the cloth (defaults:
# panels span ±4.121 -> x ±3.662..±0.908, stand y=0.75, aim z=1.6)
_fabs = sorted([o for o in bpy.data.objects if o.type == "MESH"
                and re.fullmatch(r"ffffff-\d+", o.name)],
               key=lambda o: world_bbox(o)[0][0])
_pidx = 0
for _fp in _fabs:
    flo, fhi = world_bbox(_fp)
    _py = fhi[1] + 0.409              # 0.75 at the default drape front (0.341)
    _ay = fhi[1] - 0.005              # aim just inside the cloth face (0.336)
    _zt = max(0.8, min(1.6, fhi[2] - 0.4))   # default panel top ~2.0 -> 1.6
    _fw = (fhi[0] - flo[0]) / 4.0
    for _k in range(4):
        par_uplight(_pidx, flo[0] + (_k + 0.5) * _fw, _py, _zt, _ay)
        _pidx += 1
assert _pidx == 8, "expected 8 PARs from 2 fabric panels, got %d" % _pidx

# ---------- P-010: silk drape, pillows, table mats, stage border strips ----------
FAB = os.path.join(ASSETS, "textures")

# (1) S-curve drape -> satin/silk: beige-tinted crepe-satin weave (albedo +
#     non-color rough/normal) + anisotropic sheen. New material so other
#     "ffffff" fabric keeps its original cloth shader; pillows share it for
#     exact curtain-color parity.
silk = image_pbr("silk_drape",
                 os.path.join(FAB, "crepe_satin_diff_beige_1k.jpg"), 3.0,
                 rough=os.path.join(FAB, "crepe_satin_rough_1k.jpg"),
                 nor=os.path.join(FAB, "crepe_satin_nor_gl_1k.jpg"))
for _n in silk.node_tree.nodes:
    if _n.type == "TEX_IMAGE" and _n.image and (
            "rough" in _n.image.name or "nor_gl" in _n.image.name):
        _n.image.colorspace_settings.name = "Non-Color"
    if _n.type == "BSDF_PRINCIPLED":
        _n.inputs["Anisotropic"].default_value = 0.75
        _n.inputs["Sheen Weight"].default_value = 1.0
        _n.inputs["Sheen Roughness"].default_value = 0.20
for _dn in ("ffffff-129", "ffffff-130"):
    bpy.data.objects[_dn].data.materials[0] = silk

# (2) pillows (P-012): plush SQUARE knife-edge throw pillows (equal H x W,
#     pointed corners, high-center domed loft) placed by build-time ray
#     contact -- seat-top median + backrest face probes -- so each pillow
#     rests ON the seat AGAINST the backrest with zero penetration (r1).
#     Shared silk_drape keeps pillow color == curtain color.
def _plush_pillow(name, w, h, t, n=16):
    verts, faces, idx = [], [], {}

    def prof(u, v):
        return (math.cos(math.pi * (u - 0.5)) *
                math.cos(math.pi * (v - 0.5))) ** 0.65

    for j in range(n + 1):
        for i in range(n + 1):
            x = (i / n - 0.5) * w
            z = (j / n - 0.5) * h
            if i in (0, n) or j in (0, n):
                idx[("b", i, j)] = len(verts)
                verts.append((x, 0.0, z))          # shared knife-edge seam
            else:
                f = prof(i / n, j / n)
                idx[("f", i, j)] = len(verts)
                verts.append((x, t * 0.5 * f, z))  # front dome (+y)
                idx[("k", i, j)] = len(verts)
                verts.append((x, -t * 0.5 * f, z)) # back dome (-y)

    def fv(i, j):
        return (idx[("b", i, j)] if i in (0, n) or j in (0, n)
                else idx[("f", i, j)])

    def bv(i, j):
        return (idx[("b", i, j)] if i in (0, n) or j in (0, n)
                else idx[("k", i, j)])

    for j in range(n):
        for i in range(n):
            faces.append((fv(i, j), fv(i + 1, j), fv(i + 1, j + 1), fv(i, j + 1)))
            faces.append((bv(i, j), bv(i, j + 1), bv(i + 1, j + 1), bv(i + 1, j)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(silk)
    return ob

def _ray_hit(seat, origin, direction):
    inv = seat.matrix_world.inverted()
    o = inv @ mathutils.Vector(origin)
    d = (inv.to_3x3() @ mathutils.Vector(direction)).normalized()
    hit, loc, nrm, _i = seat.ray_cast(o, d, distance=60.0)
    if not hit:
        return None
    return (seat.matrix_world @ loc,
            (inv.transposed().to_3x3() @ nrm).normalized())

def _seat_median(seat, cx, cy, half_x, half_y):
    """Median first-up-hit z over a contact-footprint grid (rejects creases)."""
    zs = []
    for i in range(-2, 3):
        for j in range(-2, 3):
            h = _ray_hit(seat, (cx + i * half_x / 2.0,
                                cy + j * half_y / 2.0, 3.0),
                         (0.0, 0.0, -1.0))
            if h and h[1].z > 0.5:
                zs.append(h[0].z)
    if not zs:
        return None
    zs.sort()
    return zs[len(zs) // 2]

def _face_probe(seat, cx, z, y_from=None):
    """Front-most seat-surface y at (x, z); None if nothing plausible."""
    if y_from is None:
        y_from = 2.9 + FURN_DY
    h = _ray_hit(seat, (cx, y_from, z), (0.0, -1.0, 0.0))
    return h[0].y if h and h[0].y <= 1.95 + FURN_DY else None

def _place_pillow(name, seat_name, cx, cy_hint, fallback_lean=15.0,
                  w=0.44, h=0.44, t=0.17):
    seat = bpy.data.objects[seat_name]
    seat_z = _seat_median(seat, cx, cy_hint, 0.36, 0.20)
    if seat_z is None:
        seat_z = 0.5
    # backrest face probes above the seat: conservative front-most y + slope
    probes = []
    for dz in (0.05, 0.22, 0.40):
        y = _face_probe(seat, cx, seat_z + dz)
        if y is not None:
            probes.append((seat_z + dz, y))
    if len(probes) >= 2:
        za, ya = probes[0]
        zb, yb = probes[-1]
        lean = math.degrees(math.atan((ya - yb) / (zb - za)))
        lean = max(6.0, min(22.0, lean))
        y_face = max(p[1] for p in probes)
    else:
        lean = fallback_lean
        y_face = probes[0][1] if probes else cy_hint - 0.25
    # plan yaw: match the backrest line in plan so the back sits flush
    yaw = 0.0
    yA = _face_probe(seat, cx - 0.15, seat_z + 0.20)
    yB = _face_probe(seat, cx + 0.15, seat_z + 0.20)
    if yA is not None and yB is not None and abs(yB - yA) < 0.6:
        phi = math.degrees(math.atan2(yB - yA, 0.30))
        if abs(phi) <= 30.0:
            yaw = phi
    p = _plush_pillow(name, w, h, t)
    R = mathutils.Euler((math.radians(lean), 0.0, math.radians(yaw)),
                        "XYZ").to_matrix()
    dg = bpy.context.evaluated_depsgraph_get()
    pe = p.evaluated_get(dg)
    mme = pe.to_mesh()
    coords = [R @ v.co for v in mme.vertices]
    pe.to_mesh_clear()
    ly_min = min(c.y for c in coords)
    lz_min = min(c.z for c in coords)
    low_ys = [c.y for c in coords if c.z <= lz_min + 0.03]
    loc_y = y_face - ly_min + 0.002          # back dome on the face, +2mm
    loc_z = seat_z - lz_min + 0.003          # bottom on the seat, +3mm
    if low_ys:
        seat2 = _seat_median(seat, cx, loc_y + sum(low_ys) / len(low_ys),
                             0.36, 0.16)
        if seat2 is not None and abs(seat2 - seat_z) < 0.12:
            loc_z += seat2 - seat_z
            seat_z = seat2
    p.rotation_euler = (math.radians(lean), 0.0, math.radians(yaw))
    p.location = (cx, loc_y, loc_z)
    print("P012 %-18s seat %.3f face %.3f lean %.1f yaw %+.1f loc (%.3f, %.3f, %.3f)"
          % (name, seat_z, y_face, lean, yaw, cx, loc_y, loc_z))
    return p

_place_pillow("pillow_throne_L", "wed_throne_L", -0.60, 1.52 + FURN_DY, 21.0)
_place_pillow("pillow_throne_R", "wed_throne_R", 0.60, 1.52 + FURN_DY, 21.0)
_place_pillow("pillow_sofa_L1", "wed_sofa_L", -3.48, 1.90 + FURN_DY, 14.0)
_place_pillow("pillow_sofa_L2", "wed_sofa_L", -2.26, 1.55 + FURN_DY, 13.0)
_place_pillow("pillow_sofa_R1", "wed_sofa_R", 3.48, 1.90 + FURN_DY, 14.0)
_place_pillow("pillow_sofa_R2", "wed_sofa_R", 2.26, 1.55 + FURN_DY, 13.0)

# (3) table-top mats: champagne quatrefoil jacquard runners on the 4 banquet
#     tables (tops z=0.433; bloom centerpiece rests on the runner)
table_mat = image_pbr("tableMat",
                      os.path.join(FAB, "quatrefoil_jacquard_fabric_diff_champagne_1k.jpg"),
                      2.0,
                      rough=os.path.join(FAB, "quatrefoil_jacquard_fabric_rough_1k.jpg"),
                      nor=os.path.join(FAB, "quatrefoil_jacquard_fabric_nor_gl_1k.jpg"))
for _n in table_mat.node_tree.nodes:
    if _n.type == "TEX_IMAGE" and _n.image and (
            "rough" in _n.image.name or "nor_gl" in _n.image.name):
        _n.image.colorspace_settings.name = "Non-Color"
_rows_m = tuple(-z * FT for z in ROWZ_FT)   # 4.343 / 7.087 at d=18
for _i, (_tx, _ty) in enumerate((
        (-XCOL_FT * FT, _rows_m[0]), (-XCOL_FT * FT, _rows_m[1]),
        (XCOL_FT * FT, _rows_m[0]), (XCOL_FT * FT, _rows_m[1]))):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(_tx, _ty, 0.439))
    m = bpy.context.active_object
    m.name = "table_mat_%d" % _i
    m.scale = (1.15, 0.45, 0.012)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    m.data.materials.append(table_mat)

# (4) stage under-lip LED strip + floor wash (P-012): ONE continuous warm bar
#     tucked under the stage top front lip (skirt face y2.74, stage top z0,
#     floor z-0.366) -> continuous warm horizontal glow at ~2850K, plus a
#     soft area wash throwing the light down onto the floor in front.
strip_mat = emission("stage_strip", (1.0, 0.76, 0.52), 24.0)

def _strip(name, x0, x1, y):
    bpy.ops.mesh.primitive_cube_add(size=1.0,
                                    location=((x0 + x1) / 2.0, y, -0.05))
    s = bpy.context.active_object
    s.name = name
    s.scale = (x1 - x0, 0.02, 0.05)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    s.data.materials.append(strip_mat)
    return s

STRIP_X = SKIRT_X - 0.35 * FT          # 6.599 at w=44 (was 6.6)
_strip("stage_strip", -STRIP_X, STRIP_X, SKIRT_Y + 0.007)

wd = bpy.data.lights.new("stage_wash", type="AREA")
wd.shape = "RECTANGLE"
wd.size = 2 * STRIP_X
wd.size_y = 0.10
wd.energy = 160.0
wd.color = (1.0, 0.76, 0.52)
if hasattr(wd, "spread"):
    wd.spread = math.radians(120.0)
wo = bpy.data.objects.new("stage_wash", wd)
bpy.context.scene.collection.objects.link(wo)
wo.location = (0.0, SKIRT_Y + 0.027, -0.045)
wo.rotation_euler = (math.radians(25.0), 0.0, 0.0)  # down + forward wash

# ---------- render config ----------
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type in {"OPTIX", "CUDA"}
scene.cycles.device = "GPU"
scene.cycles.samples = 384
if os.environ.get("FORGE_SAMPLES"):
    scene.cycles.samples = max(16, int(os.environ["FORGE_SAMPLES"]))
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.render.resolution_x = 2048
scene.render.resolution_y = 1152
if os.environ.get("FORGE_RES_X"):
    scene.render.resolution_x = int(os.environ["FORGE_RES_X"])
if os.environ.get("FORGE_RES_Y"):
    scene.render.resolution_y = int(os.environ["FORGE_RES_Y"])
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX Medium High Contrast"
except Exception:
    pass
scene.render.film_transparent = False

# ---------- realtime progress ----------
# stdout is fully buffered when Blender runs behind a pipe, so the sample
# lines never stream. Instead the render_stats handler writes a sidecar
# JSON every >=0.4s; the forge worker watches it and feeds the studio's
# progress bar. Cheap enough to leave on for every forge render.
PROGRESS_FILE = os.environ.get("FORGE_PROGRESS")
if PROGRESS_FILE:
    # Blender passes no stats payload to render_stats here (5.x calls it
    # with just scene, context), but it fires once per path-tracing tick,
    # so counting ticks against the sample budget (with the ~1.25x overhead
    # the probe measured) gives an honest sub-shot fill for the bar. The
    # worker snaps the shot to its span on exit, so undershoot is harmless.
    _samples_total = int(os.environ["FORGE_SAMPLES"]) if os.environ.get(
        "FORGE_SAMPLES") else (384 if PRESET.startswith("grand") else 512)
    _ticks_target = max(8, int(_samples_total * 1.25) + 5)
    _state = {"ticks": 0, "last": 0.0}

    def _stats_handler(scene_arg, context):
        _state["ticks"] += 1
        now = time.time()
        if now - _state["last"] < 0.4:
            return
        _state["last"] = now
        try:
            with open(PROGRESS_FILE, "w") as f:
                json.dump({"shot": PRESET,
                           "sample": min(_state["ticks"], _ticks_target),
                           "samples": _ticks_target}, f)
        except Exception:
            pass

    bpy.app.handlers.render_stats.append(_stats_handler)

if PRESET == "saveblend":
    # native .blend: one camera at the grand-wide angle for the GUI session
    cam = bpy.data.cameras.new("cam_gui")
    cam.lens = SHOTS["grand-wide"]["lens"]
    camc = bpy.data.objects.new("cam_gui", cam)
    bpy.context.collection.objects.link(camc)
    l = SHOTS["grand-wide"]
    lx, ly, lz = (l["loc"][0] * FT, -l["loc"][2] * FT, l["loc"][1] * FT)
    tx, ty, tz = (l["look"][0] * FT, -l["look"][2] * FT, l["look"][1] * FT)
    camc.location = (lx, ly, lz)
    di = mathutils.Vector((tx - lx, ty - ly, tz - lz))
    camc.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camc
    bp = os.path.join(OUTDIR, "ballroom_scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=bp)
    print("SAVED BLEND", bp)
else:
    for nm in PRESETS:
        S = SHOTS[nm]
        cam = bpy.data.cameras.new("cam_%s" % nm)
        cam.lens = S["lens"]
        cam.dof.use_dof = True
        cam.dof.aperture_fstop = S["f"]
        camc = bpy.data.objects.new("cam_%s" % nm, cam)
        bpy.context.collection.objects.link(camc)
        lx, ly, lz = (S["loc"][0] * FT, -S["loc"][2] * FT, S["loc"][1] * FT)
        tx, ty, tz = (S["look"][0] * FT, -S["look"][2] * FT, S["look"][1] * FT)
        camc.location = (lx, ly, lz)
        di = mathutils.Vector((tx - lx, ty - ly, tz - lz))
        camc.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
        cam.dof.focus_distance = di.length
        scene.camera = camc
        # A forge payload's sample budget overrides the per-shot default;
        # without it, keep the grand/detail split as rendered before.
        scene.cycles.samples = (
            max(16, int(os.environ["FORGE_SAMPLES"]))
            if os.environ.get("FORGE_SAMPLES")
            else (384 if nm.startswith("grand") else 512))
        scene.render.filepath = os.path.join(OUTDIR, "bal_%s.png" % nm)
        bpy.ops.render.render(write_still=True)
        print("RENDERED", nm)
