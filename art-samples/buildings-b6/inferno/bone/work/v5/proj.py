"""proj.py : print where world points land in the still render (px), and in the L3-hopper crop (px), at rest.
    blender -b --factory-startup -P work/v5/proj.py -- 3 fit        (run from bone/)"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import bone3d as b  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
b.build()
b.kit.setup(b.kit.SC)
sc = b.kit.SC
r = sc.render
W_, H_ = r.resolution_x * r.resolution_percentage / 100, r.resolution_y * r.resolution_percentage / 100


def show(name, p):
    c = world_to_camera_view(sc, sc.camera, b.Vector(p))
    x, y = c.x * W_, (1 - c.y) * H_
    print("PROJ %-14s render %6.0f %6.0f   hopper-crop %6.0f %6.0f" % (name, x, y, x - 480, y - 20))


j = b.hp(*b.HOP_J)
show("axle", j)
x, y = b.COLUMN
for z in (4.0, 5.0, 6.0, 6.55):
    show(f"column z{z}", (x, y, z))
W, Lc, D = b.HOP_W, b.HOP_L, b.HOP_D
for nm, (u, v, n) in {"cover far-L": (0, 0, 0), "cover far-R": (W, 0, 0), "cover near-L": (0, Lc, 0),
                      "cover near-R": (W, Lc, 0), "bin bot near-R": (W, Lc, D), "tray top-L": (b.TRAY[0], b.TRAY[2], D),
                      "tray foot-L": (b.TRAY[0], b.TRAY[3], D), "tray foot-R": (b.TRAY[1], b.TRAY[3], D)}.items():
    show(nm, b.hp(u, v, n))
print("SCALE world unit along X:", end=" ")
show("origin", (0, 0, 5)); show("x+1", (1, 0, 5)); show("y+1", (0, 1, 5)); show("z+1", (0, 0, 6))
