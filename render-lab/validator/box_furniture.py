# box_furniture -- wedding furniture on stage + chair facing + P-012 ray-
# contact plush pillows and P-010 table mats. (P-004/005/006/010/012)
# Stage bounds, rig gap, chair clearance and mat positions all derive from
# the skirt object, so the checks hold at any recalc'd stage size.
import math
import re

import bpy
import mathutils

from lib import register, Box, bbox, dims, center, image_names

FT = 0.3048
RIG_HEX = re.compile(r"^[0-9a-f]{6}(-|$)", re.I)


def run(ctx):
    # stage bounds from the skirt -> valid at any size (44x18 defaults
    # give the historic -6.7/6.7, -2.74/2.74 grid)
    sk = bpy.data.objects.get("skirt")
    ctx.chk(sk is not None, "skirt object present")
    if not sk:
        return
    sk_lo, sk_hi = bbox(sk)

    # rig footprint (same detection as update_scurve.py)
    rig = [o for o in bpy.data.objects if o.type == "MESH"
           and (RIG_HEX.match(o.name.lower())
                or o.name.lower().startswith("wall_stand"))]
    rig_front = max((bbox(o)[1][1] for o in rig), default=None)
    # design reference: default rig front face sits at y=0.341 m
    furn_dy = (rig_front - 0.341) if rig_front is not None else 0.0

    # thrones/sofas: on stage, seat front at +Y (audience side)
    for nm in ("wed_throne_L", "wed_throne_R", "wed_sofa_L", "wed_sofa_R"):
        o = bpy.data.objects.get(nm)
        ctx.chk(o is not None, nm + " exists")
        if not o:
            continue
        lo, hi = bbox(o)
        ctx.chk(abs(lo[2]) < 0.02
                and lo[0] > sk_lo[0] + 0.005 and hi[0] < sk_hi[0] - 0.005
                and lo[1] > sk_lo[1] + 0.005 and hi[1] < sk_hi[1] - 0.005,
                nm + " on stage (z0=%.3f)" % lo[2])
        sy = []
        for poly in o.data.polygons:
            c = o.matrix_world @ poly.center
            n = (o.matrix_world.to_3x3() @ poly.normal).normalized()
            if 0.28 < c.z < 0.62 and n.z > 0.7:
                sy.append(c.y)
        if sy:
            my = sum(sy) / len(sy)
            cy = (lo[1] + hi[1]) / 2
            ctx.chk(my - cy > 0.01,
                    "%s front at +Y (seatOffset %+.3f)" % (nm, my - cy))

    # 2ft throne-sofa gap (TILT wedding layout)
    sofa = bbox(bpy.data.objects["wed_sofa_R"]) if "wed_sofa_R" in bpy.data.objects else None
    thr = bbox(bpy.data.objects["wed_throne_R"]) if "wed_throne_R" in bpy.data.objects else None
    if sofa and thr:
        gap = thr[0][0] - sofa[1][0] if thr[0][0] > sofa[1][0] else sofa[0][0] - thr[1][0]
        ctx.chk(abs(gap - 0.6096) < 0.03, "throne-sofa gap 2ft (%.3f)" % gap)
    else:
        ctx.chk(False, "throne/sofa objects found")

    # rig front -> furniture back: design gap 0.605 m, floor 0.58 m -
    # the no-converging-intersection gate between rig and wedding set
    wedges = [n for n in ("wed_throne_L", "wed_throne_R",
                          "wed_sofa_L", "wed_sofa_R")
              if n in bpy.data.objects]
    if rig_front is not None and wedges:
        furn_back = min(bbox(bpy.data.objects[n])[0][1] for n in wedges)
        gap = furn_back - rig_front
        ctx.chk(gap >= 0.58, "rig<->furniture gap %.3f m (design 0.605)" % gap)

    # rig must stand inside the stage with a 1 ft margin all round
    if rig:
        rlo = [min(bbox(o)[0][i] for o in rig) for i in range(3)]
        rhi = [max(bbox(o)[1][i] for o in rig) for i in range(3)]
        ctx.chk(rlo[0] > sk_lo[0] + FT and rhi[0] < sk_hi[0] - FT
                and rlo[1] > sk_lo[1] + FT and rhi[1] < sk_hi[1] - FT,
                "rig inside stage 1ft margin (x %.2f..%.2f y %.2f..%.2f)"
                % (rlo[0], rhi[0], rlo[1], rhi[1]))

    # chairs face scene origin -- verbatim ballroom.js ry=atan2 port
    chairs = [o for o in bpy.data.objects if o.name.startswith("lux_chair")
              and not o.hide_render]
    ctx.chk(len(chairs) == 32, "32 visible chairs (got %d)" % len(chairs))
    facing_ok = 0
    for o in chairs:
        mw = o.matrix_world
        pts = [mw @ mathutils.Vector(c) for c in o.bound_box]
        zs = [p.z for p in pts]
        zlo, zhi = min(zs), max(zs)
        h = zhi - zlo
        cx = sum(p.x for p in pts) / 8
        cy = sum(p.y for p in pts) / 8
        sx_, sy_ = [], []
        for poly in o.data.polygons:
            c = mw @ poly.center
            n = (mw.to_3x3() @ poly.normal).normalized()
            if zlo + 0.25 * h < c.z < zlo + 0.55 * h and n.z > 0.7:
                sx_.append(c.x)
                sy_.append(c.y)
        if not sx_:
            continue
        fx, fy = sum(sx_) / len(sx_) - cx, sum(sy_) / len(sy_) - cy
        tx, ty = -cx, -cy
        nl = math.hypot(fx, fy) * math.hypot(tx, ty)
        if nl > 0 and (fx * tx + fy * ty) / nl > 0.5:
            facing_ok += 1
    ctx.chk(facing_ok == 32, "32 chairs face origin (got %d)" % facing_ok)

    # chairs stand clear of the stage skirt (row 1 clears by ~0.14 m at
    # the design 5.25 ft row offset; the old -4.5 row CUT INTO the skirt)
    if chairs:
        chair_front = min(bbox(o)[0][1] for o in chairs)
        clr = chair_front - sk_hi[1]
        ctx.chk(clr >= 0.10,
                "chairs clear stage front %.2f m (min y %.2f)"
                % (clr, chair_front))

    # P-012 pillows: 6 plush square knife-edge pillows, ray-verified contact
    # (r1: rest on seat top, back against the backrest face, no penetration)
    sites = {
        "pillow_throne_L": "wed_throne_L",
        "pillow_throne_R": "wed_throne_R",
        "pillow_sofa_L1": "wed_sofa_L",
        "pillow_sofa_L2": "wed_sofa_L",
        "pillow_sofa_R1": "wed_sofa_R",
        "pillow_sofa_R2": "wed_sofa_R",
    }

    def _hit(seat, origin, direction):
        inv = seat.matrix_world.inverted()
        o = inv @ mathutils.Vector(origin)
        d = (inv.to_3x3() @ mathutils.Vector(direction)).normalized()
        hit, loc, nrm, _i = seat.ray_cast(o, d, distance=60.0)
        if not hit:
            return None
        return (seat.matrix_world @ loc,
                (inv.transposed().to_3x3() @ nrm).normalized())

    for name, seat_name in sites.items():
        o = bpy.data.objects.get(name)
        ctx.chk(o is not None, name + " exists")
        if not o:
            continue
        seat = bpy.data.objects.get(seat_name)
        if seat is None:
            ctx.chk(False, "%s seat %s present" % (name, seat_name))
            continue
        lo, hi = bbox(o)
        cx = (lo[0] + hi[0]) / 2.0
        depth = hi[1] - lo[1]
        # seat top under the front half of the pillow footprint (median,
        # front-half only so the backrest top can never fake a "seat" hit)
        zs = []
        for i in range(-2, 3):
            for fy in (0.55, 0.75, 0.95):
                h = _hit(seat, (cx + i * 0.07, lo[1] + depth * fy, 3.0),
                         (0.0, 0.0, -1.0))
                if h and h[1].z > 0.5:
                    zs.append(h[0].z)
        if not zs:
            ctx.chk(False, "%s seat probe hits" % name)
            continue
        zs.sort()
        seat_z = zs[len(zs) // 2]
        # rendered geometry (evaluated mesh, world) -- empty AABB corners of
        # the tilted box must NOT count as contact or penetration
        dg = bpy.context.evaluated_depsgraph_get()
        oe = o.evaluated_get(dg)
        mme = oe.to_mesh()
        wpts = [o.matrix_world @ v.co for v in mme.vertices]
        oe.to_mesh_clear()
        bottom = min(p.z for p in wpts)
        ctx.chk(seat_z - 0.012 <= bottom <= seat_z + 0.05,
                "%s rests on seat z%.3f (bottom %.3f)"
                % (name, seat_z, bottom))
        # backrest face: first seat-surface hit behind the pillow, at 2 heights
        face_ys = []
        for z in (bottom + 0.10, bottom + (hi[2] - lo[2]) * 0.5):
            h = _hit(seat, (cx, 2.9 + furn_dy, z), (0.0, -1.0, 0.0))
            if h and h[0].y <= 1.95 + furn_dy:
                face_ys.append(h[0].y)
        if not face_ys:
            ctx.chk(False, "%s backrest face probe" % name)
        else:
            y_face = max(face_ys)
            back = min(p.y for p in wpts)
            ctx.chk(y_face - 0.012 <= back <= y_face + 0.12,
                    "%s back on face y%.3f (back %.3f)"
                    % (name, y_face, back))
        # square knife-edge base mesh: equal width/height, shared seam ring,
        # high-center loft (verts live in local space, unrotated)
        bx = [v.co.x for v in o.data.vertices]
        bz = [v.co.z for v in o.data.vertices]
        by = [v.co.y for v in o.data.vertices]
        w0, h0 = max(bx) - min(bx), max(bz) - min(bz)
        ctx.chk(abs(w0 - h0) < 0.02 and 0.38 < w0 < 0.50,
                "%s square base %.2fx%.2f" % (name, w0, h0))
        seam = sum(1 for v in o.data.vertices if abs(v.co.y) < 1e-6)
        ctx.chk(seam >= 4 * 16,
                "%s knife-edge seam verts %d" % (name, seam))
        ctx.chk(max(max(by), -min(by)) >= 0.06,
                "%s plush loft %.3f" % (name, max(max(by), -min(by))))
        m = o.data.materials[0] if o.data.materials else None
        ctx.chk(m is not None and m.name == "silk_drape",
                "%s material silk_drape (got %s)"
                % (name, m.name if m else None))
        ctx.chk(not o.hide_render and any(
            ob is o for ob in bpy.context.scene.objects),
            "%s linked + renderable" % name)

    # P-010 table mats: 4 champagne jacquard runners on banquet table tops
    # (positions derive from the skirt: xcol = 0.35w, rows off the stage edge)
    w_ft = (sk_hi[0] - sk_lo[0]) / FT
    d_ft = (sk_hi[1] - sk_lo[1]) / FT
    xcol = 0.35 * w_ft * FT
    rows = ((d_ft / 2 + 5.25) * FT, (d_ft / 2 + 14.25) * FT)
    tmats = ((-xcol, rows[0]), (-xcol, rows[1]),
             (xcol, rows[0]), (xcol, rows[1]))
    for i, (tx, ty) in enumerate(tmats):
        o = bpy.data.objects.get("table_mat_%d" % i)
        ctx.chk(o is not None, "table_mat_%d exists" % i)
        if not o:
            continue
        d = dims(o)
        c = center(o)
        ctx.chk(abs(c[0] - tx) < 0.02 and abs(c[1] - ty) < 0.02
                and abs(c[2] - 0.439) < 0.02,
                "mat_%d center %s" % (i, [round(v, 3) for v in c]))
        ctx.chk(abs(d[0] - 1.15) < 0.03 and abs(d[1] - 0.45) < 0.03
                and d[2] < 0.03,
                "mat_%d dims %s" % (i, [round(v, 3) for v in d]))
        m = o.data.materials[0] if o.data.materials else None
        ctx.chk(m is not None and m.name == "tableMat",
                "mat_%d material tableMat" % i)
    tm = bpy.data.materials.get("tableMat")
    imgs = image_names(tm)
    ctx.chk(any("champagne" in i for i in imgs),
            "mat champagne jacquard texture (%s)" % imgs)


register(Box(
    name="furniture",
    shot="grand-front",
    keep=["wed_*", "lux_chair*", "table*", "cloth-*", "bloom-*",
          "wall_tableTop*", "pillow_*", "table_mat_*", "carpet", "skirt",
          "floor*", "wall*", "stage_clock", "ffffff-*"],
    run=run))
