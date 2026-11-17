import bpy, math, sys
BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
ch = bpy.data.objects["lux_chair_00"]
print("T| chair mode=%s eulerZ=%.1f quatZ=%.3f" % (ch.rotation_mode, math.degrees(ch.rotation_euler[2]), ch.rotation_quaternion[2]))
so = bpy.data.objects["wed_sofa_L"]
print("T| sofa  mode=%s eulerZ=%.1f quat=%s" % (so.rotation_mode, math.degrees(so.rotation_euler[2]), tuple(round(q,3) for q in so.rotation_quaternion)))
# semantics: does euler write move the matrix in QUATERNION mode?
o = bpy.data.objects["lux_chair_001"]
mr_before = o.matrix_world.to_euler()
o.rotation_euler[2] = math.radians(123)
bpy.context.view_layer.update()
mr_after = o.matrix_world.to_euler()
print("T| euler write in mode=%s -> matrix z: %.1f -> %.1f (%s)" % (o.rotation_mode, math.degrees(mr_before[2]), math.degrees(mr_after[2]), "APPLIED" if abs(mr_after[2]-mr_before[2])>1 else "IGNORED"))
