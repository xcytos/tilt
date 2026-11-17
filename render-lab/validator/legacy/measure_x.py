import bpy, json

TARGETS = {
    "throne_L": ["x=+0.60 side, rz=180"],  # placeholder — identify by bbox
}
# Identify wedding objects by name patterns
def bbox_world(ob):
    import mathutils
    pts = [ob.matrix_world @ mathutils.Vector(c) for c in ob.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)

rows = []
for ob in bpy.data.objects:
    n = ob.name
    if any(k in n.lower() for k in ["shelter", "wingback", "haven", "loveseat", "throne", "sofa", "wedding"]):
        if ob.type != 'MESH':
            continue
        x0,x1,y0,y1,z0,z1 = bbox_world(ob)
        rows.append(dict(name=n, x0=round(x0,4), x1=round(x1,4), y0=round(y0,4), y1=round(y1,4),
                         z0=round(z0,4), z1=round(z1,4), cx=round((x0+x1)/2,4)))

print("=== WEDDING OBJECTS ===")
for r in sorted(rows, key=lambda r: r["cx"]):
    print(json.dumps(r))

# Gap computation: right side = positive x. throne at ~+0.6, sofa at ~+3.9
# left side mirrored.
thr = [r for r in rows if r["cx"] > 0 and r["cx"] < 2.0]
sof = [r for r in rows if r["cx"] > 2.0]
thrL = [r for r in rows if r["cx"] < 0 and r["cx"] > -2.0]
sofL = [r for r in rows if r["cx"] < -2.0]
print("\n=== CURRENT GAPS (edge-to-edge, meters) ===")
for t, s in [(thr[0] if thr else None, sof[0] if sof else None),
             (thrL[0] if thrL else None, sofL[0] if sofL else None)]:
    if t and s:
        gap = s["x0"] - t["x1"] if s["cx"] > 0 else t["x0"] - s["x1"]
        print(f"{t['name']} (x1={t['x1']}) <-> {s['name']} (x0={s['x0']}): gap={gap:.4f} m = {gap/0.3048:.3f} ft")
