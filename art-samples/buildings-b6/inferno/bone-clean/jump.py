"""jump.py : the loop has no jump. At frame FRAMES every moving part is back where it was at frame 0; the rollers and
cogs may instead have turned by exactly one step of their own symmetry (one spike row; a quarter turn of a four-spoke cog, an eighth of the small web cog), which looks the same.

    blender -b --factory-startup -P jump.py -- <tier> fit
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import clean3d as c  # noqa: E402

c.build()
bpy = c.bpy


def state(f):
    c.turn(f)
    bpy.context.view_layer.update()
    return {o.name: (o.matrix_world.copy(), tuple(o.color)) for o in bpy.data.objects if c.kit.under_moving(o)}


def steps(f):
    c.turn(f)
    out = {}
    for spin, _ in c.ROLLS:
        out[spin.name] = (spin.rotation_euler.x, 2 * math.pi / c.ROWS)
    for spin, n, _, _, sym in c.COGS:
        out[spin.name] = (spin.rotation_euler.z, sym)
    return out


def under(o, names):
    p = o
    while p:
        if p.name in names:
            return True
        p = p.parent
    return False


a, b = state(0), state(c.FR)
sa, sb = steps(0), steps(c.FR)
sym = set(sa)
worst = 0.0
for n in a:
    if under(bpy.data.objects[n], sym):
        continue
    d = max(abs(x - y) for ra, rb in zip(a[n][0], b[n][0]) for x, y in zip(ra, rb))
    d = max(d, max(abs(x - y) for x, y in zip(a[n][1], b[n][1])))
    worst = max(worst, d)
wsym = 0.0
for n, (ang0, step) in sa.items():
    k = (sb[n][0] - ang0) / step
    wsym = max(wsym, abs(k - round(k)))
    print("STEP", n, "turns %.4f of its symmetry step in one loop" % k)
print("JUMP tier", c.TIER, "frames", c.FR, "moving objects", len(a), "largest jump of the other moving parts %.1e," % worst,
      "rollers/cogs off a whole step by %.1e" % wsym)
