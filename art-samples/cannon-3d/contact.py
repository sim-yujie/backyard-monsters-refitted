"""contact.py : all 32 headings of one tilt row, body and barrel laid together as the game draws them, on grass green, 4 a
row, each cell cropped to the top of the tower (turret, ring and spikes; the drum never changes) and enlarged (owner, 28 Oct:
the barrel passing through the spikes; this shows every heading at once).

  python contact.py TIER ROW [OUT.png] [SRC]      SRC: the render folder (default render; render-before for the old ones)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
GRASS, PAD, COLS, SCALE, TOP = (96, 150, 64, 255), 12, 4, 1.2, 0.6


def cells(tier, row, src):
    R = HERE / src / tier
    body = Image.open(R / "body-4x.png").convert("RGBA")
    out = []
    for k in range(32):
        im = body.copy()
        im.alpha_composite(Image.open(R / "tilt-4x" / f"r{row}_h{k:02d}.png").convert("RGBA"))
        out.append(im)
    return out


def sheet(tier, row, path, src="render"):
    ims = cells(tier, row, src)
    box = ims[0].getbbox()
    for im in ims[1:]:
        b = im.getbbox()
        box = (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    box = (box[0], box[1], box[2], box[1] + round((box[3] - box[1]) * TOP))
    ims = [im.crop(box) for im in ims]
    w, h = round(ims[0].width * SCALE), round(ims[0].height * SCALE)
    font = ImageFont.truetype("arialbd.ttf", 26)
    S = Image.new("RGBA", (COLS * (w + PAD) + PAD, 32 // COLS * (h + PAD + 30) + PAD + 44), GRASS)
    d = ImageDraw.Draw(S)
    p = json.loads((HERE / src / tier / "aim_tilt.json").read_text())["pitch_deg"][row]
    title = f"Cannon {tier}, barrel {abs(p)}° {'up' if p < 0 else 'down'} (row {row}), all 32 headings"
    d.text((PAD, 8), title, fill=(255, 255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for k, im in enumerate(ims):
        x, y = PAD + (k % COLS) * (w + PAD), 44 + (k // COLS) * (h + PAD + 30)
        d.text((x + 4, y), f"heading {k}", fill=(255, 255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0, 255))
        S.alpha_composite(im.resize((w, h), Image.LANCZOS), (x, y + 30))
    S.convert("RGB").save(path, optimize=True)
    print(path, S.size)


if __name__ == "__main__":
    a = sys.argv[1:]
    sheet(a[0], int(a[1]), a[2] if len(a) > 2 else HERE / f"contact-{a[0]}-row{a[1]}.png", a[3] if len(a) > 3 else "render")
