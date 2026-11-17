# Shared registry for the ballroom blender lane: camera presets and the
# STAND-IN-JSON progress hook (stdout is fully buffered when blender runs
# behind a pipe - render_stats writes a json sidecar instead).
import json
import os
import time

FT = 0.3048  # three.js scenes are authored in feet at this scale

# loc/look in FEET: (x, height, z-negative=front).
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
    "det-table":    {"loc": (7, 4.4, -17.5), "look": (15.4, 1.5, -13.5), "lens": 55, "f": 4.0},
    "det-strip":    {"loc": (0, 2.0, -16.5), "look": (0, -0.3, -9.0), "lens": 50, "f": 4.5},
    "det-mood":     {"loc": (11, 3.8, -14), "look": (-2, 4.6, 2), "lens": 55, "f": 4.5},
    "debug-top":    {"loc": (0, 55, -2), "look": (0, 0, -0.5), "lens": 24, "f": 11.0},
    "debug-front":  {"loc": (0, 9, -55), "look": (0, 8, 0), "lens": 35, "f": 11.0},
}


# Blender's 5.x render_stats runs with (scene, context) and NO stats
# payload, once per path-tracing tick; a tick counter against the sample
# budget (~1.25x overhead measured) is the honest fill the worker streams.
def attach_render_progress(samples_total, shot_name, progress_file):
    ticks_target = max(8, int(samples_total * 1.25) + 5)
    state = {"ticks": 0, "last": 0.0}

    def handler(_scene, _context):
        state["ticks"] += 1
        now = time.time()
        if now - state["last"] < 0.4:
            return
        state["last"] = now
        try:
            with open(progress_file, "w") as f:
                json.dump({"shot": shot_name,
                           "sample": min(state["ticks"], ticks_target),
                           "samples": ticks_target}, f)
        except Exception:
            pass

    try:
        import bpy
        bpy.app.handlers.render_stats.append(handler)
    except Exception:
        pass
    return handler
