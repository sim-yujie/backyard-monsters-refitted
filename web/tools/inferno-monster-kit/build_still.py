"""
build_still.py <IC id> <work dir>
Builds the still sheet from every <work>/still/b-*/frames-new.png (a later batch wins for a heading painted
twice; list "b-dir heading" lines in <work>/still/skip.txt to drop a view). Unpainted headings are the
left-right mirror of their painted twin. Output: one row of `directions` cells, the Flash cell size (plus spec still_pad each side):

    server/public/assets/monsters/<out>-repaint@4x.png   and   <out>-repaint.png (1x)

Each view is scaled so its solid area is `area` x the Flash body's (smoothed over 5 headings), stands on the
Flash body's bottom line, centred on it, over a soft copy of the Flash cell's own ground shadow.
Also writes <work>/still/fit.json (per heading: scale, centre, bottom) and the painted cutouts
<work>/still/cuts/h<N>.png for the animated sheet, and prints a
facing check (the 1x painting against the Flash column and its mirror image).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import common
from spec import ASSETS, SPECS, flash_column, mirror_of

UP = 4
MARGIN = 0.5

mid, work = sys.argv[1], Path(sys.argv[2])
spec = SPECS[mid]
D = spec["directions"]
CW, CH = spec["cell"]
PAD = spec.get("still_pad", 0)  # still cell = Flash cell + PAD 1x px each side (room for a body at the cell edge)
SW = CW + 2 * PAD

skip = set()
sk = work / "still" / "skip.txt"
if sk.exists():
    skip = {tuple(l.split()) for l in sk.read_text().splitlines() if l.strip()}
painted = {}
for f in sorted((work / "still").glob("b-*/frames-new.png"), key=lambda p: p.stat().st_mtime):
    hs = [int(x) for x in f.parent.name.split("-")[1:]]
    for h, cell in zip(hs, common.grid_cells(f, 2, 2)):
        if (f.parent.name, str(h)) in skip:
            continue
        cut = common.key_cell(cell, despill=spec.get("despill"), open_holes=spec.get("open_holes", False))
        if cut is not None:
            painted[h] = cut
if spec.get("view_match"):
    painted = common.match_views(painted)  # IC2 round 3: one colour for every batch
src = {}
for h in range(D):
    if h in painted:
        src[h] = (h, False)
    elif mirror_of(spec, h) in painted:
        src[h] = (mirror_of(spec, h), True)
missing = [h for h in range(D) if h not in src]
if missing:
    sys.exit(f"no painting for headings {missing}")


def view(h):
    s, flip = src[h]
    return painted[s].transpose(Image.FLIP_LEFT_RIGHT) if flip else painted[s]


flash = {h: common.flash_body_and_shadow(spec, flash_column(spec, h)) for h in range(D)}
want = {}
for h in range(D):
    body = flash[h][0]
    want[h] = np.sqrt(spec["area"] * body.sum() / common.solid(view(h)).sum())  # 1x px per painted px
# smooth the size (in 1x pixels) over 5 headings
size = {h: want[h] * np.sqrt(common.solid(view(h)).sum()) for h in range(D)}
fit = {}
for h in range(D):
    v = view(h)
    k = float(np.mean([size[(h + d) % D] for d in range(-2, 3)])) / np.sqrt(common.solid(v).sum())
    body = flash[h][0]
    bx0, by0, bx1, by1 = common.bbox(body)
    shift = common.flash_shift(spec, flash_column(spec, h))  # takes out the Flash sheet's drift (IC2)
    cx, bottom = (bx0 + bx1) / 2 + shift, by1 + spec.get("drop", 0)
    fx0, fy0, fx1, _ = common.bbox(np.asarray(v)[..., 3] > 40)
    fy1 = common.bbox(common.solid(v))[3]  # stands on its solid bottom, not the faint glow under it
    sx0, _, sx1, _ = common.bbox(common.solid(v))
    mid_x = (sx0 + sx1) / 2
    limit = min((cx + PAD - MARGIN) / ((mid_x - fx0) * k), (CW + PAD - MARGIN - cx) / ((fx1 - mid_x) * k), (bottom - MARGIN) / ((fy1 - fy0) * k))
    if limit < 1:
        print(f"heading {h}: cut to {limit:.2f} to fit the cell", file=sys.stderr)
    fit[h] = dict(scale=float(k * min(1.0, limit)), cx=float(cx), bottom=float(bottom), mid=float(mid_x), foot=float(fy1), shift=float(shift))


def shadow_layer(h, w, hgt, ox=0, oy=0):
    """The Flash cell's ground shadow as a soft dark ellipse, at UP scale, shifted by (ox, oy) 1x px
    (spec shadow="flash": the Flash cast shadow's own shape, common.cast_shadow)."""
    if spec.get("shadow") == "flash":
        return common.cast_shadow(spec, flash_column(spec, h), w, hgt, ox, oy, UP)
    _, (sx0, sy0, sx1, sy1), a = flash[h]
    m = Image.new("L", (w, hgt), 0)
    if sx1 > sx0:
        ImageDraw.Draw(m).ellipse(((sx0 + ox + 0.5) * UP, (sy0 + oy + 0.5) * UP, (sx1 + ox - 0.5) * UP, (sy1 + oy - 0.5) * UP), fill=min(255, a + 20))
    m = m.filter(ImageFilter.GaussianBlur(0.8 * UP))
    lay = Image.new("RGBA", (w, hgt), (25, 18, 12, 0))
    lay.putalpha(m)
    return lay


def place(h, v, scale, cx, bottom, mid, foot, w, hgt, ox=0, oy=0):
    s = scale * UP
    mon = common.grade(common.premul_resize(v, (max(1, round(v.width * s)), max(1, round(v.height * s)))), spec)
    layer = Image.new("RGBA", (w, hgt))
    layer.alpha_composite(mon, (round((cx + ox) * UP - mid * s), round((bottom + oy) * UP - foot * s)))
    return layer


if __name__ == "__main__":
    cw, ch = SW * UP, CH * UP
    sheet = Image.new("RGBA", (D * cw, ch))
    for h in range(D):
        f = fit[h]
        cell = shadow_layer(h, cw, ch, ox=PAD + f["shift"])
        cell.alpha_composite(place(h, view(h), f["scale"], f["cx"], f["bottom"], f["mid"], f["foot"], cw, ch, ox=PAD))
        sheet.paste(cell, (h * cw, 0))
    out = spec["out"]
    sheet.save(ASSETS / f"{out}-repaint@4x.png", optimize=True)
    small = Image.new("RGBA", (D * SW, CH))
    for h in range(D):
        small.paste(common.premul_resize(sheet.crop((h * cw, 0, (h + 1) * cw, ch)), (SW, CH)), (h * SW, 0))
    small.save(ASSETS / f"{out}-repaint.png", optimize=True)
    (work / "still" / "cuts").mkdir(exist_ok=True)
    for h, cut in painted.items():
        cut.save(work / "still" / "cuts" / f"h{h}.png")
    (work / "still" / "fit.json").write_text(json.dumps({str(h): dict(fit[h], src=src[h][0], flip=src[h][1]) for h in range(D)}, indent=1))
    # facing check: the 1x painting should look more like its Flash column than like that column's mirror
    # image (lit body only, each centred on its own box, so a shift or the shadow does not decide it)
    for h in range(D):
        same, flip = common.facing_scores(small.crop((h * SW, 0, (h + 1) * SW, CH)), common.flash_cell(spec, flash_column(spec, h)))
        flag = "  <-- CHECK FACING" if flip < same * 0.9 else ""
        print(f"h{h:2} {'mirror of h%d' % src[h][0] if src[h][1] else 'painted':16} scale {fit[h]['scale']:.4f}  vs flash {same:5.1f}  vs mirrored flash {flip:5.1f}{flag}")
    print("wrote", ASSETS / f"{out}-repaint@4x.png")
