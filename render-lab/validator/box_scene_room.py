# box_scene_room -- room shell: camera, luxury chairs, chandelier, backdrop
# panels, marble floor, paintings, gold frames. (P-006 + P-007)
import bpy

from lib import register, Box, bbox, image_names, principled

FT = 0.3048


def run(ctx):
    cam = bpy.data.objects.get("cam_gui")
    ctx.chk(cam is not None and abs(cam.data.lens - 30.0) < 0.01,
            "cam_gui lens=30")

    lux = [o for o in bpy.data.objects if o.name.startswith("lux_chair")]
    vis = [o for o in lux if not o.hide_render]
    ctx.chk(len(lux) == 32 and len(vis) == 32,
            "32 luxury chairs visible (got %d/%d)" % (len(lux), len(vis)))

    hidden = [o for o in bpy.data.objects if o.hide_render and o.type == "MESH"]
    ctx.chk(len(hidden) == 222, "222 hidden stand-ins (got %d)" % len(hidden))

    chand = bpy.data.objects.get("lux_chandelier")
    ctx.chk(chand is not None, "lux_chandelier exists")
    if chand:
        lo, hi = bbox(chand)
        # hang height tracks the wall height at any recalc'd wallH:
        # top = (wallH - 1.4) ft -> 6.889 at wallH=24 (was the 6.89 hardcode)
        wall = bpy.data.objects.get("wall")
        wall_h_ft = ((bbox(wall)[1][2] - bbox(wall)[0][2]) / FT
                     if wall else 24.0)
        expect_top = (wall_h_ft - 1.4) * FT
        ctx.chk(abs(hi[2] - expect_top) < 0.15,
                "chandelier top z~%.2f (got %.3f)" % (expect_top, hi[2]))
        ctx.chk(abs((lo[0] + hi[0]) / 2) < 0.1
                and abs((lo[1] + hi[1]) / 2 + 1.22) < 0.3,
                "chandelier xy~(0,-1.22) (got %.2f,%.2f)"
                % ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))

    ctx.chk("stage_panel_wood" in bpy.data.objects, "stage_panel_wood exists")
    ctx.chk("stage_panel_marble" in bpy.data.objects, "stage_panel_marble exists")

    fm = bpy.data.materials.get("floor")
    imgs = image_names(fm)
    ctx.chk(any("marble" in i for i in imgs),
            "floor has marble texture (%s)" % imgs)

    for i in range(4):
        p = bpy.data.objects.get("painting_%d" % i)
        ctx.chk(p is not None, "painting_%d exists" % i)
        if not p:
            continue
        ti = image_names(p.data.materials[0] if p.data.materials else None)
        ctx.chk(len(ti) == 1, "painting_%d has image" % i)
        lo, hi = bbox(p)
        ctx.chk(lo[0] > -9.2 and hi[0] < 9.2 and hi[2] - lo[2] > 1.4,
                "painting_%d sized/placed" % i)

    for tn in ("trim.001", "trim.002", "trim.004", "trim.005"):
        t = bpy.data.objects.get(tn)
        ctx.chk(t is not None and t.data.materials
                and t.data.materials[0].name == "gold",
                "%s gold frame" % tn)


register(Box(
    name="scene_room",
    shot="grand-front",
    keep=["cam*", "lux_chair*", "lux_chandelier", "stage_panel*", "wall*",
          "floor*", "trim*", "painting_*", "parquet*", "cove*", "sconce*",
          "pillaster*", "ceiling*"],
    run=run))
