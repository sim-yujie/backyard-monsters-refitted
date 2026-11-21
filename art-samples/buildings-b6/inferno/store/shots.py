"""shots.py : round 2's pictures for the lead, into the worktree's shots/ folder, from <variant>/render/L1-base.png and
L1-alone.png (12 px per Flash px) and the Codex picture (art-samples/store-inferno/r2/codex1/sample-new.png, variant
"c": cut off its green ground and scaled so it is as tall as the surface Store).
  compare.png        surface Store | Codex C | D | E | F | today's live Inferno Store, one scale (4 px per Flash px),
                     feet on one line, no ground shadows; under them four Inferno neighbours at that scale
  <v>-game2x.png     the picture at the game's own art size (2 px per Flash px, as every @2x.webp), with its shadow
  <v>-detail.png     full-size detail: the render at 6 px per Flash px (Codex: its own 1024 px picture)
  <v>-yard.png, <v>-yard-full.png   set into a real Inferno yard screenshot (shots/yard/inferno-in2.png: yardtester's
                     Inferno yard, Modern look, 4 screen px per Flash px, taken by the Lab helper). A COMPOSITE: the
                     building is not in the game. Codex's has no shadow of its own, so it borrows D's.
  yard-all.png       the yard crops side by side
Prints each picture's tone beside the neighbours'."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "shots"
ART = ROOT / "server/public/assets/buildings"
BG = (74, 42, 36, 255)
NAMES = {"c": "C  Codex repaint", "d": "D  Burnt Store (close copy)", "e": "E  Bone and Brimstone", "f": "F  Copper Works"}
ORIGIN, FRAME = (3.0, 33.5), (-56, -60)
SHOT, PX, SPOT, CROP = ROOT / "shots/yard/inferno-in2.png", 4, (1560, 960), (660, 400, 2460, 1400)


def on_bg(im, pad=16, label=None):
    im = im.crop(im.getbbox())
    top = 44 if label else 0
    s = Image.new("RGBA", (max(im.width + 2 * pad, 330), im.height + 2 * pad + top), BG)
    s.alpha_composite(im, ((s.width - im.width) // 2, pad + top))
    if label:
        ImageDraw.Draw(s).text((pad, 8), label, fill=(255, 236, 200, 255), font_size=24)
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


def cut_green(path):
    im = Image.open(path).convert("RGBA")
    out = []
    for r, g, b, _ in im.get_flattened_data():
        k = g - max(r, b)                      # how green
        a = 255 if k < 40 else 0 if k > 140 else round(255 * (140 - k) / 100)
        if k > 0 and a:                        # take the green spill off the rim
            g = max(r, b) + min(k, 10)
        out.append((r, g, b, a))
    im.putdata(out)
    return im.crop(im.getbbox())


def faded(base):
    edge = Image.new("RGBA", base.size, (0, 0, 0, 0))
    edge.paste(base.crop((6, 6, base.width - 6, base.height - 6)), (6, 6))
    ramp = Image.new("L", base.size, 0)
    for k in range(60):
        ImageDraw.Draw(ramp).rectangle((k, k, base.width - 1 - k, base.height - 1 - k), fill=round(255 * (k + 1) / 60))
    edge.putalpha(ImageChops.multiply(edge.getchannel("A"), ramp))
    return edge


surf = Image.open(ART / "generalstore/top.3d1@2x.webp").convert("RGBA")
live = Image.open(ART / "generalstore/top.ishop3C@2x.webp").convert("RGBA")
print("surface Store          ", tone(surf))
print("live Inferno Store     ", tone(live))
top = [on_bg(surf.resize((surf.width * 2, surf.height * 2), Image.LANCZOS), label="Surface General Store")]
yards = []
bases, alones = {}, {}
for d in "def":
    bases[d] = Image.open(HERE / d / "render" / "L1-base.png").convert("RGBA")
    alones[d] = Image.open(HERE / d / "render" / "L1-alone.png").convert("RGBA")
# Codex: as tall as D's body (alpha box of the alone render), standing where D stands, over D's shadow
cod = cut_green(ROOT / "art-samples/store-inferno/r2/codex1/sample-new.png")
on_bg(cod, 30).convert("RGB").save(OUT / "c-detail.png")
ab = alones["d"].getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
sc = (ab[3] - ab[1]) / cod.height
c12 = cod.resize((round(cod.width * sc), ab[3] - ab[1]), Image.LANCZOS)
shadow = bases["d"].copy()
shadow.putalpha(ImageChops.multiply(shadow.getchannel("A"), ImageChops.invert(alones["d"].getchannel("A"))))
al = Image.new("RGBA", bases["d"].size, (0, 0, 0, 0))
al.alpha_composite(c12, ((ab[0] + ab[2] - c12.width) // 2, ab[1]))
b = shadow.copy()
b.alpha_composite(al)
bases["c"], alones["c"] = b, al
for d in "cdef":
    base, alone = bases[d], alones[d]
    g = base.resize((base.width // 6, base.height // 6), Image.LANCZOS)
    s = Image.new("RGBA", (g.width * 2, g.height * 2), BG)
    s.alpha_composite(g.resize(s.size, Image.LANCZOS))
    s.convert("RGB").save(OUT / f"{d}-game2x.png")           # shown at 2x so it can be seen; the art itself is half this
    print("%-23s" % NAMES[d], tone(alone.resize((alone.width // 6, alone.height // 6), Image.LANCZOS)))
    top.append(on_bg(alone.resize((alone.width // 3, alone.height // 3), Image.LANCZOS), label=NAMES[d]))
    if d != "c":
        on_bg(base.resize((base.width // 2, base.height // 2), Image.LANCZOS), 30).convert("RGB").save(OUT / f"{d}-detail.png")
    yard = Image.open(SHOT).convert("RGBA")
    f = faded(base)
    im = f.resize((base.width * PX // 12, base.height * PX // 12), Image.LANCZOS)
    yard.alpha_composite(im, (round(SPOT[0] - (ORIGIN[0] - FRAME[0]) * PX), round(SPOT[1] - (ORIGIN[1] - FRAME[1]) * PX)))
    yard.convert("RGB").save(OUT / f"{d}-yard-full.png")
    c = yard.crop(CROP).convert("RGB")
    ImageDraw.Draw(c).text((14, 10), NAMES[d] + "  (composite)", fill=(255, 236, 200), font_size=26)
    c.save(OUT / f"{d}-yard.png")
    yards.append(c)
top.append(on_bg(live.resize((live.width * 2, live.height * 2), Image.LANCZOS), label="Live Inferno Store today"))
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
t.convert("RGB").save(OUT / "compare-top.png")
s = Image.new("RGB", (yards[0].width * 2, yards[0].height * 2))
for i, c in enumerate(yards):
    s.paste(c, (c.width * (i % 2), c.height * (i // 2)))
s.save(OUT / "yard-all.png")
print(t.size)
