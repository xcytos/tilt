# box_scurve -- S-curve drape panels + satin/silk material + pillow==curtain
# material parity. (P-006 drape, P-010 silk upgrade)
# P-014: panel discovery is dynamic (ffffff-<n>) and position checks are
# relative, so shape-param updates (gap/pan/lobes/...) stay valid.
import re

import bpy

from lib import register, Box, bbox, image_names, principled

_FAB = re.compile(r"^ffffff-\d+$")


def fabric_panels():
    fabs = [o for o in bpy.data.objects
            if o.type == "MESH" and _FAB.match(o.name)]
    fabs.sort(key=lambda o: bbox(o)[0][0])       # left panel first
    return fabs


def run(ctx):
    fabs = fabric_panels()
    ctx.chk(len(fabs) == 2, "2 fabric drape panels (%d)" % len(fabs))
    if len(fabs) == 2:
        left, right = fabs
        rlo, _ = bbox(right)
        _, lhi = bbox(left)
        # relative to the stage centre: params move the panels, never
        # past the centre line or off the stage (stage half-width ~6 m)
        ctx.chk(0.05 < rlo[0] < 5.5,
                "right panel x_lo=%.3f inside stage" % rlo[0])
        ctx.chk(-5.5 < lhi[0] < -0.05,
                "left panel x_hi=%.3f inside stage" % lhi[0])
        ctx.chk(rlo[0] - lhi[0] > 0.1,
                "centre gap %.3f m" % (rlo[0] - lhi[0]))
    for o in fabs:
        ctx.chk(bool(o.data.materials)
                and o.data.materials[0].name == "silk_drape",
                "%s on silk_drape" % o.name)

    silk = bpy.data.materials.get("silk_drape")
    ctx.chk(silk is not None, "silk_drape material exists")
    if not silk:
        return
    imgs = image_names(silk)
    ctx.chk(len(imgs) >= 3, "silk has >=3 textures (%s)" % imgs)
    beige = any("crepe_satin_diff_beige" in i for i in imgs)
    ctx.chk(beige, "silk beige albedo texture")
    b = principled(silk)
    ctx.chk(b is not None, "silk principled node")
    if b:
        ctx.chk(b.inputs["Anisotropic"].default_value >= 0.7,
                "silk aniso>=0.7 (%.2f)" % b.inputs["Anisotropic"].default_value)
        ctx.chk(b.inputs["Sheen Weight"].default_value >= 0.9,
                "silk sheen>=0.9 (%.2f)" % b.inputs["Sheen Weight"].default_value)
        ctx.chk(b.inputs["Roughness"].is_linked,
                "silk roughness from texture")
    users = [o.name for o in bpy.data.objects
             if any(sl.material == silk for sl in o.material_slots)]
    ctx.chk(len(users) == 8,
            "silk on 2 drape + 6 pillows (got %d)" % len(users))
    # color parity: every pillow shares the curtain material
    pillows = [n for n in users if n.startswith("pillow_")]
    ctx.chk(len(pillows) == 6, "6 pillows share curtain silk (got %d)" % len(pillows))


register(Box(
    name="scurve",
    shot="grand-front",
    keep=["ffffff-*", "stage_panel*", "wall*", "floor*",
          "trim*", "painting_*", "stage_clock", "pillow_*"],
    run=run))
