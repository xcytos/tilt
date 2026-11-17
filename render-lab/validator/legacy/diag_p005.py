# diag_p005.py -- locate S-curve drape fabrics + lamp-like objects + table context
import bpy, math, os, sys
import mathutils

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

def wb(o):
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    return (min(xs),min(ys),min(zs)), (max(xs),max(ys),max(zs))

print("=== MATERIALS (users) ===")
for m in sorted(bpy.data.materials, key=lambda x: -x.users):
    emis = ""
    if m.use_nodes and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "EMISSION":
                emis = " EMISSION strength=%s color=%s" % (n.inputs[1].default_value, tuple(round(v,2) for v in n.inputs[0].default_value))
            if n.type == "BSDF_PRINCIPLED":
                ei = n.inputs.get("Emission Color")
                if ei and ei.default_value[0]+ei.default_value[1]+ei.default_value[2] > 0.01:
                    emis += " principled_emission=%s str=%s" % (tuple(round(v,2) for v in ei.default_value), n.inputs.get("Emission Strength").default_value if n.inputs.get("Emission Strength") else "?")
    print("MAT %-28s users=%-4d%s" % (m.name, m.users, emis))

print("=== DRAPE/CLOTH/SCURVE objects ===")
for o in sorted(bpy.data.objects, key=lambda x: x.name):
    n = o.name.lower()
    if any(k in n for k in ("cloth","drape","curtain","scurve","fabric","pleat")):
        lo,hi = wb(o)
        mats = ",".join(s.material.name if s.material else "-" for s in o.material_slots)
        print("%-24s dims=(%.2f,%.2f,%.2f) center=(%.2f,%.2f,%.2f) mats=%s" % (
            o.name, hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2],
            (lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2, mats))

print("=== LAMP-LIKE objects ===")
for o in sorted(bpy.data.objects, key=lambda x: x.name):
    n = o.name.lower()
    if any(k in n for k in ("lamp","bulb","sconce","light","glow","candle","stand")):
        lo,hi = wb(o)
        mats = ",".join(s.material.name if s.material else "-" for s in o.material_slots)
        print("%-24s type=%s dims=(%.2f,%.2f,%.2f) center=(%.2f,%.2f,%.2f) mats=%s hide_r=%s" % (
            o.name, o.type, hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2],
            (lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2, mats, o.hide_render))

print("=== LIGHT objects ===")
for o in bpy.data.objects:
    if o.type == "LIGHT":
        print("%-16s energy=%s color=%s loc=%s" % (o.name, o.data.energy, tuple(round(v,2) for v in o.data.color), tuple(round(v,2) for v in o.location)))

print("=== objects with EMISSION mats (non-hidden) ===")
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render: continue
    for s in o.material_slots:
        m = s.material
        if not (m and m.use_nodes and m.node_tree): continue
        for n in m.node_tree.nodes:
            if n.type == "EMISSION" or (n.type=="BSDF_PRINCIPLED" and n.inputs.get("Emission Strength") and n.inputs["Emission Strength"].default_value > 0):
                print("%-24s mat=%s" % (o.name, m.name))
                break
