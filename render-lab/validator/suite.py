# suite.py -- the ballroom validator tester.
# Opens a blend, runs every registered element box, writes the report to
# temp/opencode/validator_out/, and deploys to render-lab/out/ only when
# every check passes. Optionally renders targeted element views for fast
# visual debugging instead of full 384-sample grand renders.
#
# Usage (inside blender):
#   blender --background --factory-startup --python suite.py -- \
#       [--blend PATH] [--regen] [--only a,b] [--no-deploy] [--render box[:shot]]
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

VDIR = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(VDIR)                       # render-lab root
TMP = os.path.join(os.environ.get("TEMP", "/tmp"), "opencode")
OUTDIR = os.path.join(TMP, "validator_out")       # every run lands here
DEFAULT_BLEND = os.path.join(TMP, "regen_out", "ballroom_scene.blend")
DEPLOY_DST = os.path.join(LAB, "out", "ballroom_scene.blend")
sys.path.insert(0, VDIR)

import lib                                   # noqa: E402
import render_target                         # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_opt(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


BLEND = os.path.abspath(arg_opt("--blend", DEFAULT_BLEND))
DO_REGEN = "--regen" in argv
NO_DEPLOY = "--no-deploy" in argv
ONLY = arg_opt("--only", "").split(",") if arg_opt("--only") else None
RENDERS = arg_opt("--render", "").split(",") if arg_opt("--render") else []

os.makedirs(OUTDIR, exist_ok=True)
ts = time.strftime("%Y%m%d_%H%M%S")
lines = []


def log(s):
    print(s)
    lines.append(s)


# ---- optional regen: single source of truth -> fresh blend ----
if DO_REGEN:
    import bpy
    cmd = [bpy.app.binary_path, "--background", "--factory-startup",
           "--python", os.path.join(LAB, "render_ballroom.py"), "--",
           os.path.join(LAB, "out", "ballroom.obj"),
           os.path.join(TMP, "regen_out"), "saveblend"]
    log("REGEN: %s" % " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc != 0:
        log("REGEN FAILED rc=%d" % rc)
        sys.exit(2)

if not os.path.isfile(BLEND):
    log("BLEND NOT FOUND: %s" % BLEND)
    sys.exit(2)

# ---- discover element boxes (each box_*.py registers itself) ----
for f in sorted(os.listdir(VDIR)):
    m = re.match(r"(box_\w+)\.py$", f)
    if m:
        importlib.import_module(m.group(1))

boxes = [lib.BOXES[n] for n in sorted(lib.BOXES)
         if ONLY is None or n in ONLY]
if not boxes:
    log("NO BOXES SELECTED")
    sys.exit(2)

# ---- run checks ----
import bpy                                   # noqa: E402

bpy.ops.wm.open_mainfile(filepath=BLEND)
log("SUITE %s blend=%s" % (ts, BLEND))
results = {}
all_fails = []
for box in boxes:
    ctx = lib.Ctx(box.name)
    box.run(ctx)
    results[box.name] = {"passed": ctx.passed, "fails": ctx.fails}
    all_fails.extend(ctx.fails)
    log("BOX %-12s %3d ok, %d fail" % (box.name, ctx.passed, len(ctx.fails)))

total_ok = sum(r["passed"] for r in results.values())
passed = not all_fails
log("RESULT: %s (%d checks, %d failed)"
    % ("ALL PASS" if passed else "FAILURES", total_ok, len(all_fails)))
for f in all_fails:
    log("  FAIL: %s" % f)

# ---- deploy only on full pass ----
deployed = False
if passed and not NO_DEPLOY:
    if os.path.abspath(BLEND) != os.path.abspath(DEPLOY_DST):
        os.makedirs(os.path.dirname(DEPLOY_DST), exist_ok=True)
        shutil.copyfile(BLEND, DEPLOY_DST)
        deployed = True
        log("DEPLOYED: %s -> %s (%d bytes)"
            % (BLEND, DEPLOY_DST, os.path.getsize(DEPLOY_DST)))
    else:
        log("DEPLOY: blend already at destination")

# ---- targeted element renders (fast visual debug) ----
rendered = []
for spec in RENDERS:
    if ":" in spec:
        bname, shot = spec.split(":", 1)
    else:
        bname, shot = spec, None
    if bname not in lib.BOXES:
        log("RENDER: unknown box %s" % bname)
        continue
    png = render_target.render(BLEND, bname, shot=shot, outdir=OUTDIR)
    rendered.append(png)
    log("RENDER %s -> %s" % (bname, png))

# ---- report files ----
report = {"ts": ts, "blend": BLEND, "boxes": results,
          "total_passed": total_ok, "total_failed": len(all_fails),
          "passed": passed, "deployed": deployed,
          "deploy_dst": DEPLOY_DST if deployed else None,
          "renders": rendered}
for name in ("report_%s" % ts, "report_latest"):
    with open(os.path.join(OUTDIR, name + ".txt"), "w", encoding="utf8") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(OUTDIR, name + ".json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
log("REPORT: %s" % os.path.join(OUTDIR, "report_latest.txt"))
sys.exit(0 if passed else 1)
