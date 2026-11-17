# box_clock -- P-008 1.2m luxury wall clock on the stage backdrop.
import bpy

from lib import register, Box, bbox, image_names


def run(ctx):
    clk = bpy.data.objects.get("stage_clock")
    ctx.chk(clk is not None, "stage_clock exists")
    if clk:
        lo, hi = bbox(clk)
        w = hi[0] - lo[0]
        h = hi[2] - lo[2]
        cx = (lo[0] + hi[0]) / 2
        cz = (lo[2] + hi[2]) / 2
        ctx.chk(abs(w - 1.2) < 0.05 and abs(h - 1.2) < 0.12,
                "clock dia 1.2m (w=%.3f h=%.3f)" % (w, h))
        ctx.chk(abs(cx) < 0.03 and abs(cz - 3.9) < 0.04,
                "clock center (%.3f, %.3f)" % (cx, cz))
        ctx.chk(-5.17 < lo[1] < -5.0, "clock back flush y=%.4f" % lo[1])
        lux = False
        for sl in clk.material_slots:
            if any("wall_clock_diff_luxury" in i for i in image_names(sl.material)):
                lux = True
        ctx.chk(lux, "clock uses luxury atlas image")

    loaded = [i.name for i in bpy.data.images if "luxury" in i.name]
    ctx.chk(len(loaded) >= 1, "luxury atlas loaded (%s)" % loaded)


register(Box(
    name="clock",
    shot="grand-front",
    keep=["stage_clock", "stage_panel*", "wall*", "floor*", "trim*",
          "painting_*", "pillaster*"],
    run=run))
