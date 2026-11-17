# place_wedding.py -- P-005: import wedding furniture onto stage top z=0
#   2x shelter wingback (bride/groom thrones) center, 2x haven loveseat flanking
#   audience = +Y (cameras at +Y). Real-world meters, Innerscene GLBs floor-at-zero.
import bpy, os, math, sys
from mathutils import Vector

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
ASSETS = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets"
THRONE = os.path.join(ASSETS, "shelter_wingback.glb")
SOFA = os.path.join(ASSETS, "haven_loveseat.glb")

def bbox_world(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    # join into one object for easy placement
    if not new:
        raise RuntimeError("no mesh from " + path)
    bpy.ops.object.select_all(action='DESELECT')
    for o in new: o.select_set(True)
    bpy.context.view_layer.objects.active = new[0]
    if len(new) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = os.path.basename(path).replace(".glb", "") + "_imported"
    return obj

def place(obj, x, y, rz_deg, label):
    # drop to stage top z=0 (carpet top), then rotate, then set xy
    x0, x1, y0, y1, z0, z1 = bbox_world(obj)
    obj.location.z -= z0
    obj.rotation_euler[2] = math.radians(rz_deg)
    # re-evaluate bbox after rot for centering: move so bbox center lands at (x,y)
    bpy.context.view_layer.update()
    x0, x1, y0, y1, z0, z1 = bbox_world(obj)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    obj.location.x += x - cx
    obj.location.y += y - cy
    bpy.context.view_layer.update()
    x0, x1, y0, y1, z0, z1 = bbox_world(obj)
    print(f"P005| {label}: x[{x0:.2f},{x1:.2f}] y[{y0:.2f},{y1:.2f}] z[{z0:.3f},{z1:.3f}] rz={rz_deg}")

bpy.ops.wm.open_mainfile(filepath=BLEND)

# detect throne front: back = tall side along local Y after import (unrotated).
# shelter wingback: back panel is the tall thin side. Use pre-rot bbox: if depth(Y) > width(X) it's already front-along-X...
# Simpler: Innerscene convention = front faces -Y (viewer side). We want front toward +Y audience => rz=180.
# Verify with seat-cushion heuristic: seat cushion centroid is toward the front.
# We'll just render-verify; start with front=+Y => if model front is -Y, rotate 180.

# --- 2 thrones center (bride/groom), slightly apart, facing +Y audience ---
t1 = import_glb(THRONE)
t1.name = "wed_throne_L"
place(t1, -0.60, 0.35, 180, "throne_L")   # will verify facing via render; flip if wrong
t2 = import_glb(THRONE)
t2.name = "wed_throne_R"
place(t2, 0.60, 0.35, 180, "throne_R")

# --- 2 sofas flanking, angled slightly toward center ---
s1 = import_glb(SOFA)
s1.name = "wed_sofa_L"
place(s1, -3.9, 0.2, 165, "sofa_L")   # +15deg toward center if front=+Y... front=+Y at rz=0 => angle in
s2 = import_glb(SOFA)
s2.name = "wed_sofa_R"
place(s2, 3.9, 0.2, 195, "sofa_R")

# stage bounds sanity (44x18ft => x +-6.71, y +-2.74)
for o in (t1, t2, s1, s2):
    x0, x1, y0, y1, z0, z1 = bbox_world(o)
    assert x0 > -6.7 and x1 < 6.7 and y0 > -2.74 and y1 < 2.74, f"{o.name} off stage!"
    assert abs(z0) < 0.02, f"{o.name} not on stage top: z0={z0}"

bpy.ops.wm.save_mainfile(filepath=os.path.abspath(BLEND))
print("P005| SAVED wedding furniture")
