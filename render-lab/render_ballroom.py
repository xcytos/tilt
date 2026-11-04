# Blender 5.x headless: photoreal BALLROOM + S-Curve render lane.
# Usage: blender --background --factory-startup --python render_ballroom.py -- <obj> <outdir> <preset|all>
# Materials/lamps/mood are the faithful port of TILT js/scenes.js buildBallroom (P-006).

import bpy
import json
import math
import os
import re
import sys
import time
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OBJ = os.path.abspath(argv[0])
OUTDIR = os.path.abspath(argv[1])
PRESET = argv[2] if len(argv) > 2 else "all"
DATA = os.path.abspath(argv[3]) if len(argv) > 3 else os.path.join(os.path.dirname(OBJ), "ballroom_data.json")

FT = 0.3048
os.makedirs(OUTDIR, exist_ok=True)
with open(DATA, "r", encoding="utf8") as f:
    BD = json.load(f)
MOOD = BD["mood"]

# ---------- import ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=OBJ)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.shade_smooth()

for o in meshes:
    o.scale = (FT, FT, FT)
    o.select_set(True)
bpy.ops.object.transform_apply(scale=True)

mins = [min((o.location[c] + o.bound_box[v][c] for o in meshes for v in range(8)), key=abs) for c in range(3)]
dims = {o.name: o.dimensions for o in meshes if o.dimensions.length > 0.1}
big = sorted(dims.items(), key=lambda kv: -kv[1].length)[:12]
print("DEBUG largest meshes (m):", [(k, [round(x, 2) for x in tuple(v)]) for k, v in big])

def hexc(h):
    v = int(h, 16)
    return ((v >> 16 & 255) / 255.0, (v >> 8 & 255) / 255.0, (v & 255) / 255.0)

def principled(name, rgb, rough=0.85, metal=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    return m

def emission(name, rgb, strength, base_rgb=None, base_rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1.0)
    em.inputs["Strength"].default_value = strength
    if base_rgb:
        mix = nt.nodes.new("ShaderNodeMixShader")
        pr = principled(name + "_b", base_rgb, base_rough, 0.0)
        pb = pr.node_tree.nodes["Principled BSDF"]
        mix.inputs[0].default_value = 0.5
        nt.links.new(pb.outputs["BSDF"], mix.inputs[1])
        nt.links.new(em.outputs["Emission"], mix.inputs[2])
        nt.links.new(mix.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    else:
        nt.links.new(em.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    return m

MATSET = {
    # rig
    "d4af37": principled("gold_rail", hexc("d4af37"), 0.22, 1.0),
    "ffffff": principled("cloth", hexc("ffffff"), 0.82, 0.0, sheen=0.55),
    "9ca3af": principled("pole", hexc("9ca3af"), 0.35, 1.0),
    "374151": principled("base", hexc("374151"), 0.5, 0.8),
    "6b7280": principled("joint", hexc("6b7280"), 0.4, 0.9),
    # ballroom
    "floor": principled("floor", hexc("cbb694"), 0.62),
    "wall": principled("wall", hexc("efe6d6"), 0.92),
    "skirt": principled("skirt", hexc("f3ead9"), 0.85),
    "carpet": principled("carpet", hexc("b98a56"), 0.96),
    "cream": principled("cream", hexc("f7f1e4"), 0.93),
    "gold": principled("gold", hexc("d9b45c"), 0.3, 0.90),
    "parquetBorder": principled("parquetBorder", hexc("5a4028"), 0.6),
    "parquet": principled("parquet", hexc("b5894f"), 0.55),
    "pilaster": principled("pilaster", hexc("f3ecdc"), 0.70),
    "trim": principled("trim", hexc("e8dcc2"), 0.70),
    "panelIn": principled("panelIn", hexc("e6dcc6"), 0.85),
    "cloth": principled("cloth_tbl", hexc("f2ead8"), 0.95),
    "tableTop": principled("tableTop", hexc("f6f0e2"), 0.90),
    "goldRim": principled("goldRim", hexc("d9c48a"), 0.40, 0.55),
    "bloom": principled("bloom", hexc("7a1f2b"), 0.85),
    "seat": principled("seat", hexc("6e5f4a"), 0.90),
    "cframe": principled("cframe", hexc("8f8574"), 0.40, 0.60),
    # emissive surfaces
    "cove": emission("cove", hexc("ffdfae"), 18.0, base_rgb=hexc("fff2d8")),
    "sconce": emission("sconce", hexc("ffe7bd"), 12.0, base_rgb=hexc("fff6e2")),
    "glass": emission("glass", hexc("ffe3ae"), 60.0, base_rgb=hexc("fff4dd")),
    "bulb": emission("bulb", hexc("ffe3ae"), 42.0, base_rgb=hexc("2b2b2b")),
    "strand": emission("strand", hexc("ffedc8"), 16.0, base_rgb=hexc("fff8ea")),
}

for o in meshes:
    key = None
    for k in MATSET:
        if o.name.lower().startswith(k):
            key = k
            break
    if key is None:
        key = "wall"
        o.name = "wall_" + o.name
    o.data.materials.clear()
    o.data.materials.append(MATSET[key])

# ---------- world ----------
world = bpy.data.worlds.new("ballroom")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (*hexc("%x" % MOOD["background"]), 1.0)
bg.inputs[1].default_value = 0.12
bpy.context.scene.world = world

# ---------- lights: codebase exact lamps ----------
for i, L in enumerate(BD["lamps"]):
    d = bpy.data.lights.new("lamp%d" % i, type="POINT")
    d.energy = L["watts"] * 6.0
    d.color = hexc("%x" % L["color"])
    d.shadow_soft_size = 0.3
    o = bpy.data.objects.new("lamp%d" % i, d)
    o.location = (L["x"] * FT, L["z"] * FT, L["y"] * FT)
    bpy.context.collection.objects.link(o)

def add_area_light(name, loc_ft, target_ft, size_ft, watts, rgbhex):
    d = bpy.data.lights.new(name, type="AREA")
    d.shape = "SQUARE"
    d.size = size_ft * FT * 2
    d.energy = watts
    d.color = hexc(rgbhex)
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    x, y, z = (loc_ft[0] * FT, loc_ft[2] * FT, loc_ft[1] * FT)
    o.location = (x, y, z)
    tx, ty, tz = (target_ft[0] * FT, target_ft[2] * FT, target_ft[1] * FT)
    di = mathutils.Vector((tx - x, ty - y, tz - z))
    o.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
    return o

# mood key/fill from buildBallroom return (warm cream/gold接过) + portal bounce
add_area_light("key", (0, 0, 24), (0, 0, 0), 26, 1400, "%x" % MOOD["key"]["color"])
add_area_light("fillL", (-22, 0, -14), (0, 0, 0), 26, 320, "%x" % MOOD["fill"]["color"])
add_area_light("fillR", (22, 0, -14), (0, 0, 0), 26, 320, "%x" % MOOD["fill"]["color"])
add_area_light("bounceF", (0, 0, -30), (0, 2, 0), 30, 260, "%x" % MOOD["fill"]["color"])

# ---------- cameras ----------
# loc/look in FEET: (x, height, z-negative=front). Camera looks at the rig/room focus.
SHOTS = {
    "grand-wide":   {"loc": (-5.5, 5.2, -24.5), "look": (0, 7.5, 1), "lens": 30, "f": 6.3},
    "grand-front":  {"loc": (0, 5.5, -28), "look": (0, 7, 0), "lens": 38, "f": 6.3},
    "grand-threeQ": {"loc": (-9, 6.2, -22), "look": (0.5, 6.5, 1.5), "lens": 42, "f": 4.5},
    "grand-low":    {"loc": (0, 2.2, -21), "look": (0, 8.5, 1), "lens": 45, "f": 5.6},
    "grand-high":   {"loc": (2.5, 13.5, -27), "look": (0, 5.5, 0), "lens": 30, "f": 5.6},
    "grand-side":   {"loc": (-15.5, 5.8, -16), "look": (1, 6.8, 3.5), "lens": 40, "f": 4.5},
    "det-rail":     {"loc": (1.1, 5.6, -4.2), "look": (0.05, 6.15, 0.3), "lens": 85, "f": 2.8},
    "det-drape":    {"loc": (2.6, 4.4, -4.6), "look": (0.4, 4.5, 0.2), "lens": 85, "f": 2.8},
    "det-joint":    {"loc": (2.2, 3.0, -4.6), "look": (0.6, 3.4, 0.2), "lens": 85, "f": 2.8},
    "det-chand":    {"loc": (0, 5.5, -10), "look": (0, 14.4, 3.5), "lens": 45, "f": 5.6},
    "det-table":    {"loc": (7, 4.4, -17.5), "look": (15.4, 3.0, -13.5), "lens": 55, "f": 4.0},
    "det-mood":     {"loc": (11, 3.8, -14), "look": (-2, 4.6, 2), "lens": 55, "f": 4.5},
    "debug-top":    {"loc": (0, 55, -2), "look": (0, 0, -0.5), "lens": 24, "f": 11.0},
    "debug-front":  {"loc": (0, 9, -55), "look": (0, 8, 0), "lens": 35, "f": 11.0},
}
PRESETS = list(SHOTS) if PRESET == "all" else [PRESET]

# ---------- render config ----------
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type in {"OPTIX", "CUDA"}
scene.cycles.device = "GPU"
scene.cycles.samples = 384
if os.environ.get("FORGE_SAMPLES"):
    scene.cycles.samples = max(16, int(os.environ["FORGE_SAMPLES"]))
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.render.resolution_x = 2048
scene.render.resolution_y = 1152
if os.environ.get("FORGE_RES_X"):
    scene.render.resolution_x = int(os.environ["FORGE_RES_X"])
if os.environ.get("FORGE_RES_Y"):
    scene.render.resolution_y = int(os.environ["FORGE_RES_Y"])
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX Medium High Contrast"
except Exception:
    pass
scene.render.film_transparent = False

# ---------- realtime progress ----------
# stdout is fully buffered when Blender runs behind a pipe, so the sample
# lines never stream. Instead the render_stats handler writes a sidecar
# JSON every >=0.4s; the forge worker watches it and feeds the studio's
# progress bar. Cheap enough to leave on for every forge render.
PROGRESS_FILE = os.environ.get("FORGE_PROGRESS")
if PROGRESS_FILE:
    # Blender passes no stats payload to render_stats here (5.x calls it
    # with just scene, context), but it fires once per path-tracing tick,
    # so counting ticks against the sample budget (with the ~1.25x overhead
    # the probe measured) gives an honest sub-shot fill for the bar. The
    # worker snaps the shot to its span on exit, so undershoot is harmless.
    _samples_total = int(os.environ["FORGE_SAMPLES"]) if os.environ.get(
        "FORGE_SAMPLES") else (384 if PRESET.startswith("grand") else 512)
    _ticks_target = max(8, int(_samples_total * 1.25) + 5)
    _state = {"ticks": 0, "last": 0.0}

    def _stats_handler(scene_arg, context):
        _state["ticks"] += 1
        now = time.time()
        if now - _state["last"] < 0.4:
            return
        _state["last"] = now
        try:
            with open(PROGRESS_FILE, "w") as f:
                json.dump({"shot": PRESET,
                           "sample": min(_state["ticks"], _ticks_target),
                           "samples": _ticks_target}, f)
        except Exception:
            pass

    bpy.app.handlers.render_stats.append(_stats_handler)

if PRESET == "saveblend":
    # native .blend: one camera at the grand-wide angle for the GUI session
    cam = bpy.data.cameras.new("cam_gui")
    cam.lens = 40
    camc = bpy.data.objects.new("cam_gui", cam)
    bpy.context.collection.objects.link(camc)
    l = SHOTS["grand-wide"]
    lx, ly, lz = (l["loc"][0] * FT, l["loc"][2] * FT, l["loc"][1] * FT)
    tx, ty, tz = (l["look"][0] * FT, l["look"][2] * FT, l["look"][1] * FT)
    camc.location = (lx, ly, lz)
    di = mathutils.Vector((tx - lx, ty - ly, tz - lz))
    camc.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camc
    bp = os.path.join(OUTDIR, "ballroom_scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=bp)
    print("SAVED BLEND", bp)
else:
    for nm in PRESETS:
        S = SHOTS[nm]
        cam = bpy.data.cameras.new("cam_%s" % nm)
        cam.lens = S["lens"]
        cam.dof.use_dof = True
        cam.dof.aperture_fstop = S["f"]
        camc = bpy.data.objects.new("cam_%s" % nm, cam)
        bpy.context.collection.objects.link(camc)
        lx, ly, lz = (S["loc"][0] * FT, S["loc"][2] * FT, S["loc"][1] * FT)
        tx, ty, tz = (S["look"][0] * FT, S["look"][2] * FT, S["look"][1] * FT)
        camc.location = (lx, ly, lz)
        di = mathutils.Vector((tx - lx, ty - ly, tz - lz))
        camc.rotation_euler = di.to_track_quat("-Z", "Y").to_euler()
        cam.dof.focus_distance = di.length
        scene.camera = camc
        # A forge payload's sample budget overrides the per-shot default;
        # without it, keep the grand/detail split as rendered before.
        scene.cycles.samples = (
            max(16, int(os.environ["FORGE_SAMPLES"]))
            if os.environ.get("FORGE_SAMPLES")
            else (384 if nm.startswith("grand") else 512))
        scene.render.filepath = os.path.join(OUTDIR, "bal_%s.png" % nm)
        bpy.ops.render.render(write_still=True)
        print("RENDERED", nm)
