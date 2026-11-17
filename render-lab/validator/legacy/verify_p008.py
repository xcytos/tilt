# P-008 verification: 1.2m luxury clock + 8 TILT-spec PAR uplights.
# Usage: blender --background --factory-startup --python verify_p008.py -- <blend>
import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
BLEND = argv[0]
bpy.ops.wm.open_mainfile(filepath=BLEND)
fails = []

def chk(cond, msg):
    print(("PASS: " if cond else "FAIL: ") + msg)
    if not cond:
        fails.append(msg)

# ---- clock ----
clk = bpy.data.objects.get("stage_clock")
chk(clk is not None, "stage_clock exists")
if clk:
    ws = [clk.matrix_world @ mathutils.Vector(c) for c in clk.bound_box]
    xs = [v.x for v in ws]; ys = [v.y for v in ws]; zs = [v.z for v in ws]
    w = max(xs) - min(xs); h = max(zs) - min(zs)
    cx = (max(xs) + min(xs)) / 2; cz = (max(zs) + min(zs)) / 2
    back = min(ys)
    chk(abs(w - 1.2) < 0.05 and abs(h - 1.2) < 0.12, "clock dia 1.2m (w=%.3f h=%.3f)" % (w, h))
    chk(abs(cx) < 0.03 and abs(cz - 3.9) < 0.04, "clock center (%.3f, %.3f)" % (cx, cz))
    chk(back > -5.17 and back < -5.0, "clock back flush y=%.4f" % back)
    lux = False
    for sl in clk.material_slots:
        m = sl.material
        if m and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.name.startswith("wall_clock_diff_luxury"):
                    lux = True
    chk(lux, "clock uses luxury atlas image")

# ---- PAR uplights ----
PAR_X = (-3.662, -2.744, -1.826, -0.908, 0.908, 1.826, 2.744, 3.662)
spots = 0
for i, px in enumerate(PAR_X):
    root = bpy.data.objects.get("par_%d" % i)
    chk(root is not None, "par_%d root exists" % i)
    if not root:
        continue
    chk(abs(root.location.x - px) < 0.01 and abs(root.location.y - 0.75) < 0.01
        and abs(root.location.z) < 0.01,
        "par_%d at (%.3f, 0.75, 0)" % (i, root.location.x))
    sp = bpy.data.objects.get("par_%d_light" % i)
    chk(sp is not None and sp.type == "LIGHT", "par_%d spot light" % i)
    lens = bpy.data.objects.get("par_%d_lens" % i)
    can = bpy.data.objects.get("par_%d_can" % i)
    chk(lens is not None and can is not None, "par_%d can+lens mesh" % i)
    if sp and sp.type == "LIGHT":
        ld = sp.data
        spots += 1
        chk(abs(math.degrees(ld.spot_size) - 30.0) < 1.0,
            "par_%d spot_size 30deg (%.1f)" % (i, math.degrees(ld.spot_size)))
        chk(abs(ld.spot_blend - 0.35) < 0.02, "par_%d blend 0.35" % i)
        chk(ld.color[0] > 0.99 and 0.85 < ld.color[1] < 0.93,
            "par_%d warm color %s" % (i, tuple(round(c, 2) for c in ld.color)))
        d = sp.matrix_world.to_3x3() @ mathutils.Vector((0, 0, -1))
        chk(d.y < -0.15 and d.z > 0.8, "par_%d aims at drape dir=(%.2f,%.2f,%.2f)" % (i, d.x, d.y, d.z))
chk(spots == 8, "8 PAR spots total (%d)" % spots)

# ---- regression: P-006/P-007 scene intact ----
def bbox(name):
    o = bpy.data.objects.get(name)
    if not o:
        return None
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    return ([min(v[i] for v in ws) for i in range(3)],
            [max(v[i] for v in ws) for i in range(3)])

sofa = bbox("wed_sofa_R")
thr = bbox("wed_throne_R")
if sofa and thr:
    gap = thr[0][0] - sofa[1][0] if thr[0][0] > sofa[1][0] else sofa[0][0] - thr[1][0]
    chk(gap > 0.55, "throne-sofa gap %.3f" % gap)
else:
    chk(False, "throne/sofa objects found")
chairs = [o for o in bpy.data.objects if "Chair" in o.name or "chair" in o.name]
chk(len(chairs) >= 32, "chairs present (%d)" % len(chairs))
paints = [o for o in bpy.data.objects if o.name.startswith("painting_")]
chk(len(paints) == 4, "4 paintings (%d)" % len(paints))
drape = bbox("ffffff-129")
chk(drape and abs(drape[0][0] - 0.451) < 0.05, "right drape panel intact")

print("P-008 VERIFY:", "ALL PASS" if not fails else "FAILURES: %d" % len(fails))
for f in fails:
    print("  FAIL:", f)
sys.exit(1 if fails else 0)
