"""damage.py : the Inferno Academy's damaged look, one rough pass on the built model (PB_STATE=damaged), after Flash's:
the gold shell dented and knocked askew but still shiny, the pillars charred and leaning, the cogs knocked loose and
standing out, one fallen onto the rock, the drills hanging, gold scraps on the mound."""
import math
import random

import bpy


def wreck(m):
    kit, PART, M = m.kit, m.PART, m.M
    rnd = random.Random(26 + m.L)
    m.BODY.rotation_euler.rotate_axis("X", math.radians(-6))          # the whole body knocked over a little
    m.BODY.rotation_euler.rotate_axis("Y", math.radians(5))
    tex = bpy.data.textures.new("dents", "CLOUDS")
    tex.noise_scale = 0.9
    for name in ("shell", "shell-inlay", "band", "collar"):          # the same dents in the shell and what lies on it
        ob = bpy.data.objects[name]
        d = ob.modifiers.new("dents", "DISPLACE")
        d.texture, d.strength, d.mid_level, d.texture_coords = tex, 0.42, 0.5, "GLOBAL"
    for e, i in PART["pillars"]:
        e.rotation_euler = (math.radians(rnd.uniform(-24, 24)), math.radians(rnd.uniform(-18, 6)), 0)
        e.location.z -= rnd.uniform(0.0, 0.6)
    for j, (sp, n, sign) in enumerate(PART["cogs"]):
        e = sp.parent
        if j == len(PART["cogs"]) - 1:                               # the last one has fallen onto the rock
            e.parent = None
            r = m.P["rock"]["r0"] + 1.3
            a = math.radians(-92)
            e.location = (r * math.cos(a), r * math.sin(a), 1.3)
            e.rotation_euler = (math.radians(58), 0, math.radians(40))
        else:                                                        # the others hang askew, pushed out and up
            e.location.z += rnd.uniform(0.2, 0.6)
            e.location.y += rnd.uniform(-0.3, 0.3)
            e.rotation_euler = (math.radians(rnd.uniform(-25, 25)), math.pi / 2 + math.radians(rnd.uniform(-30, 30)), 0)
            sp.scale = (1.15, 1.15, 1.0)
    for i, (e, f) in enumerate(PART["drills"]):
        e.rotation_euler = (math.radians(rnd.uniform(-20, 20)), math.pi / 2 + math.radians(26 + 12 * i), 0)
        e.location.x -= 0.2
    o = bpy.data.objects.get("needle")
    if o:
        o.rotation_euler.rotate_axis("X", math.radians(16))
        o.rotation_euler.rotate_axis("Y", math.radians(-20))
    for j in range(6):                                    # gold scraps on the mound
        a = math.radians(rnd.uniform(-130, 40))
        r = m.P["rock"]["r0"] + rnd.uniform(0.4, 1.8)
        kit.box(f"scrap{j}", (rnd.uniform(0.3, 0.8), rnd.uniform(0.2, 0.5), 0.08),
                (r * math.cos(a), r * math.sin(a), rnd.uniform(1.0, 1.9)), M["gold" if j % 3 else "tooth"],
                rot=(rnd.uniform(-40, 40), rnd.uniform(-40, 40), rnd.uniform(0, 180)), bevel=0.02)
