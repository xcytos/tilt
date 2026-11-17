import bpy, json

scene = bpy.context.scene
out = {
    "scene_camera": scene.camera.name if scene.camera else None,
    "resolution": [scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage],
    "pixel_aspect": [scene.render.pixel_aspect_x, scene.render.pixel_aspect_y],
    "use_border": scene.render.use_border,
    "use_crop_to_border": scene.render.use_crop_to_border,
    "border": [scene.render.border_min_x, scene.render.border_max_x, scene.render.border_min_y, scene.render.border_max_y],
    "cameras": [],
    "views": [],
}

for ob in bpy.data.objects:
    if ob.type != "CAMERA":
        continue
    c = ob.data
    out["cameras"].append({
        "name": ob.name,
        "is_scene_cam": scene.camera is ob,
        "lens": round(c.lens, 2),
        "sensor": [c.sensor_width, c.sensor_height],
        "sensor_fit": c.sensor_fit,
        "clip": [round(c.clip_start, 4), round(c.clip_end, 1)],
        "shift": [round(c.shift_x, 3), round(c.shift_y, 3)],
        "dof": c.dof.use_dof,
        "fstop": round(c.dof.aperture_fstop, 2) if c.dof.use_dof else None,
        "loc": [round(v, 3) for v in ob.location],
        "rot_deg": [round(v * 57.2958, 1) for v in ob.rotation_euler],
        "scale": [round(v, 4) for v in ob.scale],
        "hidden": ob.hide_get() if ob.name in bpy.context.view_layer.objects else ob.hide_viewport,
    })

for v in bpy.data.scenes[0].view_layers:
    out["views"].append(v.name)

sys_out = "CAM_DUMP<<<" + json.dumps(out) + ">>>"
import sys
sys.stdout.write(sys_out)
