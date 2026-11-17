import bpy, sys
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=sys.argv[sys.argv.index("--")+1])
def ybox(o):
    pts=[o.matrix_world@Vector(c) for c in o.bound_box]
    return min(p.y for p in pts), max(p.y for p in pts)
drapes=[o for o in bpy.data.objects if o.name in ("ffffff-129","ffffff-130")]
dmax=max(ybox(o)[1] for o in drapes)
print("G| drape frontY=%.3f" % dmax)
for nm in ("wed_throne_L","wed_throne_R","wed_sofa_L","wed_sofa_R"):
    o=bpy.data.objects[nm]
    y0,y1=ybox(o)
    print("G| %s backY=%.3f gap=%.3f ft=%.2f" % (nm,y0,y0-dmax,(y0-dmax)/0.3048))
