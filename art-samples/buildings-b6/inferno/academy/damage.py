"""damage.py : the Inferno Academy's damaged look, one rough pass on the built model (PB_STATE=damaged): everything
sooted (the materials do that), the shell dented, the pillars knocked askew, the cogs and half the teeth fallen onto the
rock, the drills hanging, gold scraps on the mound."""
import math
import random

import bpy
from mathutils import Vector


def wreck(m):
    kit, P, PART, M = m.kit, m.P, m.PART, m.M
    rnd = random.Random(26 + m.L)
    m.BODY.rotation_euler.rotate_axis("X", math.radians(-5))          # the whole body knocked over a little
    m.BODY.rotation_euler.rotate_axis("Y", math.radians(4))
    for e, i in PART["pillars"]:
        e.rotation_euler = (math.radians(rnd.uniform(-22, 22)), math.radians(rnd.uniform(-16, 8)), 0)
        e.location.z -= rnd.uniform(0.2, 1.0)
    teeth = PART["track"][0]
    for t in teeth:
        if rnd.random() < 0.45:
            t.hide_render = True
    front = Vector((2.6, -2.6, 0))
    for j, (sp, n, sign) in enumerate(PART["cogs"]):
        e = sp.parent
        e.parent = None
        r = m.P["rock"]["r0"] + 1.0
        a = math.radians(-95 + 55 * j)
        e.location = (r * math.cos(a), r * math.sin(a), 0.9 + 0.5 * j)
        e.rotation_euler = (math.radians(62), math.radians(20 * j), math.radians(40))
    for i, (e, f) in enumerate(PART["drills"]):
        e.rotation_euler = (math.radians(rnd.uniform(-20, 20)), math.pi / 2 + math.radians(28 + 14 * i), 0)
        e.location.x -= 0.25
    for nm, ang in (("needle", (14, -22, 0)), ("sidespike", (0, 0, 0))):
        o = bpy.data.objects.get(nm)
        if o and nm == "needle":
            o.rotation_euler.rotate_axis("X", math.radians(ang[0]))
            o.rotation_euler.rotate_axis("Y", math.radians(ang[1]))
    for j in range(7):                                    # gold scraps and a tooth or two on the mound
        a = math.radians(rnd.uniform(-130, 40))
        r = m.P["rock"]["r0"] + rnd.uniform(0.2, 1.6)
        kit.box(f"scrap{j}", (rnd.uniform(0.3, 0.8), rnd.uniform(0.2, 0.5), 0.08),
                (r * math.cos(a), r * math.sin(a), rnd.uniform(0.9, 1.8)), M["gold" if j % 3 else "tooth"],
                rot=(rnd.uniform(-40, 40), rnd.uniform(-40, 40), rnd.uniform(0, 180)), bevel=0.02)
