"""overview.py : all tower samples in one picture: Flash (top row) and new (bottom row), on grass with the old shadow, at 2x."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, TOWERS, bbox, grass, old_rgba, resize_pm, shadow_on  # noqa: E402

S = 2
cols = []
for t in TOWERS:
    if not (OUT / t / "new-4x.png").exists():
        continue
    old, ox, oy = old_rgba(t)
    x0, y0, x1, y1 = bbox(t)
    W, H = x1 - x0, y1 - y0
    pair = []
    for im in (old, Image.open(OUT / t / "new-4x.png")):
        bg = shadow_on(grass(W, H, seed=5), t, ox, oy).resize((W * S, H * S), Image.BILINEAR).convert("RGBA")
        bg.alpha_composite(resize_pm(im, (W * S, H * S)) if im.width != W * S else im)
        pair.append(bg.convert("RGB"))
    cols.append((t, pair))
cw = sum(p[0].width for _, p in cols) + 10 * (len(cols) + 1)
ch = max(p[0].height for _, p in cols)
g = Image.new("RGB", (cw + 70, 2 * ch + 50), (36, 36, 40))
d = ImageDraw.Draw(g)
d.text((6, 30 + ch // 2), "Flash", fill=(230, 230, 230)); d.text((6, 40 + ch + ch // 2), "new", fill=(230, 230, 230))
x = 70
for t, (a, b) in cols:
    d.text((x, 6), t, fill=(230, 230, 230))
    g.paste(a, (x, 22 + ch - a.height)); g.paste(b, (x, 32 + 2 * ch - b.height))
    x += a.width + 10
g.save(OUT / "overview.png")
print(OUT / "overview.png", g.size)
