"""sheets.py : comparison sheets for the square body (2 Nov 2026): Flash | old 3D (hexagon) | new 3D (square), per tier,
all at @2x game size on one origin, then enlarged 2x with hard pixels. Writes shots/sniper/sheet-tN.png and sheet-all.png.

    python -I art-samples/sniper-3d/sheets.py <old stills folder>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WT = Path(__file__).resolve().parents[2]
A = WT / "server/public/assets/buildings/snipertower"
OLD = Path(sys.argv[1])
OUT = WT / "shots/sniper"
ROWS = {1: (-45, -40, -39), 2: (-75, -40, -39), 3: (-92, -40, -39)}   # top y, new x, old x (game px)
W, H, O = 200, 440, (100, 300)     # @2x panel, origin pixel
GREEN = (92, 136, 60, 255)
try:
    FONT = ImageFont.truetype("arial.ttf", 22)
except OSError:
    FONT = ImageFont.load_default()


def flash():
    c = Image.new("RGBA", (W // 2, H // 2))
    o = (O[0] // 2, O[1] // 2)
    c.alpha_composite(Image.open(A / "top.3.png").convert("RGBA"), (o[0] - 40, o[1] - 30))
    c.alpha_composite(Image.open(A / "anim.3.png").convert("RGBA").crop((0, 0, 55, 47)), (o[0] - 27, o[1] - 50))
    return c.resize((W, H), Image.LANCZOS)


def at(path, x, y):
    c = Image.new("RGBA", (W, H))
    c.alpha_composite(Image.open(path).convert("RGBA"), (O[0] + 2 * x, O[1] + 2 * y))
    return c


def sheet(t):
    ty, nx, ox = ROWS[t]
    panels = [("Flash (every level)", flash()), (f"old 3D tier {t}", at(OLD / f"top.t{t}@2x.webp", ox, ty)),
              (f"new 3D tier {t}", at(A / f"top.t{t}@2x.webp", nx, ty))]
    g = Image.new("RGBA", (3 * W + 20, H), (0, 0, 0, 255))
    for i, (_, p) in enumerate(panels):
        b = Image.new("RGBA", (W, H), GREEN)
        b.alpha_composite(p)
        g.paste(b, (i * (W + 10), 0))
    g = g.resize((g.width * 2, g.height * 2), Image.NEAREST)
    d = ImageDraw.Draw(g)
    for i, (name, _) in enumerate(panels):
        d.text((i * (W + 10) * 2 + 10, 8), name, fill=(255, 255, 255, 255), font=FONT, stroke_width=2, stroke_fill=(0, 0, 0))
    return g


all_ = [sheet(t) for t in (1, 2, 3)]
for t, g in zip((1, 2, 3), all_):
    g.save(OUT / f"sheet-t{t}.png")
G = Image.new("RGBA", (all_[0].width, sum(g.height for g in all_) + 20), (0, 0, 0, 255))
y = 0
for g in all_:
    G.paste(g, (0, y))
    y += g.height + 10
G.save(OUT / "sheet-all.png")
print("wrote", [f"sheet-t{t}.png" for t in (1, 2, 3)], "sheet-all.png", G.size)
