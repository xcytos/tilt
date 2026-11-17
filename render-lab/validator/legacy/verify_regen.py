# verify_regen.py -- parity checks on regenerated blend
import bpy, math, sys
from mathutils import Vector

BLEND = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
fails = []

def chk(cond, msg):
    print("VR|", "OK " if cond else "FAIL", msg)
    if not cond: fails.append(msg)

def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return (min(xs),min(ys),min(zs)), (max(xs),max(ys),max(zs))

cam = bpy.data.objects.get("cam_gui")
chk(cam and abs(cam.data.lens - 30.0) < 0.01, "cam_gui lens=30")

lux = [o for o in bpy.data.objects if o.name.startswith("lux_chair")]
lux_vis = [o for o in lux if not o.hide_render]
chk(len(lux) == 32 and len(lux_vis) == 32, "32 luxury chairs visible (got %d/%d)" % (len(lux), len(lux_vis)))

hidden = [o for o in bpy.data.objects if o.hide_render and o.type == "MESH"]
chk(len(hidden) == 222, "222 hidden stand-ins (got %d)" % len(hidden))

chand = bpy.data.objects.get("lux_chandelier")
chk(chand is not None, "lux_chandelier exists")
if chand:
    lo, hi = bbox(chand)
    chk(abs(hi[2] - 6.89) < 0.15, "chandelier top z~6.89 (got %.2f)" % hi[2])
    chk(abs((lo[0]+hi[0])/2) < 0.1 and abs((lo[1]+hi[1])/2 + 1.22) < 0.3,
        "chandelier xy~(0,-1.22) (got %.2f,%.2f)" % ((lo[0]+hi[0])/2, (lo[1]+hi[1])/2))

# wedding furniture: on stage, sofas backrest toward -Y (facing +Y audience)
for nm in ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R"):
    o = bpy.data.objects.get(nm)
    chk(o is not None, nm + " exists")
    if not o: continue
    lo, hi = bbox(o)
    chk(abs(lo[2]) < 0.02 and lo[0] > -6.7 and hi[0] < 6.7 and lo[1] > -2.74 and hi[1] < 2.74,
        nm + " on stage z0=%.3f" % lo[2])
    # seat-top faces (normal +Z at seat height) mark the FRONT
    sy = []
    for poly in o.data.polygons:
        c = o.matrix_world @ poly.center
        n = (o.matrix_world.to_3x3() @ poly.normal).normalized()
        if 0.28 < c.z < 0.62 and n.z > 0.7:
            sy.append(c.y)
    my = sum(sy) / len(sy)
    cy = (lo[1] + hi[1]) / 2
    chk(my - cy > 0.01, "%s front at +Y (seatOffset %+.3f)" % (nm, my - cy))

# chairs face the scene origin -- verbatim ballroom.js ry=atan2(-cxK,-czK) port
facing_ok = 0
for i, o in enumerate(lux_vis):
    mw = o.matrix_world
    pts = [mw @ Vector(c) for c in o.bound_box]
    zs = [p.z for p in pts]
    zlo, zhi = min(zs), max(zs)
    h = zhi - zlo
    cx = sum(p.x for p in pts) / 8; cy = sum(p.y for p in pts) / 8
    sx_, sy_ = [], []
    for poly in o.data.polygons:
        c = mw @ poly.center
        n = (mw.to_3x3() @ poly.normal).normalized()
        if zlo + 0.25 * h < c.z < zlo + 0.55 * h and n.z > 0.7:
            sx_.append(c.x); sy_.append(c.y)
    if not sx_:
        continue
    fx, fy = sum(sx_)/len(sx_) - cx, sum(sy_)/len(sy_) - cy
    tx, ty = -cx, -cy
    nl = math.hypot(fx, fy) * math.hypot(tx, ty)
    if nl > 0 and (fx*tx + fy*ty) / nl > 0.5:
        facing_ok += 1
chk(facing_ok == 32, "32 chairs face origin per JS (got %d)" % facing_ok)

# materials (P-010: drape upgraded cloth -> silk_drape with crepe-satin weave)
silk = bpy.data.materials.get("silk_drape")
if silk and silk.use_nodes:
    imgs = [n.image.name for n in silk.node_tree.nodes
            if n.type == "TEX_IMAGE" and n.image]
    chk(any("crepe_satin_diff_beige" in i for i in imgs), "silk beige albedo")
    b = next((n for n in silk.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    chk(b is not None, "silk principled node")
    if b:
        chk(b.inputs["Anisotropic"].default_value >= 0.7,
            "silk aniso>=0.7 (%.2f)" % b.inputs["Anisotropic"].default_value)
        chk(b.inputs["Sheen Weight"].default_value >= 0.9,
            "silk sheen>=0.9 (%.2f)" % b.inputs["Sheen Weight"].default_value)
        chk(b.inputs["Roughness"].is_linked, "silk roughness from texture")
    dn = [o.name for o in bpy.data.objects
          if any(sl.material == silk for sl in o.material_slots)]
    chk(len(dn) == 8, "silk on 2 drape + 6 pillows (got %d)" % len(dn))
else:
    chk(False, "silk_drape material present")

bloom = bpy.data.materials.get("bloom")
if bloom and bloom.use_nodes:
    b = bloom.node_tree.nodes.get("Principled BSDF")
    chk(abs(b.inputs["Emission Strength"].default_value - 22.0) < 0.01, "bloom emission=22")
    ec = b.inputs["Emission Color"].default_value
    chk(abs(ec[0]-1.0) < 0.01 and abs(ec[1]-0.78) < 0.02, "bloom emission color warm")
else:
    chk(False, "bloom material present")

bloom_objs = [o.name for o in bpy.data.objects if any(s.material == bloom for s in o.material_slots)]
chk(len(bloom_objs) == 4, "4 bloom lamp objects (got %d)" % len(bloom_objs))

# tables + chiavari at tables spot check
tables = [o for o in bpy.data.objects if o.name.lower().startswith("tabletop") or o.name.lower().startswith("table")]
print("VR| table-ish objects:", len(tables))

print("VR| RESULT:", "ALL PASS" if not fails else "FAILURES: %d" % len(fails))
for f in fails: print("VR|  -", f)
sys.exit(1 if fails else 0)
