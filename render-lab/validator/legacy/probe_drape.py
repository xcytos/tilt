import bpy, mathutils
def bb(o):
    pts=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return [round(min(xs),3),round(max(xs),3),round(min(ys),3),round(max(ys),3),round(min(zs),3),round(max(zs),3)]
names=[n for n in bpy.data.objects.keys() if "ffffff-129" in n or "ffffff-130" in n or "drape" in n.lower() or "rail" in n.lower() or n in ("stage","floor")]
for n in sorted(set(names)):
    print("OBJ", n, bb(bpy.data.objects[n]))
