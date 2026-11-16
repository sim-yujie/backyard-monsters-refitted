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
GAMMA = SPECS[sys.argv[1]].get("gamma", 0.92)  # lifts the painting a little so it reads as bright as Flash's at game size (IC2 r2: 1.0)

mid, work = sys.argv[1], Path(sys.argv[2])
spec = SPECS[mid]
D = spec["directions"]
CW, CH = spec["cell"]
PX, PT, PB = spec["anim_pad"]
ACW, ACH = CW + 2 * PX, CH + PT + PB
fit = {int(k): v for k, v in json.loads((work / "still" / "fit.json").read_text()).items()}
cuts = {int(p.stem[1:]): Image.open(p).convert("RGBA") for p in (work / "still" / "cuts").glob("h*.png")}


def lifted(im):
    im = common.grade(im, spec)  # spec grade (IC2 round 2): colour match to the Flash body
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


def colour_lock(cut, ref):
    """spec anim_colour_lock (IC2 round 2): match each frame's per-channel mean and spread (solid pixels) to the
    still view of its heading, so a Codex sheet painted a little greener or paler than its ref.png does not
    flicker against the idle frame (heading 9 came back olive-grey). Gains are held to 0.8-1.25."""
    a = np.asarray(cut).astype(float)
    m, r = common.solid(cut), np.asarray(ref).astype(float)[common.solid(ref)][:, :3]
    x = a[m][:, :3]
    k = np.clip(r.std(0) / np.maximum(x.std(0), 1e-3), 0.8, 1.25)
    o = r.mean(0) - x.mean(0) * k
    a[..., :3] = np.clip(a[..., :3] * k + o, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def flyer_frames(p):
    """spec flyer (Balthazar IC5): the wing beat changes the silhouette a lot, so frames are NOT each scaled to the
    still's area or stood on its bottom line (the body would swell and bob with the wings). One scale for all 11
    frames, from walk cell 1 (painted as ref.png's pose) against the still; each frame keeps the place Codex painted
    it at in its grid cell, and cell 1's solid box (centre, bottom) lands where the still view stands.
    -> list of 11 (cutout, scale, (x, y) of the cutout's top-left in grid-cell px, cell width, reference point)."""
    ref = cuts[p]
    base = fit[p]["scale"] * GROW
    cells = common.grid_cells(work / "anim" / f"h{p}" / "sheet.png", 4, 3)
    out = []
    for i in range(11):
        cut, org = common.key_cell(cells[i], choose=pick_main, despill=spec.get("despill"), open_holes=spec.get("open_holes", False), origin=True)
        if spec.get("anim_colour_lock"):
            cut = colour_lock(cut, ref)
        out.append((cut, org, cells[i].width))
    c1, o1, _ = out[0]
    a1 = common.solid(c1).sum()
    s = base * float(np.sqrt(common.solid(ref).sum() / a1))
    x0, _, x1, y1 = common.bbox(common.solid(c1))
    pt = (o1[0] + (x0 + x1) / 2, o1[1] + y1)  # cell 1's solid box centre and bottom, in grid-cell px
    res = []
    for cut, org, cw in out:
        # a frame Codex drew much smaller (a dive away into the picture, h19 / h20) is enlarged to 65% of cell 1's
        # area about its own box centre, so the size does not halve for one frame
        bx0, by0, bx1, by1 = common.bbox(common.solid(cut))
        own = (org[0] + (bx0 + bx1) / 2, org[1] + (by0 + by1) / 2)
        up = max(1.0, float(np.sqrt(0.65 * a1 / common.solid(cut).sum())))
        res.append((cut, s, org, cw, pt, own, up))
    return res


def render_flyer(h, cut, s, org, cw, pt, own, up, flip):
    """One flyer cell: the cutout at scale s, placed so grid point `pt` lands on the still's spot (fit cx, bottom);
    a frame enlarged by `up` keeps its own box centre `own` where scale s would put it."""
    f = fit[h]
    W, H = ACW * UP, ACH * UP
    if flip:
        cut = cut.transpose(Image.FLIP_LEFT_RIGHT)
        org, pt, own = (cw - org[0] - cut.width, org[1]), (cw - pt[0], pt[1]), (cw - own[0], own[1])
    k = s * UP
    cx = (f["cx"] + PX) * UP - (pt[0] - own[0]) * k  # where the frame's own centre lands, in cell px at UP
    cy = (f["bottom"] + PT) * UP - (pt[1] - own[1]) * k
    k *= up
    mon = lifted(common.premul_resize(cut, (max(1, round(cut.width * k)), max(1, round(cut.height * k)))))
    x = round(cx - (own[0] - org[0]) * k)
    y = round(cy - (own[1] - org[1]) * k)
    a = np.asarray(mon)[..., 3] > 40
    ys, xs = np.nonzero(a)
    note = ""
    if x + xs.min() < 0 or x + xs.max() >= W or y + ys.min() < 0 or y + ys.max() >= H:
        note = f"CUT ({x + xs.min()},{y + ys.min()})-({x + xs.max()},{y + ys.max()}) in {W}x{H}"  # needs more anim_pad
    cell = shadow(h)
    lay = Image.new("RGBA", (W + 2 * mon.width, H + 2 * mon.height))
    lay.paste(mon, (x + mon.width, y + mon.height))
    cell.alpha_composite(lay.crop((mon.width, mon.height, mon.width + W, mon.height + H)))
    return cell, note


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
        cut = common.key_cell(cell, choose=pick_main, despill=spec.get("despill"), open_holes=spec.get("open_holes", False))
        m = ~common.magenta(rgb)
        m = common.grow(common.shrink(m, 2), 2)
        xs = np.nonzero(m)[1]
        rel = xs.mean() - cell.width / 2 if len(xs) else 0.0
        if spec.get("anim_colour_lock"):
            cut = colour_lock(cut, ref)
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
    if spec.get("shadow") == "none":  # a flyer (Balthazar IC5): the game draws its shadow on the ground itself
        return Image.new("RGBA", (ACW * UP, ACH * UP))
    if spec.get("shadow") == "flash":
        return common.cast_shadow(spec, flash_column(spec, h), ACW * UP, ACH * UP, PX + fit[h].get("shift", 0.0), PT, UP)
    _, (sx0, sy0, sx1, sy1), a = common.flash_body_and_shadow(spec, flash_column(spec, h))
    m = Image.new("L", (ACW * UP, ACH * UP), 0)
    if sx1 > sx0:
        ox = PX + fit[h].get("shift", 0.0)  # the drift taken out of the Flash sheet (IC2), as the still view
        ImageDraw.Draw(m).ellipse(((sx0 + ox + 0.5) * UP, (sy0 + PT + 0.5) * UP, (sx1 + ox - 0.5) * UP, (sy1 + PT - 0.5) * UP), fill=min(255, a + 20))
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
    FLY = spec.get("flyer", False)
    for p in painted:
        frames[p] = flyer_frames(p) if FLY else painted_frames(p)
    fdir = work / "anim" / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    W, H = ACW * UP, ACH * UP
    sheet = Image.new("RGBA", (D * W, 12 * H))
    for h in range(D):
        p, flip = fit[h]["src"], fit[h]["flip"]
        if p not in frames:
            continue
        row = [render(h, cuts[p], fit[p]["scale"] * GROW, 0.0, 0, flip)]
        frs = frames[p]
        roll = spec.get("mirror_walk_roll", 0)
        if flip and roll:
            # IC3: a mirrored four-legged gait is half a cycle out (its left legs are the painted right legs), so the
            # mirrored heading plays walk frame k+roll; the legs then do not jump at the h7/h8 and h22/h23 seams
            frs = [frs[(k + roll) % 6] for k in range(6)] + frs[6:]
        row += [(render_flyer if FLY else render)(h, *fr, flip) for fr in frs]
        notes = [n for _, n in row if n]
        if notes:
            print(f"h{h}: frames {[k for k, (_, n) in enumerate(row) if n]} shrunk or moved to stay in the cell" + (f": {notes}" if FLY else ""))
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
