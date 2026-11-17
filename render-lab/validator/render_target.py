# render_target.py -- targeted element render for fast debugging/validtion.
# Isolates one box (hides meshes outside its keep list, keeps lights and
# cameras), renders at low res/samples through the box's default SHOTS
# preset, and writes to temp/opencode/validator_out/target_<box>_<shot>.png.
import fnmatch
import math
import os
import sys

import bpy
import mathutils

VDIR = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(VDIR)
TMP = os.path.join(os.environ.get("TEMP", "/tmp"), "opencode")
OUTDIR = os.path.join(TMP, "validator_out")
sys.path.insert(0, VDIR)
sys.path.insert(0, LAB)

from ballroom_common import SHOTS, FT          # noqa: E402
import lib                                     # noqa: E402


def _discover():
    import importlib
    import re
    for f in sorted(os.listdir(VDIR)):
        m = re.match(r"(box_\w+)\.py$", f)
        if m:
            importlib.import_module(m.group(1))


def render(blend, box_name, shot=None, outdir=None, samples=None, res=None):
    if not lib.BOXES:
        _discover()
    if box_name not in lib.BOXES:
        raise SystemExit("unknown box: %s (%s)" % (box_name, ", ".join(lib.BOXES)))
    box = lib.BOXES[box_name]
    shot = shot or box.shot
    if shot not in SHOTS:
        raise SystemExit("unknown shot: %s" % shot)
    outdir = outdir or OUTDIR
    os.makedirs(outdir, exist_ok=True)
    samples = samples or int(os.environ.get("TARGET_SAMPLES", "64"))
    rx, ry = res or (int(os.environ.get("TARGET_RES_X", "1280")),
                     int(os.environ.get("TARGET_RES_Y", "720")))

    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
    scene = bpy.context.scene

    # isolation: hide visible meshes outside the box keep list; never
    # unhide anything (the 222 stand-ins stay hidden); lights/cameras stay
    kept = 0
    hidden = 0
    for o in scene.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        if box.keep is None or any(fnmatch.fnmatch(o.name, pat)
                                   for pat in box.keep):
            kept += 1
        else:
            o.hide_render = True
            hidden += 1
    print("TARGET %s/%s: kept %d meshes, hid %d, keep=%s"
          % (box_name, shot, kept, hidden, box.keep))

    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type in {"OPTIX", "CUDA"}
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPTIX"
    except Exception:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.render.resolution_x = rx
    scene.render.resolution_y = ry
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX Medium High Contrast"
    except Exception:
        pass

    S = SHOTS[shot]
    loc = mathutils.Vector((S["loc"][0] * FT, -S["loc"][2] * FT, S["loc"][1] * FT))
    tgt = mathutils.Vector((S["look"][0] * FT, -S["look"][2] * FT, S["look"][1] * FT))
    print("TARGET shot=%s S=%s loc=%s tgt=%s"
          % (shot, S, tuple(round(v, 2) for v in loc), tuple(round(v, 2) for v in tgt)))
    camc = bpy.data.cameras.new("target_cam")
    cam = bpy.data.objects.new("target_cam", camc)
    scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (tgt - loc).to_track_quat("-Z", "Y")
    camc.lens = S["lens"]
    camc.clip_end = 1000.0
    camc.dof.use_dof = True
    camc.dof.focus_distance = max(0.1, (tgt - loc).length)
    camc.dof.aperture_fstop = S["f"]
    scene.camera = cam

    png = os.path.join(outdir, "target_%s_%s.png" % (box_name, shot))
    scene.render.filepath = png
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("TARGET RENDERED", png)
    return png


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SystemExit("usage: render_target.py -- <blend> <box> [shot]")
    render(argv[0], argv[1], shot=argv[2] if len(argv) > 2 else None)
