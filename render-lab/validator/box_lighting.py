# box_lighting -- P-012 r3 PAR uplights (glass lens + LED diodes + bracket +
# shadows), P-013 emission/light-visibility boost (150W spots, lens 1.6, LED 100),
# continuous under-lip stage strip + floor wash, bloom centerpieces.
# (P-008 + P-010 + P-012 + P-013)
# P-014: PAR x/y derive from the live fabric panel bboxes (quartile centres
# + standoff), so shape-param updates to the S-curve stay valid.
import math
import re

import bpy
import mathutils

from lib import register, Box, bbox, principled

# Static fallback for a blend whose fabric panels are missing (the scurve
# box reports that; lighting keeps its shape so the run still completes).
PAR_X_DEFAULT = (-3.662, -2.744, -1.826, -0.908, 0.908, 1.826, 2.744, 3.662)
PAR_Y_DEFAULT = 0.75
PAR_STANDOFF = 0.414     # update_scurve.py: PAR stands this far behind the front

_FAB = re.compile(r"^ffffff-\d+$")


def par_targets():
    """[(x, y)] for par_0..7: 4 quartile centres per fabric panel,
    left panel first, PAR standoff behind the panel's front face."""
    fabs = [o for o in bpy.data.objects
            if o.type == "MESH" and _FAB.match(o.name)]
    fabs.sort(key=lambda o: bbox(o)[0][0])
    if len(fabs) != 2:
        return [(px, PAR_Y_DEFAULT) for px in PAR_X_DEFAULT]
    out = []
    for p in fabs:
        lo, hi = bbox(p)
        w = hi[0] - lo[0]
        yf = hi[1] + PAR_STANDOFF
        for k in range(4):
            out.append((lo[0] + w * (2 * k + 1) / 8.0, yf))
    return out


def run(ctx):
    # ---- 8 PAR uplights (TILT par spec) ----
    spots = 0
    for i, (px, py) in enumerate(par_targets()):
        root = bpy.data.objects.get("par_%d" % i)
        ctx.chk(root is not None, "par_%d root exists" % i)
        if not root:
            continue
        ctx.chk(abs(root.location.x - px) < 0.02
                and abs(root.location.y - py) < 0.02
                and abs(root.location.z) < 0.01,
                "par_%d at (%.3f, %.3f, 0)" % (i, root.location.x, root.location.y))
        sp = bpy.data.objects.get("par_%d_light" % i)
        lens = bpy.data.objects.get("par_%d_lens" % i)
        can = bpy.data.objects.get("par_%d_can" % i)
        ctx.chk(sp is not None and sp.type == "LIGHT", "par_%d spot light" % i)
        ctx.chk(lens is not None and can is not None, "par_%d can+lens mesh" % i)
        if sp and sp.type == "LIGHT":
            ld = sp.data
            spots += 1
            ctx.chk(abs(math.degrees(ld.spot_size) - 30.0) < 1.0,
                    "par_%d spot_size 30deg (%.1f)" % (i, math.degrees(ld.spot_size)))
            ctx.chk(abs(ld.spot_blend - 0.35) < 0.02,
                    "par_%d blend 0.35" % i)
            ctx.chk(ld.energy >= 100.0,
                    "par_%d spot energy %.0fW" % (i, ld.energy))
            ctx.chk(ld.color[0] > 0.99 and 0.85 < ld.color[1] < 0.93,
                    "par_%d warm color %s" % (i, tuple(round(c, 2) for c in ld.color)))
            d = sp.matrix_world.to_3x3() @ mathutils.Vector((0, 0, -1))
            ctx.chk(d.y < -0.15 and d.z > 0.8,
                    "par_%d aims at drape (%.2f,%.2f,%.2f)" % (i, d.x, d.y, d.z))
            ctx.chk(bool(getattr(ld, "use_shadow", False)),
                    "par_%d casts shadows" % i)
        # ---- P-012 r3: glass lens + LED diodes + mounting bracket ----
        led = bpy.data.objects.get("par_%d_led" % i)
        ctx.chk(led is not None and led.type == "MESH", "par_%d LED array" % i)
        if led:
            lb = principled(led.data.materials[0] if led.data.materials
                            else None)
            ctx.chk(lb is not None
                    and lb.inputs["Emission Strength"].default_value >= 40,
                    "par_%d LED emission %.0f"
                    % (i, lb.inputs["Emission Strength"].default_value
                       if lb else -1))
        if lens:
            lb = principled(lens.data.materials[0] if lens.data.materials
                            else None)
            if lb is None:
                ctx.chk(False, "par_%d lens material" % i)
            else:
                tr = lb.inputs.get("Transmission Weight")
                ctx.chk(tr is not None and tr.default_value >= 0.9,
                        "par_%d lens glass (transmission %.2f)"
                        % (i, tr.default_value if tr else 0.0))
                ctx.chk(lb.inputs["Emission Strength"].default_value >= 1.5,
                        "par_%d lens face emission %.2f"
                        % (i, lb.inputs["Emission Strength"].default_value))
            # local frame (object rotation excluded): cylinder disc in XY
            ext_x = max(c[0] for c in lens.bound_box) - min(c[0] for c in lens.bound_box)
            ext_y = max(c[1] for c in lens.bound_box) - min(c[1] for c in lens.bound_box)
            ext_z = max(c[2] for c in lens.bound_box) - min(c[2] for c in lens.bound_box)
            ctx.chk(abs(ext_x - 0.27) < 0.02 and abs(ext_y - 0.27) < 0.02
                    and ext_z < 0.03,
                    "par_%d lens disc d%.2fx%.2f t%.3f"
                    % (i, ext_x, ext_y, ext_z))
            # P-012: yoke bridge must sit BEHIND the tilted lens plane (no
            # bar across the face from any angle); arms must reach it
            brg = bpy.data.objects.get("par_%d_bridge" % i)
            arm = bpy.data.objects.get("par_%d_armL" % i)
            if brg and arm:
                nrm = (lens.matrix_world.to_3x3()
                       @ mathutils.Vector((0, 0, 1))).normalized()
                lc = lens.matrix_world.translation
                bb = bbox(brg)
                dmax = -1e9
                for sx in (bb[0][0], bb[1][0]):
                    for sy in (bb[0][1], bb[1][1]):
                        for sz in (bb[0][2], bb[1][2]):
                            dmax = max(dmax, nrm.dot(
                                mathutils.Vector((sx, sy, sz)) - lc))
                ctx.chk(dmax < -0.005,
                        "par_%d bridge behind lens plane (%.3fm)" % (i, dmax))
                ab, brb = bbox(arm), bbox(brg)
                ctx.chk(ab[1][2] > brb[0][2] - 0.04
                        and ab[1][1] > brb[0][1] - 0.005,
                        "par_%d arms reach bridge (arm z%.2f y%.2f, bridge z%.2f y%.2f)"
                        % (i, ab[1][2], ab[1][1], brb[0][2], brb[0][1]))
        for pn in ("par_%d_base" % i, "par_%d_knobL" % i,
                   "par_%d_knobR" % i):
            ctx.chk(bpy.data.objects.get(pn) is not None,
                    pn + " bracket part")
        if sp and sp.type == "LIGHT" and lens:
            d_sp = (sp.matrix_world.to_3x3()
                    @ mathutils.Vector((0, 0, -1))).normalized()
            d_ln = (lens.matrix_world.to_3x3()
                    @ mathutils.Vector((0, 0, 1))).normalized()
            ctx.chk(abs(d_sp.dot(d_ln)) > 0.97,
                    "par_%d lens<->spot aligned %.3f"
                    % (i, abs(d_sp.dot(d_ln))))
            dist = (sp.matrix_world.translation
                    - lens.matrix_world.translation).length
            ctx.chk(dist < 0.06,
                    "par_%d lens<->spot coaxial %.3fm" % (i, dist))
    ctx.chk(spots == 8, "8 PAR spots total (%d)" % spots)

    # ---- P-012 continuous under-lip strip + floor wash ----
    ctx.chk(bpy.data.objects.get("stage_strip_L") is None
            and bpy.data.objects.get("stage_strip_R") is None,
            "old split strips removed")
    o = bpy.data.objects.get("stage_strip")
    ctx.chk(o is not None, "stage_strip exists")
    # strip follows the skirt face + width at any recalc'd stage size
    # (defaults: face y=2.75, x ±6.599 at 44x18)
    sk = bpy.data.objects.get("skirt")
    skirt_y = bbox(sk)[1][1] if sk else 2.743
    strip_x = (bbox(sk)[1][0] if sk else 6.706) - 0.35 * 0.3048
    if o:
        lo, hi = bbox(o)
        ctx.chk(abs(lo[1] - (skirt_y + 0.007)) < 0.02 and hi[1] < skirt_y + 0.05,
                "strip on skirt face y=%.3f..%.3f" % (lo[1], hi[1]))
        ctx.chk(abs((lo[2] + hi[2]) / 2 + 0.05) < 0.015,
                "strip under lip z=%.3f" % ((lo[2] + hi[2]) / 2))
        ctx.chk(abs(lo[0] + strip_x) < 0.03 and abs(hi[0] - strip_x) < 0.03,
                "strip continuous x=%.2f..%.2f" % (lo[0], hi[0]))
        m = o.data.materials[0] if o.data.materials else None
        em = None
        if m and m.node_tree:
            em = next((n for n in m.node_tree.nodes if n.type == "EMISSION"),
                      None)
        ctx.chk(em is not None and em.inputs["Strength"].default_value >= 10,
                "strip emission strength %s"
                % (em.inputs["Strength"].default_value if em else None))
        if em:
            c = em.inputs["Color"].default_value
            # warm white 2700-3000K: high R, mid G, low-mid B
            ctx.chk(c[0] > 0.95 and 0.68 < c[1] < 0.85
                    and 0.44 < c[2] < 0.62,
                    "strip warm white %s"
                    % [round(v, 2) for v in c[:3]])
    w = bpy.data.objects.get("stage_wash")
    ctx.chk(w is not None and w.type == "LIGHT", "stage_wash light exists")
    if w and w.type == "LIGHT":
        ctx.chk(w.data.type == "AREA" and w.data.energy >= 60,
                "stage_wash area %.0fW" % w.data.energy)
        d = w.matrix_world.to_3x3() @ mathutils.Vector((0, 0, -1))
        ctx.chk(d.y > 0.25 and d.z < -0.7,
                "stage_wash aims down-forward (%.2f,%.2f,%.2f)"
                % (d.x, d.y, d.z))
        ctx.chk(w.data.color[0] > 0.95 and 0.68 < w.data.color[1] < 0.85
                and 0.44 < w.data.color[2] < 0.62,
                "stage_wash warm white %s"
                % [round(v, 2) for v in w.data.color])

    # ---- bloom centerpieces ----
    bloom = bpy.data.materials.get("bloom")
    b = principled(bloom)
    ctx.chk(b is not None, "bloom material present")
    if b:
        ctx.chk(abs(b.inputs["Emission Strength"].default_value - 22.0) < 0.01,
                "bloom emission=22 (%.1f)" % b.inputs["Emission Strength"].default_value)
        ec = b.inputs["Emission Color"].default_value
        ctx.chk(abs(ec[0] - 1.0) < 0.01 and abs(ec[1] - 0.78) < 0.02,
                "bloom emission color warm")
    bloom_objs = [o.name for o in bpy.data.objects
                  if bloom and any(s.material == bloom for s in o.material_slots)]
    ctx.chk(len(bloom_objs) == 4, "4 bloom lamp objects (got %d)" % len(bloom_objs))


register(Box(
    name="lighting",
    shot="grand-high",
    keep=None,  # lighting needs the whole scene; isolation only lowers res/samples
    run=run))
