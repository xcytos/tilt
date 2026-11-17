import bpy, mathutils, sys

BLEND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=BLEND)
ok = True

def chk(cond, msg):
    global ok
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        ok = False

def dims(o):
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = [min(v[i] for v in ws) for i in range(3)]
    hi = [max(v[i] for v in ws) for i in range(3)]
    return [hi[i] - lo[i] for i in range(3)], lo, hi

# --- 1. pillows: 6, right sizes, shared silk material ---
expect = {
    "pillow_throne_L": ((0.42, 0.13, 0.38), (-0.6, 1.20, 0.66)),
    "pillow_throne_R": ((0.42, 0.13, 0.38), (0.6, 1.20, 0.66)),
    "pillow_sofa_L1": ((0.46, 0.14, 0.42), (-3.75, 1.45, 0.62)),
    "pillow_sofa_L2": ((0.46, 0.14, 0.42), (-1.99, 1.45, 0.62)),
    "pillow_sofa_R1": ((0.46, 0.14, 0.42), (1.99, 1.45, 0.62)),
    "pillow_sofa_R2": ((0.46, 0.14, 0.42), (3.75, 1.45, 0.62)),
}
pillow_mats = set()
for name, (edims, eloc) in expect.items():
    o = bpy.data.objects.get(name)
    chk(o is not None, "pillow exists: " + name)
    if not o:
        continue
    _, lo, hi = dims(o)
    d = tuple(o.dimensions)  # local-axis dims (rotation-independent)
    c = [(lo[i] + hi[i]) / 2 for i in range(3)]
    chk(all(abs(d[i] - edims[i]) < 0.06 for i in range(3)),
        "%s dims %s ~ %s" % (name, [round(v, 3) for v in d], edims))
    chk(all(abs(c[i] - eloc[i]) < 0.08 for i in range(3)),
        "%s center %s ~ %s" % (name, [round(v, 3) for v in c], eloc))
    m = o.data.materials[0] if o.data.materials else None
    chk(m is not None and m.name == "silk_drape",
        "%s material silk_drape (got %s)" % (name, m.name if m else None))
    if m:
        pillow_mats.add(m.name)
chk(pillow_mats == {"silk_drape"}, "pillow==curtain material parity")

# --- 2. drape uses silk_drape with weave textures + anisotropic sheen ---
for dn in ("ffffff-129", "ffffff-130"):
    o = bpy.data.objects.get(dn)
    chk(o is not None and o.data.materials and o.data.materials[0].name == "silk_drape",
        "drape %s on silk_drape" % dn)
silk = bpy.data.materials.get("silk_drape")
chk(silk is not None, "silk_drape material exists")
if silk:
    imgs = [n.image.name for n in silk.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    chk(len(imgs) >= 3, "silk has >=3 textures: %s" % imgs)
    chk(any("crepe_satin_diff_beige" in i for i in imgs), "silk beige albedo texture")
    pb = next((n for n in silk.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    chk(pb is not None, "silk principled node")
    if pb:
        chk(pb.inputs["Anisotropic"].default_value >= 0.7,
            "silk anisotropic %.2f >= 0.7" % pb.inputs["Anisotropic"].default_value)
        chk(pb.inputs["Sheen Weight"].default_value >= 0.9,
            "silk sheen %.2f >= 0.9" % pb.inputs["Sheen Weight"].default_value)
        chk(pb.inputs["Roughness"].is_linked, "silk roughness from texture")

# --- 3. table mats: 4 runners on the banquet table tops ---
tmats = ((-4.694, 4.115), (-4.694, 6.858), (4.694, 4.115), (4.694, 6.858))
for i, (tx, ty) in enumerate(tmats):
    o = bpy.data.objects.get("table_mat_%d" % i)
    chk(o is not None, "table_mat_%d exists" % i)
    if not o:
        continue
    d, lo, hi = dims(o)
    c = [(lo[j] + hi[j]) / 2 for j in range(3)]
    chk(abs(c[0] - tx) < 0.02 and abs(c[1] - ty) < 0.02 and abs(c[2] - 0.439) < 0.02,
        "mat_%d center %s" % (i, [round(v, 3) for v in c]))
    chk(abs(d[0] - 1.15) < 0.03 and abs(d[1] - 0.45) < 0.03 and d[2] < 0.03,
        "mat_%d dims %s" % (i, [round(v, 3) for v in d]))
    m = o.data.materials[0] if o.data.materials else None
    chk(m is not None and m.name == "tableMat", "mat_%d material" % i)
tm = bpy.data.materials.get("tableMat")
if tm:
    imgs = [n.image.name for n in tm.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    chk(any("champagne" in i for i in imgs), "mat champagne jacquard texture: %s" % imgs)

# --- 4. stage strips: 2 warm emissive bars on front skirt ---
for name, x0, x1 in (("stage_strip_L", -6.6, -0.15), ("stage_strip_R", 0.15, 6.6)):
    o = bpy.data.objects.get(name)
    chk(o is not None, "%s exists" % name)
    if not o:
        continue
    d, lo, hi = dims(o)
    chk(abs(lo[1] - 2.74) < 0.02 and hi[1] < 2.78,
        "%s on skirt face y=%.3f..%.3f" % (name, lo[1], hi[1]))
    chk(abs((lo[2] + hi[2]) / 2 + 0.05) < 0.01, "%s z center %.3f" % (name, (lo[2] + hi[2]) / 2))
    chk(abs(lo[0] - x0) < 0.02 and abs(hi[0] - x1) < 0.02,
        "%s x span %.2f..%.2f" % (name, lo[0], hi[0]))
    m = o.data.materials[0] if o.data.materials else None
    em = None
    if m and m.use_nodes:
        em = next((n for n in m.node_tree.nodes if n.type == "EMISSION"), None)
    chk(em is not None and em.inputs["Strength"].default_value >= 10,
        "%s emission strength %s" % (name,
        em.inputs["Strength"].default_value if em else None))

# --- 5. regressions: clock 1.2m luxury, 8 PARs (P-008) ---
clk = bpy.data.objects.get("stage_clock")
chk(clk is not None, "stage_clock exists")
if clk:
    d, lo, hi = dims(clk)
    chk(abs(d[0] - 1.2) < 0.05, "clock dia 1.2m (w=%.3f)" % d[0])
lux = [i.name for i in bpy.data.images if "luxury" in i.name]
chk(len(lux) >= 1, "luxury atlas loaded: %s" % lux)
pars = [o for o in bpy.data.objects if o.name.startswith("par_") and o.name.endswith("_light")]
chk(len(pars) == 8, "8 par lights (got %d)" % len(pars))

print("VERIFY_P010:", "ALL PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
