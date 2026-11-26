"""Owner sheets of the multi-photo pass: per landmark, 3 real photos | today's version | the new version, one look.
    python sheet3.py <classic|modern> <out.png|.webp> [new dir=sheets/new3]
Today's pictures come from sheets/today (frozen before re-wiring), the new from sheets/new3 (yard_compose.py: shadow
+ picture as the yard draws them); both art panels share one scale per row, so sizes compare."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(F, 24); small = ImageFont.truetype(F, 17)
BG, PANEL, INK, GOLD = (24, 24, 24), (107, 96, 52), (240, 240, 240), (240, 200, 90)
ROWS = [(215, "paoay-church", "Paoay Church", ("front-with-tower", "three-quarter-left", "aerial-front-right")),
        (216, "fort-santiago", "Fort Santiago Gate", ("front", "three-quarter-left", "wide-across-moat")),
        (217, "magellans-cross", "Magellan's Cross", ("front-jan2025", "three-quarter", "aerial-top")),
        (214, "rizal-monument", "Rizal Monument", ("front", "front-wide-2018", "left-side-figures"))]


def fit(im, w, h):
    k = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)


def main(look, out, new):
    PW, AW, CH = 250, 405, 420
    W = 3 * PW + 2 * AW + 6 * 10
    H = 50 + len(ROWS) * (CH + 44)
    s = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(s)
    heads = [("REAL PHOTOS (3 of the 7 used)", 10), (f"TODAY ({look})", 10 + 3 * (PW + 10)),
             (f"NEW, FROM 7 PHOTOS ({look})", 10 + 3 * (PW + 10) + AW + 10)]
    for t, x in heads:
        d.text((x, 14), t, font=font, fill=INK)
    y = 50
    for t, n, label, photos in ROWS:
        d.text((10, y + 6), label, font=font, fill=GOLD); y += 38
        for j, p in enumerate(photos):
            ph = fit(Image.open(os.path.join(HERE, "refs", n, p + ".jpg")).convert("RGBA"), PW, CH - 6)
            s.alpha_composite(ph, (10 + j * (PW + 10), y + (CH - ph.height) // 2))
        ims = [Image.open(os.path.join(HERE, "sheets", w, f"{t}-{look}@2x.png")).convert("RGBA") for w in ("today", new)]
        k = min(min((AW - 30) / i.width, (CH - 30) / i.height) for i in ims)
        for j, im in enumerate(ims):
            im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
            p = Image.new("RGBA", (AW, CH), PANEL + (255,)); p.alpha_composite(im, ((AW - im.width) // 2, CH - 15 - im.height))
            s.alpha_composite(p, (10 + 3 * (PW + 10) + j * (AW + 10), y))
        y += CH + 6
    s = s.convert("RGB")
    s.save(out, quality=88) if out.endswith(".webp") else s.save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "new3")
