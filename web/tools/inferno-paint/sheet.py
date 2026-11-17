"""sheet.py <out.png> <look:run>... : a vetting sheet from the runs (before export). Each look:run (e.g.
a1:a1+a2-A, c5:c5-A) is one block: Flash left, new right, on the yard's ground (lava for the Inferno buildings, grass
for the Cavern) with the shadow the game draws (Flash's own JPEG), origins on the same spot, cropped to one box, at
SCALE (default 2) times game size. The Cavern's new look is drawn on Flash's soft ground (common.flash_ground).
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, UP, canvas, flash_ground, flash_rgba, flash_shadow, folder, ground, multiply, B  # noqa: E402

S = int(os.environ.get("SCALE", "2"))


def scene(look, top4):
    """The look on its ground with its shadow, 1x canvas -> S x. top4: the new look at 4x, or None for Flash."""
    b = look[0]
    CW, CH, OX, OY = canvas(b)
    bg = ground(B[b]["ground"], CW * S, CH * S)
    sh = flash_shadow(look)
    if sh:
        f, x, y = sh
        im = Image.open(folder(b) / f)
        bg = multiply(bg, im.resize((im.width * S, im.height * S), Image.LANCZOS), (OX + x) * S, (OY + y) * S)
    bg = bg.convert("RGBA")
    if top4 is None:
        t = flash_rgba(look)
        bg.alpha_composite(t.resize((CW * S, CH * S), Image.LANCZOS))
    else:
        if b == "c":
            bg.alpha_composite(flash_ground(look).resize((CW * S, CH * S), Image.LANCZOS))
        bg.alpha_composite(top4.resize((CW * S, CH * S), Image.LANCZOS))
    return bg.convert("RGB")


def block(item):
    look, run = item.split(":")
    new = Image.open(OUT / "runs" / run / f"new-4x-{look}.png").convert("RGBA")
    old = flash_rgba(look)
    bb = [min(old.getbbox()[0], new.getbbox()[0] // UP), min(old.getbbox()[1], new.getbbox()[1] // UP),
          max(old.getbbox()[2], -(-new.getbbox()[2] // UP)), max(old.getbbox()[3], -(-new.getbbox()[3] // UP))]
    bb = [max(0, bb[0] - 8), max(0, bb[1] - 8), bb[2] + 8, bb[3] + 8]
    box = tuple(v * S for v in bb)
    a, n = scene(look, None).crop(box), scene(look, new).crop(box)
    out = Image.new("RGB", (a.width * 2 + 30, a.height + 34), (24, 24, 24))
    out.paste(a, (10, 30)); out.paste(n, (a.width + 20, 30))
    d = ImageDraw.Draw(out)
    d.text((12, 8), f"{look} Flash", fill=(230, 230, 230)); d.text((a.width + 22, 8), f"{look} Modern ({run})", fill=(230, 230, 230))
    return out


blocks = [block(it) for it in sys.argv[2:]]
W = max(b.width for b in blocks)
sheet = Image.new("RGB", (W, sum(b.height for b in blocks)), (24, 24, 24))
y = 0
for b in blocks:
    sheet.paste(b, (0, y)); y += b.height
sheet.save(sys.argv[1])
print(sys.argv[1], sheet.size)
