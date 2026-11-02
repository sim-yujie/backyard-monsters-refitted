"""grid.py : Flash's Sniper (top.3 + anim.3 as in-game) and a 3D still at the same @1x game scale, enlarged with a 5 px
grid, for measuring proportions by eye.   python -I grid.py <out.png> [3D still @2x ...]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
WT = Path(__file__).resolve().parents[3]
A = WT / "server/public/assets/buildings/snipertower"
W, H, O, K = 90, 130, (45, 70), 5     # @1x canvas, origin (building's ground point), zoom


def flash():
    c = Image.new("RGBA", (W, H))
    c.alpha_composite(Image.open(A / "top.3.png").convert("RGBA"), (O[0] - 40, O[1] - 30))
    c.alpha_composite(Image.open(A / "anim.3.png").convert("RGBA").crop((0, 0, 55, 47)), (O[0] - 27, O[1] - 50))
    return c


def still(p, x, y):   # @2x still placed at game offset (x, y), shown at @1x
    im = Image.open(p).convert("RGBA")
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    c = Image.new("RGBA", (W, H))
    c.alpha_composite(im, (O[0] + x, O[1] + y))
    return c


def gridded(c):
    b = Image.new("RGBA", c.size, (92, 136, 60, 255))
    b.alpha_composite(c)
    b = b.resize((W * K, H * K), Image.NEAREST)
    d = ImageDraw.Draw(b)
    for v in range(0, H, 5):
        d.line((0, v * K, b.width, v * K), fill=(255, 0, 0, 255) if v % 10 == 0 else (255, 255, 0, 255))
        if v % 10 == 0:
            d.text((2, v * K + 1), str(v), fill=(255, 255, 255, 255))
    for v in range(0, W, 5):
        d.line((v * K, 0, v * K, b.height), fill=(255, 0, 0, 255) if v % 10 == 0 else (255, 255, 0, 255))
    return b


if __name__ == "__main__":
    out = sys.argv[1]
    panels = [flash()] + [still(p, int(x), int(y)) for p, x, y in (a.split(",") for a in sys.argv[2:])]
    g = Image.new("RGBA", (len(panels) * (W * K + 8), H * K), (0, 0, 0, 255))
    for i, p in enumerate(panels):
        g.paste(gridded(p), (i * (W * K + 8), 0))
    g.save(out)
