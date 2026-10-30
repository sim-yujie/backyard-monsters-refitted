"""laser_body.py : the Laser's tN/body-4x.png and tN/body@2x.png from render/tN/body-4x.png, as laser-3d/post.py's
tier_pieces() makes them (cropped to the painted body picture's box), without the 32- and 54-heading strips the game no
longer uses (it draws the tilt strips of `post.py tilt`).

  python laser_body.py
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent / "laser-3d"
sys.path.insert(0, str(HERE))
from post import AX, AY, BODY, P, R, scale  # noqa: E402

for t in (1, 2, 3):
    src, out = R / f"t{t}", HERE / f"t{t}"
    shutil.copy(src / "body-4x.png", out / "body-4x.png")
    bx, by = BODY[t]
    pb = Image.open(P / f"body.t{t}@2x.webp")
    b2 = scale(Image.open(src / "body-4x.png").convert("RGBA"), 0.5)
    b2.crop((AX // 2 + 2 * bx, AY // 2 + 2 * by, AX // 2 + 2 * bx + pb.width, AY // 2 + 2 * by + pb.height)).save(
        out / "body@2x.png", optimize=True)
    print("laser body", t, pb.size)
