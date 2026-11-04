#!/usr/bin/env python3
"""TILT FORGE - Blender photoreal pipeline microservice (stdlib-only MVP).

Endpoints (localhost:8765, bearer token in forge/.token):
  GET  /v1/health
  GET  /v1/looks               -> colorway/scene look catalog
  POST /v1/scene/fit           -> computeStageSize parity for a footprint
  POST /v1/render.json         -> submit job {scene, size|footprint, shots[], collage}
  GET  /v1/jobs/{id}           -> job status/artifacts
"""
import json
import os
import queue
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
TOKEN_FILE = os.path.join(HERE, ".token")

os.makedirs(ARTIFACTS, exist_ok=True)

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


WORKQ = queue.Queue()


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
            shots = payload.get("shots") or ["grand-wide"]
            size = payload.get("size") or compute_stage_size(payload.get("footprint"))
            job["status"] = "reconstructing"
            recon_payload = {"scene": scene, "size": size}
            pjson = os.path.join(jdir, "payload.json")
            with open(pjson, "w") as f:
                json.dump(recon_payload, f)
            r = subprocess.run(["node", os.path.join(HERE, "reconstruct.mjs"), pjson, jdir],
                               capture_output=True, text=True, cwd=RENDER_LAB, timeout=180)
            if r.returncode != 0:
                job["status"] = "failed"
                job["error"] = "reconstruct: " + (r.stderr or r.stdout)[-800:]
                _jobs_save()
                continue
            obj = os.path.join(jdir, "scene.obj")
            data = os.path.join(jdir, "scene_data.json")
            artifacts = []
            env = dict(os.environ)
            if quality.get("samples"):
                env["FORGE_SAMPLES"] = str(int(quality["samples"]))
            if quality.get("4k"):
                env["FORGE_RES_X"], env["FORGE_RES_Y"] = "3840", "2160"
            for shot in shots:
                job["status"] = "rendering:" + shot
                _jobs_save()
                b = subprocess.run(
                    [BLENDER, "--background", "--factory-startup",
                     "--python", os.path.join(RENDER_LAB, "render_ballroom.py"),
                     "--", obj, jdir, shot, data],
                    capture_output=True, text=True, cwd=RENDER_LAB, timeout=900, env=env)
                png = os.path.join(jdir, "bal_%s.png" % shot)
                if b.returncode != 0 or not os.path.exists(png):
                    job["status"] = "failed"
                    job["error"] = ("render %s: " % shot) + (b.stderr or b.stdout)[-800:]
                    _jobs_save()
                    break
                artifacts.append(os.path.basename(png))
            else:
                if payload.get("collage") and artifacts:
                    job["status"] = "collage"
                    _jobs_save()
                    c = subprocess.run(["python", os.path.join(HERE, "collage.py"), jdir]
                                       + artifacts, capture_output=True, text=True, timeout=300)
                    cpath = os.path.join(jdir, "collage.png")
                    if c.returncode == 0 and os.path.exists(cpath):
                        artifacts.append("collage.png")
                job["status"] = "done"
                job["artifacts"] = artifacts
        except Exception as e:
            job["status"] = "failed"
            job["error"] = repr(e)[:500]
        _jobs_save()
        WORKQ.task_done()


threading.Thread(target=worker, daemon=True, name="forge-worker").start()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def do_GET(self):
        if self.path == "/v1/health":
            self._send(200, {"service": "tilt-forge", "version": "0.1.0",
                             "blender": os.path.exists(BLENDER), "jobs": len(JOBS)})
        elif self.path == "/v1/looks":
            self._send(200, LOOKS)
        elif self.path.startswith("/v1/jobs/"):
            jid = self.path.rsplit("/", 1)[-1]
            job = JOBS.get(jid)
            if not job:
                return self._send(404, {"error": "no job " + jid})
            self._send(200, {"id": jid, **job})
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
