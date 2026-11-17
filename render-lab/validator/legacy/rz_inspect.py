import bpy, sys, math
from mathutils import Vector
for path in (r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend",
             r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"):
    bpy.ops.wm.open_mainfile(filepath=path)
    print("FILE|", path.split("\\")[-3])
    for nm in ("wed_throne_L","wed_sofa_L"):
        o = bpy.data.objects[nm]
        print("RZ| %s rz=%.1f mode=%s" % (nm, math.degrees(o.rotation_euler[2]), o.rotation_mode))
