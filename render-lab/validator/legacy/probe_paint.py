import bpy, mathutils
def bb(o):
    pts=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return [round(min(xs),4),round(max(xs),4),round(min(ys),4),round(max(ys),4),round(min(zs),4),round(max(zs),4)]
for n in ("trim.001","wall_panelIn.002","painting_0","trim.002","wall_panelIn","painting_1","trim.004","wall_panelIn.003","painting_2","trim.005","wall_panelIn.001","painting_3"):
    o=bpy.data.objects.get(n)
    print(n, bb(o) if o else "MISSING", "loc", [round(v,3) for v in o.location] if o else "")
