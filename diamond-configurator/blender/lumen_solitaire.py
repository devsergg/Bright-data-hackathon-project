"""
Lumen Solitaire: hero ring, built and rendered in Blender (Cycles).

    1.75 ct ideal round brilliant (exact 57-facet geometry from the configurator)
    platinum six-claw head, hidden halo of 18 melee under the girdle,
    cathedral shoulders, tapered comfort-fit band, US size 6.

Run with Blender 4.2+ (or the `bpy` module):
    blender -b -P blender/lumen_solitaire.py -- --shot studio --out renders/studio.png
    python blender/lumen_solitaire.py --shot velvet --samples 1024 --res 2000x1500
    python blender/lumen_solitaire.py --save blender/lumen_solitaire.blend   # scene only

Shots: studio (white light tent), velvet (dark, hard light for fire), faceup (macro).
Units: 1 Blender unit = 1 mm (scene unit scale 0.001), so depth of field and
light falloff are physically scaled. Finger axis = Y, head points +Z.
"""
import argparse
import math
import os
import sys

import bpy  # must precede bmesh when running as the bpy module
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")

# ------------------------------------------------------------------ design parameters (mm)
RING_SIZE_US = 6
INNER_R = (11.63 + 0.8128 * RING_SIZE_US) / 2  # 8.255
BAND_W_TOP, BAND_W_BOTTOM = 2.1, 1.8
BAND_T_TOP, BAND_T_BOTTOM = 1.75, 1.5
CLAW_AZIMUTHS = [30 + 60 * k for k in range(6)]  # degrees around the stone, 0 = +X
CULET_CLEARANCE = 0.9  # culet height above the band top
MELEE_PER_GAP = 3
HALO_DROP = 0.95  # halo melee centre below the girdle plane
HALO_TILT = 55  # degrees: melee table normal tilted outward from vertical

# Diamond dispersion: IOR per channel from diamond's Sellmeier equation
def diamond_ior(nm):
    l2 = (nm / 1000) ** 2
    return math.sqrt(1 + 4.3356 * l2 / (l2 - 0.106**2) + 0.3306 * l2 / (l2 - 0.175**2))

IOR_RGB = (diamond_ior(640), diamond_ior(540), diamond_ior(460))
PLATINUM_F0 = (0.673, 0.637, 0.585)  # linear, measured


# ------------------------------------------------------------------ helpers
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def load_gem(path, name):
    """Parse the configurator's OBJ (Y-up, true n-gon facets) into a flat-shaded mesh, Z-up."""
    verts, faces, header = [], [], {}
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                x, y, z = map(float, line.split()[1:4])
                verts.append((x, -z, y))  # Y-up → Z-up
            elif line.startswith("f "):
                faces.append([int(t.split("/")[0]) - 1 for t in line.split()[1:]])
            elif "girdleTop=" in line:
                for kv in line.split(";")[-1].split():
                    k, v = kv.split("=")
                    header[k] = float(v)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    return me, header


def curve_tube(name, pts, radii, closed=False, resolution=32, bevel_res=10):
    """Smooth NURBS tube through points with per-point radius (mm)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    cu.resolution_u = resolution
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, (co, r) in zip(sp.points, zip(pts, radii)):
        p.co = (*co, 1.0)
        p.radius = r
    sp.order_u = 4 if len(pts) >= 4 else len(pts)
    sp.use_endpoint_u = not closed
    sp.use_cyclic_u = closed
    sp.use_smooth = True
    return bpy.data.objects.new(name, cu)


def sphere(name, center, r, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    ob.data.materials.append(mat)
    return ob


# ------------------------------------------------------------------ materials
def mat_diamond():
    m = bpy.data.materials.new("Diamond")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    # dispersion: three glass lobes, one per channel, each with its own IOR.
    # Path tracing picks lobes stochastically; mixed-channel paths cancel,
    # so each wavelength band refracts at its own angle → real fire.
    add1 = nt.nodes.new("ShaderNodeAddShader")
    add2 = nt.nodes.new("ShaderNodeAddShader")
    lobes = []
    for ior, col in zip(IOR_RGB, [(1, 0, 0, 1), (0, 1, 0, 1), (0, 0, 1, 1)]):
        g = nt.nodes.new("ShaderNodeBsdfGlass")
        g.distribution = "SHARP" if "SHARP" in [i.identifier for i in g.bl_rna.properties["distribution"].enum_items] else "GGX"
        g.inputs["IOR"].default_value = ior
        g.inputs["Roughness"].default_value = 0.0
        g.inputs["Color"].default_value = col
        lobes.append(g)
    nt.links.new(lobes[0].outputs[0], add1.inputs[0])
    nt.links.new(lobes[1].outputs[0], add1.inputs[1])
    nt.links.new(add1.outputs[0], add2.inputs[0])
    nt.links.new(lobes[2].outputs[0], add2.inputs[1])
    nt.links.new(add2.outputs[0], out.inputs["Surface"])
    return m


def mat_platinum(rough=0.075):
    m = bpy.data.materials.new("Platinum")
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*PLATINUM_F0, 1)
    p.inputs["Metallic"].default_value = 1.0
    p.inputs["Roughness"].default_value = rough
    return m


def mat_principled(name, color, rough, coat=0.0, sheen=0.0, sheen_tint=(1, 1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Coat Weight"].default_value = coat
    p.inputs["Coat Roughness"].default_value = 0.03
    p.inputs["Sheen Weight"].default_value = sheen
    p.inputs["Sheen Tint"].default_value = sheen_tint
    return m


def mat_emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


# ------------------------------------------------------------------ ring geometry
def build_band(mat):
    """Tapered comfort-fit band: superellipse section swept round the finger (axis Y)."""
    nu, nv, e = 384, 48, 2 / 3.2
    verts, faces = [], []
    for i in range(nu):
        phi = 2 * math.pi * i / nu  # 0 = top (+Z)
        k = (1 - math.cos(phi)) / 2  # 0 at top, 1 at bottom
        w = BAND_W_TOP + (BAND_W_BOTTOM - BAND_W_TOP) * k
        t = BAND_T_TOP + (BAND_T_BOTTOM - BAND_T_TOP) * k
        rc = INNER_R + t / 2
        for j in range(nv):
            th = 2 * math.pi * j / nv
            c, s = math.cos(th), math.sin(th)
            r = rc + (t / 2) * math.copysign(abs(c) ** e, c)
            ax = (w / 2) * math.copysign(abs(s) ** e, s)
            verts.append((r * math.sin(phi), ax, r * math.cos(phi)))
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            faces.append((a, d, c, b))
    me = bpy.data.meshes.new("Band")
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("Band", me)
    ob.data.materials.append(mat)
    return ob


def build_ring():
    coll = bpy.data.collections.new("Ring")
    bpy.context.scene.collection.children.link(coll)
    diamond, plat = mat_diamond(), mat_platinum()

    band_top = INNER_R + BAND_T_TOP
    me, h = load_gem(os.path.join(ASSETS, "center.obj"), "CenterStone")
    R = max(Vector(v.co).xy.length for v in me.vertices)  # girdle radius
    gem_z = band_top + CULET_CLEARANCE - h["culet"]
    stone = link(bpy.data.objects.new("CenterStone", me), coll)
    stone.location = (0, 0, gem_z)
    stone.data.materials.append(diamond)

    def pav_z(s):  # height of the pavilion surface at radius s·R
        return gem_z + h["culet"] * (1 - s) + h["girdleBottom"] * s

    # -- six claws
    for az in CLAW_AZIMUTHS:
        a = math.radians(az)
        u = Vector((math.cos(a), math.sin(a), 0))
        P = lambda r, z: tuple(u * r + Vector((0, 0, z)))
        base_r = 0.85
        base_z = math.sqrt(max(0.0, (band_top - 0.15) ** 2 - (u.x * base_r) ** 2)) - 0.25
        pts = [
            P(base_r, base_z),
            P(0.45 * R + 0.5, pav_z(0.42)),
            P(0.80 * R + 0.48, pav_z(0.80)),
            P(R + 0.40, gem_z - 0.15),
            P(R + 0.28, gem_z + h["girdleTop"] + 0.26),
            P(R - 0.20, gem_z + h["girdleTop"] + 0.44),
        ]
        radii = [0.46, 0.44, 0.42, 0.40, 0.37, 0.33]
        link(curve_tube(f"Claw_{az}", pts, radii), coll).data.materials.append(plat)
        link(sphere(f"ClawTip_{az}", pts[-1], 0.34, plat), coll)

    # -- gallery rails
    for s, tube in [(0.62, 0.30), (0.22, 0.26)]:
        n = 64
        r = s * R + tube + 0.08
        pts = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), pav_z(s)) for i in range(n)]
        link(curve_tube(f"Gallery_{s}", pts, [tube] * n, closed=True, resolution=8), coll).data.materials.append(plat)

    # -- hidden halo under the girdle
    melee_me, mh = load_gem(os.path.join(ASSETS, "melee.obj"), "Melee")
    dm = 2 * max(Vector(v.co).xy.length for v in melee_me.vertices)
    halo_z = gem_z - HALO_DROP
    s_halo = (halo_z - gem_z - h["culet"]) / (h["girdleBottom"] - h["culet"])
    halo_r = s_halo * R + dm * 0.62 + 0.12
    gap = 2 * math.pi / len(CLAW_AZIMUTHS)
    tilt = math.radians(HALO_TILT)
    for k, az in enumerate(CLAW_AZIMUTHS):
        a0 = math.radians(az)
        for m in range(MELEE_PER_GAP):
            a = a0 + gap * (m + 1) / (MELEE_PER_GAP + 1)
            u = Vector((math.cos(a), math.sin(a), 0))
            ob = link(bpy.data.objects.new(f"Melee_{k}_{m}", melee_me), coll)
            # table normal tilted outward by HALO_TILT
            rot = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(tilt, 4, "Y")
            ob.matrix_world = Matrix.Translation(u * halo_r + Vector((0, 0, halo_z))) @ rot
    if not melee_me.materials:
        melee_me.materials.append(diamond)
    # halo frame + seat rail
    n = 96
    for dr, dz, tube in [(-0.05, -0.55, 0.32), (0.42, -0.25, 0.16)]:
        r = halo_r + dr
        pts = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), halo_z + dz) for i in range(n)]
        link(curve_tube("HaloFrame", pts, [tube] * n, closed=True, resolution=6), coll).data.materials.append(plat)
    # beads between melee
    for k, az in enumerate(CLAW_AZIMUTHS):
        for m in range(MELEE_PER_GAP - 1):
            a = math.radians(az) + gap * (m + 1.5) / (MELEE_PER_GAP + 1)
            c = Vector((math.cos(a), math.sin(a), 0)) * (halo_r + 0.28) + Vector((0, 0, halo_z + 0.28))
            link(sphere(f"Bead_{k}_{m}", c, 0.15, plat), coll)

    # -- cathedral shoulders: sweep from the band up into the halo frame
    ro = band_top
    for side in (1, -1):
        for y in (0.42, -0.42):
            a0 = math.radians(52)
            pts = [
                (side * (ro - 0.55) * math.sin(a0), y * 0.9, (ro - 0.55) * math.cos(a0)),
                (side * ro * math.sin(a0 * 0.55), y * 1.15, band_top + 0.35),
                (side * (halo_r - 0.1), y * 1.6, halo_z - 1.4),
                (side * (halo_r - 0.2), y * 1.9, halo_z - 0.6),
            ]
            link(curve_tube("Shoulder", pts, [0.5, 0.46, 0.40, 0.34]), coll).data.materials.append(plat)

    link(build_band(plat), coll)
    return stone, gem_z, R


# ------------------------------------------------------------------ studio
def area_light(name, loc, target, size, power, color=(1, 1, 1), shape="RECTANGLE", spread=None):
    li = bpy.data.lights.new(name, "AREA")
    li.shape = shape
    if isinstance(size, tuple):
        li.size, li.size_y = size
    else:
        li.size = size
        li.size_y = size
    li.energy = power
    li.color = color
    if spread is not None:
        li.spread = math.radians(spread)
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    aim(ob, target)
    return link(ob)


def spot(name, loc, target, power, cone_deg, radius=0.6, color=(1, 1, 1)):
    """Hard, focused light: lights the ring, not the whole set."""
    li = bpy.data.lights.new(name, "SPOT")
    li.energy = power
    li.spot_size = math.radians(cone_deg)
    li.spot_blend = 0.6
    li.shadow_soft_size = radius
    li.color = color
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    aim(ob, target)
    return link(ob)


def sun(name, direction_from, strength, angle_deg, color=(1, 1, 1)):
    li = bpy.data.lights.new(name, "SUN")
    li.energy = strength
    li.angle = math.radians(angle_deg)
    li.color = color
    ob = bpy.data.objects.new(name, li)
    ob.location = direction_from
    aim(ob, (0, 0, 0))
    return link(ob)


def aim(ob, target):
    d = Vector(target) - Vector(ob.location)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def card(name, loc, target, size, mat, camera_visible=False):
    """Flag / bounce card: only seen in reflections, not by the camera."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.scale = (size[0], size[1], 1)
    aim(ob, target)
    ob.data.materials.append(mat)
    ob.visible_camera = camera_visible
    return link(ob)


def cyclorama(mat, floor_z, radius=60.0, depth=400.0, width=600.0, back=-140.0, height=300.0):
    """Seamless sweep: floor curving up into a back wall (no horizon line)."""
    verts, faces = [], []
    prof = []
    # floor from front to the start of the curve, quarter circle, then the wall
    for i in range(12):
        prof.append((depth - (depth - (back + radius)) * i / 11, floor_z))
    for i in range(1, 24):
        a = (math.pi / 2) * i / 24
        prof.append((back + radius - radius * math.sin(a), floor_z + radius - radius * math.cos(a)))
    for i in range(0, 12):
        prof.append((back, floor_z + radius + (height - radius) * i / 11))
    nx = 2
    for (y, z) in prof:
        for xi in range(nx):
            verts.append((-width / 2 + width * xi / (nx - 1), y, z))
    for j in range(len(prof) - 1):
        for xi in range(nx - 1):
            a = j * nx + xi
            faces.append((a, a + 1, a + 1 + nx, a + nx))
    me = bpy.data.meshes.new("Sweep")
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("Sweep", me)
    ob.data.materials.append(mat)
    return link(ob)


def world(color, strength):
    w = bpy.data.worlds.new("World")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = w


def camera_sees_black():
    """Background reads black to camera rays only; reflections still see the lit world."""
    nt = bpy.context.scene.world.node_tree
    bg = nt.nodes["Background"]
    out = nt.nodes["World Output"]
    lp = nt.nodes.new("ShaderNodeLightPath")
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0.004, 0.004, 0.005, 1)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(black.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def camera(loc, target, lens, fstop, focus):
    cam = bpy.data.cameras.new("Camera")
    cam.lens = lens
    cam.sensor_width = 36
    cam.dof.use_dof = True
    cam.dof.aperture_fstop = fstop
    cam.dof.focus_distance = (Vector(loc) - Vector(focus)).length
    cam.clip_start = 1
    cam.clip_end = 5000
    ob = link(bpy.data.objects.new("Camera", cam))
    ob.location = loc
    aim(ob, target)
    bpy.context.scene.camera = ob
    return ob


def use_gpu():
    """Turn on every Metal/OptiX/CUDA/HIP device Cycles can find; return True if any."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return False
    for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            print("cycles device:", kind, ", ".join(d.name for d in gpus))
            return True
    return False


def setup_render(samples, res, caustics=False):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 0.001
    s.unit_settings.length_unit = "MILLIMETERS"
    c = s.cycles
    c.device = "GPU" if use_gpu() else "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.006
    c.use_denoising = True
    c.denoiser = "OPENIMAGEDENOISE"
    c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.denoising_prefilter = "ACCURATE"
    c.denoising_use_gpu = True
    # Viewport (Z > Rendered): denoise from the first sample so it reads clean while orbiting.
    c.preview_samples = 256
    c.use_preview_adaptive_sampling = True
    c.preview_adaptive_threshold = 0.02
    c.use_preview_denoising = True
    c.preview_denoiser = "OPENIMAGEDENOISE"
    c.preview_denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.preview_denoising_start_sample = 1
    c.preview_denoising_use_gpu = True
    s.render.use_persistent_data = True
    c.max_bounces = 48
    c.diffuse_bounces = 4
    c.glossy_bounces = 24
    c.transmission_bounces = 32
    c.transparent_max_bounces = 8
    # Caustics through the stone onto the floor/backdrop are the main firefly source;
    # the stone's own fire comes from camera rays and is unaffected.
    c.caustics_reflective = True
    c.caustics_refractive = caustics
    c.blur_glossy = 1.0
    c.sample_clamp_direct = 0
    c.sample_clamp_indirect = 8
    c.use_light_tree = True
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    s.view_settings.look = "AgX - Punchy"
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_depth = "8"


# ------------------------------------------------------------------ shots
def shot_studio(gem_z, R):
    """White light tent: bright, clean e-commerce look with a mirror-gloss floor."""
    floor_z = -(INNER_R + BAND_T_BOTTOM)
    sweep = mat_principled("WhiteAcrylic", (0.86, 0.86, 0.87), 0.18, coat=1.0)
    cyclorama(sweep, floor_z)
    world((0.92, 0.93, 0.95), 0.85)
    target = (0, 0, gem_z * 0.42)
    # big overhead softbox + front fill + side strips (the "tent")
    area_light("Key", (60, 140, 260), target, (220, 160), 3.0e5)
    area_light("Fill", (-160, 220, 60), target, (120, 200), 1.4e5)
    area_light("StripL", (-190, -40, 70), target, (40, 260), 3.0e5, color=(0.97, 0.98, 1.0))
    area_light("StripR", (200, -10, 90), target, (40, 260), 3.0e5, color=(1.0, 0.98, 0.96))
    area_light("Rim", (0, -260, 140), target, (200, 60), 2.6e5)
    # hard pin-spots for fire
    sun("SpotA", (40, 60, 200), 3.5, 0.6)
    sun("SpotB", (-60, 30, 180), 2.5, 0.6)
    # black flags: contrast pattern in the crown
    black = mat_principled("Flag", (0.003, 0.003, 0.003), 0.9)
    card("FlagL", (-70, 120, 120), (0, 0, gem_z), (40, 120), black)
    card("FlagR", (80, 110, 130), (0, 0, gem_z), (40, 120), black)
    card("FlagTop", (0, 40, 230), (0, 0, gem_z), (60, 30), black)
    camera((70, 122, 52), (0, 0, gem_z * 0.36), 100, 16, (0, 0, gem_z))


def ring_only(*lights):
    """Light linking: these lights illuminate (and reflect in) the ring, never the set."""
    ring = bpy.data.collections["Ring"]
    for ob in lights:
        ob.light_linking.receiver_collection = ring


def shot_velvet(gem_z, R):
    """Dark velvet: the boutique look, maximum fire and scintillation."""
    floor_z = -(INNER_R + BAND_T_BOTTOM)
    velvet = mat_principled("Velvet", (0.03, 0.004, 0.009), 1.0, sheen=0.45, sheen_tint=(0.75, 0.3, 0.42, 1))
    cyclorama(velvet, floor_z)
    world((0.004, 0.003, 0.004), 0.25)
    head = (0, 0, gem_z)
    ring_c = (0, 0, gem_z * 0.35)
    ring_only(
        # large softboxes the stone reflects: brilliance
        area_light("Softbox", (-30, 60, 210), head, (160, 160), 6.0e6),
        area_light("FrontSoft", (-90, 160, 170), head, (110, 110), 3.0e6, color=(0.97, 0.98, 1.0)),
        area_light("Strip", (160, 60, 120), ring_c, (30, 200), 1.6e6),
        area_light("Rim", (0, -220, 80), ring_c, (180, 40), 1.6e6, color=(1.0, 0.9, 0.86)),
        # small hard spots: fire
        spot("Key", (-90, -70, 230), head, 1.6e6, 7, radius=0.8, color=(1.0, 0.97, 0.92)),
        spot("Pin", (70, 40, 220), head, 9.0e5, 5, radius=0.4),
        spot("FrontA", (-20, 150, 190), head, 1.6e6, 5, radius=1.0),
        spot("FrontB", (-120, 90, 170), head, 1.2e6, 5, radius=0.8),
    )
    # a soft pool of light on the velvet under the ring
    spot("Pool", (0, 30, 260), (0, 0, floor_z), 4.0e6, 20, radius=30, color=(1.0, 0.92, 0.9))
    camera((-56, 90, 68), (0, 0, gem_z * 0.42), 100, 16, head)


def shot_faceup(gem_z, R):
    """Macro straight down onto the table: arrows pattern, brilliance, fire."""
    floor_z = -(INNER_R + BAND_T_BOTTOM)
    sweep = cyclorama(mat_principled("Black", (0.002, 0.002, 0.0025), 1.0), floor_z)
    sweep.visible_camera = False  # the stone still reflects the room; the camera sees black velvet
    world((0.85, 0.86, 0.88), 0.9)
    camera_sees_black()
    bpy.context.scene.view_settings.exposure = 0.9
    head = (0, 0, gem_z)
    # jewellery-store spots at 40–60° elevation around the stone
    for i in range(8):
        a = 2 * math.pi * i / 8 + 0.2
        el = math.radians(45 + 12 * (i % 2))
        loc = (math.cos(el) * math.cos(a) * 160, math.cos(el) * math.sin(a) * 160, gem_z + math.sin(el) * 160)
        spot(f"Spot{i}", loc, head, 1.8e6, 6, radius=0.5)
    area_light("Dome", (0, 0, gem_z + 200), head, (260, 260), 9.0e5, shape="DISK")
    # the camera and photographer seen in the stone (ASET's blue zone)
    card("Lens", (0, 0, gem_z + 120), head, (45, 45), mat_principled("Lens", (0.01, 0.01, 0.01), 0.4))
    camera((0, -0.01, gem_z + 62), head, 100, 22, (0, 0, gem_z + 1.0))


SHOTS = {"studio": shot_studio, "velvet": shot_velvet, "faceup": shot_faceup}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", choices=SHOTS, default="studio")
    ap.add_argument("--samples", type=int, default=384)
    ap.add_argument("--res", default="1600x1200")
    ap.add_argument("--out", default="")
    ap.add_argument("--save", default="", help="save the .blend here")
    ap.add_argument("--caustics", action="store_true", help="refractive caustics (slower, noisier)")
    a = ap.parse_args(argv)
    res = tuple(int(x) for x in a.res.split("x"))

    clear_scene()
    setup_render(a.samples, res, a.caustics)
    stone, gem_z, R = build_ring()
    SHOTS[a.shot](gem_z, R)
    if a.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save))
        print("saved", a.save)
    if a.out:
        bpy.context.scene.render.filepath = os.path.abspath(a.out)
        bpy.ops.render.render(write_still=True)
        print("rendered", a.out)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:])
