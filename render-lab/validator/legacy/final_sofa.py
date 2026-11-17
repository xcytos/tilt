# front_shot.py -- definitive facing check: close-up from audience +Y
import bpy, math, mathutils
BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
OUT = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\bal_front-sofa.png"
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
cam = bpy.data.cameras.new("cam_front"); cam.lens = 50
co = bpy.data.objects.new("cam_front", cam)
bpy.context.collection.objects.link(co)
co.location = (-3.9, 3.6, 1.6)          # audience side, looking at sofa_L
target = mathutils.Vector((-3.9, 0.2, 0.5))
di = target - co.location
co.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
cam.dof.use_dof = False
scene.camera = co
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("P005B| saved", OUT)

