import bpy
import numpy as np

tex = bpy.data.images.load(
    r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\wall_clock\textures\wall_clock_diff_luxury_2k.jpg")
W, H = tex.size
px = np.array(tex.pixels[:], dtype=np.float32).reshape(H, W, 4)  # bottom-up
rgb = (px[:, :, :3] * 255).astype(int)

# coarse grid: 8x8 cells, mean color + rough classification
print("atlas", W, H)
for gy in range(8):
    row = []
    for gx in range(8):
        cell = rgb[gy * H // 8:(gy + 1) * H // 8, gx * W // 8:(gx + 1) * W // 8]
        m = cell.reshape(-1, 3).mean(axis=0).round(0).astype(int)
        row.append("(%3d,%3d,%3d)" % tuple(m))
    print("y%4d" % (gy * H // 8), " ".join(row))
print("x ticks:", [gx * W // 8 for gx in range(8)])

# classify: silver-ish bright neutral
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
silver = (r > 120) & (abs(r - b) < 60) & (abs(r - g) < 40) & (g > 110)
ys, xs = np.where(silver)
if len(xs):
    print("silver-ish pixels:", len(xs), "x", xs.min(), xs.max(), "y", ys.min(), ys.max())
