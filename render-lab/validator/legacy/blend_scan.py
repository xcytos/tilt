# Inspect prepared.blend: object count, per-root world bbox summary.
import bpy, collections, os
bpy.ops.wm.open_mainfile(filepath=os.path.abspath("forge/cache/894536c5fc8c/prepared.blend"))
import mathutils
roots = collections.defaultdict(lambda: {"n": 0, "min": [1e9]*3, "max": [-1e9]*3})
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    root = o.name.rsplit("-", 1)[0] if o.name.rsplit("-", 1)[-1].isdigit() else o.name
    r = roots[root]
    r["n"] += 1
    for v in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(v)
        for c in range(3):
            r["min"][c] = min(r["min"][c], w[c])
            r["max"][c] = max(r["max"][c], w[c])
print("MESHES", sum(r["n"] for r in roots.values()))
def ft(m): return m / 0.3048
for k in sorted(roots, key=lambda k: -roots[k]["n"])[:30]:
    r = roots[k]
    lo = ", ".join(f"{ft(x):6.1f}" for x in r["min"])
    hi = ", ".join(f"{ft(x):6.1f}" for x in r["max"])
    print(f"{r['n']:4d} {k[:24]:24s} min[{lo}] max[{hi}] (ft, blender XYZ)")
print("CAMS", [(o.name) for o in bpy.context.scene.objects if o.type == "CAMERA"])
