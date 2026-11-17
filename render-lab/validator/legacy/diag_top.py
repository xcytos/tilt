# diag_top.py -- why does debug-top render eye-level drapes?
import bpy, math, os, sys
import mathutils

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
OUT = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\diag_top.png"
sys.path.insert(0, r"C:\Users\syedm\Downloads\tools\TILT\render-lab")
from ballroom_common import SHOTS, FT

bpy.ops.wm.open_mainfile(filepath=BLEND)
S = SHOTS["debug-top"]
loc = mathutils.Vector((S["loc"][0] * FT, -S["loc"][2] * FT, S["loc"][1] * FT))
tgt = mathutils.Vector((S["look"][0] * FT, -S["look"][2] * FT, S["look"][1] * FT))
print("DIAG| debug-top loc=%s tgt=%s" % (tuple(round(v,3) for v in loc), tuple(round(v,3) for v in tgt)))

camc = bpy.data.cameras.new("diag_cam"); camc.lens = S["lens"]
cam = bpy.data.objects.new("diag_cam", camc)
bpy.context.scene.collection.objects.link(cam)
cam.location = loc
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (tgt - loc).to_track_quat("-Z", "Y")
bpy.context.scene.camera = cam

# objects whose world bbox contains or is very close to the camera
hits = []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    lo = (min(xs), min(ys), min(zs)); hi = (max(xs), max(ys), max(zs))
    # distance from camera point to bbox
    dx = max(lo[0]-loc.x, 0, loc.x-hi[0])
    dy = max(lo[1]-loc.y, 0, loc.y-hi[1])
    dz = max(lo[2]-loc.z, 0, loc.z-hi[2])
    d = (dx*dx+dy*dy+dz*dz) ** 0.5
    hits.append((d, o.name, tuple(round(v,2) for v in lo), tuple(round(v,2) for v in hi)))
hits.sort()
for h in hits[:12]:
    print("DIAG| near: d=%.2f %s lo=%s hi=%s" % h)

# what does the camera SEE along -Z? ray cast
deps = bpy.context.evaluated_depsgraph_get()
ok, loc_h, nrm, idx, obj, mat = bpy.context.scene.ray_cast(deps, loc, (tgt-loc).normalized())
print("DIAG| raycast hit=%s obj=%s at=%s" % (ok, obj.name if obj else None,
      tuple(round(v,2) for v in loc_h) if ok else None))

scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices: d.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.render.filepath = OUT
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("DIAG| RENDERED", OUT)
