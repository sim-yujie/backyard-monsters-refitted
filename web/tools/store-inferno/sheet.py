"""sheet.py : the owner's comparison sheet of the original Inferno shops (round 2), as the yard draws them.

    ~/.cache/bymr-art-venv/bin/python -I web/tools/store-inferno/sheet.py

From art-samples/store-inferno/files/ (export.py <v> art-samples/store-inferno/files), on the Inferno's own lava
ground, each with its shadow, beside real Modern Inferno buildings (the painted Resource Pod and the 3D Strongbox),
enlarged. Writes art-samples/store-inferno/compare-shops.png (all in a row, 3 px a world px) and
compare-shops-big.png (each shop alone between the two real ones, 4x, one per row).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT, ground, multiply  # noqa: E402

B = ASSETS / "buildings"
FILES = OUT / "files"
# (label, top file, top x, y, shadow file, shadow x, y): world px, the yard's own rows
REAL = {
    "Resource Pod": (B / "istoragesilo/top.c1@2x.webp", -45, -53, B / "istoragesilo/shadow.1.v2.jpg", -48, 17),
    "Strongbox": (B / "imonsterlab/top.3d1@2x.webp", -57, -38, B / "imonsterlab/shadow.3d1.jpg", -61, 31),
}
ROWS = {"A": (-49, -26, -32, 32), "B": (-41, -39, -33, 29), "C": (-47, -40, -33, 28)}
SHOPS = {f"Shop {v}": (FILES / f"top.ishop{v}@2x.webp", x, y, FILES / f"shadow.ishop{v}.jpg", sx, sy)
         for v, (x, y, sx, sy) in ROWS.items()}


def scene(items, step=150, k=2):
    """The items in a row on lava at k px a world px (2 = the game's @2x art at full size)."""
    W, H = step * len(items) + 40, 240
    g = ground("lava", W, H).convert("RGB").resize((W * k, H * k), Image.LANCZOS)
    ox = [40 + step // 2 - 20 + i * step for i in range(len(items))]
    oy = 140
    for (top, x, y, sh, sx, sy), cx in zip(items, ox):
        s = Image.open(sh).convert("RGB")
        g = multiply(g, s.resize((s.width * k, s.height * k), Image.LANCZOS), (cx + sx) * k, (oy + sy) * k)
    g = g.convert("RGBA")
    for (top, x, y, sh, sx, sy), cx in zip(items, ox):
        t = Image.open(top).convert("RGBA")
        t = t.resize((t.width * k // 2, t.height * k // 2), Image.LANCZOS)
        g.alpha_composite(t, ((cx + x) * k, (oy + y) * k))
    return g.convert("RGB"), [o * k for o in ox]


def labelled(im, labels, xs):
    out = Image.new("RGB", (im.width, im.height + 34), (24, 24, 24))
    out.paste(im, (0, 34))
    d = ImageDraw.Draw(out)
    for t, x in zip(labels, xs):
        d.text((x - 4 * len(t), 10), t, fill=(240, 240, 240))
    return out


order = ["Resource Pod", "Shop A", "Shop B", "Shop C", "Strongbox"]
items = [REAL.get(n) or SHOPS[n] for n in order]
b, xb = scene(items, k=3)
labelled(b, order, xb).save(OUT / "compare-shops.png")

rows = []
for v in "ABC":
    im, xs = scene([REAL["Resource Pod"], SHOPS[f"Shop {v}"], REAL["Strongbox"]], k=4)
    rows.append(labelled(im, ["Resource Pod", f"Shop {v}", "Strongbox"], xs))
big = Image.new("RGB", (rows[0].width, sum(r.height for r in rows)), (24, 24, 24))
y = 0
for r in rows:
    big.paste(r, (0, y))
    y += r.height
big.save(OUT / "compare-shops-big.png")
print(OUT / "compare-shops.png", OUT / "compare-shops-big.png", big.size)

# compare-shops-each.png: each shop alone on lava with its shadow, 5 px a world px, two to a row (A B / C)
cells = []
for v in "ABC":
    im, xs = scene([SHOPS[f"Shop {v}"]], step=170, k=5)
    im = im.crop((60, 380, im.width - 60, 1080))   # around the shop and its shadow
    xs = [x - 60 for x in xs]
    cells.append(labelled(im, [f"Shop {v}"], xs))
cw, ch = cells[0].width, cells[0].height
each = Image.new("RGB", (cw * 2 + 10, ch * 2 + 10), (24, 24, 24))
for i, c in enumerate(cells):
    each.paste(c, ((i % 2) * (cw + 10), (i // 2) * (ch + 10)))
each.save(OUT / "compare-shops-each.png")
print(OUT / "compare-shops-each.png", each.size)

# Round 3 (the game camera, owner 20 Nov 2026): old shop C beside the new A, B, C and two real Inferno buildings
ROWS3 = {"3A": (-43, -45, -32, 26), "3B": (-51, -60, -41, 26), "3C": (-52, -52, -35, 25)}
NEW = {f"New {v[1]}": (FILES / f"top.ishop{v}@2x.webp", x, y, FILES / f"shadow.ishop{v}.jpg", sx, sy)
       for v, (x, y, sx, sy) in ROWS3.items()}
order3 = ["Resource Pod", "Old C", "New A", "New B", "New C", "Strongbox"]
pool = {**REAL, "Old C": SHOPS["Shop C"], **NEW}
r3, x3 = scene([pool[n] for n in order3], k=3)
labelled(r3, order3, x3).save(OUT / "compare-round3.png")
cells = []
for n in ["Old C", "New A", "New B", "New C"]:
    im, xs = scene([pool[n]], step=170, k=5)
    im = im.crop((60, 330, im.width - 60, 1080))
    cells.append(labelled(im, [n], [x - 60 for x in xs]))
cw, ch = cells[0].width, cells[0].height
each = Image.new("RGB", (cw * 2 + 10, ch * 2 + 10), (24, 24, 24))
for i, c in enumerate(cells):
    each.paste(c, ((i % 2) * (cw + 10), (i // 2) * (ch + 10)))
each.save(OUT / "compare-round3-each.png")
print(OUT / "compare-round3.png", OUT / "compare-round3-each.png")
