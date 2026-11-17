# seat_facing.py -- definitive facing: seat-top faces (normal +Z at seat height) mark the FRONT
import bpy, sys, math
from mathutils import Vector

BLEND = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

for nm in ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R"):
    o = bpy.data.objects[nm]
    mw = o.matrix_world
    pts = [mw @ Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    cy = (min(ys)+max(ys))/2
    # seat top: polygons whose world normal is up and center at seat height
    sy = []
    for poly in o.data.polygons:
        c = mw @ poly.center
        n = (mw.to_3x3() @ poly.normal).normalized()
        if 0.28 < c.z < 0.62 and n.z > 0.7:
            sy.append(c.y)
    if sy:
        my = sum(sy)/len(sy)
        off = my - cy
        verdict = "FRONT at +Y (ok)" if off > 0.05 else "FRONT at -Y (WRONG, flip 180)"
        print("SF| %s: seatFaces=%d seatMeanY=%.3f bboxCy=%.3f frontOffset=%+.3f -> %s"
              % (nm, len(sy), my, cy, off, verdict))
    else:
        print("SF| %s: NO seat faces found (rz=%.0f)" % (nm, math.degrees(o.rotation_euler[2])))
