import bpy

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\syedm\AppData\Local\Temp\opencode\regen_out\ballroom_scene.blend")
clk = bpy.data.objects["stage_clock"]
for slot in clk.material_slots:
    m = slot.material
    print("MAT", m.name)
    if not m.node_tree:
        continue
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            for inp in n.inputs:
                if inp.name in ("Roughness", "Metallic", "Transmission Weight",
                                "Specular IOR Level", "IOR", "Alpha", "Base Color",
                                "Coat Weight"):
                    v = inp.default_value
                    try:
                        v = tuple(round(x, 3) for x in v)
                    except TypeError:
                        v = round(float(v), 3)
                    print("  ", inp.name, "=", v)
