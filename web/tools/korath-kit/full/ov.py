"""ov.py <level> <cols comma> <out> [h] : one row per column, walk call (A) then attack call (B), each grid scaled to height h."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
lvl, cols, out = sys.argv[1], [int(c) for c in sys.argv[2].split(",")], sys.argv[3]
h = int(sys.argv[4]) if len(sys.argv) > 4 else 300
d = Path(f"D:/Coding/BYMR/art-trials/champions/korath/L{lvl}/full")
rows = []
for c in cols:
    parts = []
    for m in "AB":
        f = d / f"{m}{c}" / "frames-new.png"
        if f.exists():
            im = Image.open(f).convert("RGB")
            parts.append(im.resize((im.width * h // im.height, h)))
        else:
            parts.append(Image.new("RGB", (h, h), (60, 60, 60)))
    rows.append(parts)
w = max(sum(p.width for p in r) + 40 for r in rows)
o = Image.new("RGB", (w, len(rows) * (h + 6)), (30, 30, 30))
dr = ImageDraw.Draw(o)
for i, r in enumerate(rows):
    x = 30
    dr.text((4, i * (h + 6) + 4), str(cols[i]), fill=(255, 255, 255))
    for p in r:
        o.paste(p, (x, i * (h + 6))); x += p.width + 10
o.save(out)
