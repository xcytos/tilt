import bpy, mathutils, os
OUT = r"C:\Users\syedm\AppData\Local\Temp\opencode"
scn = bpy.context.scene
scn.render.resolution_x = 1280
scn.render.resolution_y = 720
scn.cycles.samples = 48
def shot(name, loc, target):
    cam_data = bpy.data.cameras.new("dbg")
    cam = bpy.data.objects.new("dbg", cam_data)
    scn.collection.objects.link(cam)
    cam.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    cam_data.lens = 24
    scn.camera = cam
    scn.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
# left wall (x=-9.1) faces +X; stand in room center-ish, look -X at the two squares (y -0.6..0.9, 3.8..5.3)
shot("dbg_wall_left.png",  (-2.0, 2.4, 2.0), (-9.1, 2.4, 2.0))
# right wall (x=+9.1) faces -X
shot("dbg_wall_right.png", (2.0, 2.4, 2.0),  (9.1, 2.4, 2.0))
print("DBG DONE")
