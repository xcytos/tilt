import bpy, math
bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend")
ch = bpy.data.objects["lux_chair_00"]
print("U| chair00 quat=%s matrixEulerZ=%.1f storedEulerZ=%.1f" % (tuple(round(q,4) for q in ch.rotation_quaternion), math.degrees(ch.matrix_world.to_euler()[2]), math.degrees(ch.rotation_euler[2])))
o = bpy.data.objects["lux_chair_001"]
print("U| chair001 before: quat=%s matrixZ=%.1f eulerZ=%.1f" % (tuple(round(q,4) for q in o.rotation_quaternion), math.degrees(o.matrix_world.to_euler()[2]), math.degrees(o.rotation_euler[2])))
o.rotation_euler = (0.0, 0.0, math.radians(123))   # vector assign like ca049
bpy.context.view_layer.update()
print("U| after vector assign: matrixZ=%.1f quat=%s" % (math.degrees(o.matrix_world.to_euler()[2]), tuple(round(q,4) for q in o.rotation_quaternion)))
