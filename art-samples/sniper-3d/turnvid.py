"""turnvid.py : Flash | tier 1 | tier 2 | tier 3 turning through the 32 headings, old 3D (hexagon) above, new 3D (square)
below, from the game's own pieces (body + turret strip cell), @2x enlarged 2x. Writes shots/sniper/work/turn/fNN.png;
ffmpeg makes the mp4.   python -I art-samples/sniper-3d/turnvid.py <old pieces folder>"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

WT = Path(__file__).resolve().parents[2]
A = WT / "server/public/assets/buildings/snipertower"
OLD = Path(sys.argv[1])
OUT = WT / "shots/sniper/work/turn"
OUT.mkdir(parents=True, exist_ok=True)
# body (x, y) old, new; strip (x, y, w, h), game px
ROWS = {1: ((-39, -37), (-40, -34), (-27, -51, 54, 40)), 2: ((-39, -67), (-40, -64), (-27, -81, 54, 40)),
        3: ((-39, -84), (-40, -81), (-27, -98, 54, 40))}
W, H, O = 200, 440, (100, 300)
fl_top = Image.open(A / "top.3.png").convert("RGBA")
fl_anim = Image.open(A / "anim.3.png").convert("RGBA")


def flash(k):
    c = Image.new("RGBA", (W // 2, H // 2))
    o = (O[0] // 2, O[1] // 2)
    c.alpha_composite(fl_top, (o[0] - 40, o[1] - 30))
    f = round(k * 30 / 32) % 30
    c.alpha_composite(fl_anim.crop((55 * f, 0, 55 * f + 55, 47)), (o[0] - 27, o[1] - 50))
    return c.resize((W, H), Image.LANCZOS)


def tower(folder, t, k, which):
    b, nb, (sx, sy, sw, sh) = ROWS[t]
    bx, by = b if which == "old" else nb
    c = Image.new("RGBA", (W, H))
    c.alpha_composite(Image.open(folder / f"body.t{t}@2x.webp").convert("RGBA"), (O[0] + 2 * bx, O[1] + 2 * by))
    strip = Image.open(folder / f"turret.t{t}@2x.webp").convert("RGBA")
    c.alpha_composite(strip.crop((2 * sw * k, 0, 2 * sw * (k + 1), 2 * sh)), (O[0] + 2 * sx, O[1] + 2 * sy))
    return c


for k in range(32):
    g = Image.new("RGBA", (4 * W + 30, 2 * H + 10), (0, 0, 0, 255))
    for r, (folder, which) in enumerate(((OLD, "old"), (A, "new"))):
        for i, p in enumerate([flash(k)] + [tower(folder, t, k, which) for t in (1, 2, 3)]):
            bg = Image.new("RGBA", (W, H), (92, 136, 60, 255))
            bg.alpha_composite(p)
            g.paste(bg, (i * (W + 10), r * (H + 10)))
    d = ImageDraw.Draw(g)
    d.text((6, 4), "old 3D (hexagon)", fill="white")
    d.text((6, H + 14), "new 3D (square)", fill="white")
    g.resize((g.width * 2 // 2 * 1, g.height), Image.NEAREST).convert("RGB").save(OUT / f"f{k:02d}.png")
print("frames", OUT)
