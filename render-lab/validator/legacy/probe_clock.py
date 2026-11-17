import bpy, mathutils, json

# --- sconces on back wall? ---
def bb(o):
    pts=[o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return [round(min(xs),3),round(max(xs),3),round(min(ys),3),round(max(ys),3),round(min(zs),3),round(max(zs),3)]
print("=== sconce-mat objects ===")
for o in bpy.data.objects:
    if o.type=='MESH' and o.data.materials and o.data.materials[0] and 'sconce' in o.data.materials[0].name.lower():
        print(o.name, bb(o))

# --- clock model probe ---
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\wall_clock\wall_clock_2k.gltf")
parts=[o for o in bpy.data.objects if o not in before]
print("=== clock parts ===")
for p in parts:
    print(p.name, p.type, bb(p) if p.type=='MESH' else '')
meshes=[p for p in parts if p.type=='MESH']
if meshes:
    bpy.ops.object.select_all(action='DESELECT')
    for p in meshes: p.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    if len(meshes)>1: bpy.ops.object.join()
    ob=bpy.context.view_layer.objects.active
    lo,hi=bb(ob)
    print("JOINED dims:", [round(hi[i]-lo[i],3) for i in range(3)], "bbox:", lo, hi)
    print("materials:", [m.name for m in ob.data.materials])
    print("has_uv:", bool(ob.data.uv_layers))
