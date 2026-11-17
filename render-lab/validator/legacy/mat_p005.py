# mat_p005.py -- 1) S-curve drape cloth -> satin beige  2) table-lamp (bloom) glow  3) save
import bpy, os, sys

BLEND = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\out\ballroom_scene.blend"

def set_input(node, name, value):
    for inp in node.inputs:
        if inp.name == name:
            inp.default_value = value
            return True
    return False

bpy.ops.wm.open_mainfile(filepath=BLEND)

# --- 1+2. satin beige on the S-curve drape fabric (material 'cloth', 2 users) ---
cloth = bpy.data.materials.get("cloth")
assert cloth and cloth.use_nodes, "cloth material missing"
bsdf = cloth.node_tree.nodes.get("Principled BSDF")
assert bsdf, "no principled in cloth"
# satin: smooth + sheen (skill recipe 10 tuned for satin, not velvet)
set_input(bsdf, "Base Color", (0.78, 0.68, 0.52, 1.0))   # beige (linear)
set_input(bsdf, "Metallic", 0.0)
set_input(bsdf, "Roughness", 0.32)
set_input(bsdf, "Sheen Weight", 0.6)
set_input(bsdf, "Sheen Roughness", 0.25)
set_input(bsdf, "Sheen Tint", (1.0, 0.97, 0.92, 1.0))
set_input(bsdf, "IOR", 1.45)
cloth.name = "MAT-satin_beige_drape"
cloth.diffuse_color = (0.78, 0.68, 0.52, 1.0)
users = [o.name for o in bpy.data.objects if any(s.material == cloth for s in o.material_slots)]
print("P005| satin beige ->", users)

# --- 3. table lamps glow: 'bloom' (red shade on gold vase) gets warm emission ---
bloom = bpy.data.materials.get("bloom")
assert bloom and bloom.use_nodes, "bloom material missing"
bb = bloom.node_tree.nodes.get("Principled BSDF")
assert bb, "no principled in bloom"
set_input(bb, "Emission Color", (1.0, 0.78, 0.52, 1.0))    # warm tungsten
set_input(bb, "Emission Strength", 22.0)
bloom.diffuse_color = (0.48, 0.12, 0.17, 1.0)
busers = [o.name for o in bpy.data.objects if any(s.material == bloom for s in o.material_slots)]
print("P005| lamp glow ->", busers)

bpy.ops.wm.save_mainfile(filepath=os.path.abspath(BLEND))
print("P005| SAVED", BLEND)
