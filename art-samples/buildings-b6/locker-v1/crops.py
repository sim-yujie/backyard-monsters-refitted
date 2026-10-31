"""crops.py <level> <name> x0 y0 x1 y1 [frame] [scale] : one area at full render size, Flash | 3D, from the final renders.
Box in Flash px (game frame). -> crops/L<level>-<name>.png"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import fref
import post

HERE = Path(__file__).resolve().parent
lv, name = int(sys.argv[1]), sys.argv[2]
bx = [int(v) for v in sys.argv[3:7]]
k = int(sys.argv[7]) if len(sys.argv) > 7 else 0
sc = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0
b3 = post.frame3d(lv, k)
K = b3.width // (fref.FRAME[2] - fref.FRAME[0])
fx, fy = fref.FRAME[:2]
box = ((bx[0] - fx) * K, (bx[1] - fy) * K, (bx[2] - fx) * K, (bx[3] - fy) * K)
a = post.flash(lv, k, b3.size).crop(box).convert("RGB")
b = post.on_grass(b3).crop(box).convert("RGB")
out = Image.new("RGB", (a.width * 2 + 12, a.height + 34), (24, 24, 24))
d = ImageDraw.Draw(out)
d.text((8, 6), f"Flash  L{lv} {name}", fill=(255, 255, 255), font=post.font(22))
d.text((a.width + 20, 6), "3D", fill=(255, 255, 255), font=post.font(22))
out.paste(a, (0, 34))
out.paste(b, (a.width + 12, 34))
if sc != 1.0:
    out = out.resize((int(out.width * sc), int(out.height * sc)), Image.LANCZOS)
(HERE / "crops").mkdir(exist_ok=True)
out.save(HERE / "crops" / f"L{lv}-{name}.png")
print(out.size)
