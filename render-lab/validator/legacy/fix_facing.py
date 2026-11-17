# fix_facing.py -- P-005: flip wedding furniture to face +Y audience
import bpy, os, math
from mathutils import Vector

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"

def bbox_world(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return min(xs),max(xs),min(ys),max(ys),min(zs),max(zs)

bpy.ops.wm.open_mainfile(filepath=BLEND)

# front=+Y at rz=0 (verified: rz=180 showed backs). Thrones face audience straight;
# sofas angle 15deg toward stage center.
targets = {
    "wed_throne_L": 0,
    "wed_throne_R": 0,
    "wed_sofa_L": -15,
    "wed_sofa_R": 15,
}
for name, rz in targets.items():
    o = bpy.data.objects.get(name)
    assert o, name
    # rotate about own center: save xy center, rotate, re-center
    x0,x1,y0,y1,z0,z1 = bbox_world(o)
    cx, cy = (x0+x1)/2, (y0+y1)/2
    o.rotation_euler[2] = math.radians(rz)
    bpy.context.view_layer.update()
    x0,x1,y0,y1,z0,z1 = bbox_world(o)
    o.location.x += cx - (x0+x1)/2
    o.location.y += cy - (y0+y1)/2
    bpy.context.view_layer.update()
    x0,x1,y0,y1,z0,z1 = bbox_world(o)
    assert abs(z0) < 0.02, f"{name} z0={z0}"
    assert x0 > -6.7 and x1 < 6.7 and y0 > -2.74 and y1 < 2.74, f"{name} off stage"
    print(f"P005| {name}: rz={rz} x[{x0:.2f},{x1:.2f}] y[{y0:.2f},{y1:.2f}] z[{z0:.3f},{z1:.3f}]")

bpy.ops.wm.save_mainfile(filepath=os.path.abspath(BLEND))
print("P005| SAVED facing fix")
