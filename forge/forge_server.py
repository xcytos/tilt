#!/usr/bin/env python3
"""TILT FORGE - Blender photoreal pipeline microservice (stdlib-only MVP).

Endpoints (localhost:8765, bearer token in forge/.token):
  GET  /v1/health
  GET  /v1/handshake          -> bearer for same-machine pages
  GET  /v1/looks               -> colorway/scene look catalog
  POST /v1/scene/fit           -> computeStageSize parity for a footprint
  POST /v1/render.json         -> submit job {scene, size|footprint,
                                  shots[] OR view{position,target,fov,aspect},
                                  quality{samples,4k}, watch, collage}
  GET  /v1/jobs/{id}           -> job status/artifacts/progress/cache
  GET  /v1/artifact/{id}/{f}   -> artifact image
  GET  /v1/scurve/params       -> S-curve PARAMS metadata + blend version
  POST /v1/scurve/update       -> {params} rebuild the S-curve rig inside
                                  out/ballroom_scene.blend (delta: only the
                                  rig meshes + PAR aim are touched)
  GET  /v1/blend               -> deployed .blend {version,size,applied,url}
  GET  /v1/blend/file          -> the .blend bytes (same-machine only)
Scene geometry+materials are built ONCE into forge/cache/<sig>/prepared.blend;
later jobs load it and only swap the camera (exact-view or a preset).
The render-lab master blend (render-lab/out/ballroom_scene.blend) is edited
in place by scurve jobs - run the validator suite BEFORE the first update.

Runtime logging: console + rotating file forge/forge.log, level via
FORGE_LOG_LEVEL (DEBUG = every http request, job transition, stage-size
decision and subprocess; INFO default; errors always log tracebacks).
"""
import hashlib
import json
import logging
import logging.handlers
import mimetypes
import os
import queue
import re
import secrets
import subprocess
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_LAB = os.path.abspath(os.path.join(HERE, "..", "render-lab"))
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
ARTIFACTS = os.path.join(HERE, "artifacts")
CACHE = os.path.join(HERE, "cache")
TOKEN_FILE = os.path.join(HERE, ".token")

# ---------- runtime logging (dev standard) ----------
# StreamHandler for the console/window + a rotating file so long-running
# debug sessions never eat the disk. DEBUG is the development level:
# requests, job lifecycle, delta-vs-regen decisions, subprocess cmds.
LOG_FILE = os.path.join(HERE, "forge.log")
LOG_LEVEL = os.environ.get("FORGE_LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-7s [%(threadName)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.handlers.RotatingFileHandler(
            LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3,
            encoding="utf8"),
    ],
)
log = logging.getLogger("forge")

os.makedirs(ARTIFACTS, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

# bearer token: stable per forge install
if not os.path.exists(TOKEN_FILE):
    with open(TOKEN_FILE, "w") as f:
        f.write(secrets.token_hex(16))
with open(TOKEN_FILE) as f:
    TOKEN = f.read().strip()

# render-lab master blend: the delta-update target of scurve jobs, and the
# file the Render Studio offers for download. Params state sits beside it.
SCURVE_BLEND = os.path.join(RENDER_LAB, "out", "ballroom_scene.blend")
SCURVE_PARAMS_FILE = os.path.join(RENDER_LAB, "out", "scurve_params.json")

# ---------- codebase parity: computeStageSize (js/scenes.js) ----------
DEFAULT_STAGE_SIZE = {"w": 60, "d": 16, "h": 1.2, "wallX": 30, "wallZ": 16, "wallH": 26}
MARGIN_X, MARGIN_Z = 3.5, 3
W_MIN, W_MAX, D_MIN, D_MAX = 44, 140, 18, 60
# Front wedding-furniture band - parity with js/scenes.js: thrones/sofas
# clear the rig by ~2 ft, the loveseat is 4.86 ft deep, 1 ft to spare.
FURN_GAP_Z, FURN_DEPTH_Z, FURN_CLEAR_Z = 1.99, 4.86, 1


def compute_stage_size(fp):
    # Extents from the stage CENTRE (the stage is origin-centred) plus the
    # front furniture band, so an off-centre rig cannot hang off an edge.
    if not fp or not all(_is_num(fp.get(k)) for k in ("minX", "maxX", "minZ", "maxZ")):
        log.debug("compute_stage_size: no/invalid footprint -> default %sx%s",
                  DEFAULT_STAGE_SIZE["w"], DEFAULT_STAGE_SIZE["d"])
        return dict(DEFAULT_STAGE_SIZE)
    span_w = (max(abs(fp["minX"]), abs(fp["maxX"])) + MARGIN_X) * 2
    furn_d = -fp["minZ"] + FURN_GAP_Z + FURN_DEPTH_Z + FURN_CLEAR_Z
    span_d = max(max(abs(fp["minZ"]), abs(fp["maxZ"])) + MARGIN_Z, furn_d) * 2
    w = min(W_MAX, max(W_MIN, -(-span_w // 2) * 2))
    d = min(D_MAX, max(D_MIN, -(-span_d // 2) * 2))
    size = {
        "w": int(w), "d": int(d), "h": DEFAULT_STAGE_SIZE["h"],
        "wallX": w / 2 + 8,
        "wallZ": int(max(16, d / 2 + 8)),
        "wallH": int(min(40, max(24, round(w / 2.3)))),
    }
    log.debug("compute_stage_size fp=%s span=(%.2f, %.2f) furnD=%.2f -> %sx%s",
              {k: round(fp[k], 2) for k in ("minX", "maxX", "minZ", "maxZ")},
              span_w, span_d, furn_d, size["w"], size["d"])
    return size


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


LOOKS = {
    "colorways": [{"id": "ivory-ballroom", "name": "Ivory Ballroom", "scene": "ballroom",
                   "colorway": "ivory", "set": "classic-symmetry"}],
    "scenes": ["studio", "white-stage", "ballroom", "garden-night", "terrace"],
    "quality": {"draft": 128, "standard": 384, "high": 512},
}

JOBS = {}
JOBS_LOCK = threading.Lock()
JOBS_FILE = os.path.join(HERE, "jobs.json")


def _jobs_save():
    with JOBS_LOCK, open(JOBS_FILE, "w") as f:
        json.dump(JOBS, f, indent=1)


# Shots render_ballroom.py actually knows (mirrors its SHOTS table) -
# unknown ids would crash the blender script with a KeyError that exits 0.
VALID_SHOTS = {
    "grand-wide", "grand-front", "grand-threeQ", "grand-low", "grand-high",
    "grand-side", "det-rail", "det-drape", "det-joint", "det-chand",
    "det-table", "det-mood", "debug-top", "debug-front",
}


# The job dict is the realtime source of truth: pollers read progress
# (0-100), the current shot and a detail line straight out of JOBS.
def _progress(job, pct, detail=None):
    job["progress"] = max(0, min(100, int(pct)))
    if detail:
        job["detail"] = detail
    log.debug("job %s: %3d%% %s", job.get("id"), job["progress"],
              detail or job.get("status") or "")
    _jobs_save()


# Blender's stdout is fully buffered behind a pipe, so nothing streams
# from there. render_ballroom.py instead writes sample progress into a
# sidecar json (FORGE_PROGRESS); this watcher drains it into the job at
# >=0.6s cadence until the render process exits.
def _run_render(args, env, job, base_pct, span_pct, progress_file):
    # Blender output goes to a real log file (next to the sidecar): a
    # PIPE that nobody reads can deadlock a chatty render, and stdout is
    # the only place to read a silent blender failure from.
    log_path = os.path.join(os.path.dirname(progress_file),
                            "blender_%s.log" % (job.get("shot") or "job"))
    log.info("job %s: spawn %s", job.get("id"),
             " ".join(os.path.basename(a) for a in args[:6]) + " ...")
    with open(log_path, "w") as logf:
        proc = subprocess.Popen(args, stdout=logf, stderr=subprocess.STDOUT,
                                text=True, errors="replace", cwd=RENDER_LAB, env=env)

        def watch():
            while proc.poll() is None:
                try:
                    with open(progress_file) as f:
                        p = json.load(f)
                    s, d = p.get("sample"), p.get("samples")
                    if isinstance(s, int) and isinstance(d, int) and d > 0:
                        frac = min(1.0, s / d)
                        job["detail"] = "%s · sample %d/%d" % (job.get("shot") or "", s, d)
                        job["progress"] = int(base_pct + frac * span_pct)
                        _jobs_save()
                except FileNotFoundError:
                    pass
                except Exception:
                    pass
                time.sleep(0.6)

        w = threading.Thread(target=watch, daemon=True, name="job-" + str(job.get("id")))
        w.start()
        rc = proc.wait()
        w.join(timeout=2)
    job["log"] = os.path.basename(log_path)
    log.info("job %s: render rc=%s (%s)", job.get("id"), rc,
             os.path.basename(log_path))
    _progress(job, base_pct + span_pct)
    return rc


def _log_tail(job):
    try:
        with open(os.path.join(ARTIFACTS, job["id"], job["log"])) as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        for ln in reversed(lines):
            if ("Error" in ln or "Traceback" in ln or "RuntimeError" in ln
                    or "SystemExit:" in ln):
                return " · " + ln[:300]
    except Exception:
        pass
    return ""


WORKQ = queue.Queue()

SUPPORTED_SCENES = {"ballroom"}


# A prepared blend is the cached scene (geometry + materials + lamps) keyed
# by scene + room size + the live rig spec (frames' params/positions/colors):
# the first job pays the reconstruct/import/material build once, every later
# job only swaps the camera and renders. The rig rides in the payload so
# edited designs get their own cache entry instead of the default prop.
RIG_ENV_KEYS = ("frames", "fabric", "theme")


def _clean_rig(rig):
    if not isinstance(rig, dict):
        return None
    out = {}
    frames = rig.get("frames")
    if isinstance(frames, list) and frames:
        clean = []
        for fr in frames:
            if not isinstance(fr, dict):
                continue
            state = fr.get("state")
            clean.append({
                "state": state if isinstance(state, dict) else {},
                "x": fr.get("x", 0), "z": fr.get("z", 0), "ry": fr.get("ry", 0)
            })
        if clean:
            out["frames"] = clean
    if isinstance(rig.get("fabric"), (str, int)):
        out["fabric"] = rig["fabric"]
    if rig.get("theme") in ("light", "dark"):
        out["theme"] = rig["theme"]
    return out or None


def _sig(scene, size, rig=None):
    return hashlib.md5(json.dumps(
        {"scene": scene, "size": size, "rig": rig}, sort_keys=True
    ).encode()).hexdigest()[:12]


# Cache hygiene: keep the newest N prepared scenes; rig edits would
# otherwise leave every revision's blend on disk forever.
def _prune_cache(keep=8):
    try:
        dirs = [os.path.join(CACHE, d) for d in os.listdir(CACHE)]
        dirs = [(os.path.getmtime(d), d) for d in dirs
                if os.path.isdir(d)]
        for _, d in sorted(dirs)[:-keep]:
            for name in ("prepared.blend", "scene.obj",
                         "scene_data.json", "payload.json",
                         "ballroom_scene.blend"):
                try:
                    os.remove(os.path.join(d, name))
                except OSError:
                    pass
            try:
                os.rmdir(d)
            except OSError:
                pass
    except OSError:
        pass


def _ensure_prepared(job, scene, size, rig=None):
    cdir = os.path.join(CACHE, _sig(scene, size, rig))
    prepared = os.path.join(cdir, "prepared.blend")
    if os.path.exists(prepared):
        job["cache"] = "hit"
        log.info("job %s: scene cache hit (%s)", job.get("id"),
                 os.path.basename(cdir))
        _progress(job, 45, "Scene cache hit")
        return prepared
    job["cache"] = "miss"
    job["status"] = "preparing"
    log.info("job %s: scene cache miss -> building (%s)",
             job.get("id"), os.path.basename(cdir))
    _progress(job, 6, "Building photoreal scene (one-time cache fill)…")
    try:
        os.makedirs(cdir, exist_ok=True)
        pjson = os.path.join(cdir, "payload.json")
        with open(pjson, "w") as f:
            json.dump({"scene": scene, "size": size, "rig": rig}, f)
        r = subprocess.run(["node", os.path.join(HERE, "reconstruct.mjs"), pjson, cdir],
                           capture_output=True, text=True, cwd=RENDER_LAB, timeout=180)
        if r.returncode != 0:
            raise RuntimeError("reconstruct: " + ((r.stderr or r.stdout) or "no output")[-500:])
        obj = os.path.join(cdir, "scene.obj")
        data = os.path.join(cdir, "scene_data.json")
        blend = os.path.join(cdir, "ballroom_scene.blend")
        env = dict(os.environ)
        env["FORGE_SAMPLES"] = "32"  # saveblend renders nothing; keep env sane
        b = subprocess.run(
            [BLENDER, "--background", "--factory-startup",
             "--python", os.path.join(RENDER_LAB, "render_ballroom.py"),
             "--", obj, cdir, "saveblend", data],
            capture_output=True, text=True, cwd=RENDER_LAB, env=env, timeout=900)
        if not os.path.exists(blend):
            raise RuntimeError(
                "prepared blend build failed (rc=%s): %s"
                % (b.returncode, ((b.stderr or b.stdout) or "no output")[-400:]))
        os.replace(blend, prepared)
        _prune_cache()
        _progress(job, 45, "Scene cache ready")
        return prepared
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)[:300]
        log.error("job %s: scene prepare FAILED: %s", job.get("id"), e,
                  exc_info=True)
    _jobs_save()
    return None


def _sha12(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def _blend_info():
    """Metadata for GET /v1/blend: version = content hash (12 hex chars)."""
    if not os.path.isfile(SCURVE_BLEND):
        return {"exists": False, "url": "/v1/blend/file"}
    st = os.stat(SCURVE_BLEND)
    info = {"exists": True, "size": st.st_size, "mtime": st.st_mtime,
            "version": _sha12(SCURVE_BLEND), "url": "/v1/blend/file"}
    try:
        with open(SCURVE_PARAMS_FILE) as f:
            info["applied"] = json.load(f).get("params") or {}
    except Exception:
        info["applied"] = None
    return info


def _obj_bounds_ft(obj):
    """Rig OBJ is feet/y-up: min/max over vertex lines -> footprint dict."""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    with open(obj, "r", encoding="utf8", errors="replace") as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                if len(p) >= 4:
                    x, y, z = float(p[1]), float(p[2]), float(p[3])
                    lo = [min(lo[0], x), min(lo[1], y), min(lo[2], z)]
                    hi = [max(hi[0], x), max(hi[1], y), max(hi[2], z)]
    if lo[0] > hi[0]:
        raise RuntimeError("rig OBJ has no vertices: " + obj)
    return {"minX": lo[0], "maxX": hi[0], "minZ": lo[2], "maxZ": hi[2]}


def _deployed_size():
    """Stage size of the deployed blend (written by export_ballroom.mjs)."""
    try:
        with open(os.path.join(RENDER_LAB, "out", "ballroom_data.json")) as f:
            size = json.load(f).get("size")
        return size if isinstance(size, dict) else None
    except Exception:
        return None


def _swap_blend(src):
    try:
        os.replace(src, SCURVE_BLEND)
        log.info("swapped %s -> %s (v%s, %s bytes)", os.path.basename(src),
                 SCURVE_BLEND, _sha12(SCURVE_BLEND),
                 os.path.getsize(SCURVE_BLEND))
    except PermissionError:
        try:
            os.remove(src)
        except OSError:
            pass
        log.error("swap blocked: %s is locked (Blender GUI open?)", SCURVE_BLEND)
        raise RuntimeError("blend is locked - close the Blender GUI "
                           "window that has it open, then retry")


# S-curve shape job: params -> rig OBJ (node) -> stage size recalculation.
# Same stage size as the deployed blend -> delta update (rig + PAR aim
# only). Different size (a rig that swings toward the audience, or the
# front furniture band demanding more depth) -> FULL REGEN: export the
# room around the new footprint, rebuild the blend, validate it with the
# validator suite, then swap blend + ballroom_data.json together.
def _scurve_job(job, jdir):
    try:
        params = (job.get("payload") or {}).get("params")
        if not isinstance(params, dict):
            raise ValueError("params object required")
        if not os.path.isfile(SCURVE_BLEND):
            raise RuntimeError("no blend at render-lab/out/ballroom_scene.blend"
                               " - run the validator suite first")
        _progress(job, 8, "Building S-curve rig...")
        pjson = os.path.join(jdir, "params.json")
        with open(pjson, "w") as f:
            json.dump(params, f)
        obj = os.path.join(jdir, "scurve.obj")
        r = subprocess.run(
            ["node", os.path.join(RENDER_LAB, "scurve_params.mjs"), pjson, obj],
            cwd=RENDER_LAB, capture_output=True, text=True, timeout=180)
        if r.returncode != 0 or not os.path.isfile(obj):
            raise RuntimeError("scurve build: "
                               + ((r.stderr or r.stdout) or "no output")[-400:])
        try:
            job["obj"] = json.loads(r.stdout or "{}")
        except Exception:
            job["obj"] = {"bytes": os.path.getsize(obj)}

        env = dict(os.environ)
        env["FORGE_SAMPLES"] = "1"      # saveblend-style run, no renders

        # stage-based size recalculation (front furniture band included)
        need = compute_stage_size(_obj_bounds_ft(obj))
        have = _deployed_size()
        job["stage"] = {"need": need, "have": have}
        mode = "delta" if have == need else "regen"
        log.info("job %s: stage decision -> %s (need %sx%s, have %s)",
                 job.get("id"), mode.upper(), need["w"], need["d"],
                 ("%sx%s" % (have.get("w"), have.get("d"))) if have else "none")
        if have == need:
            _progress(job, 35, "Updating .blend (S-curve only)...")
            tmp = os.path.join(RENDER_LAB, "out", "ballroom_scene.updating.blend")
            for stray in (tmp, tmp + "1"):
                if os.path.exists(stray):
                    os.remove(stray)
            b = subprocess.run(
                [BLENDER, "--background", "--factory-startup",
                 "--python", os.path.join(RENDER_LAB, "update_scurve.py"),
                 "--", SCURVE_BLEND, obj, tmp],
                cwd=RENDER_LAB, capture_output=True, text=True, env=env,
                timeout=600)
            if not os.path.isfile(tmp):
                raise RuntimeError("update_scurve failed (rc=%s): %s"
                                   % (b.returncode,
                                      ((b.stderr or b.stdout) or "no output")[-400:]))
            _progress(job, 85, "Swapping blend...")
            _swap_blend(tmp)
            for stray in (tmp + "1",):
                if os.path.exists(stray):
                    os.remove(stray)
            job["regen"] = False
        else:
            _progress(job, 35, "Stage %s -> %s: full regen..."
                      % (have and "%dx%d" % (have.get("w"), have.get("d")),
                         "%dx%d" % (need["w"], need["d"])))
            # fresh room around the new footprint (params-aware export),
            # staged data beside the candidate blend so a failed validate
            # never leaves data.json ahead of the deployed blend
            t0 = time.time()
            tmpdata = os.path.join(jdir, "ballroom_data.json")
            r = subprocess.run(
                ["node", os.path.join(RENDER_LAB, "export_ballroom.mjs"),
                 pjson, tmpdata],
                cwd=RENDER_LAB, capture_output=True, text=True, timeout=300)
            if r.returncode != 0 or not os.path.isfile(tmpdata):
                raise RuntimeError("export: "
                                   + ((r.stderr or r.stdout) or "no output")[-400:])
            log.info("job %s: export ok (%.1fs)", job.get("id"), time.time() - t0)
            cand = os.path.join(jdir, "regen")
            os.makedirs(cand, exist_ok=True)
            t0 = time.time()
            b = subprocess.run(
                [BLENDER, "--background", "--factory-startup",
                 "--python", os.path.join(RENDER_LAB, "render_ballroom.py"),
                 "--", os.path.join(RENDER_LAB, "out", "ballroom.obj"),
                 cand, "saveblend", tmpdata],
                cwd=RENDER_LAB, capture_output=True, text=True, env=env,
                timeout=600)
            blend_cand = os.path.join(cand, "ballroom_scene.blend")
            if not os.path.isfile(blend_cand):
                raise RuntimeError("regen failed (rc=%s): %s"
                                   % (b.returncode,
                                      ((b.stderr or b.stdout) or "no output")[-400:]))
            log.info("job %s: render_ballroom ok (%.1fs)", job.get("id"),
                     time.time() - t0)
            _progress(job, 70, "Validating regen (validator suite)...")
            t0 = time.time()
            v = subprocess.run(
                [BLENDER, "--background", "--factory-startup",
                 "--python", os.path.join(RENDER_LAB, "validator", "suite.py"),
                 "--", "--blend", blend_cand, "--no-deploy"],
                cwd=RENDER_LAB, capture_output=True, text=True, env=env,
                timeout=600)
            if v.returncode != 0:
                raise RuntimeError("regen failed validation: "
                                   + ((v.stdout or v.stderr) or "")[-500:])
            log.info("job %s: suite ALL PASS (%.1fs)", job.get("id"),
                     time.time() - t0)
            _progress(job, 85, "Swapping blend + data...")
            _swap_blend(blend_cand)
            os.replace(tmpdata,
                       os.path.join(RENDER_LAB, "out", "ballroom_data.json"))
            log.info("job %s: ballroom_data.json swapped -> %sx%s",
                     job.get("id"), need["w"], need["d"])
            job["regen"] = True

        version = _sha12(SCURVE_BLEND)
        size = os.path.getsize(SCURVE_BLEND)
        with open(SCURVE_PARAMS_FILE, "w") as f:
            json.dump({"params": params, "version": version, "size": size,
                       "updated": time.time()}, f, indent=1)
        job["result"] = {"version": version, "size": size,
                         "regen": bool(job.get("regen")),
                         "stage": need}
        job["status"] = "done"
        job["artifacts"] = []
        job["seconds"] = round(time.time() - job["created"], 1)
        _progress(job, 100, ("Regenerated" if job.get("regen")
                             else "Blend updated") + " · v" + version)
        log.info("job %s: DONE in %ss - %s - v%s",
                 job.get("id"), job.get("seconds"),
                 "regen" if job.get("regen") else "delta", version)
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)[:300]
        log.error("job %s FAILED: %s", job.get("id"), e, exc_info=True)
        _progress(job, 100, "Failed")


def worker():
    while True:
        job_id = WORKQ.get()
        job = JOBS[job_id]
        jdir = os.path.join(ARTIFACTS, job_id)
        os.makedirs(jdir, exist_ok=True)
        try:
            payload = job["payload"]
            log.info("job %s: worker start kind=%s", job_id,
                     payload.get("kind") or payload.get("scene") or "render")
            if payload.get("kind") == "scurve":
                # self-contained: never falls through to the render lane
                _scurve_job(job, jdir)
                _jobs_save()
                WORKQ.task_done()
                continue
            scene = payload.get("scene", "ballroom")
            quality = payload.get("quality", {})
            env = dict(os.environ)
            if quality.get("samples"):
                env["FORGE_SAMPLES"] = str(int(quality["samples"]))
            # Standard tier is the default; view jobs may widen it via
            # quality.res (the modal matches the viewer's aspect there).
            rx, ry = "2048", "1152"
            if quality.get("4k"):
                rx, ry = "3840", "2160"
            elif isinstance(quality.get("res"), list) and len(quality["res"]) == 2:
                try:
                    rx, ry = str(int(quality["res"][0])), str(int(quality["res"][1]))
                except Exception:
                    pass
            env["FORGE_RES_X"], env["FORGE_RES_Y"] = rx, ry

            # Fail fast with a plain-text reason instead of rendering a
            # scene we have no photoreal geometry for.
            if scene not in SUPPORTED_SCENES:
                job["status"] = "failed"
                job["error"] = ("Photoreal lane covers 'ballroom' today - "
                                "scene '%s' is still WebGL-only." % scene)[:200]
                _jobs_save()
                continue

            prepared = _ensure_prepared(job, scene,
                                        payload.get("size") or compute_stage_size(payload.get("footprint")),
                                        _clean_rig(payload.get("rig")))
            if not prepared:
                continue

            script = os.path.join(RENDER_LAB, "render_from_blend.py")

            def run_shot(label, preset, src, base, span):
                job["status"] = "rendering:" + label
                job["shot"] = label
                _progress(job, base, "Rendering %s…" % label)
                args = [BLENDER] + ([] if payload.get("watch") else ["--background"]) + [
                    "--factory-startup", "--python", script,
                    "--", prepared, jdir, preset, src]
                env["FORGE_PROGRESS"] = os.path.join(jdir, "progress.json")
                rc = _run_render(args, env, job, base, span,
                                 os.path.join(jdir, "progress.json"))
                png = os.path.join(jdir, "bal_%s.png" % label)
                return (png if rc == 0 and os.path.exists(png) else None), rc

            view = payload.get("view")
            if view and isinstance(view.get("position"), list) and \
                    len(view.get("position")) >= 3 and isinstance(view.get("target"), list) \
                    and len(view.get("target")) >= 3:
                vjson = os.path.join(jdir, "view.json")
                with open(vjson, "w") as f:
                    json.dump(view, f)
                png, rc = run_shot("view", "exact-view", vjson, 45, 53)
                if not png:
                    job["status"] = "failed"
                    job["error"] = ("exact-view render failed (exit %s)%s"
                                    % (rc, _log_tail(job)))[:250]
                    _jobs_save()
                    continue
                job["status"] = "done"
                job["artifacts"] = ["bal_view.png"]
                job["seconds"] = round(time.time() - job["created"], 1)
                _progress(job, 100, "Done")
            else:
                wanted = payload.get("shots") or ["grand-wide"]
                shots = [s for s in wanted if s in VALID_SHOTS] or ["grand-wide"]
                if len(shots) != len(wanted):
                    job["notice"] = "unknown shots dropped: " + \
                        ", ".join(s for s in wanted if s not in VALID_SHOTS)
                artifacts = []
                n = max(1, len(shots))
                job["shots_total"] = n
                base, span = 45.0, 50.0 / n
                for idx, shot in enumerate(shots):
                    png, rc = run_shot(shot, shot, prepared, base, span)
                    if not png:
                        job["status"] = "failed"
                        job["error"] = ("render %s: interrupted (exit %s)%s"
                                        % (shot, rc, _log_tail(job)))[:250]
                        _jobs_save()
                        break
                    artifacts.append(os.path.basename(png))
                    base += span
                else:
                    if payload.get("collage") and artifacts:
                        job["status"] = "collage"
                        _progress(job, 97, "Composing labeled collage…")
                        c = subprocess.run(["python", os.path.join(HERE, "collage.py"), jdir]
                                           + artifacts, capture_output=True, text=True, timeout=300)
                        cpath = os.path.join(jdir, "collage.png")
                        if c.returncode == 0 and os.path.exists(cpath):
                            artifacts.append("collage.png")
                    job["status"] = "done"
                    job["artifacts"] = artifacts
                    job["seconds"] = round(time.time() - job["created"], 1)
                    _progress(job, 100, "Done")
        except Exception as e:
            job["status"] = "failed"
            job["error"] = repr(e)[:500]
            log.error("job %s crashed: %r", job_id, e, exc_info=True)
        _jobs_save()
        WORKQ.task_done()


threading.Thread(target=worker, daemon=True, name="forge-worker").start()


# The TILT page (localhost PWA) talks to forge cross-origin. Same-machine
# origins only: an arbitrary website must never reach a local GPU service.
_LOCAL_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


def _local_origin(origin):
    return bool(origin) and bool(_LOCAL_RE.match(origin.strip()))


MIME = {".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "TiltForge/0.3.0"

    def _cors(self):
        origin = self.headers.get("Origin") or ""
        if _local_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers",
                             "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        log.debug("-> %s %s (%s bytes)", code, self.path, len(body))
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        ok = self.headers.get("Authorization") == "Bearer " + TOKEN
        if not ok:
            log.warning("unauthorized %s %s from %s",
                        self.command, self.path, self.client_address)
        return ok

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self._cors()
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin") or ""
        local = _local_origin(origin)
        if self.path == "/v1/health":
            self._send(200, {"service": "tilt-forge", "version": "0.3.0",
                             "blender": os.path.exists(BLENDER), "jobs": len(JOBS)})
        elif self.path == "/v1/handshake":
            # Browser cannot read forge/.token, so a page served locally gets
            # the bearer here. Off-machine origins get nothing.
            if not local:
                return self._send(403, {"error": "same-machine origins only"})
            self._send(200, {"service": "tilt-forge", "token": TOKEN})
        elif self.path == "/v1/looks":
            self._send(200, LOOKS)
        elif self.path == "/v1/scurve/params":
            # PARAMS metadata (labels/ranges/defaults) straight from
            # o2tilt.js + the deployed blend's version + applied params.
            try:
                r = subprocess.run(
                    ["node", os.path.join(RENDER_LAB, "scurve_params.mjs"),
                     "--dump"],
                    cwd=RENDER_LAB, capture_output=True, text=True, timeout=60)
                if r.returncode != 0:
                    raise RuntimeError((r.stderr or r.stdout
                                        or "node failed")[-300:])
                d = json.loads(r.stdout)
                try:
                    with open(SCURVE_PARAMS_FILE) as f:
                        d["applied"] = json.load(f).get("params") or {}
                except Exception:
                    d["applied"] = None
                self._send(200, d)
            except Exception as e:
                self._send(502, {"error": str(e)[:300]})
        elif self.path == "/v1/blend":
            self._send(200, _blend_info())
        elif self.path == "/v1/blend/file":
            # The .blend bytes for the TILT app to fetch. A local Origin
            # (or none at all - <a download> navigations send no Origin)
            # is accepted; a foreign Origin is refused. The listener binds
            # 127.0.0.1 anyway, so only this machine can connect.
            origin = self.headers.get("Origin")
            if origin and not _local_origin(origin):
                return self._send(403, {"error": "same-machine origins only"})
            if not os.path.isfile(SCURVE_BLEND):
                return self._send(404, {"error": "no deployed blend"})
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(os.path.getsize(SCURVE_BLEND)))
            self.send_header("Content-Disposition",
                             'attachment; filename="ballroom_scene.blend"')
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            with open(SCURVE_BLEND, "rb") as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        elif self.path.startswith("/v1/jobs/"):
            jid = self.path.rsplit("/", 1)[-1]
            job = JOBS.get(jid)
            if not job:
                return self._send(404, {"error": "no job " + jid})
            self._send(200, {"id": jid, **job})
        elif self.path.startswith("/v1/artifact/"):
            # GET /v1/artifact/{job}/{filename} - images for the studio modal.
            if not local:
                return self._send(403, {"error": "same-machine origins only"})
            rest = self.path[len("/v1/artifact/"):]
            jid, name = (rest.split("/", 1) + [""])[:2]
            jid = jid.replace("..", "")
            name = os.path.basename(name.replace("\\", "/"))
            path = os.path.abspath(os.path.join(ARTIFACTS, jid, name))
            if os.path.dirname(path) != os.path.abspath(os.path.join(ARTIFACTS, jid)) \
                    or not os.path.isfile(path):
                return self._send(404, {"error": "no artifact"})
            ext = os.path.splitext(name)[1].lower()
            with open(path, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send(404, {"error": "unknown path"})

    def do_POST(self):
        if not self._auth():
            return self._send(401, {"error": "bearer token required (forge/.token)"})
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad json"})
        if self.path == "/v1/scene/fit":
            return self._send(200, {"stage": compute_stage_size(body.get("footprint"))})
        if self.path == "/v1/render.json":
            jid = uuid.uuid4().hex[:12]
            JOBS[jid] = {"id": jid, "status": "queued", "payload": body,
                         "created": time.time(), "artifacts": []}
            _jobs_save()
            WORKQ.put(jid)
            log.info("POST /v1/render.json -> job %s (scene=%s)",
                     jid, body.get("scene"))
            return self._send(202, {"id": jid, "status": "queued"})
        if self.path == "/v1/scurve/update":
            params = body.get("params")
            if not isinstance(params, dict):
                return self._send(400, {"error": "params object required"})
            jid = uuid.uuid4().hex[:12]
            JOBS[jid] = {"id": jid, "status": "queued",
                         "payload": {"kind": "scurve", "params": params},
                         "created": time.time(), "artifacts": []}
            _jobs_save()
            WORKQ.put(jid)
            log.info("POST /v1/scurve/update -> job %s (params=%s)",
                     jid, sorted(params))
            return self._send(202, {"id": jid, "status": "queued"})
        log.warning("404 POST %s", self.path)
        self._send(404, {"error": "unknown path"})

    def log_message(self, fmt, *args):
        log.debug("http %s", fmt % args)


if __name__ == "__main__":
    log.info("FORGE token: %s", TOKEN)
    log.info("forge listening on 127.0.0.1:8765 - level=%s - log=%s",
             LOG_LEVEL, LOG_FILE)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
