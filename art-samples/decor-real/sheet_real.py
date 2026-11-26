"""Owner sheets (decor-real):
  python sheet_real.py wonders <classic|modern> out.png   real photo | angle-fixed (current) | new, 4 wonders
  python sheet_real.py windpump out.png                   windpump before / after, 3 wheel frames, both looks
Pictures come from sheets/before and sheets/after (yard_compose.py: shadow + picture as the yard draws them)."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(F, 26); small = ImageFont.truetype(F, 20)
BG, PANEL, INK, GOLD = (24, 24, 24), (107, 96, 52), (240, 240, 240), (240, 200, 90)
ROWS = [(215, "paoay-church", "Paoay Church", "Paoay_Church.jpg"), (216, "fort-santiago", "Fort Santiago Gate", "Fort_Santiago.jpg"),
        (217, "magellans-cross", "Magellan's Cross", "Magellans_Cross.jpg"), (214, "rizal-monument", "Rizal Monument", "Rizal_Monument.jpg")]


def fit(im, w, h):
    k = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)


def panel(im, w, h, bg=PANEL):
    p = Image.new("RGBA", (w, h), bg + (255,))
    im = fit(im, w - 30, h - 30)
    p.alpha_composite(im, ((w - im.width) // 2, h - 15 - im.height))
    return p


def wonders(look, out):
    CW, CH = 520, 470
    W = 3 * CW + 40; H = 50 + len(ROWS) * (CH + 46)
    s = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(s)
    for i, t in enumerate(("REAL PLACE", f"ANGLE-FIXED, NOW ({look})", f"NEW, CLOSER TO REAL ({look})")):
        d.text((10 + i * (CW + 10), 12), t, font=font, fill=INK)
    y = 50
    for t, n, label, photo in ROWS:
        d.text((10, y + 6), label, font=font, fill=GOLD); y += 40
        ph = Image.open(os.path.join(HERE, "refs", photo)).convert("RGBA")
        s.alpha_composite(panel(ph, CW, CH, BG), (10, y))
        ims = [Image.open(os.path.join(HERE, "sheets", w, f"{t}-{look}@2x.png")).convert("RGBA") for w in ("before", "after")]
        k = min(min((CW - 30) / i.width, (CH - 30) / i.height) for i in ims)     # one scale per row: sizes compare
        for j, im in enumerate(ims):
            im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
            p = Image.new("RGBA", (CW, CH), PANEL + (255,)); p.alpha_composite(im, ((CW - im.width) // 2, CH - 15 - im.height))
            s.alpha_composite(p, (10 + (j + 1) * (CW + 10), y))
        y += CH + 6
    s.convert("RGB").save(out)


def windpump(out):
    CW, CH = 300, 330
    W = 6 * CW + 70; H = 2 * (CH + 90) + 20
    s = Image.new("RGBA", (W, H), BG + (255,)); d = ImageDraw.Draw(s)
    y = 10
    for look in ("classic", "modern"):
        d.text((10, y), f"Windpump, {look}: BEFORE (platform turned)  |  AFTER (squared to the grid)   wheel frames 0 / 16 / 32, 2x",
               font=small, fill=GOLD); y += 34
        for k, which in enumerate(("before", "after")):
            for j, f in enumerate((0, 16, 32)):
                im = Image.open(os.path.join(HERE, "windpump", which, f"{look}-frame{f}.png")).convert("RGBA")
                x = 10 + (k * 3 + j) * (CW + 10) + k * 10
                s.alpha_composite(panel(fit(im, im.width * 2, im.height * 2), CW, CH), (x, y))
                d.text((x + 8, y + 6), f"{which} {f}", font=small, fill=INK)
        y += CH + 56
    s.convert("RGB").save(out)


if __name__ == "__main__":
    if sys.argv[1] == "wonders": wonders(sys.argv[2], sys.argv[3])
    else: windpump(sys.argv[2])
