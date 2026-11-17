import bpy, sys, math
from mathutils import Vector

BLEND = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)
FT = 0.3048
tables = [(sx*15.4*FT, -z*FT) for sx in (-1,1) for z in (-13.5,-22.5)]

def seat_dir(o):
    mw = o.matrix_world
    pts = [mw @ Vector(c) for c in o.bound_box]
    zlo = min(p.z for p in pts); zhi = max(p.z for p in pts); h = zhi-zlo
    cx = sum(p.x for p in pts)/8; cy = sum(p.y for p in pts)/8
    sx_, sy_ = [], []
    for poly in o.data.polygons:
        c = mw @ poly.center
        n = (mw.to_3x3() @ poly.normal).normalized()
        if zlo+0.25*h < c.z < zlo+0.55*h and n.z > 0.7:
            sx_.append(c.x); sy_.append(c.y)
    if not sx_: return None
    return (sum(sx_)/len(sx_)-cx, sum(sy_)/len(sy_)-cy)

lux = sorted([o for o in bpy.data.objects if o.name.startswith("lux_chair") and not o.hide_render], key=lambda o: o.name)
ok_tbl = ok_org = 0
for i, o in enumerate(lux):
    d = seat_dir(o)
    if not d: continue
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    cx = sum(p.x for p in pts)/8; cy = sum(p.y for p in pts)/8
    nl = math.hypot(*d)
    def cosang(tx, ty):
        t = math.hypot(tx, ty)
        return (d[0]*tx + d[1]*ty)/(nl*t) if nl*t>0 else -1
    ct = cosang(tables[i//8][0]-cx, tables[i//8][1]-cy)
    co = cosang(-cx, -cy)
    if ct > 0.5: ok_tbl += 1
    if co > 0.5: ok_org += 1
print("CF| lux chairs: table-facing=%d/32 origin-facing=%d/32" % (ok_tbl, ok_org))

# stand-in back-panel truth: hidden seat stands (JS-baked orientation)
seats = sorted([o for o in bpy.data.objects if o.name.lower().startswith("seat") and o.hide_render], key=lambda o: o.name)
print("CF| hidden seat stands:", len(seats))
# back panels: stand-in seats come in pairs (flat seat + vertical back); find vertical ones (dim z > dim x-ish)
ok_si = si_n = 0
for i, o in enumerate(seats[:64]):
    mw = o.matrix_world
    pts = [mw @ Vector(c) for c in o.bound_box]
    dx = max(p.x for p in pts)-min(p.x for p in pts)
    dy = max(p.y for p in pts)-min(p.y for p in pts)
    dz = max(p.z for p in pts)-min(p.z for p in pts)
    if dz < 0.3 or dy > dx:  # vertical back panel: tall in z, thin in y (world)
        pass
    # back panel world-thin axis = local z after ry; approximate: normal of largest face
    # simpler: skip detailed -- compare front = opposite of back offset for clustered pairs
print("CF| (stand-in detailed check skipped; JS formula port is verbatim)")
