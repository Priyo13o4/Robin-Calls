"""
Builds the authorable city .blend from the raw western pack. Run ONCE.

  blender -b "<pack>.blend" -P scripts/city/build_city_blend.py -- --out <city.blend>

What it fixes, none of which survives a plain import:
  * every texture in the pack is unlinked (the file stores the original
    author's absolute paths) — relinked here by basename;
  * the 2.7x -> 5.x conversion produced Principled BSDFs with NO image nodes at
    all, while keeping the legacy Texture datablocks. Concatenating the two
    texture series in numeric order gives 39 + 20 = exactly 59 textures for 59
    materials, and at that mapping every sign lands on its own building. Both
    the count and the semantics were checked; redo both if the pack changes.

Afterwards the .blend is yours to arrange. The render script reads the scene,
so the layout lives in the file, not in any script.
"""
import bpy, sys, os, math, re
from mathutils import Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(f, d=None): return argv[argv.index(f) + 1] if f in argv else d
OUT = os.path.abspath(arg("--out", "city.blend"))

# Allocation key -> the object in the pack that stands for it. Keys must match
# `city` on the rows in lib/sale/tokenomics.ts.
ALLOC = {
    "fair_launch": "Cube.002",   # hotel
    "treasury":    "Cube.003",   # national bank
    "platform":    "Cube.001",   # general store
    "liquidity":   "Cube.004",   # saloon
    "airdrop":     "Cylinder",   # water tower
    "dev":         "Cube.009",   # barn / workshop
    "team":        "Cube.005",   # log cabin
}
START = {   # a starting arrangement; move them however you like
    "fair_launch": (-3.0, 1.30, 0), "treasury": (-1.05, 3.55, 90),
    "platform": (2.55, 3.30, 0),    "liquidity": (1.55, 1.10, 0),
    "airdrop": (5.60, 3.10, 0),     "dev": (-1.05, -1.75, 90),
    "team": (2.40, -1.90, 90),
}
SCENERY = [
    ("Cube", -4.6, 4.4, 0), ("Cube.012", -4.9, -1.3, 0), ("Cube.006", -3.3, -3.7, 90),
    ("Cube.008", 4.9, -2.5, 0), ("Cube.010", 0.5, -3.9, 0), ("Cube.013", 0.8, 4.9, 0),
    ("Cube.014", -1.9, 0.55, 20), ("Cylinder.000", 0.95, 0.50, 0), ("Cube.011", -6.4, 1.2, 0),
    ("Cube.010", -6.0, 4.7, 90), ("Cube.008", -5.5, -3.6, 0), ("Cube.013", 4.9, -4.1, 90),
    ("Cube.006", 6.4, 1.5, 90), ("Cube.014", -6.5, 1.2, -35), ("Cube.012", 6.0, 5.2, 0),
    ("Cube.005", -6.3, -1.7, 90), ("Cube.009", 4.3, 5.5, 90),
]
ROADS = [("x", 0.0, 15.0), ("y", 0.0, 13.0)]
ROAD_W = 1.55
ELEV, AZIM = 40.0, 45.0

# ---- 1. relink textures -----------------------------------------------------
texdir = os.path.join(os.path.dirname(bpy.data.filepath), "Texture")
by_name = {f.lower(): os.path.join(texdir, f) for f in os.listdir(texdir)} if os.path.isdir(texdir) else {}
for img in bpy.data.images:
    if img.source != "FILE" or os.path.exists(bpy.path.abspath(img.filepath)):
        continue
    hit = by_name.get(os.path.basename(img.filepath).lower())
    if hit:
        img.filepath = hit
        img.reload()

# ---- 2. rebuild materials ---------------------------------------------------
def _idx(name, prefix):
    if name == prefix: return 0
    m = re.fullmatch(re.escape(prefix) + r"\.(\d+)", name)
    return int(m.group(1)) if m else None

def _series(prefix, exclude=None):
    out = []
    for t in bpy.data.textures:
        if exclude and t.name.startswith(exclude): continue
        i = _idx(t.name, prefix)
        if i is not None and getattr(t, "image", None): out.append((i, t.image))
    return [im for _, im in sorted(out, key=lambda p: p[0])]

ORDERED = _series("Texture") + _series("Tex", exclude="Texture")
MATS = sorted(((_idx(m.name, "Material"), m) for m in bpy.data.materials
               if _idx(m.name, "Material") is not None), key=lambda p: p[0])
assert len(ORDERED) == len(MATS), (
    f"{len(ORDERED)} textures vs {len(MATS)} materials — the order mapping no "
    f"longer holds; re-derive it before trusting any sprite")
for slot, (_, mat) in enumerate(MATS):
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf: continue
    o = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if o and not o.inputs["Surface"].is_linked:
        nt.links.new(bsdf.outputs["BSDF"], o.inputs["Surface"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = ORDERED[slot]; t.interpolation = "Smart"
    t.location = (bsdf.location.x - 320, bsdf.location.y)
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.12

# ---- 3. ground + road materials --------------------------------------------
def _mat(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    build(nt, bsdf)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def _dirt(nt, bsdf):
    coord = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 9.0; n.inputs["Detail"].default_value = 8.0
    n.inputs["Roughness"].default_value = 0.62
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 120.0; grain.inputs["Detail"].default_value = 4.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.30, 0.235, 0.165, 1)
    ramp.color_ramp.elements[1].color = (0.53, 0.435, 0.315, 1)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"; mix.inputs["Factor"].default_value = 0.35
    nt.links.new(coord.outputs["Object"], n.inputs["Vector"])
    nt.links.new(coord.outputs["Object"], grain.inputs["Vector"])
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    nt.links.new(grain.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

def _road(nt, bsdf):
    coord = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 6.0; n.inputs["Detail"].default_value = 9.0
    st = nt.nodes.new("ShaderNodeTexNoise")
    st.inputs["Scale"].default_value = 3.0; st.inputs["Detail"].default_value = 6.0
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.7, 14.0, 1.0)   # ruts along the street
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.128, 0.098, 0.068, 1)
    ramp.color_ramp.elements[1].color = (0.268, 0.212, 0.150, 1)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"; mix.inputs["Factor"].default_value = 0.55
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], st.inputs["Vector"])
    nt.links.new(coord.outputs["Object"], n.inputs["Vector"])
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    nt.links.new(st.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

def _plank(nt, bsdf):
    img = next((i for i in bpy.data.images if i.name.lower().startswith("doski old 3")), None)
    if not img:
        bsdf.inputs["Base Color"].default_value = (0.28, 0.22, 0.15, 1); return
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1.6, 0.5, 1.0)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95

def _socket(nt, bsdf):
    coord = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 42.0; n.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    # Deliberately not dirt: this is what a lifted building uncovers, so it has
    # to read as a different surface at a glance.
    ramp.color_ramp.elements[0].color = (0.115, 0.105, 0.088, 1)
    ramp.color_ramp.elements[1].color = (0.245, 0.215, 0.175, 1)
    nt.links.new(coord.outputs["Object"], n.inputs["Vector"])
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

M_DIRT   = _mat("RC_ground", _dirt)
M_ROAD   = _mat("RC_road", _road)
M_PLANK  = _mat("RC_boardwalk", _plank)
M_SOCKET = _mat("RC_socket", _socket)

# ---- 4. collections ---------------------------------------------------------
scene = bpy.context.scene
def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

C_ALLOC = collection("ALLOCATIONS")
C_SCENE = collection("SCENERY")
C_SET   = collection("SET")

def move_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)

def place(obj, x, y, yaw):
    obj.rotation_euler.z += math.radians(yaw)
    bpy.context.view_layer.update()
    cs = [obj.matrix_world @ v.co for v in obj.data.vertices] if False else \
         [obj.matrix_world @ __import__("mathutils").Vector(c) for c in obj.bound_box]
    obj.location.x += x - sum(c.x for c in cs) / 8
    obj.location.y += y - sum(c.y for c in cs) / 8
    obj.location.z -= min(c.z for c in cs)      # base onto z = 0
    bpy.context.view_layer.update()

MESHES = {o.name: o for o in scene.objects if o.type == "MESH"}
for o in list(scene.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

# ground + roads
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object; ground.name = "SET_ground"
ground.data.materials.append(M_DIRT); move_to(ground, C_SET)
for axis, off, half in ROADS:
    loc = (0.0, off, 0.004) if axis == "x" else (off, 0.0, 0.004)
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    r = bpy.context.active_object; r.name = f"SET_road_{axis}"
    r.scale = (half * 2, ROAD_W, 1) if axis == "x" else (ROAD_W, half * 2, 1)
    r.data.materials.append(M_ROAD)
    bpy.ops.object.select_all(action="DESELECT"); r.select_set(True)
    bpy.context.view_layer.objects.active = r
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to(r, C_SET)

# allocation buildings — renamed so the renderer can find them
for key, src in ALLOC.items():
    obj = MESHES[src]
    obj.name = f"alloc_{key}"
    x, y, yaw = START[key]
    place(obj, x, y, yaw)
    move_to(obj, C_ALLOC)

# Scenery duplicates a repeated name rather than moving one object twice — and
# `seen` is PRE-SEEDED with every allocation source, because two of the props
# reuse the cabin and the barn. Without that the scenery pass moves the real
# allocation building into the dressing and the collection silently ends up
# with five buildings instead of seven.
seen = set(ALLOC.values())
for name, x, y, yaw in SCENERY:
    src = MESHES[name]
    if name in seen:
        obj = src.copy(); obj.data = src.data; scene.collection.objects.link(obj)
    else:
        obj = src; seen.add(name)
    place(obj, x, y, yaw)
    move_to(obj, C_SCENE)

# anything left over in the pack, parked out of shot but available
for o in scene.objects:
    if o.type == "MESH" and not o.users_collection:
        move_to(o, C_SCENE)
for o in list(C_SCENE.objects) + list(C_ALLOC.objects) + list(C_SET.objects):
    pass

# ---- 5. camera and sun ------------------------------------------------------
cam_d = bpy.data.cameras.new("CITY_CAM"); cam_d.type = "ORTHO"; cam_d.ortho_scale = 14.0
cam = bpy.data.objects.new("CITY_CAM", cam_d); C_SET.objects.link(cam)
cam.rotation_euler = Euler((math.radians(ELEV), 0, math.radians(AZIM)), "XYZ")
cam.location = (18.0, -18.0, 18.0)
scene.camera = cam

sun_d = bpy.data.lights.new("CITY_SUN", type="SUN")
sun_d.energy = 4.2; sun_d.angle = math.radians(6); sun_d.color = (1.0, 0.94, 0.82)
sun_d.use_shadow = True
sun = bpy.data.objects.new("CITY_SUN", sun_d); C_SET.objects.link(sun)
sun.rotation_euler = Euler((math.radians(52), 0, math.radians(AZIM + 55)), "XYZ")

world = bpy.data.worlds.new("RC_world"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.66, 0.78, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.22
scene.world = world

scene.render.engine = "BLENDER_EEVEE"
scene.render.film_transparent = True
scene.render.resolution_percentage = 100
try:
    scene.eevee.use_shadows = True
    scene.eevee.shadow_ray_count = 4
    scene.eevee.shadow_resolution_scale = 2.0
    scene.eevee.taa_render_samples = 64
except Exception:
    pass

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print(f"[build] saved {OUT}")
print(f"[build] ALLOCATIONS={len(C_ALLOC.objects)} SCENERY={len(C_SCENE.objects)} SET={len(C_SET.objects)}")
