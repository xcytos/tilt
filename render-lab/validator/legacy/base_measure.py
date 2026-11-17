import bpy
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend")
# anything in stage zone that belongs to the s-curve stands (poles/bases)
for o in bpy.data.objects:
    if o.type!="MESH" or o.hide_render: continue
    n=o.name.lower()
    if n.startswith(("pole","base","stand","drape")) or "ffffff" in n:
        pts=[o.matrix_world@Vector(c) for c in o.bound_box]
        y0=min(p.y for p in pts); y1=max(p.y for p in pts)
        if -3 < (min(p.x for p in pts)+max(p.x for p in pts))/2 < 3 and y1>-1:
            print("B| %s y=[%.3f,%.3f]" % (o.name,y0,y1))
