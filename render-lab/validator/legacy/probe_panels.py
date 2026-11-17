import bpy, mathutils
def bb(o):
    pts=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return [round(min(xs),3),round(max(xs),3),round(min(ys),3),round(max(ys),3),round(min(zs),3),round(max(zs),3)]
for n in ("stage_panel_wood","stage_panel_marble"):
    o=bpy.data.objects[n]
    m=o.data.materials[0] if o.data.materials else None
    imgs=[]
    if m and m.use_nodes:
        imgs=[(nd.image.name if nd.image else None) for nd in m.node_tree.nodes if nd.type=='TEX_IMAGE']
    print(n, "bbox", bb(o), "mat", m.name if m else None, "imgs", imgs)
