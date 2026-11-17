# diag2.py -- grand-high camera raycast + light/world audit
import bpy, math, os, sys
import mathutils

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
sys.path.insert(0, r"C:\Users\syedm\Downloads\tools\TILT\render-lab")
from ballroom_common import SHOTS, FT

bpy.ops.wm.open_mainfile(filepath=BLEND)
S = SHOTS["grand-high"]
loc = mathutils.Vector((S["loc"][0] * FT, -S["loc"][2] * FT, S["loc"][1] * FT))
tgt = mathutils.Vector((S["look"][0] * FT, -S["look"][2] * FT, S["look"][1] * FT))
print("DIAG2| loc=%s tgt=%s" % (tuple(round(v,3) for v in loc), tuple(round(v,3) for v in tgt)))

camc = bpy.data.cameras.new("d2"); camc.lens = S["lens"]
cam = bpy.data.objects.new("d2", camc)
bpy.context.scene.collection.objects.link(cam)
cam.location = loc
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (tgt - loc).to_track_quat("-Z", "Y")
bpy.context.scene.camera = cam

deps = bpy.context.evaluated_depsgraph_get()
d = (tgt - loc).normalized()
ok, hp, nrm, idx, obj, mat = bpy.context.scene.ray_cast(deps, loc, d)
print("DIAG2| center-ray hit=%s obj=%s at=%s n=%s" % (
    ok, obj.name if obj else None,
    tuple(round(v,2) for v in hp) if ok else None,
    tuple(round(v,2) for v in nrm) if ok else None))

# corner rays of the frame (approx via camera frame)
bpy.context.view_layer.update()
frame = [cam.matrix_world @ v for v in cam.data.view_frame(scene=bpy.context.scene)]
print("DIAG2| view_frame corners:", [tuple(round(v,2) for v in c) for c in frame])
for i, c in enumerate(frame):
    rd = (c - loc).normalized()
    ok2, hp2, n2, i2, o2, m2 = bpy.context.scene.ray_cast(deps, loc, rd)
    print("DIAG2| corner%d hit=%s obj=%s at=%s" % (
        i, ok2, o2.name if o2 else None, tuple(round(v,2) for v in hp2) if ok2 else None))

scene = bpy.context.scene
print("DIAG2| world=%s" % (scene.world.name if scene.world else None))
if scene.world and scene.world.use_nodes:
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        print("DIAG2| bg color=%s strength=%s" % (tuple(bg.inputs[0].default_value), bg.inputs[1].default_value))
lights = [o for o in bpy.data.objects if o.type == "LIGHT"]
print("DIAG2| lights=%d %s" % (len(lights), [(o.name, o.data.energy) for o in lights[:8]]))
print("DIAG2| film_transparent=%s exposure=%s" % (scene.render.film_transparent, scene.view_settings.exposure))
