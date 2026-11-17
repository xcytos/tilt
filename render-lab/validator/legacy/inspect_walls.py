import bpy, json, mathutils

def bbox_world(ob):
    pts = [ob.matrix_world @ mathutils.Vector(c) for c in ob.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return [round(min(xs),3), round(max(xs),3), round(min(ys),3), round(max(ys),3), round(min(zs),3), round(max(zs),3)]

rows=[]
for ob in bpy.data.objects:
    if ob.type!='MESH': continue
    b=bbox_world(ob)
    w=b[1]-b[0]; d=b[3]-b[2]; h=b[5]-b[4]
    rows.append(dict(name=ob.name, vis=not ob.hide_render, x0=b[0],x1=b[1],y0=b[2],y1=b[3],z0=b[4],z1=b[5],
                     size=[round(w,2),round(d,2),round(h,2)], mat=(ob.data.materials[0].name if ob.data and ob.data.materials else None)))

# walls / structural / trim candidates: tall or wall-like, and cream/gold/wall named
print("=== WALL-LIKE / STRUCTURAL (h>1.5 or name match) ===")
for r in sorted(rows, key=lambda r:(-r["size"][2])):
    n=r["name"].lower()
    if r["size"][2]>1.5 or any(k in n for k in ["wall","cream","gold","cove","trim","frame","panel","floor","stage","carpet"]):
        print(json.dumps(r))

print("\n=== FLOOR / GROUND ===")
for r in rows:
    if "floor" in r["name"].lower() or (r["size"][0]>30 and r["size"][2]<0.5):
        print(json.dumps(r))

print("\n=== STAGE REGION objects (y between -3 and 3, z<3) ===")
for r in sorted(rows, key=lambda r: r["name"]):
    if -3.2<r["y0"]<3.2 and r["z1"]<4 and r["size"][0]>0.3:
        print(json.dumps(r))
