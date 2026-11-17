import bpy, math, mathutils, os, sys
OUT = r"C:\Users\syedm\AppData\Local\Temp\opencode"
scn = bpy.context.scene
# camera close to wall, looking at upper center (clock area + wall above drapes)
cam_data = bpy.data.cameras.new("dbg")
cam = bpy.data.objects.new("dbg", cam_data)
scn.collection.objects.link(cam)
cam.location = (0.0, -1.5, 3.9)
d = mathutils.Vector((0.0, -5.16, 3.9)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
cam_data.lens = 24
scn.camera = cam
scn.render.resolution_x = 1024
scn.render.resolution_y = 768
scn.cycles.samples = 48
scn.render.filepath = os.path.join(OUT, "dbg_wall.png")
bpy.ops.render.render(write_still=True)
print("DBG DONE")
