"""
build_anim.py <IC id> <work dir> [painted heading ...]
With headings named, only those (and their mirrors) are built into anim/frames/ (a quick look; no sheet).
Builds the animated sheet from <work>/anim/h<N>/sheet.png (one Codex call per painted heading, 4x3 cells:
walk 1-6, attack 7-11) and the still views (<work>/still/cuts, fit.json from build_still.py).
Unpainted headings are the left-right mirror of their painted twin (attack lunges flip with them).

Layout: `directions` columns x 12 rows; row 0 idle (the still view), rows 1-6 walk, rows 7-11 attack.
The cell is the Flash cell grown by spec anim_pad (left/right, top, bottom), so the anchor moves by
(pad, top) and the creature keeps its ground point. Walk frames are each scaled to the still view's area
and lifted by spec walk_lift (the hop); attack frames keep the walk scale so the wind-up swell shows, and
keep the sideways lunge Codex painted. The Flash cell's ground shadow sits under every frame.

    server/public/assets/monsters/<out>-anim@4x.png   (and <out>-anim.png, 1x)
Frames are also saved to <work>/anim/frames/h<N>-f<K>.png for the comparison sheets.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import common
from spec import ASSETS, SPECS, flash_column

UP = 4
GAMMA = 0.92  # lifts the painting a little so it reads as bright as Flash's at game size

mid, work = sys.argv[1], Path(sys.argv[2])
spec = SPECS[mid]
D = spec["directions"]
CW, CH = spec["cell"]
PX, PT, PB = spec["anim_pad"]
ACW, ACH = CW + 2 * PX, CH + PT + PB
fit = {int(k): v for k, v in json.loads((work / "still" / "fit.json").read_text()).items()}
cuts = {int(p.stem[1:]): Image.open(p).convert("RGBA") for p in (work / "still" / "cuts").glob("h*.png")}


def lifted(im):
    a = np.asarray(im).astype(float)
    a[..., :3] = 255 * (a[..., :3] / 255) ** GAMMA
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def body_width_1x(spec, h):
    body = common.flash_body_and_shadow(spec, flash_column(spec, h))[0]
    return body.sum(1).max()


# grow so the painted body is as wide as Flash's (the flame crown is taller than Flash's, so the
# still sheet, held to the Flash cell's height, came out a little narrower)
fw = np.median([body_width_1x(spec, h) for h in range(D)])
sw = np.median([common.solid(cuts[fit[h]["src"]]).sum(1).max() * fit[h]["scale"] for h in range(D)])
GROW = float(np.clip(fw / sw, 1.0, 1.2))
print(f"grow {GROW:.3f} (Flash body {fw:.1f} px wide, still {sw:.1f})")


def pick_main(lab, sizes):
    big = int(np.argmax(sizes))
    h, w = lab.shape
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    return [i for i in range(1, len(sizes)) if sizes[i] >= sizes[big] * 0.03 and (i == big or i not in edge)]


def painted_frames(p):
    """-> list of 11 (cutout, scale in 1x px per painted px, dx in 1x px, lift in 1x px)."""
    ref = cuts[p]
    base = fit[p]["scale"] * GROW
    target = common.solid(ref).sum() * base ** 2
    cells = common.grid_cells(work / "anim" / f"h{p}" / "sheet.png", 4, 3)
    out = []
    for i in range(11):
        cell = cells[i]
        rgb = np.asarray(cell.convert("RGB"), dtype=float)
        cut = common.key_cell(cell, choose=pick_main, despill=spec.get("despill"))
        m = ~common.magenta(rgb)
        m = common.grow(common.shrink(m, 2), 2)
        xs = np.nonzero(m)[1]
        rel = xs.mean() - cell.width / 2 if len(xs) else 0.0
        out.append([cut, float(np.sqrt(target / common.solid(cut).sum())), rel])
    med = float(np.median([f[1] for f in out[:6]]))
    rel0 = float(np.median([f[2] for f in out[:6]]))
    res = []
    for i, (cut, s, rel) in enumerate(out):
        if i < 6:
            res.append((cut, s, 0.0, spec["walk_lift"][i]))
        else:
            res.append((cut, med, (rel - rel0) * med, 0))
    return res


def shadow(h):
    _, (sx0, sy0, sx1, sy1), a = common.flash_body_and_shadow(spec, flash_column(spec, h))
    m = Image.new("L", (ACW * UP, ACH * UP), 0)
    if sx1 > sx0:
        ImageDraw.Draw(m).ellipse(((sx0 + PX + 0.5) * UP, (sy0 + PT + 0.5) * UP, (sx1 + PX - 0.5) * UP, (sy1 + PT - 0.5) * UP), fill=min(255, a + 20))
    m = m.filter(ImageFilter.GaussianBlur(0.8 * UP))
    lay = Image.new("RGBA", m.size, (25, 18, 12, 0))
    lay.putalpha(m)
    return lay


def render(h, cut, s, dx, lift, flip):
    """One cell of heading h: the cutout at scale s, moved dx sideways and lifted, over the ground shadow."""
    f = fit[h]
    if flip:
        cut, dx = cut.transpose(Image.FLIP_LEFT_RIGHT), -dx
    W, H = ACW * UP, ACH * UP
    note = ""
    for _ in range(8):
        k = s * UP
        mon = lifted(common.premul_resize(cut, (max(1, round(cut.width * k)), max(1, round(cut.height * k)))))
        sx0, _, sx1, _ = common.bbox(common.solid(mon))
        fy0 = common.bbox(np.asarray(mon)[..., 3] > 40)[1]
        fy1 = common.bbox(common.solid(mon))[3]
        x = round((f["cx"] + PX + dx) * UP - (sx0 + sx1) / 2)
        y = round((f["bottom"] + PT - lift) * UP - fy1)
        if mon.width <= W - 2 and y + fy0 >= 1:
            break
        s *= 0.95  # keep every part inside the cell: shrink a frame that does not fit
        note = "shrunk"
    if x < 1 or x + mon.width > W - 1:
        x = min(max(x, 1), W - mon.width - 1)
        note = note or "moved"
    cell = shadow(h)
    lay = Image.new("RGBA", (W, H))
    lay.paste(mon, (x, y))
    cell.alpha_composite(lay)
    return cell, note


if __name__ == "__main__":
    only = [int(x) for x in sys.argv[3:]]
    painted = only or sorted({fit[h]["src"] for h in range(D)})
    frames = {}
    for p in painted:
        frames[p] = painted_frames(p)
    fdir = work / "anim" / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    W, H = ACW * UP, ACH * UP
    sheet = Image.new("RGBA", (D * W, 12 * H))
    for h in range(D):
        p, flip = fit[h]["src"], fit[h]["flip"]
        if p not in frames:
            continue
        row = [render(h, cuts[p], fit[p]["scale"] * GROW, 0.0, 0, flip)]
        row += [render(h, *fr, flip) for fr in frames[p]]
        notes = [n for _, n in row if n]
        if notes:
            print(f"h{h}: frames {[k for k, (_, n) in enumerate(row) if n]} shrunk or moved to stay in the cell")
        for k, (cell, _) in enumerate(row):
            sheet.paste(cell, (h * W, k * H))
            cell.save(fdir / f"h{h}-f{k:02d}.png")
    if only:
        sys.exit(f"frames of headings {sorted(h for h in range(D) if fit[h]['src'] in frames)} in {fdir}")
    out = spec["out"]
    sheet.save(ASSETS / f"{out}-anim@4x.png", optimize=True)
    small = Image.new("RGBA", (D * ACW, 12 * ACH))
    for h in range(D):
        for k in range(12):
            small.paste(common.premul_resize(sheet.crop((h * W, k * H, (h + 1) * W, (k + 1) * H)), (ACW, ACH)), (h * ACW, k * ACH))
    small.save(ASSETS / f"{out}-anim.png", optimize=True)
    print(f"wrote {out}-anim@4x.png {sheet.size}; cell {ACW}x{ACH}, anchor {spec['anchor'][0] + PX},{spec['anchor'][1] + PT}")
