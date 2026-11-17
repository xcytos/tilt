import bpy, math, json, os
from mathutils import Vector

ASSETS = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets"
log = []

def wpos(ob):
    return ob.matrix_world.translation

def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx

# --- 1. camera lens fix (root cause: hardcoded 40 vs SHOTS grand-wide 30) ---
cam = bpy.data.cameras.get("cam_gui")
old_lens = cam.lens
cam.lens = 30.0
log.append("CAMERA cam_gui lens %s -> 30" % old_lens)

# --- 2. old chandelier cluster (cframe parts = crystal frames) ---
cframes = [o for o in bpy.data.objects if o.name.startswith("cframe")]
cmn, cmx = world_bbox(cframes)
c_center = (cmn + cmx) * 0.5
log.append("OLD chandelier cluster n=%d center=(%.2f,%.2f,%.2f) size=(%.2f,%.2f,%.2f)" % (
    len(cframes), c_center.x, c_center.y, c_center.z,
    cmx.x - cmn.x, cmx.y - cmn.y, cmx.z - cmn.z))

# --- 3. import chandelier GLB ---
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, "chandelier.glb"))
new_ch = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
nmn, nmx = world_bbox(new_ch)
log.append("IMPORTED chandelier parts=%d size=(%.2f,%.2f,%.2f)" % (
    len(new_ch), nmx.x - nmn.x, nmx.y - nmn.y, nmx.z - nmn.z))

# scale to old XY span, center XY at old center, top at old top
old_sx = cmx.x - cmn.x; new_sx = nmx.x - nmn.x
s = (old_sx / new_sx) if new_sx > 0.01 and old_sx > 0.01 else 1.0
s = max(0.5, min(s, 4.0))
# apply scale about origin then translate: easiest = scale object origins+data via parent empty
piv = Vector(((nmn.x + nmx.x) / 2, (nmn.y + nmx.y) / 2, nmx.z))  # top center of new
for ob in new_ch:
    ob.scale = (ob.scale[0] * s, ob.scale[1] * s, ob.scale[2] * s)
    # scale location relative to piv (objects may have own locs)
    ob.location = piv + (ob.location - piv) * s if ob.parent is None else ob.location
# after scaling data/loc, recompute bbox
nmn2, nmx2 = world_bbox(new_ch)
dx = c_center.x - (nmn2.x + nmx2.x) / 2
dy = c_center.y - (nmn2.y + nmx2.y) / 2
dz = cmx.z - nmx2.z
for ob in new_ch:
    if ob.parent is None:
        ob.location = ob.location + Vector((dx, dy, dz))
log.append("CHAND scale=%.2f shift=(%.2f,%.2f,%.2f)" % (s, dx, dy, dz))

# --- 4. hide old chandelier stand-ins (near center, above 3m) ---
hidden = []
for ob in bpy.data.objects:
    if ob in new_ch or ob.type != "MESH":
        continue
    n = ob.name
    p = wpos(ob)
    near = (p.x - c_center.x) ** 2 + (p.y - c_center.y) ** 2 < 2.2 ** 2
    if n.startswith("cframe") or n.startswith("strand") or n.startswith("bloom") \
       or n in ("glass", "gold.004", "gold.005", "gold.006") \
       or (near and p.z > 3.0 and n.startswith("bulb")):
        ob.hide_render = True
        ob.hide_viewport = True
        hidden.append(n)
log.append("HID old chandelier parts: %d" % len(hidden))

# --- 5. chairs: cluster old 374151-* frames ---
frames = [o for o in bpy.data.objects if o.name.startswith("374151")]
clusters = []
for ob in frames:
    p = wpos(ob)
    for c in clusters:
        if (p - c["anchor"]).length < 0.6:
            c["objs"].append(ob)
            c["pts"].append(p)
            break
    else:
        clusters.append({"objs": [ob], "pts": [p], "anchor": p.copy()})
log.append("CHAIR clusters=%d sizes=%s" % (len(clusters), [len(c["objs"]) for c in clusters]))

# table centers (from tabletops) for facing
tables = [wpos(o) for o in bpy.data.objects if o.name.startswith("wall_tableTop")]
log.append("TABLES=%d at %s" % (len(tables), [(round(t.x, 1), round(t.y, 1)) for t in tables]))

# import chair once
before2 = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, "chiavari_gold_chair.glb"))
base_new = [o for o in bpy.data.objects if o not in before2 and o.type == "MESH"]
# join base into one object for easy duplication
bpy.ops.object.select_all(action="DESELECT")
for o in base_new:
    o.select_set(True)
if base_new:
    bpy.context.view_layer.objects.active = base_new[0]
    bpy.ops.object.join()
    chair0 = bpy.context.view_layer.objects.active
    chair0.name = "lux_chair_00"
    bmn, bmx = world_bbox([chair0])
    new_h = bmx.z - bmn.z
    log.append("IMPORTED chair parts joined -> %s h=%.3f" % (chair0.name, new_h))

placed = 0
if base_new:
    for i, c in enumerate(clusters):
        pts = c["pts"]
        cx = sum(p.x for p in pts) / len(pts)
        cy = sum(p.y for p in pts) / len(pts)
        cz = min(p.z for p in pts)
        omn, omx = world_bbox(c["objs"])
        old_h = omx.z - omn.z
        sc = (old_h / new_h) if new_h > 0.05 and old_h > 0.05 else 1.0
        if i == 0:
            ch = chair0
        else:
            ch = chair0.copy()  # shares mesh data
            bpy.context.collection.objects.link(ch)
        ch.name = "lux_chair_%02d" % i
        ch.scale = (sc, sc, sc)
        # recompute bbox bottom after scale for floor align
        smn, smx = world_bbox([ch])
        # face nearest table (front = -Y after glTF import)
        if tables:
            nt = min(tables, key=lambda t: (t.x - cx) ** 2 + (t.y - cy) ** 2)
            d = Vector((nt.x - cx, nt.y - cy))
            if d.length > 0.01:
                theta = math.atan2(d.x, -d.y)
            else:
                theta = 0.0
        else:
            theta = 0.0
        ch.rotation_euler = (0, 0, theta)
        # set location: bottom at old min z, xy at cluster centroid
        smn2, smx2 = world_bbox([ch])
        off = Vector((cx, cy, cz)) - Vector(((smn2.x + smx2.x) / 2, (smn2.y + smx2.y) / 2, smn2.z))
        ch.location = ch.location + off
        placed += 1
    log.append("PLACED %d luxury chairs (scale-to-old-height, facing nearest table)" % placed)

# hide old chair frames
n_hide = 0
for ob in frames:
    ob.hide_render = True
    ob.hide_viewport = True
    n_hide += 1
log.append("HID old chair frames: %d" % n_hide)

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
log.append("SAVED %s" % bpy.data.filepath)
print("UPGRADE_LOG<<<" + json.dumps(log) + ">>>")
