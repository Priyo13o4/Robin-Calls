"""
Renders the allocation city from an AUTHORED .blend into aligned web layers.

  blender -b robincalls-city.blend -P scripts/city/render_city.py -- \
      --out public/tokenomics/city [--size 1600] [--camera]

The layout lives in the .blend, not here. Move, rotate and add whatever you
like in Blender; this reads the scene as it finds it. The camera's ANGLE is
authored too, but by default its zoom and centre are fitted to the allocation
buildings. Aim CITY_CAM at the town and pass --camera to own the framing
outright — then Blender's camera view IS the published frame.

The contract it reads:
  ALLOCATIONS  one object per allocation, named alloc_<key>. Each becomes its
               own interactive layer, so <key> must match `city` on the row in
               lib/sale/tokenomics.ts.
  SCENERY      dressing. Baked into the ground plate, never interactive.
  SET          ground, roads, camera (CITY_CAM, must stay ORTHOGRAPHIC), sun.

Two things are generated per allocation building rather than authored, so they
follow it when you move it: its SOCKET (the plot revealed when the building
lifts on hover) and its BOARDWALK (placed on the side the facade actually
faces, derived from the object's own rotation).

Every layer renders from the same camera at the same resolution, so the browser
stacks them at 0,0 with no positioning maths — one projection, decided here.
Contact shadows are baked into the PLATE, not the building layers: the shadow
must stay on the ground when the building lifts off it, or the hover reads as a
sticker sliding rather than a building rising.
"""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(f, d=None): return argv[argv.index(f) + 1] if f in argv else d

OUT  = os.path.abspath(arg("--out", "./city"))
SIZE = int(arg("--size", "1600"))
PAD  = float(arg("--pad", "1.03"))
AUTHORED_CAM = "--camera" in argv
# The published SHAPE is a page-layout decision, not a Blender one: the city
# sits beside the allocation table and has to end at roughly the same height.
# publish.sh passes it; the blend's own resolution is the fallback.
ASPECT = arg("--aspect")
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True

def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        raise SystemExit(f"[city] the .blend has no '{name}' collection — see the header of this script")
    return c

ALLOCS = [o for o in coll("ALLOCATIONS").objects if o.type == "MESH"]
if not ALLOCS:
    raise SystemExit("[city] ALLOCATIONS is empty")
for o in ALLOCS:
    if not o.name.startswith("alloc_"):
        raise SystemExit(f"[city] '{o.name}' is in ALLOCATIONS but is not named alloc_<key>")
PLATE = [o for o in scene.objects
         if o.type == "MESH" and o not in ALLOCS and not o.hide_render]

cam = bpy.data.objects.get("CITY_CAM") or scene.camera
if cam is None or cam.data.type != "ORTHO":
    raise SystemExit("[city] CITY_CAM must exist and stay ORTHOGRAPHIC — a perspective camera "
                     "gives each layer its own vanishing point and the stack stops lining up")
scene.camera = cam

# ---- generated: socket + boardwalk per allocation building -----------------
def mat(name, fallback):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = fallback
    return m

M_SOCKET = mat("RC_socket", (0.16, 0.14, 0.11, 1))
M_PLANK  = mat("RC_boardwalk", (0.28, 0.22, 0.15, 1))

def local_extents(obj):
    bb = obj.bound_box
    return ((max(c[0] for c in bb) - min(c[0] for c in bb)) * abs(obj.scale.x),
            (max(c[1] for c in bb) - min(c[1] for c in bb)) * abs(obj.scale.y))

GENERATED = []
for obj in ALLOCS:
    fw, fd = local_extents(obj)
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    cx = sum(c.x for c in corners) / 8
    cy = sum(c.y for c in corners) / 8
    yaw = obj.rotation_euler.z

    # Facade normal: these models face local -Y, so the walkway side comes from
    # the object's own rotation and follows it if you spin the building.
    nx, ny = math.sin(yaw), -math.cos(yaw)
    reach = (abs(nx) * fd + abs(ny) * fd) if False else (fd if abs(math.cos(yaw)) > 0.5 else fw)

    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx + nx * (reach / 2 + 0.34),
                                                       cy + ny * (reach / 2 + 0.34), 0.02))
    bw = bpy.context.active_object; bw.name = f"gen_walk_{obj.name}"
    span = (fw if abs(math.cos(yaw)) > 0.5 else fd) + 0.5
    bw.scale = (span, 0.62, 1)
    bw.rotation_euler.z = yaw
    bw.data.materials.append(M_PLANK)
    GENERATED.append(bw)

    # Socket, nudged away from the camera so its near edge tucks under the
    # facade instead of lying in the street.
    ax, ay = -0.7071, 0.7071
    off = max(fw, fd) * 0.17
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx + ax * off, cy + ay * off, 0.012))
    sk = bpy.context.active_object; sk.name = f"gen_socket_{obj.name}"
    sk.scale = (fw * 0.44, fd * 0.44, 1)
    sk.rotation_euler.z = yaw
    sk.data.materials.append(M_SOCKET)
    GENERATED.append(sk)

# ---- framing ---------------------------------------------------------------
# By default the camera's ANGLE is authored and its zoom and centre are fitted
# to the allocation buildings. `--camera` hands framing entirely to CITY_CAM.
#
# Read the guard below before removing the fit: CITY_CAM in the working blend
# points at bare ground 10 units off the town, so `--camera` on it renders a
# picture of dirt. That is why the fit exists — but the fit also means the
# published frame is NOT the one Blender's camera view shows, which reads as
# "that isn't what I made". Aim CITY_CAM at the town and pass --camera to own
# the framing; the guard fails loudly rather than publishing an empty plate.
#
# The aspect comes from the blend's own render resolution either way, so
# Blender's camera rectangle is the published shape. Only the WIDTH is ours.
R = cam.rotation_euler.to_matrix()
right, up, back = R.col[0], R.col[1], R.col[2]
pts = [o.matrix_world @ Vector(c) for o in ALLOCS for c in o.bound_box]
centre = sum(pts, Vector()) / len(pts)

if ASPECT:
    _w, _h = (float(v) for v in ASPECT.split(":"))
    authored_aspect = _w / _h
else:
    authored_aspect = (scene.render.resolution_x / scene.render.resolution_y
                       if scene.render.resolution_y else 0)
scene.render.resolution_x = SIZE
scene.render.resolution_y = max(1, round(SIZE / (authored_aspect or (1 / 0.70))))
aspect = scene.render.resolution_x / scene.render.resolution_y

if AUTHORED_CAM:
    # A mis-aimed camera renders a plate of empty ground and NOTHING errors —
    # every layer is a valid transparent PNG and the manifest boxes simply go
    # off-frame. Refuse instead: an empty town is not a rendering choice.
    R2 = cam.matrix_world.to_3x3().normalized()
    r2, u2, b2 = R2.col[0], R2.col[1], R2.col[2]
    hw2, hh2 = cam.data.ortho_scale / 2, cam.data.ortho_scale / (2 * aspect)
    rel = [(p - cam.location) for p in pts]
    if (min(d.dot(r2) for d in rel) > hw2 or max(d.dot(r2) for d in rel) < -hw2
            or min(d.dot(u2) for d in rel) > hh2 or max(d.dot(u2) for d in rel) < -hh2):
        raise SystemExit(
            "[city] --camera: CITY_CAM does not see the ALLOCATIONS at all. Aim it at "
            "the town in Blender (its view axis currently misses them), or drop --camera "
            "to fit the zoom automatically.")
else:
    # Fit the ALLOCATIONS only — a prop in a far corner deciding the zoom is
    # what shrank the buildings the page is about. The camera's ROTATION is
    # left alone: the viewing angle is an authoring decision.
    hw = max(abs((p - centre).dot(right)) for p in pts) * PAD
    hh = max(abs((p - centre).dot(up)) for p in pts) * PAD
    cam.data.ortho_scale = 2 * max(hw, hh * aspect)
    cam.location = centre + back * (max((p - centre).dot(back) for p in pts) + 40)
    bpy.context.view_layer.update()
print(f"[city] camera {'as authored' if AUTHORED_CAM else 'auto-fitted (angle authored)'} — "
      f"ortho_scale {cam.data.ortho_scale:.2f}, {scene.render.resolution_x}x{scene.render.resolution_y}")

# The ground plane must cover the whole frame. Where it stops short the render
# is TRANSPARENT, which composites to the page background and reads as a hole
# in the world, with nothing failing to say so.
#
# Measured, not padded: an ortho camera looking DOWN at a plane sees a
# parallelogram on it, not a rectangle, and the tilt stretches it along the
# view azimuth by 1/|back.z|. The old `ortho_scale * 1.25` was a guess against
# the wrong quantity and left the corners open at every tilt steeper than a
# few degrees. Project the four frame corners onto the ground plane and cover
# the box they actually land in.
_ground = next((o for o in PLATE if o.name.startswith("SET_ground")), None)
if _ground is not None:
    hw, hh = cam.data.ortho_scale / 2, cam.data.ortho_scale / (2 * aspect)
    gz = (_ground.matrix_world @ Vector((0, 0, 0))).z
    hits = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = cam.location + right * (sx * hw) + up * (sy * hh)
            if abs(back.z) < 1e-6:
                hits.append(c)  # camera level with the plane: nothing to project
                continue
            hits.append(c + (-back) * ((c.z - gz) / back.z))
    need_x = 2 * max(abs(h.x - centre.x) for h in hits)
    need_y = 2 * max(abs(h.y - centre.y) for h in hits)
    bb = _ground.bound_box
    span_x = (max(c[0] for c in bb) - min(c[0] for c in bb)) * abs(_ground.scale.x)
    span_y = (max(c[1] for c in bb) - min(c[1] for c in bb)) * abs(_ground.scale.y)
    _ground.scale.x *= max(1.0, need_x / span_x)
    _ground.scale.y *= max(1.0, need_y / span_y)
    _ground.location.x, _ground.location.y = centre.x, centre.y
    bpy.context.view_layer.update()
    print(f"[city] ground covers {need_x:.1f} x {need_y:.1f} units of the frame's footprint")

def to_screen(p):
    d = p - cam.location
    u = d.dot(right) / cam.data.ortho_scale + 0.5
    v = d.dot(up) / (cam.data.ortho_scale / aspect) + 0.5
    return (u * scene.render.resolution_x, (1 - v) * scene.render.resolution_y)

# ---- pass 1: the plate (ground, roads, scenery, sockets, walkways) ----------
# Allocation buildings stay visible to SHADOW rays and hidden from the camera,
# so their contact shadows land on the plate and stay there on hover.
for o in ALLOCS:
    o.hide_render = False
    o.visible_camera = False
scene.render.filepath = os.path.join(OUT, "ground.png")
bpy.ops.render.render(write_still=True)
for o in ALLOCS:
    o.hide_render = True
    o.visible_camera = True

# ---- pass 2: one layer per allocation building -----------------------------
HIDE_FOR_LAYERS = PLATE + GENERATED
manifest = []
for obj in ALLOCS:
    key = obj.name[len("alloc_"):]
    obj.hide_render = False
    for o in HIDE_FOR_LAYERS:
        o.hide_render = True
    scene.render.filepath = os.path.join(OUT, f"b_{key}.png")
    bpy.ops.render.render(write_still=True)
    obj.hide_render = True
    for o in HIDE_FOR_LAYERS:
        o.hide_render = False

    scr = [to_screen(obj.matrix_world @ Vector(c)) for c in obj.bound_box]
    manifest.append({
        "key": key,
        "file": f"b_{key}.webp",
        "box": [max(0, round(min(p[0] for p in scr))), max(0, round(min(p[1] for p in scr))),
                min(scene.render.resolution_x, round(max(p[0] for p in scr))),
                min(scene.render.resolution_y, round(max(p[1] for p in scr)))],
        "depth": round((Vector(obj.location) - cam.location).dot(-back), 4),
    })
    print(f"[city] {key}")

manifest.sort(key=lambda m: -m["depth"])
with open(os.path.join(OUT, "city.json"), "w") as f:
    json.dump({"w": scene.render.resolution_x, "h": scene.render.resolution_y,
               "buildings": manifest}, f, indent=1)
print(f"[city] {len(manifest)} layers + plate at "
      f"{scene.render.resolution_x}x{scene.render.resolution_y} -> {OUT}")
