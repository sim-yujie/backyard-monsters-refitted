"""uh_fire2_sim.py : a real fire (or smoke) simulation for the Under Hall's funnel, baked and rendered in Blender.

Mantaflow gas domain, a round burner at the bottom, rendered with Cycles on the graphics card from the game's camera
angle (orthographic, looking 30 degrees down), on pure black. Nothing is painted: the picture is the simulated flame
volume, glowing orange where thin and adding up to yellow-white where it is deep (that is all the "grading" there is;
uh_fire2_anim.py turns black into see-through and loops it).

Run (holding a Blender GPU lock, CUDA_VISIBLE_DEVICES=<lock number>):
  blender -b --factory-startup --python uh_fire2_sim.py -- <name> <out dir> [key=value ...]
Keys (defaults in P below): kind=fire|smoke, radius, fuel, burn, rise, vort, turb, pow, dissolve, tscale, res, noise, warm, frames, glow, seed.
Writes <out dir>/<name>/NNNN.png (8-bit RGB on black, PX px per metre, burner centre at pixel BX, BY: see meta.json).
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, OUT = argv[0], Path(argv[1])
P = dict(kind="fire", radius=0.36, fuel=1.0, burn=0.75, rise=0.6, vort=0.5, tscale=1.0, res=128, warm=40, frames=64,
         glow=2.2, seed=1, dw=2.0, dh=4.0, px=180, samples=48, maxtemp=3.0, smoke=0.0, noise=2, turb=0.25, pow=1.6, nstr=1.0, dissolve=0)
for kv in argv[2:]:
    k, v = kv.split("=")
    P[k] = v if k == "kind" else float(v)
out = OUT / NAME
out.mkdir(parents=True, exist_ok=True)
cache = out / "cache"

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 20
sc.frame_start, sc.frame_end = 1, int(P["warm"] + P["frames"])

# the domain: dw x dw x dh metres, standing on z = 0
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, P["dh"] / 2))
dom = bpy.context.object
dom.scale = (P["dw"], P["dw"], P["dh"])
bpy.ops.object.transform_apply(scale=True)
m = dom.modifiers.new("Fluid", "FLUID")
m.fluid_type = "DOMAIN"
d = m.domain_settings
d.domain_type = "GAS"
d.resolution_max = int(P["res"])
d.time_scale = P["tscale"]
d.vorticity = P["turb"]
d.burning_rate = P["burn"]
d.flame_smoke = P["smoke"]
d.flame_vorticity = P["vort"]
d.flame_max_temp = P["maxtemp"]
d.use_dissolve_smoke = True
d.dissolve_speed = int(P["dissolve"]) or (18 if P["kind"] == "smoke" else 6)       # frames a puff of smoke lasts
d.use_dissolve_smoke_log = P["kind"] == "smoke"
d.use_adaptive_domain = False
for side in ("use_collision_border_front", "use_collision_border_back", "use_collision_border_left",
             "use_collision_border_right", "use_collision_border_top"):
    setattr(d, side, False)                       # open sides and top: the fire must not pile up against a wall
if P["noise"] > 1:
    d.use_noise = True
    d.noise_scale = int(P["noise"])
    d.noise_strength = P["nstr"]
d.cache_type = "ALL"
d.cache_data_format = "OPENVDB"
d.cache_directory = str(cache)
d.cache_frame_start, d.cache_frame_end = sc.frame_start, sc.frame_end

# the burner: a flat disc just above the floor, its fuel wobbling a little so the flame is never steady
bpy.ops.mesh.primitive_cylinder_add(radius=P["radius"], depth=0.08, location=(0, 0, 0.16))
burner = bpy.context.object
fm = burner.modifiers.new("Fluid", "FLUID")
fm.fluid_type = "FLOW"
f = fm.flow_settings
f.flow_type = "SMOKE" if P["kind"] == "smoke" else "FIRE"
f.flow_behavior = "INFLOW"
f.fuel_amount = P["fuel"]
f.density = 1.0
f.temperature = 1.2 if P["kind"] == "smoke" else 1.0
f.use_initial_velocity = True
f.velocity_coord = (0, 0, P["rise"])
f.surface_distance = 0.5
burner.hide_render = True
import random
rng = random.Random(int(P["seed"]))
for fr in range(sc.frame_start, sc.frame_end + 1, 3):
    k = 0.7 + 0.6 * rng.random()
    if P["kind"] == "smoke":
        f.density = k
        f.keyframe_insert("density", frame=fr)
    else:
        f.fuel_amount = P["fuel"] * k
        f.keyframe_insert("fuel_amount", frame=fr)
    burner.location = (0.06 * (rng.random() - 0.5), 0.06 * (rng.random() - 0.5), 0.16)
    burner.keyframe_insert("location", frame=fr)

# what the volume looks like: only light. Fire: the flame field glows orange; depth adds it up to yellow, then white.
mat = bpy.data.materials.new("vol")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
o = nt.nodes.new("ShaderNodeOutputMaterial")
e = nt.nodes.new("ShaderNodeEmission")
a = nt.nodes.new("ShaderNodeAttribute")
a.attribute_name = "density" if P["kind"] == "smoke" else "flame"
mul = nt.nodes.new("ShaderNodeMath")
mul.operation = "MULTIPLY"
mul.inputs[1].default_value = P["glow"]
if P["kind"] == "smoke":
    e.inputs["Color"].default_value = (1, 1, 1, 1)             # a plain depth-of-smoke picture; coloured later
    nt.links.new(a.outputs["Fac"], mul.inputs[0])
else:
    ramp = nt.nodes.new("ShaderNodeValToRGB")                  # cool edge of the flame deep red, its heart orange
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.55, 0.035, 0.0, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (1.0, 0.30, 0.045, 1)
    nt.links.new(a.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], e.inputs["Color"])
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = P["pow"]                           # thin wisps stay dim, the body carries the light
    nt.links.new(a.outputs["Fac"], pw.inputs[0])
    nt.links.new(pw.outputs[0], mul.inputs[0])
nt.links.new(mul.outputs[0], e.inputs["Strength"])
nt.links.new(e.outputs["Emission"], o.inputs["Volume"])
dom.data.materials.append(mat)

# the game's camera: orthographic, 30 degrees above the horizon, straight on
elev = math.radians(30)
look = Vector((0, 0, P["dh"] / 2))
cam_d = bpy.data.cameras.new("cam")
cam_d.type = "ORTHO"
vis_h = P["dh"] * math.cos(elev) + P["dw"] * math.sin(elev)
W, H = int(P["dw"] * P["px"]), int(vis_h * P["px"])
cam_d.ortho_scale = max(P["dw"], vis_h)
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
cam.location = look + Vector((0, -math.cos(elev), math.sin(elev))) * 20
cam.rotation_euler = (math.pi / 2 - elev, 0, 0)
cam_d.clip_end = 100
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
sc.world = world
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "CUDA"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "CUDA"
sc.cycles.device = "GPU"
sc.cycles.samples = int(P["samples"])
sc.cycles.use_denoising = False
sc.cycles.volume_bounces = 0
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.film_transparent = False

# where the burner's centre lands in the picture
ctr = Vector((0, 0, 0.16)) - look
up = Vector((0, math.sin(elev), math.cos(elev)))
bx, by = W / 2 + ctr.x * P["px"], H / 2 - ctr.dot(up) * P["px"]
(out / "meta.json").write_text(json.dumps({"px": P["px"], "bx": bx, "by": by, "w": W, "h": H, "params": P}))

bpy.context.view_layer.objects.active = dom
dom.select_set(True)
print("BAKE", NAME, flush=True)
with bpy.context.temp_override(active_object=dom, object=dom, selected_objects=[dom]):
    bpy.ops.fluid.bake_all()
print("RENDER", NAME, flush=True)
n = 0
for fr in range(int(P["warm"]) + 1, sc.frame_end + 1):
    sc.frame_set(fr)
    sc.render.filepath = str(out / f"{n:04d}.png")
    bpy.ops.render.render(write_still=True)
    n += 1
import shutil
shutil.rmtree(cache, ignore_errors=True)
print("DONE", NAME, n, flush=True)
