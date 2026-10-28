"""ai_render.py : an AI-generated Cannon (Meshy / Tripo / Hyper3D Rodin .glb) rendered in our Cannon's camera and light at
30 degrees, fitted to the same body box as the tier, for a side-by-side look only (owner, 28 Oct). Not for the game.

  blender -b --factory-startup -P ai_render.py -- MODEL.glb TIER OUT.png [TURN_DEG]

TURN_DEG turns the model about its upright axis (the generators face it any way they like).
"""
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
glb, tier, out = Path(argv[0]), argv[1], Path(argv[2])
turn = float(argv[3]) if len(argv) > 3 else 0.0
L.EL = 30.0
CANVAS = {"t1": 1, "t1b": 1, "t2": 2, "t3": 3}
cv = {1: dict(size=(620, 640), box=(163, 323, 421, 577)), 2: dict(size=(620, 960), box=(163, 576, 421, 897)),
      3: dict(size=(620, 960), box=(163, 515, 421, 897))}[CANVAS[tier]]
L.canvas(*cv["size"], cv["box"], out.parent)
L.clear_scene()
bpy.ops.import_scene.gltf(filepath=str(glb))
root = L.empty("AI")
for o in list(bpy.data.objects):
    if o is not root and o.parent is None and o.type in ("MESH", "EMPTY"):
        o.parent = root
bpy.context.view_layer.update()
root.rotation_euler = (0, 0, math.radians(turn))
bpy.context.view_layer.update()
obs = L.objs_under(root)
# stand it on the ground, centred on the turning axis
pts = [o.matrix_world @ v.co for o in obs for v in o.data.vertices]
cx, cy, z0 = (min(p.x for p in pts) + max(p.x for p in pts)) / 2, (min(p.y for p in pts) + max(p.y for p in pts)) / 2, min(p.z for p in pts)
root.location = (-cx, -cy, -z0)
cam = L.setup_render()
print("BOX", [round(v, 1) for v in L.fit(cam, obs)])
L.shot(out, obs)
print("DONE", out)
