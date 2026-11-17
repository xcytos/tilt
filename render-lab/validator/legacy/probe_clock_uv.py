import bpy
from collections import Counter

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend")
clk = bpy.data.objects["stage_clock"]
tex = bpy.data.images.load(
    r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\wall_clock\textures\wall_clock_diff_luxury_2k.jpg")
W, H = tex.size
px = list(tex.pixels)  # RGBA floats

def sample(u, v):
    x = min(W - 1, max(0, int(u * W)))
    y = min(H - 1, max(0, int((1 - v) * H)))  # blender image pixels bottom-up
    i = (y * W + x) * 4
    return (round(px[i] * 255), round(px[i + 1] * 255), round(px[i + 2] * 255))

me = clk.data
uvl = me.uv_layers.active.data
print("MATS", [ms.material.name if ms.material else None for ms in clk.material_slots])
print("counts", dict(Counter(p.material_index for p in me.polygons)))
samples = {}
for p in me.polygons:
    samples.setdefault(p.material_index, [])
    if len(samples[p.material_index]) < 600:
        for li in p.loop_indices:
            u = uvl[li].uv
            samples[p.material_index].append((u.x, u.y))
for mi, uvs in sorted(samples.items()):
    xs = [u for u, v in uvs]
    ys = [v for u, v in uvs]
    cols = [sample(u, v) for u, v in uvs[:300]]
    n = len(cols)
    mean = tuple(round(sum(c[i] for c in cols) / n) for i in range(3))
    mname = me.materials[mi].name if mi < len(me.materials) else "?"
    print("MI", mi, mname, "u %.3f..%.3f v %.3f..%.3f" % (min(xs), max(xs), min(ys), max(ys)),
          "meanRGB", mean)
