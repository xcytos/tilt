# side_shot.py -- definitive facing check: profile view of stage from +X
import bpy, math, os, mathutils
BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
OUT = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\bal_side-facing.png"
bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices: d.use = d.type in {"OPTIX", "CUDA"}
scene.cycles.device = "GPU"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 960; scene.render.resolution_y = 540
scene.view_settings.view_transform = "AgX"
cam = bpy.data.cameras.new("cam_side"); cam.lens = 50
co = bpy.data.objects.new("cam_side", cam)
bpy.context.collection.objects.link(co)
# profile from +X looking -X at the thrones (stage center ~ (0,0.35,0.7))
co.location = (7.5, 0.35, 1.4)
target = mathutils.Vector((0, 0.35, 0.7))
di = target - co.location
co.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
cam.dof.use_dof = False
scene.camera = co
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("P005S| saved", OUT)
