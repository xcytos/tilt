# Blender 5.x headless: DELTA update of the S-curve rig inside an existing
# ballroom .blend (P-014). Only the rig meshes are replaced - room, lights,
# cameras, PAR fixtures and render settings are untouched - then the 8 PARs
# are re-placed/re-aimed at the new drape panels.
#
# Usage:
#   blender --background --factory-startup --python update_scurve.py -- \
#       <base.blend> <scurve.obj> <out.blend>
#
# The material loop is a faithful copy of render_ballroom.py (hex prefix ->
# MATSET, ffffff fabric -> silk_drape, unmatched names get the wall_ quirk)
# so a default-params delta is visually identical to a full regen.
import bpy
import json
import math
import os
import re
import sys

import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 3:
    print("usage: update_scurve.py -- <base.blend> <scurve.obj> <out.blend>")
    sys.exit(2)
BASE = os.path.abspath(argv[0])
OBJF = os.path.abspath(argv[1])
OUT = os.path.abspath(argv[2])
FT = 0.3048
PAR_STANDOFF = 0.414      # metres PAR stands behind the drape front (0.75 - 0.336)
PAR_LENS_Z = 0.17         # lens height on the fixture
PAR_AIM_Z_MAX = 1.6       # default build aims here; tracks the panel top lower
PAR_AIM_Z_MIN = 0.8

if not os.path.isfile(BASE):
    print("BASE BLEND NOT FOUND: %s" % BASE)
    sys.exit(2)
if not os.path.isfile(OBJF):
    print("SCURVE OBJ NOT FOUND: %s" % OBJF)
    sys.exit(2)

bpy.ops.wm.open_mainfile(filepath=BASE)

# ---------- 1) delete the old rig ----------
RIG_HEX = re.compile(r"^[0-9a-f]{6}(-|$)", re.I)


def is_rig(o):
    n = o.name.lower()
    return bool(RIG_HEX.match(n)) or n.startswith("wall_stand")


old = [o for o in bpy.data.objects if is_rig(o)]
for o in old:
    bpy.data.objects.remove(o, do_unlink=True)
# purge the orphaned mesh datablocks so repeated updates never bloat the file
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

# ---------- 2) import the new rig ----------
before = set(bpy.data.objects)
bpy.ops.wm.obj_import(filepath=OBJF)
new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
if not new:
    print("IMPORT PRODUCED NO MESHES")
    sys.exit(2)

bpy.ops.object.select_all(action="DESELECT")
for o in new:
    o.select_set(True)
bpy.context.view_layer.objects.active = new[0]
bpy.ops.object.shade_smooth()
for o in new:
    o.scale = (FT, FT, FT)
bpy.ops.object.transform_apply(scale=True)


# ---------- 3) materials (render_ballroom parity, get-or-create) ----------
def hexc(h):
    v = int(h, 16)
    return ((v >> 16 & 255) / 255.0, (v >> 8 & 255) / 255.0, (v & 255) / 255.0)


def principled(name, rgb, rough=0.85, metal=0.0, sheen=0.0,
               sheen_rough=None, sheen_tint=None):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
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
    return m


RIG_MATS = {
    "d4af37": lambda: principled("gold_rail", hexc("d4af37"), 0.22, 1.0),
    "9ca3af": lambda: principled("pole", hexc("9ca3af"), 0.35, 1.0),
    "374151": lambda: principled("base", hexc("374151"), 0.5, 0.8),
    "6b7280": lambda: principled("joint", hexc("6b7280"), 0.4, 0.9),
}

silk = bpy.data.materials.get("silk_drape")
if silk is None:
    print("silk_drape material missing in base blend - deploy a P-010+ blend first")
    sys.exit(2)
wall_mat = bpy.data.materials.get("wall") or principled(
    "wall", hexc("efe6d6"), 0.92)
_fab_cache = {}

for o in new:
    base = o.name.lower().split("-")[0]
    if re.fullmatch(r"[0-9a-f]{6}", base):
        if base == "ffffff":
            mat = silk                      # drape panels share the silk (P-010)
        elif base in RIG_MATS:
            mat = RIG_MATS[base]()
        else:
            if base not in _fab_cache:
                _fab_cache[base] = principled(
                    "cloth_" + base, hexc(base), 0.32, 0.0,
                    sheen=0.6, sheen_rough=0.25)
            mat = _fab_cache[base]
    else:
        # render_ballroom quirk: unmatched rig names (stand-*) get renamed
        # wall_* and the wall material - keep it so defaults stay identical.
        if not o.name.startswith("wall_"):
            o.name = "wall_" + o.name
        mat = wall_mat
    o.data.materials.clear()
    o.data.materials.append(mat)

# ---------- 4) re-place + re-aim the 8 PARs at the new panels ----------
fabs = [o for o in new if re.fullmatch(r"ffffff-\d+", o.name)]
if len(fabs) != 2:
    print("EXPECTED 2 FABRIC PANELS, GOT %d" % len(fabs))
    sys.exit(2)


def wbbox(o):
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = [min(v[i] for v in ws) for i in range(3)]
    hi = [max(v[i] for v in ws) for i in range(3)]
    return lo, hi


fabs.sort(key=lambda o: wbbox(o)[0][0])       # left panel first

targets = []                                   # (x, y, theta) for par_0..7
for panel in fabs:
    lo, hi = wbbox(panel)
    w = hi[0] - lo[0]
    yfront = hi[1]
    ztgt = min(PAR_AIM_Z_MAX, max(PAR_AIM_Z_MIN, hi[2] - 0.4))
    # PAR sits PAR_STANDOFF behind the front face, aims back at ztgt
    d = mathutils.Vector((0.0, -PAR_STANDOFF, ztgt - PAR_LENS_Z))
    theta = math.atan2(-d.z, -d.y)
    for k in range(4):
        targets.append((lo[0] + w * (2 * k + 1) / 8.0,
                        yfront + PAR_STANDOFF, theta))

moved = []
for i, (px, py, theta) in enumerate(targets):
    root = bpy.data.objects.get("par_%d" % i)
    tilt = bpy.data.objects.get("par_%d_tilt" % i)
    if root is None or tilt is None:
        print("PAR FIXTURE MISSING: par_%d" % i)
        sys.exit(2)
    root.location = (px, py, 0.0)
    tilt.rotation_euler = (theta, 0.0, 0.0)
    moved.append([i, round(px, 4), round(py, 4), round(theta, 4)])

# ---------- 5) stage / furniture intersection gate ----------
# The delta path only runs when the stage size already fits the new rig
# (forge compares compute_stage_size first); this is the last line of
# defense so a mismatched delta fails loudly with a regen hint instead
# of shipping converging geometry.
skirt = bpy.data.objects.get("skirt")
if skirt is None:
    print("SCURVE_VALIDATION skirt object missing in base blend")
    sys.exit(3)
slo, shi = wbbox(skirt)
MARGIN = 3.0 * FT - 0.01        # rig keeps ~3 ft to every stage edge
GAP_MIN = 0.58                  # rig front -> furniture back (design 0.605)
rig = [o for o in bpy.data.objects if o.type == "MESH" and is_rig(o)]
rig_lo = [min(wbbox(o)[0][i] for o in rig) for i in range(3)]
rig_hi = [max(wbbox(o)[1][i] for o in rig) for i in range(3)]
fails = []
if not (rig_lo[0] > slo[0] + MARGIN and rig_hi[0] < shi[0] - MARGIN
        and rig_lo[1] > slo[1] + MARGIN and rig_hi[1] < shi[1] - MARGIN):
    fails.append("rig outside stage margins: rig x %.2f..%.2f y %.2f..%.2f"
                 " vs stage x %.2f..%.2f y %.2f..%.2f"
                 " - shape needs a bigger stage: run the validator"
                 " suite --regen"
                 % (rig_lo[0], rig_hi[0], rig_lo[1], rig_hi[1],
                    slo[0], shi[0], slo[1], shi[1]))
WEDGES = ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R")
present = [n for n in WEDGES if n in bpy.data.objects]
if present:
    furn_back = min(wbbox(bpy.data.objects[n])[0][1] for n in present)
    gap = furn_back - rig_hi[1]
    if gap < GAP_MIN:
        fails.append("rig/furniture gap %.3f < %.3f m"
                     " - shape needs a bigger stage: run the validator"
                     " suite --regen" % (gap, GAP_MIN))
    for n in present:
        lo, hi = wbbox(bpy.data.objects[n])
        if not (lo[1] > slo[1] and hi[1] < shi[1]
                and lo[0] > slo[0] and hi[0] < shi[0]):
            fails.append("%s off stage x %.2f..%.2f y %.2f..%.2f"
                         % (n, lo[0], hi[0], lo[1], hi[1]))
if fails:
    for f in fails:
        print("SCURVE_VALIDATION " + f)
    sys.exit(3)

# ---------- 6) save ----------
bpy.ops.wm.save_as_mainfile(filepath=OUT)

summary = {
    "deleted": len(old), "imported": len(new),
    "fabrics": sorted(o.name for o in fabs),
    "pars": moved, "out": OUT, "bytes": os.path.getsize(OUT),
    "stage_check": {"rig_front": round(rig_hi[1], 4),
                    "furn_back": round(furn_back, 4) if present else None},
}
print("SCURVE_UPDATE " + json.dumps(summary))
