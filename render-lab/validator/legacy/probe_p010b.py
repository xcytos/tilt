import bpy, mathutils

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend")
for n in ("ffffff-129", "ffffff-130"):
    o = bpy.data.objects[n]
    print("UV", n, "layers:", [l.name for l in o.data.uv_layers], "polys", len(o.data.polygons))
for n in ("wall_tableTop-0", "wall_tableTop-9", "wall_tableTop-18", "wall_tableTop-27",
          "cloth-0", "cloth-9", "cloth-18", "cloth-27"):
    o = bpy.data.objects.get(n)
    if not o:
        print("MISSING", n); continue
    ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = [min(v[i] for v in ws) for i in range(3)]
    hi = [max(v[i] for v in ws) for i in range(3)]
    print("BBOX", n, "lo", [round(v, 3) for v in lo], "hi", [round(v, 3) for v in hi])
