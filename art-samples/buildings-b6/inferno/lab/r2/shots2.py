"""shots2.py : round 2's pictures, from <variant>/render/L1-base.png and L1-alone.png (12 px per Flash px), into the
worktree's shots/r2/ folder:
  <v>-game2x.png     the picture at the game's own art size (2 px per Flash px, as every @2x.webp), with its shadow
  <v>-detail.png     the render at 6 px per Flash px, cropped to the building (finer than the game shows: for vetting)
  <v>-plot.png       the game-size picture at 2x with the building's plot drawn on it (100 yard units square)
  <v>-yard.png, <v>-yard-full.png   the picture set into a real Inferno yard screenshot (shots/yard/inferno-in2.png:
                     yardtester's Inferno yard, Modern look, 4 screen px per Flash px), beside its neighbours. A
                     COMPOSITE, as round 1's composite.py (same spot, same scale): the building is not in the game.
  compare.png        the surface Monster Lab's game picture, then each variant without its ground shadow, all at one
                     scale (4 px per Flash px), feet on one line; under them four Inferno neighbours at that scale
  yard-all.png       the three yard crops under one another
Prints each variant's reach against the plot and its tone beside the neighbours' (../tone.py's numbers)."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
OUT = ROOT / "shots" / "r2"
ART = ROOT / "server/public/assets/buildings"
BG = (74, 42, 36, 255)
NAMES = {"d": "D  Iron Lab (close copy)", "e": "E  Bone and Brimstone", "f": "F  Copper Works"}
ORIGIN, FRAME, SX, SY = (0.0, 45.0), (-86, -104), 7.0711, 3.5355
SHOT, PX, SPOT, CROP = ROOT / "shots/yard/inferno-in2.png", 4, (1560, 960), (560, 300, 2560, 1500)


def on_bg(im, pad=16, label=None):
    im = im.crop(im.getbbox())
    top = 44 if label else 0
    s = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad + top), BG)
    s.alpha_composite(im, (pad, pad + top))
    if label:
        ImageDraw.Draw(s).text((pad, 8), label, fill=(255, 236, 200, 255), font_size=26)
    return s


def row(ims):
    h = max(i.height for i in ims)
    s = Image.new("RGBA", (sum(i.width for i in ims), h), BG)
    x = 0
    for i in ims:
        s.alpha_composite(i, (x, h - i.height))
        x += i.width
    return s


def tone(im):
    px = [q for q in im.convert("RGBA").get_flattened_data() if q[3] > 230]
    lum = sorted((0.299 * r + 0.587 * g + 0.114 * b) / 255 for r, g, b, _ in px)
    n = len(lum)
    sat = sum((max(q[:3]) - min(q[:3])) / max(1, max(q[:3])) for q in px) / n
    return "brightness %.3f (90%%: %.3f)  saturation %.3f  bright pixels %.1f%%" % (
        sum(lum) / n, lum[9 * n // 10], sat, 100 * sum(v > 0.7 for v in lum) / n)


OUT.mkdir(parents=True, exist_ok=True)
top, yards = [], []
surf = Image.open(ART / "monsterlab/top.3d1@2x.webp").convert("RGBA")
print("surface Lab            ", tone(surf))
top.append(on_bg(surf.resize((surf.width * 2, surf.height * 2), Image.LANCZOS), label="Surface Monster Lab"))
for d in "def":
    base = Image.open(HERE / d / "render" / "L1-base.png").convert("RGBA")
    alone = Image.open(HERE / d / "render" / "L1-alone.png").convert("RGBA")
    g = base.resize((base.width // 6, base.height // 6), Image.LANCZOS)
    g.save(OUT / f"{d}-game2x.png")
    a4 = alone.resize((alone.width // 3, alone.height // 3), Image.LANCZOS)
    print("%-23s" % NAMES[d], tone(alone.resize((alone.width // 6, alone.height // 6), Image.LANCZOS)))
    top.append(on_bg(a4, label=NAMES[d]))
    on_bg(base.resize((base.width // 2, base.height // 2), Image.LANCZOS), 30).convert("RGB").save(OUT / f"{d}-detail.png")
    # the plot: 100 yard units square (YardGrid.ts FOOTPRINT_GROUPS, type 116) = 10 world units, centred on the origin
    al = alone.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    x0, y0, x1, y1 = al.getbbox()
    print("   building, Flash px from the origin: x %.0f..%.0f (plot -71..71), bottom %.0f (plot's front corner 35)"
          % (x0 / 12 + FRAME[0] - ORIGIN[0], x1 / 12 + FRAME[0] - ORIGIN[0], y1 / 12 + FRAME[1] - ORIGIN[1]))
    big = g.resize((g.width * 2, g.height * 2), Image.LANCZOS)
    s = Image.new("RGBA", big.size, BG)
    s.alpha_composite(big)
    pts = [((ORIGIN[0] + SX * (X + Y) - FRAME[0]) * 4, (ORIGIN[1] + SY * (X - Y) - FRAME[1]) * 4)
           for X, Y in ((5, 5), (5, -5), (-5, -5), (-5, 5), (5, 5))]
    ImageDraw.Draw(s).line(pts, fill=(120, 255, 255, 255), width=2)
    s.convert("RGB").save(OUT / f"{d}-plot.png")
    # the yard composite (round 1's composite.py)
    yard = Image.open(SHOT).convert("RGBA")
    edge = Image.new("RGBA", base.size, (0, 0, 0, 0))
    edge.paste(base.crop((6, 6, base.width - 6, base.height - 6)), (6, 6))
    ramp = Image.new("L", base.size, 0)
    for k in range(60):
        ImageDraw.Draw(ramp).rectangle((k, k, base.width - 1 - k, base.height - 1 - k), fill=round(255 * (k + 1) / 60))
    edge.putalpha(ImageChops.multiply(edge.getchannel("A"), ramp))
    im = edge.resize((base.width * PX // 12, base.height * PX // 12), Image.LANCZOS)
    yard.alpha_composite(im, (round(SPOT[0] - (ORIGIN[0] - FRAME[0]) * PX), round(SPOT[1] - (ORIGIN[1] - FRAME[1]) * PX)))
    yard.convert("RGB").save(OUT / f"{d}-yard-full.png")
    c = yard.crop(CROP).convert("RGB")
    c.save(OUT / f"{d}-yard.png")
    yards.append(c)
refs = []
for p, n in (("ihatchery/top.3d1@2x.webp", "Incubator"), ("iacademy/top.3d2@2x.webp", "Academy"),
             ("imonsterlab/top.3d1@2x.webp", "Strongbox"), ("hatcherycontrolcenter/top.i3d1@2x.webp", "Control Centre")):
    r = Image.open(ART / p).convert("RGBA")
    print("%-23s" % n, tone(r))
    refs.append(on_bg(r.resize((r.width * 2, r.height * 2), Image.LANCZOS), label=n))
t, b = row(top), row(refs)
s = Image.new("RGBA", (max(t.width, b.width), t.height + b.height), BG)
s.alpha_composite(t, (0, 0))
s.alpha_composite(b, (0, t.height))
s.convert("RGB").save(OUT / "compare.png")
s = Image.new("RGB", (yards[0].width, sum(y.height for y in yards)))
y = 0
for c in yards:
    s.paste(c, (0, y))
    y += c.height
s.save(OUT / "yard-all.png")
print(t.size)
