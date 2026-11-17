import bpy, sys, json

out = {"objects": [], "materials": {}}
for ob in bpy.data.objects:
    entry = {
        "name": ob.name,
        "type": ob.type,
        "loc": [round(v, 3) for v in ob.location],
        "dim": [round(v, 3) for v in ob.dimensions],
        "verts": len(ob.data.vertices) if ob.type in ("MESH", "CURVE") else 0,
        "mats": [m.name if m else None for m in ob.data.materials] if ob.type in ("MESH", "CURVE") else [],
    }
    out["objects"].append(entry)

for m in bpy.data.materials:
    info = {"use_nodes": m.use_nodes, "principled": {}}
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                try:
                    info["principled"] = {
                        "base_color": [round(v, 3) for v in n.inputs["Base Color"].default_value],
                        "roughness": round(n.inputs["Roughness"].default_value, 3),
                        "metallic": round(n.inputs["Metallic"].default_value, 3),
                        "has_tex_base": n.inputs["Base Color"].is_linked,
                    }
                except Exception:
                    pass
    out["materials"][m.name] = info

sys.stdout.write("BI_DUMP<<<" + json.dumps(out) + ">>>")
