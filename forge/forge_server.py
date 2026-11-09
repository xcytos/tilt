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
Scene geometry+materials are built ONCE into forge/cache/<sig>/prepared.blend;
later jobs load it and only swap the camera (exact-view or a preset).
"""
import hashlib
import json
import mimetypes
import os
import queue
import re
import secrets
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_LAB = os.path.abspath(os.path.join(HERE, "..", "render-lab"))
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
ARTIFACTS = os.path.join(HERE, "artifacts")
CACHE = os.path.join(HERE, "cache")
TOKEN_FILE = os.path.join(HERE, ".token")

os.makedirs(ARTIFACTS, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

# bearer token: stable per forge install
if not os.path.exists(TOKEN_FILE):
    with open(TOKEN_FILE, "w") as f:
        f.write(secrets.token_hex(16))
with open(TOKEN_FILE) as f:
    TOKEN = f.read().strip()

# ---------- codebase parity: computeStageSize (js/scenes.js) ----------
DEFAULT_STAGE_SIZE = {"w": 60, "d": 16, "h": 1.2, "wallX": 30, "wallZ": 16, "wallH": 26}
MARGIN_X, MARGIN_Z = 3.5, 3
W_MIN, W_MAX, D_MIN, D_MAX = 44, 140, 18, 60


def compute_stage_size(fp):
    if not fp or not all(_is_num(fp.get(k)) for k in ("minX", "maxX", "minZ", "maxZ")):
        return dict(DEFAULT_STAGE_SIZE)
    span_w = fp["maxX"] - fp["minX"] + MARGIN_X * 2
    span_d = fp["maxZ"] - fp["minZ"] + MARGIN_Z * 2
    w = min(W_MAX, max(W_MIN, -(-span_w // 2) * 2))
    d = min(D_MAX, max(D_MIN, -(-span_d // 2) * 2))
    return {
        "w": int(w), "d": int(d), "h": DEFAULT_STAGE_SIZE["h"],
        "wallX": w / 2 + 8,
        "wallZ": int(max(16, d / 2 + 8)),
        "wallH": int(min(40, max(24, round(w / 2.3)))),
    }


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
        _progress(job, 45, "Scene cache hit")
        return prepared
    job["cache"] = "miss"
    job["status"] = "preparing"
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
        _jobs_save()
        return None


def worker():
    while True:
        job_id = WORKQ.get()
        job = JOBS[job_id]
        jdir = os.path.join(ARTIFACTS, job_id)
        os.makedirs(jdir, exist_ok=True)
        try:
            payload = job["payload"]
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
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

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
            return self._send(202, {"id": jid, "status": "queued"})
        self._send(404, {"error": "unknown path"})

    def log_message(self, fmt, *args):
        print("[forge] " + fmt % args, flush=True)


if __name__ == "__main__":
    print("FORGE token:", TOKEN, flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
