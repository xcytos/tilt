import bpy

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend")
for o in bpy.data.objects:
    if "clock" in o.name.lower():
        print("CLOCK", repr(o.name), o.type, "scale", tuple(round(v, 3) for v in o.scale),
              "parent", o.parent.name if o.parent else None)
for mname in ("cloth", "silk_drape", "cloth_tbl"):
    m = bpy.data.materials.get(mname)
    users = [o.name for o in bpy.data.objects
             if any(sl.material and sl.material.name == mname for sl in o.material_slots)]
    print("MAT", mname, "exists", m is not None, "fake", bool(m and m.use_fake_user), "users", users)
