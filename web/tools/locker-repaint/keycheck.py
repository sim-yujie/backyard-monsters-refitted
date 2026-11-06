"""keycheck.py : art-samples/locker/keycheck.png, each chosen look near its key with export.py's handle cut tinted red,
p (blue) and q (yellow) marked and a grid every 10 px (red lines every 50) from the building's origin, to set KEY."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, OX, OY, UP  # noqa: E402

sys.argv = sys.argv[:1]
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("exp", Path(__file__).parent / "export.py")
src = (Path(__file__).parent / "export.py").read_text(encoding="utf-8")
ns = {}
exec(src[src.index("PICK = {"):src.index("PREVIEW = ")], ns)
KEY, PICK = ns["KEY"], ns["PICK"]
X0, Y0, X1, Y1 = -80, -110, 10, -10
S = 4
tiles = []
for n in (1, 2, 3, 4):
    im = Image.open(OUT / "runs" / f"L{n}-{PICK[str(n)]}" / "new-4x.png").convert("RGBA")
    kd = KEY[n]
    a = np.asarray(im).astype(float)
    x0, y0, x1, y1 = [(OX + v) * UP if i % 2 == 0 else (OY + v) * UP for i, v in enumerate(kd["box"])]
    p = ((OX + kd["p"][0]) * UP, (OY + kd["p"][1]) * UP)
    q = ((OX + kd["q"][0]) * UP, (OY + kd["q"][1]) * UP)
    yy, xx = np.mgrid[0:im.height, 0:im.width]
    sel = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1) & ((xx - p[0]) * kd.get("cut", (q[0] - p[0], 0))[0] + (yy - p[1]) * kd.get("cut", (0, q[1] - p[1]))[1] > 0)
    a[sel, 0] = a[sel, 0] * 0.4 + 150
    a[sel, 1] *= 0.4
    a[sel, 2] *= 0.4
    t = Image.fromarray(a.astype("uint8"), "RGBA").crop(((OX + X0) * UP, (OY + Y0) * UP, (OX + X1) * UP, (OY + Y1) * UP))
    bg = Image.new("RGBA", t.size, (128, 128, 128, 255))
    bg.alpha_composite(t)
    d = ImageDraw.Draw(bg)
    for x in range(X0, X1 + 1, 10):
        d.line([((x - X0) * S, 0), ((x - X0) * S, bg.height)], fill=(255, 0, 0) if x % 50 == 0 else (70, 70, 200))
        d.text(((x - X0) * S + 2, 2 + (x // 10 % 2) * 10), str(x), fill=(255, 255, 255))
    for y in range(Y0, Y1 + 1, 10):
        d.line([(0, (y - Y0) * S), (bg.width, (y - Y0) * S)], fill=(255, 0, 0) if y % 50 == 0 else (70, 70, 200))
        d.text((2, (y - Y0) * S + 2), str(y), fill=(255, 255, 255))
    for pt, col in ((kd["p"], (0, 120, 255)), (kd["q"], (255, 255, 0))):
        cx, cy = (pt[0] - X0) * S, (pt[1] - Y0) * S
        d.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), outline=col, width=2)
    tiles.append(bg.convert("RGB"))
c = Image.new("RGB", (sum(t.width for t in tiles) + 30, tiles[0].height))
x = 0
for t in tiles:
    c.paste(t, (x, 0)); x += t.width + 10
c.save(OUT / "keycheck.png")
print(c.size)
