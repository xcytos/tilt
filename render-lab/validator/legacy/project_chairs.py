# project_chairs.py -- print screen-pixel coords of the 8 chairs at table (4.69,4.11)
import bpy, math, os, sys
import mathutils
from bpy_extras.object_utils import world_to_camera_view

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

# same camera as verify_chairs.py
camc = bpy.data.cameras.new("pcam"); camc.lens = 32
cam = bpy.data.objects.new("pcam", camc)
bpy.context.scene.collection.objects.link(cam)
cam.location = (4.69, 9.6, 3.2)
target = mathutils.Vector((4.69, 4.11, 0.35))
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
bpy.context.scene.camera = cam
bpy.context.view_layer.update()

W, H = 1600, 900
chairs = [o for o in bpy.data.objects
          if o.name.startswith("lux_chair") and abs(o.location.x - 4.69) < 1.6
          and abs(o.location.y - 4.11) < 1.6]
print("PC| near chairs:", len(chairs))
for o in sorted(chairs, key=lambda x: x.name):
    # sample a point at mid-backrest height (z ~ 0.1 above floor world)
    co = mathutils.Vector((o.location.x, o.location.y, 0.05))
    uv = world_to_camera_view(bpy.context.scene, cam, co)
    px, py = int(uv.x * W), int((1 - uv.y) * H)
    print("PC| %s loc=(%.2f,%.2f) uv=(%.3f,%.3f) px=(%d,%d)" % (
        o.name, o.location.x, o.location.y, uv.x, uv.y, px, py))
# also table center for reference
uv = world_to_camera_view(bpy.context.scene, cam, mathutils.Vector((4.69, 4.11, 0.43)))
print("PC| table_top px=(%d,%d)" % (int(uv.x * W), int((1 - uv.y) * H)))
