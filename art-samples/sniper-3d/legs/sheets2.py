"""sheets2.py : the taller body on shorter legs (owner, 2 Nov 2026: "Too stubby? legs feel too long"). Per tier: Flash |
previous square 3D | new 3D, from the game's stills at @2x on one origin, enlarged 2x with hard pixels, the measured
ratios written under them. Writes shots/sniper-v2/sheet-tN.png and sheet-all.png.

    python -I art-samples/sniper-3d/legs/sheets2.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
WT = HERE.parents[2]
A = WT / "server/public/assets/buildings/snipertower"
PREV = HERE / "prev"                      # the stills before this change (c294548f4)
OUT = WT / "shots/sniper-v2"
OUT.mkdir(parents=True, exist_ok=True)
# the stills' top-left in game px (buildingArtTiers.ts): previous, new
ROWS = {1: ((-40, -45), (-40, -45)), 2: ((-40, -75), (-40, -75)), 3: ((-40, -92), (-40, -105))}
W, H, O = 200, 440, (100, 300)            # @2x panel, origin pixel
GREEN = (92, 136, 60, 255)
F = lambda n: ImageFont.truetype("arialbd.ttf", n)
# measured by eye on 5x enlargements at @1x game px (legs/grid.py), tier 1, at the front corner:
# body width = box corner to corner; body height = plate's underside to the box's foot; leg = box's foot to the bottom
# of the front ball; overall = top of the turret to the bottom of the front ball, across the side balls
MEAS = [("Flash", 47, 42, 20, 95, 77), ("previous 3D", 47, 30, 28, 96, 77), ("new 3D", 47, 39, 19, 96, 78)]


def flash():
    c = Image.new("RGBA", (W // 2, H // 2))
    o = (O[0] // 2, O[1] // 2)
    c.alpha_composite(Image.open(A / "top.3.png").convert("RGBA"), (o[0] - 40, o[1] - 30))
    c.alpha_composite(Image.open(A / "anim.3.png").convert("RGBA").crop((0, 0, 55, 47)), (o[0] - 27, o[1] - 50))
    return c.resize((W, H), Image.LANCZOS)


def at(path, xy):
    c = Image.new("RGBA", (W, H))
    c.alpha_composite(Image.open(path).convert("RGBA"), (O[0] + 2 * xy[0], O[1] + 2 * xy[1]))
    return c


def ratios_text():
    lines = ["tier 1, game px:  body h : w   leg : body h   overall h : w"]
    for n, bw, bh, leg, oh, ow in MEAS:
        lines.append(f"{n:<12} {bh}/{bw} = {bh / bw:.2f}   {leg}/{bh} = {leg / bh:.2f}   {oh}/{ow} = {oh / ow:.2f}")
    return lines


def sheet(t):
    prev, new = ROWS[t]
    panels = [("Flash (every level)", flash()), (f"previous 3D t{t}", at(PREV / f"top.t{t}@2x.webp", prev)),
              (f"new 3D t{t}", at(A / f"top.t{t}@2x.webp", new))]
    y0 = min(p.getbbox()[1] for _, p in panels) - 12
    y1 = max(p.getbbox()[3] for _, p in panels) + 8
    g = Image.new("RGBA", (3 * W + 20, y1 - y0), (0, 0, 0, 255))
    for i, (_, p) in enumerate(panels):
        b = Image.new("RGBA", (W, y1 - y0), GREEN)
        b.alpha_composite(p.crop((0, y0, W, y1)))
        g.paste(b, (i * (W + 10), 0))
    g = g.resize((g.width * 2, g.height * 2), Image.NEAREST)
    lab = 40
    s = Image.new("RGBA", (g.width, g.height + lab), (0, 0, 0, 255))
    s.paste(g, (0, lab))
    d = ImageDraw.Draw(s)
    for i, (name, _) in enumerate(panels):
        d.text((i * (W + 10) * 2 + 10, 8), name, fill=(255, 255, 255, 255), font=F(22))
    return s


def notes():
    lines = ratios_text() + ["", "tiers 2 and 3: tier 1's body and legs + one 30 px section each on top",
                             "(tier 3's turret now 13 px higher than before)"]
    n = Image.new("RGBA", (2 * (3 * W + 20), 34 * len(lines) + 20), (24, 24, 24, 255))
    d = ImageDraw.Draw(n)
    for i, ln in enumerate(lines):
        d.text((14, 10 + 34 * i), ln, fill=(255, 255, 255, 255), font=ImageFont.truetype("consolab.ttf", 24))
    return n


def stack(ims, gap=10):
    G = Image.new("RGBA", (max(i.width for i in ims), sum(i.height for i in ims) + gap * (len(ims) - 1)), (0, 0, 0, 255))
    y = 0
    for im in ims:
        G.paste(im, (0, y))
        y += im.height + gap
    return G


sheets = {t: sheet(t) for t in (1, 2, 3)}
N = notes()
for t, s in sheets.items():
    (stack([s, N]) if t == 1 else s).convert("RGB").save(OUT / f"sheet-t{t}.png")
stack([N] + list(sheets.values())).convert("RGB").save(OUT / "sheet-all.png")
print("wrote", OUT, [f"sheet-t{t}.png" for t in (1, 2, 3)], "sheet-all.png")
