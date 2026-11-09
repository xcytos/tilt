# Render from a PREPARED blend (cached scene with all materials/lamps),
# swapping only the camera: exact TILT-view render or a studio preset.
# Usage: blender --background --factory-startup --python render_from_blend.py \
#        -- <blend> <outdir> <preset|exact-view> <data.json|view.json>
import bpy
import json
import math
import os
import sys
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 3:
    raise SystemExit("usage: render_from_blend.py <blend> <outdir> <preset> [srcjson]")
BLEND_IN, OUTDIR, PRESET = argv[0], argv[1], argv[2]
SRC = argv[3] if len(argv) > 3 else None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ballroom_common import SHOTS, FT, attach_render_progress

bpy.ops.wm.open_mainfile(filepath=os.path.abspath(BLEND_IN))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for d in prefs.devices:
    d.use = True
scene.cycles.device = "GPU"

samples = max(16, int(os.environ.get("FORGE_SAMPLES", "384")))
scene.cycles.samples = samples
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = "OPTIX"        # GPU denoiser: fastest path on RTX
except Exception:
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.cycles.use_adaptive_sampling = True

rx = max(640, int(os.environ.get("FORGE_RES_X", "2048")))
ry = max(360, int(os.environ.get("FORGE_RES_Y", "1152")))
scene.render.resolution_x, scene.render.resolution_y = rx, ry
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass

camc = bpy.data.cameras.new("forge_cam")
cam = bpy.data.objects.new("forge_cam", camc)
scene.collection.objects.link(cam)
loc = None
name = "view" if PRESET == "exact-view" else PRESET

if PRESET == "exact-view":
    # TILT viewer -> Blender cam converter. The viewer reports raw three.js
    # world units, which for TILT scenes are FEET (product code builds
    # ballroom/rig geometry 1 ft == 1 unit). Blender OBJ import lands that
    # y-up content at blender(x, -z, y) (verified on the chandelier bulb
    # ring), so the camera must follow (x, -z, y) too and scale feet to
    # meters or the frame is 3.3x too tight (P-018).
    view = json.load(open(SRC))
    p, t = view.get("position"), view.get("target")
    if not p or not t:
        raise SystemExit("view payload needs position[] and target[]")
    fov = float(view.get("fov") or 45.0)
    aspect = max(0.15, min(6.0, float(view.get("aspect") or 1.333)))
    loc = mathutils.Vector((p[0] * FT, -p[2] * FT, p[1] * FT))
    tgt = mathutils.Vector((t[0] * FT, -t[2] * FT, t[1] * FT))
    hfov = 2 * math.atan(math.tan(math.radians(fov) / 2) * aspect)
    camc.lens = max(8, min(1000, 18 / math.tan(hfov / 2)))  # 36mm AUTO fit
    # The lens above is derived from the HORIZONTAL fov; Blender's auto fit
    # would switch to the sensor height on portrait renders (rx < ry) and
    # then the same lens pinches the fov ~aspect-fold too tight vertically.
    # Pinning the fit to horizontal keeps viewer == render at every aspect.
    camc.sensor_fit = 'HORIZONTAL'
    camc.dof.use_dof = True
    camc.dof.focus_distance = max(0.1, (tgt - loc).length)
    camc.dof.aperture_fstop = 4.5
    print("exact-view loc=%s tgt=%s hfov=%.1f lens=%.1fmm"
          % (tuple(loc), tuple(tgt), math.degrees(hfov), camc.lens))
elif PRESET in SHOTS:
    S = SHOTS[PRESET]
    # SHOTS are authored in three.js feet; import lands at (x, -z, y).
    loc = mathutils.Vector((S["loc"][0] * FT, -S["loc"][2] * FT, S["loc"][1] * FT))
    tgt = mathutils.Vector((S["look"][0] * FT, -S["look"][2] * FT, S["look"][1] * FT))
    camc.lens = S["lens"]
    camc.dof.use_dof = True
    camc.dof.focus_distance = max(0.1, (tgt - loc).length)
    camc.dof.aperture_fstop = S["f"]
else:
    raise SystemExit("UNKNOWN PRESET: %s (valid: %s, exact-view)"
                     % (PRESET, ", ".join(sorted(SHOTS))))

cam.location = loc
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (tgt - loc).to_track_quat("-Z", "Y")
camc.clip_end = 1000.0
scene.camera = cam

progress_file = os.environ.get("FORGE_PROGRESS")
if progress_file:
    attach_render_progress(samples, name, progress_file)

scene.render.filepath = os.path.join(OUTDIR, "bal_%s.png" % name)
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("RENDERED", name)
