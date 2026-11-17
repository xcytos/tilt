import bpy
print("=== blend:", bpy.data.filepath)
if bpy.context.scene.camera:
    c = bpy.context.scene.camera
    print("scene.camera:", c.name, "loc", tuple(round(v, 4) for v in c.location))
else:
    print("scene.camera: None")
for o in bpy.data.objects:
    if o.type == 'CAMERA':
        cd = o.data
        dof = cd.dof
        print("CAM %s lens=%.2f shift=(%.3f, %.3f) clip_end=%.1f dof_on=%s fstop=%.2f focus=%.3f"
              % (o.name, cd.lens, cd.shift_x, cd.shift_y, cd.clip_end,
                 dof.use_dof, dof.aperture_fstop if dof.use_dof else -1,
                 dof.focus_distance if dof.use_dof else -1))
        print("    loc", tuple(round(v, 4) for v in o.matrix_world.translation))
        print("    mode=%s euler=%s" % (o.rotation_mode,
              tuple(round(v, 4) for v in o.rotation_euler)))
        fwd = (o.matrix_world.col[2].xyz * -1.0)
        print("    fwd", tuple(round(v, 4) for v in fwd.normalized()))
print("=== end")
