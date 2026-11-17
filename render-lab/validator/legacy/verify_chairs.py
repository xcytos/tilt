# verify_chairs.py -- print lux_chair world placement + render table ring view
import bpy, math, os, sys
import mathutils

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
OUT = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\verify_chairs.png"

bpy.ops.wm.open_mainfile(filepath=BLEND)

chairs = [o for o in bpy.data.objects if o.name.startswith("lux_chair")]
print("VC| chairs=%d" % len(chairs))
for o in sorted(chairs, key=lambda x: x.name)[:4]:
    bb = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in bb]; ys=[p.y for p in bb]; zs=[p.z for p in bb]
    print("VC| %s loc=%s z=[%.3f,%.3f] xy=[%.2f,%.2f] hide_r=%s hide_v=%s" % (
        o.name, tuple(round(v,3) for v in o.location), min(zs), max(zs),
        (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, o.hide_render, o.hide_viewport))
# any chair near table (4.69, 4.11)?
near = [o for o in chairs if abs(o.location.x-4.69)<1.6 and abs(o.location.y-4.11)<1.6]
print("VC| chairs near table(4.69,4.11): %d" % len(near))

# custom elevated view of that table ring
camc = bpy.data.cameras.new("vcam"); camc.lens = 32
cam = bpy.data.objects.new("vcam", camc)
bpy.context.scene.collection.objects.link(cam)
cam.location = (4.69, 9.6, 3.2)
target = mathutils.Vector((4.69, 4.11, 0.35))
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
camc.dof.use_dof = False
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices: d.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("VC| RENDERED", OUT)
