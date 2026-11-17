from PIL import Image
import numpy as np

TEX = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\textures"

def tint(src, dst, target_srgb, boost=1.0):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]).mean() + 1e-6
    scale = np.clip((a.mean(axis=2, keepdims=True) / lum), 0.15, 3.0)
    tgt = np.array(target_srgb, dtype=np.float32)
    out = np.clip(tgt * scale * boost, 0.0, 1.0)
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(dst, quality=92)
    print("wrote", dst)

tint(TEX + r"\crepe_satin_diff_1k.jpg", TEX + r"\crepe_satin_diff_beige_1k.jpg", (0.78, 0.68, 0.52))
tint(TEX + r"\quatrefoil_jacquard_fabric_diff_1k.jpg", TEX + r"\quatrefoil_jacquard_fabric_diff_champagne_1k.jpg", (0.88, 0.83, 0.72))
