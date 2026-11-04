import bpy, os, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OBJ = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1])
FT = 0.3048  # model units are feet -> meters

# ---------- clean scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- import OBJ ----------
bpy.ops.wm.obj_import(filepath=OBJ)
src = [o for o in scene.objects if o.type == 'MESH']

# scale feet -> meters, then center feet on ground
bpy.ops.object.select_all(action='DESELECT')
for o in src:
    o.select_set(True)
bpy.context.view_layer.objects.active = src[0]
bpy.ops.object.scale_clear()  # ensure no existing scale
for o in src:
    o.scale = (FT, FT, FT)
bpy.context.view_layer.update()

mins = Vector((min(min(v.co.z * FT for v in o.data.vertices) for o in src),
               min(min(v.co.y * FT for v in o.data.vertices) for o in src),
               min(min(v.co.x * FT for v in o.data.vertices) for o in src)))
# Blender: obj z-up -> rotate conversion handled by importer; stat bounds in imported space
zs = [o.matrix_world.translation.z for o in src]
print('IMPORT: meshes=%d' % len(src))

# ---------- materials ----------
def mat(name, base, metal, rough, sheen=0.0, sheen_rough=0.3):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes['Principled BSDF']
    n.inputs['Base Color'].default_value = (*base, 1.0)
    n.inputs['Metallic'].default_value = metal
    n.inputs['Roughness'].default_value = rough
    try:
        n.inputs['Sheen Weight'].default_value = sheen
        n.inputs['Sheen Roughness'].default_value = sheen_rough
    except Exception:
        pass
    return m

M_GOLD   = mat('GoldAnodized', (0.83, 0.64, 0.15), 1.0, 0.22)
M_FABRIC = mat('DrapeCloth',   (0.86, 0.86, 0.89), 0.0, 0.8, sheen=0.55, sheen_rough=0.45)
M_POLE   = mat('PoleSteel',    (0.62, 0.64, 0.68), 1.0, 0.35)
M_BASE   = mat('BaseSteel',    (0.20, 0.24, 0.30), 1.0, 0.28)
M_JOINT  = mat('JointSteel',   (0.42, 0.45, 0.50), 1.0, 0.30)

PREFIX = {'d4af37': M_GOLD, 'ffffff': M_FABRIC, '9ca3af': M_POLE,
          '374151': M_BASE, '6b7280': M_JOINT}

for o in src:
    name = o.name  # e.g. "d4af37-127"
    key = name.rsplit('-', 1)[0]
    m = PREFIX.get(key, M_JOINT)
    if o.material_slots:
        o.material_slots[0].material = m
    else:
        o.data.materials.append(m)

# ---------- floor: soft studio cyclorama ----------
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, -6, 0))
floor = bpy.context.object
floor.name = 'Floor'
mf = bpy.data.materials.new('Floor')
mf.use_nodes = True
nf = mf.node_tree.nodes['Principled BSDF']
nf.inputs['Base Color'].default_value = (0.55, 0.56, 0.58, 1.0)
nf.inputs['Roughness'].default_value = 0.6
nf.inputs['Metallic'].default_value = 0.0
floor.data.materials.append(mf)

# backdrop wall behind the rig (gives the center seam proper depth)
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 5, 5), rotation=(math.radians(-90), 0, 0))
wall = bpy.context.object
wall.name = 'Backdrop'
wall.data.materials.append(mf)

# ---------- world: soft gradient ----------
world = bpy.data.worlds.new('Studio')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.05, 0.055, 0.07, 1.0)
bg.inputs['Strength'].default_value = 0.35

def area(name, loc, rot, size, power, color=(1, 1, 1)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.object
    l.name = name
    l.data.shape = 'RECTANGLE'
    l.data.size = size[0]
    l.data.size_y = size[1]
    l.data.energy = power
    l.data.color = color
    l.rotation_euler = rot
    return l

H = 2.6  # model height approx meters
# key: big soft frontal-left
area('KeyL', (-3.2, -4.5, 2.9), (math.radians(55), 0, math.radians(-35)), (3.2, 2.6), 900)
# fill: right, dimmer
area('FillR', (3.6, -3.6, 2.2), (math.radians(60), 0, math.radians(48)), (2.6, 2.0), 320, (0.92, 0.95, 1.0))
# rim/back top
area('RimTop', (0.0, 2.8, 3.6), (math.radians(-55), 0, math.radians(180)), (2.4, 1.8), 500)
# subtle bounce under front
area('BounceF', (0.4, -5.2, 0.25), (math.radians(78), 0, 0), (3.0, 3.0), 90)

# ---------- camera ----------
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 50
cam = bpy.data.objects.new('Cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
# center approx x=0, depth y~0 ; rails width ~ rail 12 ft -> 3.7m
cam.location = (-3.0, -13.5, 3.2)
cam.rotation_euler = (math.radians(80), 0, math.radians(-12))
cam_data.dof.use_dof = True
cam_data.dof.focus_distance = 13.0
cam_data.dof.aperture_fstop = 5.6
scene.render.resolution_x = 2048
scene.render.resolution_y = 1152

# ---------- cycles render setup ----------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type != 'CPU')
scene.cycles.device = 'GPU'
scene.cycles.samples = 384
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.02
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.max_bounces = 12
scene.cycles.caustics_refractive = True
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'

def render_to(path, loc, rot, fstop=5.6, focus=13.0, lens=35):
    cam.location = loc
    cam.rotation_euler = rot
    cam_data.lens = lens
    cam_data.dof.aperture_fstop = fstop
    cam_data.dof.focus_distance = focus
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED:', path)

ang = {'hero':  ((-3.0, -13.5, 3.2), (math.radians(80), 0, math.radians(-12))),
       'front': ((0.0, -14.5, 2.4), (math.radians(84), 0, 0)),
       'threeQ': ((6.0, -12.0, 4.2), (math.radians(78), 0, math.radians(28)))}
which = argv[2] if len(argv) > 2 else 'all'
for k, (loc, rot) in ang.items():
    if which in ('all', k):
        render_to(os.path.join(OUT, f'render_{k}.png'), loc, rot)

print('DONE')
