# diag_facing.py -- determine which way thrones/sofas face (backrest side = local back)
import bpy, math
from mathutils import Vector

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

for name in ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R"):
    o = bpy.data.objects[name]
    # world-space vertices of the upper backrest region (top 40% of height)
    zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
    zmax = max(zs); zmin = min(zs)
    thr = zmin + 0.65 * (zmax - zmin)
    top = [o.matrix_world @ v.co for v in o.data.vertices if (o.matrix_world @ v.co).z >= thr]
    # backrest panel sits at the BACK: mean of top verts is biased toward the back side
    my = sum(p.y for p in top) / len(top)
    mx = sum(p.x for p in top) / len(top)
    # also bbox center y for reference
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    # back offset from center in world Y (positive => back toward +Y audience = WRONG)
    print(f"P005F| {name}: rz={math.degrees(o.rotation_euler[2]):.0f} topMeanY={my:.3f} bboxCy={cy:.3f} backOffsetY={my-cy:+.3f} -> {'BACKS to +Y (wrong)' if my-cy > 0.05 else 'front to +Y (ok)' if my-cy < -0.05 else 'ambiguous'}")
