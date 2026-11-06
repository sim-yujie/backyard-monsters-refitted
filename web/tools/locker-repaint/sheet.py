"""sheet.py <name> <look:variant>... : a comparison sheet, art-samples/locker/<name>.png (and .jpg).

Each look:variant (e.g. 2:A, 3d:A, x:A) is one block: the Flash look on the left, the new one on the right, both on the
yard's grass with their ground shadow (Flash's own JPEG, which the new look keeps), origins on the same spot, cropped
to the same box. Rows: game size (1x), then SCALE times (default 2x; SCALE=3 for single looks). BIG=1 leaves out the
1x row. The new look is drawn from new-4x.png (body.png + the key when an anim has been made: KEYCELL=n picks the cell).
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from common import CH, CW, OUT, OX, OY, UP, flash_rgba, flash_shadow, grass, img, multiply, resize_pm  # noqa: E402

name, items = sys.argv[1], sys.argv[2:]
S = int(os.environ.get("SCALE", "2"))
BIG = os.environ.get("BIG") == "1"
try:
    FONT = ImageFont.truetype("arial.ttf", 18)
except OSError:
    FONT = ImageFont.load_default()


def parse(it):
    look, variant = it.split(":")
    state = "destroyed" if look == "x" else "damaged" if look.endswith("d") else ""
    level = 2 if look == "x" else int(look[0])
    return look, variant, state, level


def scene(pic4, level, state, box, s, flash):
    """pic (4x canvas, or 1x Flash canvas) on grass with its shadow, cropped to box (1x), at scale s."""
    bg = grass(CW, CH, seed=5)
    f, x, y = flash_shadow(level, state)
    bg = multiply(bg, img(f), OX + x, OY + y).convert("RGBA")
    x0, y0, x1, y1 = box
    bg = bg.crop(box).resize(((x1 - x0) * s, (y1 - y0) * s), Image.BILINEAR)
    if flash:
        p = pic4.crop(box)
        p = p.resize((p.width * s, p.height * s), Image.NEAREST)
    else:
        p = resize_pm(pic4.crop(tuple(v * UP for v in box)), ((x1 - x0) * s, (y1 - y0) * s))
    bg.alpha_composite(p)
    return bg.convert("RGB")


blocks = []
for it in items:
    look, variant, state, level = parse(it)
    run = OUT / "runs" / f"L{look}-{variant}"
    new4 = Image.open(run / "new-4x.png").convert("RGBA")
    fl = flash_rgba(level, state)
    b1 = fl.getbbox()
    b2 = [round(v / UP) for v in new4.getbbox()]
    f, x, y = flash_shadow(level, state)
    sh = img(f)
    box = (max(0, min(b1[0], b2[0], OX + x) - 4), max(0, min(b1[1], b2[1]) - 4),
           min(CW, max(b1[2], b2[2], OX + x + sh.width) + 4), min(CH, max(b1[3], b2[3], OY + y + sh.height) + 4))
    rows = []
    for s in ([] if BIG else [1]) + [S]:
        a, b = scene(fl, level, state, box, s, True), scene(new4, level, state, box, s, False)
        r = Image.new("RGB", (a.width * 2 + 6, a.height), (30, 30, 30))
        r.paste(a, (0, 0)); r.paste(b, (a.width + 6, 0))
        rows.append(r)
    w = max(r.width for r in rows)
    h = sum(r.height for r in rows) + 6 * len(rows) + 26
    blk = Image.new("RGB", (w, h), (30, 30, 30))
    ImageDraw.Draw(blk).text((4, 3), f"Look {look} {state or 'whole'} ({variant}): Flash left, new right", fill=(235, 235, 235), font=FONT)
    yy = 26
    for r in rows:
        blk.paste(r, (0, yy)); yy += r.height + 6
    blocks.append(blk)

W = sum(b.width for b in blocks) + 10 * (len(blocks) + 1)
H = max(b.height for b in blocks) + 20
sheet = Image.new("RGB", (W, H), (30, 30, 30))
x = 10
for b in blocks:
    sheet.paste(b, (x, 10)); x += b.width + 10
sheet.save(OUT / f"{name}.png")
sheet.save(OUT / f"{name}.jpg", quality=90)
print("sheet", (OUT / f"{name}.png").as_posix(), sheet.size)
