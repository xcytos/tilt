import bpy

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend")
names = sorted(o.name for o in bpy.data.objects)
for kw in ("table", "cloth", "bloom", "floor", "throne", "sofa", "lamp", "stage", "ffffff"):
    hits = [n for n in names if kw.lower() in n.lower()]
    print("KW", kw, "->", hits[:30])
# thrones/sofas bboxes
import mathutils
for n in ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R"):
    o = bpy.data.objects.get(n)
    if o:
        ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        lo = [min(v[i] for v in ws) for i in range(3)]
        hi = [max(v[i] for v in ws) for i in range(3)]
        print("BBOX", n, "lo", [round(v, 3) for v in lo], "hi", [round(v, 3) for v in hi])
# stage-ish: large flat objects near z 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    hi = [max(v[i] for v in ws) for i in range(3)]
    lo = [min(v[i] for v in ws) for i in range(3)]
    if hi[0] - lo[0] > 10 and hi[1] - lo[1] > 4 and lo[2] < 0.2 and hi[2] < 1.0:
        print("FLOORLIKE", o.name, "lo", [round(v, 3) for v in lo], "hi", [round(v, 3) for v in hi])
# drape cloth material
m = bpy.data.materials.get("cloth")
if m and m.node_tree:
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            print("CLOTH mat:", {i.name: (tuple(i.default_value) if hasattr(i.default_value, "__len__") else round(float(i.default_value), 3)) for i in n.inputs if i.name in ("Base Color", "Roughness", "Sheen Weight", "Sheen Roughness", "Metallic", "Anisotropic", "Specular IOR Level")})
print("TOTAL objects:", len(bpy.data.objects))
