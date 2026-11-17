"""Shared picture helpers for the Inferno monster kit: numpy + Pillow only (no scipy)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from spec import ASSETS

Image.MAX_IMAGE_PIXELS = None


_sheets = {}


def flash_sheet(spec):
    if spec["flash"] not in _sheets:
        _sheets[spec["flash"]] = Image.open(ASSETS / spec["flash"]).convert("RGBA")
    return _sheets[spec["flash"]].copy()


def flash_x(spec, col):
    """Left edge of Flash column `col` in whole pixels. A sheet whose cell is not a whole number of
    pixels wide (Zagnoid: 1933 px / 30 = 64.4) sets `flash_w`; the column then starts at col * flash_w
    rounded (half up), and the cut is `cell` wide."""
    fw = spec.get("flash_w", spec["cell"][0])
    # Balthazar (IC5): `flash_x0` < 0 opens a window wider than the Flash cell (`cell` is then that window), so the
    # wings that spill past the 56 px cell are kept whole; the own-art-run cut drops the neighbours' art
    return int(np.floor(col * fw + 0.5)) + spec.get("flash_x0", 0)


def art_runs(spec, row=0):
    """The x ranges [x0, x1) of see-through-separated art along a Flash row: one per column on Zagnoid's sheet."""
    w, h = spec["cell"]
    a = np.asarray(flash_sheet(spec))[row * h:(row + 1) * h, :, 3].any(0)
    edges = np.flatnonzero(np.diff(np.r_[0, a.astype(int), 0]))
    return list(zip(edges[::2], edges[1::2]))


def flash_cell(spec, col, row=None):
    """Flash cell (col, row) at the `cell` size; row defaults to spec `flash_row` (0; Malphus IC3: 1, the
    first walk frame, since the game never draws its row 0). With a fractional `flash_w` the neighbours' art reaches
    into the cut (a shadow tip from the left, a tail tip from the right), so only this column's own art run
    (the sheet has one see-through-separated run per column) is kept. A run that pokes past the cut
    (Zagnoid column 10's tail tip, 2 px) loses those pixels, as the Flash game's own cut did."""
    w, h = spec["cell"]
    if row is None:
        row = spec.get("flash_row", 0)
    x0 = flash_x(spec, col)
    cell = flash_sheet(spec).crop((x0, row * h, x0 + w, (row + 1) * h))
    if "flash_w" not in spec:
        return cell
    runs = art_runs(spec, row)
    if len(runs) != spec["flash_columns"]:
        raise SystemExit(f"{spec['flash']} row {row}: {len(runs)} art runs, expected {spec['flash_columns']}")
    r0, r1 = runs[col]
    a = np.asarray(cell).copy()
    xs = np.arange(x0, x0 + w)
    a[:, (xs < r0) | (xs >= r1)] = 0
    if spec.get("flash_specks"):
        # Balthazar (IC5): the rows touch, so a wing tip of the row below pokes up into this cell's last lines (and
        # the claws of the row above into its first): small pieces touching the top or bottom edge are dropped
        lab, sizes = components(a[..., 3] > 0)
        if len(sizes) > 2:
            edge = set(lab[0][lab[0] > 0]) | set(lab[-1][lab[-1] > 0])
            drop = [i for i in edge if sizes[i] < 0.1 * sizes[1:].max()]
            a[np.isin(lab, drop)] = 0
    return Image.fromarray(a, "RGBA")


def components(mask):
    """Label 4-connected components of a bool mask with Pillow's flood fill -> (labels, sizes)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    im = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), "L").copy()
    sizes = [0]
    k = 0
    todo = mask.copy()
    while todo.any():
        ys, xs = np.nonzero(todo)
        y, x = int(ys[0]), int(xs[0])
        k += 1
        ImageDraw.floodfill(im, (x, y), 1)  # 1 never occurs otherwise (mask pixels are 255)
        a = np.asarray(im)
        hit = a == 1
        lab[hit] = k
        sizes.append(int(hit.sum()))
        todo &= ~hit
        im = Image.fromarray(np.where(hit, 0, a).astype(np.uint8), "L").copy()
    return lab, np.array(sizes)


def grow(mask, px):
    if px <= 0:
        return mask
    im = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * px + 1))
    return np.asarray(im) > 127


def shrink(mask, px):
    if px <= 0:
        return mask
    im = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * px + 1))
    return np.asarray(im) > 127


def magenta(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r > 170) & (b > 170) & (g < 120) & (np.abs(r - b) < 70)


def fill_out(rgb, core, steps=12):
    """Colour every pixel from the nearest core pixels (push out by repeated blurs), so edge pixels lose the magenta tint."""
    acc = np.dstack([rgb * core[..., None], core.astype(float)])
    out = acc.copy()
    cur = acc
    for _ in range(steps):
        pad = np.pad(cur, ((1, 1), (1, 1), (0, 0)), mode="edge")
        cur = sum(pad[dy:dy + cur.shape[0], dx:dx + cur.shape[1]] for dy in range(3) for dx in range(3)) / 9
        empty = out[..., 3] < 1e-6
        out[empty] = cur[empty]
    w = np.maximum(out[..., 3:], 1e-6)
    return np.clip(out[..., :3] / w, 0, 255)


def coarse_labels(mask, f=4):
    """Components of a big mask, found on a copy f times smaller (fast); -> full-size labels, sizes."""
    h, w = mask.shape
    H, W = -(-h // f), -(-w // f)
    pad = np.zeros((H * f, W * f), bool)
    pad[:h, :w] = mask
    small = pad.reshape(H, f, W, f).any(axis=(1, 3))
    lab_s, _ = components(small)
    lab = np.repeat(np.repeat(lab_s, f, 0), f, 1)[:h, :w] * mask
    sizes = np.bincount(lab.ravel(), minlength=lab_s.max() + 1)
    sizes[0] = 0
    return lab, sizes


def fill_holes(mask):
    """Background pixels not reachable from the border become part of the mask."""
    h, w = mask.shape
    pad = np.full((h + 2, w + 2), 255, np.uint8)
    pad[1:-1, 1:-1] = np.where(mask, 0, 255)
    im = Image.fromarray(pad, "L").copy()
    ImageDraw.floodfill(im, (0, 0), 128)
    reach = np.asarray(im)[1:-1, 1:-1] == 128
    return ~reach


def key_cell(img, min_part=0.03, choose=None, despill=None, open_holes=False, origin=False, thin=False):
    """One painted creature on magenta -> tight RGBA cutout (or None).
    Keeps blobs >= min_part of the biggest; `choose(labels, sizes)` may pick the label set instead.
    despill="fire": a creature with no blue or purple in it; any blue above green is magenta bleeding into a
    thin flame tip, so it is taken out (and that pixel made see-through by as much).
    thin=True (spec key_thin, IC7 Sabnox's whiskers): thin parts joined to the creature (under ~6 px wide, which the
    speck filter and the 3 px colour core drop or paint black) are kept and coloured from their own middle."""
    rgb = np.asarray(img.convert("RGB"), dtype=float)
    fg = ~magenta(rgb)
    fg = grow(shrink(fg, 2), 2)  # drop specks and noise
    lab, sizes = coarse_labels(fg)
    if sizes.max() == 0:
        return None
    ids = choose(lab, sizes) if choose else [i for i in range(1, len(sizes)) if sizes[i] >= sizes.max() * min_part]
    keep = fill_holes(np.isin(lab, ids))
    if thin:
        raw = ~magenta(rgb)
        lab2, _ = coarse_labels(keep | raw, f=2)
        ids2 = np.unique(lab2[keep])
        keep = keep | (np.isin(lab2, ids2[ids2 > 0]) & raw)
    if open_holes:
        # magenta gaps closed in by the art (Zagnoid's bent arms and claw fingers against its body) become
        # see-through again, with a 2 px rim so no pink fringe is left
        hole = keep & ~np.isin(lab, ids) & magenta(rgb)
        if open_holes == "core":
            # only gaps with a core of real key colour (green < 60): Malphus's lilac fur highlights pass the
            # magenta test too (green ~90-110) and would be punched out as specks
            hl, hs = components(hole)
            real = np.zeros(len(hs), bool)
            np.maximum.at(real, hl[hole], rgb[..., 1][hole] < 60)
            real[0] = False
            hole = real[hl]
        keep &= ~grow(hole, 2) | ~(magenta(rgb) | grow(hole, 1))
    keep = shrink(keep, 1)
    core = shrink(keep, 3)
    if thin:
        # the thin parts' own pixels, less the edge pixels blended toward the key (blue well above green)
        core = core | (keep & ~grow(core, 3) & (rgb[..., 2] - rgb[..., 1] < 60))
    col = fill_out(rgb, core, steps=24 if thin else 12) if core.any() else rgb
    col = np.where(core[..., None], rgb, col)
    alpha = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    if despill == "fire":
        excess = np.clip((col[..., 2] - col[..., 1]) / 160, 0, 1)
        alpha = alpha * (1 - excess)
        col = col.copy()
        col[..., 2] = np.minimum(col[..., 2], col[..., 1])
    ys, xs = np.nonzero(alpha > 20)
    if len(xs) == 0:
        return None
    out = Image.fromarray(np.dstack([col, alpha]).astype(np.uint8), "RGBA")
    cut = out.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return (cut, (int(xs.min()), int(ys.min()))) if origin else cut  # origin: where the cutout sat in img (IC5)


def grid_cells(path, cols, rows):
    """Cut a Codex grid picture into cols x rows equal cells."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return [im.crop((c * w // cols, r * h // rows, (c + 1) * w // cols, (r + 1) * h // rows)) for r in range(rows) for c in range(cols)]


def premul_resize(im, size):
    """LANCZOS resize with colour weighted by alpha (no dark or pink fringe)."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def solid(im, t=200):
    return np.asarray(im)[..., 3] > t


def bbox(mask):
    ys, xs = np.nonzero(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def common_bottom(mask):
    return int(np.nonzero(mask.any(1))[0].max()) + 1


def flash_body_and_shadow(spec, col):
    """Flash cell -> (body mask, shadow box (x0,y0,x1,y1), shadow alpha) in 1x pixels."""
    a = np.asarray(flash_cell(spec, col)).astype(int)
    body = a[..., 3] > spec.get("body_alpha", 235)  # IC5: 128 (a soft-edged render: half its art is under 235)
    dark = (a[..., 3] > 0) & (a[..., :3].max(-1) < 90) & ~grow(body, 1)
    if body.any():
        dark[: common_bottom(body) - 2] = False  # the shadow lies under the body, not in its dark bits
    sx0, sy0, sx1, sy1 = bbox(dark) if dark.any() else (0, 0, 0, 0)
    return body, (sx0, sy0, sx1, sy1), int(np.median(a[..., 3][dark])) if dark.any() else 0


def flat(im, bg=(86, 92, 74)):
    b = Image.new("RGBA", im.size, bg + (255,))
    b.alpha_composite(im)
    return b.convert("RGB")


def flash_body_only(spec, col):
    """Flash cell with its ground shadow taken out: dark see-through pixels in the lower half, away from the body."""
    a = np.asarray(flash_cell(spec, col)).copy()
    body = a[..., 3] > 235
    _, y0, _, y1 = bbox(body)
    dark = (a[..., :3].max(-1) < 90) | (a[..., 3] < 200)
    low = np.zeros(body.shape, bool)
    low[(y0 + y1) // 2:] = True
    a[dark & low & ~grow(body, 1)] = 0
    return Image.fromarray(a, "RGBA")


def flash_shift(spec, col):
    """1x px to add to a Flash column's x to take out the sheet's drift. Zagnoid's art was laid out ~64.65 px
    apart but the sheet is cut 64.4 apart, so its body creeps right ~0.25 px per column (6 px from column 0 to
    29, then jumps back). `flash_drift` is that creep; the shift centres the correction on the middle column."""
    d = spec.get("flash_drift", 0.0)
    return -d * (col - (spec["flash_columns"] - 1) / 2)


def body_lum(im, size=160):
    """Luminance of the lit body (solid, not dark shadow), centred on its bbox in a size x size frame."""
    a = np.asarray(im).astype(float)
    m = (a[..., 3] > 200) & (a[..., :3].max(-1) >= 90)
    out = np.zeros((size, size))
    if not m.any():
        return out
    x0, y0, x1, y1 = bbox(m)
    ox, oy = size // 2 - (x0 + x1) // 2, size // 2 - (y0 + y1) // 2
    out[oy:oy + a.shape[0], ox:ox + a.shape[1]] = a[..., :3].mean(-1) * m
    return out


def facing_scores(modern, flash):
    """(difference to the Flash cell, difference to the mirrored Flash cell), both body-centred."""
    m = body_lum(modern)
    return np.abs(m - body_lum(flash)).mean(), np.abs(m - body_lum(flash.transpose(Image.FLIP_LEFT_RIGHT))).mean()


def cast_shadow(spec, col, w, hgt, ox, oy, up):
    """spec shadow="flash": the Flash cell's own cast shadow (Zagnoid's falls far to the lower right, which the
    ellipse of flash_body_and_shadow would lose), plus the ground under the lower half of the Flash body so the
    painted body, which covers a slightly different area, still stands in it. A w x hgt layer at `up` scale,
    the 1x mask moved by (ox, oy)."""
    a = np.asarray(flash_cell(spec, col)).astype(float)
    body = a[..., 3] > 235
    _, y0, _, y1 = bbox(body)
    low = np.zeros(body.shape, bool)
    low[(y0 + y1) // 2:] = True
    sh = (a[..., :3].max(-1) < 90) & (a[..., 3] > 0) & low & ~grow(body, 1)
    if sh.any():  # the cast shadow is one big piece; dark claw-tip edge pixels are small loose bits
        lab, sizes = components(sh)
        sh = np.isin(lab, [i for i in range(1, len(sizes)) if sizes[i] >= 0.1 * sizes.max()])
    level = float(np.median(a[..., 3][sh])) if sh.any() else 0.0
    under = body & low
    under[: y1 - 6] = False  # the ground under the body: its last 6 rows
    mask = shrink(grow(sh | under, 2), 2)
    m1 = np.where(mask, min(255.0, level + 20), 0).astype(np.uint8)
    big = Image.fromarray(m1, "L").resize((m1.shape[1] * up, m1.shape[0] * up), Image.BILINEAR)
    m = Image.new("L", (w, hgt), 0)
    m.paste(big, (round(ox * up), round(oy * up)))
    m = m.filter(ImageFilter.GaussianBlur(0.8 * up))
    lay = Image.new("RGBA", (w, hgt), (25, 18, 12, 0))
    lay.putalpha(m)
    return lay



def part_weights(rgb):
    """Soft (body, limbs, crest) weights of each pixel for Zagnoid's colour match: crest = green at least as
    strong as red (the dark teal spikes), limbs = red well above green (brick-red arms and legs), body = the rest."""
    r, g = rgb[..., 0], rgb[..., 1]
    crest = np.clip((g - r + 10) / 30, 0, 1)
    ratio = g / np.maximum(r, 1)
    red = np.clip((0.62 - ratio) / 0.12, 0, 1) * np.clip((r - 40) / 30, 0, 1) * (1 - crest)
    return 1 - red - crest, red, crest


def grade(im, spec):
    """spec `grade` = {"body": ((gain, offset) for R, G, B), "limbs": (...), "crest": (...)}: a per-part, per-channel
    colour match of the painting to the Flash sprite (IC2 round 2: mean and spread of each channel over all 30
    headings at 1x; limbs and crest then set by eye on the game-size strip). Applied when a view is placed on a sheet (build_still) and to every animated frame
    (build_anim); the cuts and the Codex references stay ungraded."""
    g = spec.get("grade")
    if not g:
        return im
    a = np.asarray(im).astype(float)
    rgb = a[..., :3]
    wb, wr, wc = part_weights(rgb)
    if spec.get("grade_chroma"):
        # IC2 round 3: grey / white pixels (fangs, drool, glints, dark crevices) keep their colour; the grade
        # acts in proportion to how coloured a pixel is, so whites do not turn cyan or shadows purple-grey
        k = np.clip((rgb.max(-1) - rgb.min(-1)) / 80.0, 0, 1)
        wc = wc + (wb + wr) * (1 - k)  # the ungraded share is kept as painted (like the crest)
        wb, wr = wb * k, wr * k
    # the crest grade only touches dark green pixels: lemon body highlights can read green-yellow too
    wd = wc * np.clip((160 - rgb.mean(-1)) / 40, 0, 1) if "crest" in g else np.zeros_like(wc)
    out = rgb * (wc - wd)[..., None]
    for w, part in ((wb, "body"), (wr, "limbs"), (wd, "crest")):
        if part not in g:
            continue
        gr = np.stack([rgb[..., c] * k + o for c, (k, o) in enumerate(g[part])], -1)
        out += gr * w[..., None]
    a[..., :3] = out
    if spec.get("tone"):
        a[..., :3] = tone(np.clip(a[..., :3], 0, 255), spec["tone"])
    if spec.get("demagenta"):
        a = demagenta(a)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def tone(rgb, parts):
    """spec tone (IC3 lead vetting, 16 Nov): after the grade, each named part, picked by hue (degrees, soft edge
    `soft`) and saturation over `min_sat` (and under `max_sat`, if given), is moved toward the portrait: chroma scaled round the pixel's luma
    (`chroma`), per-channel `gains`, brightness times `value` (pixels with luma over `hi` keep their brightness,
    so highlights do not go flat). Pixels outside every hue window (belly, claws, stripes, tusks) are untouched."""
    x = rgb / 255.0
    mx, mn = x.max(-1), x.min(-1)
    d = mx - mn + 1e-9
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    sat = d / (mx + 1e-9)
    out = rgb.copy()
    luma = (rgb * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
    for p in parts.values():
        lo, hi = p["hue"]
        soft = p.get("soft", 8)
        w = (np.clip((hue - (lo - soft)) / soft, 0, 1) * np.clip(((hi + soft) - hue) / soft, 0, 1)
             * np.clip((sat - p.get("min_sat", 0.2)) / 0.1, 0, 1)
             * np.clip((p.get("max_sat", 2.0) - sat) / 0.1, 0, 1))  # IC4: the orange eye balls (sat ~0.8) stay out of the flesh
        c = (luma + (rgb - luma) * p["chroma"]) * np.array(p.get("gains", (1.0, 1.0, 1.0)))
        keep = np.clip((luma - p.get("hi", 255)) / 40, 0, 1)
        c = c * (p["value"] + (1 - p["value"]) * keep)
        out = out * (1 - w[..., None]) + c * w[..., None]
    return np.clip(out, 0, 255)


def demagenta(a, steps=6):
    """spec demagenta (IC3): a few drool-gap pixels came back hot magenta-pink (green < 40, red and blue high) but
    not magenta enough to key out; nothing on Malphus is that colour, so they take their neighbours' colour."""
    rgb = a[..., :3]
    bad = (rgb[..., 1] < 40) & (rgb[..., 0] > 150) & (rgb[..., 2] > 110) & (a[..., 3] > 0)
    if not bad.any():
        return a
    good = ~bad & (a[..., 3] > 100)
    col, w = rgb * good[..., None], good.astype(float)
    for _ in range(steps):  # spread the good colours into the bad pixels (3x3 box, repeated)
        pc, pw = np.pad(col, ((1, 1), (1, 1), (0, 0))), np.pad(w, 1)
        h, wd = w.shape
        col = sum(pc[dy:dy + h, dx:dx + wd] for dy in range(3) for dx in range(3))
        w = sum(pw[dy:dy + h, dx:dx + wd] for dy in range(3) for dx in range(3))
        col = np.where(good[..., None], rgb, col / np.maximum(w, 1e-6)[..., None])
        w = np.where(good | (w > 0), 1.0, 0.0)
        col = col * w[..., None]
    a = a.copy()
    a[..., :3] = np.where(bad[..., None] & (w[..., None] > 0), col, rgb)
    return a


def match_views(views):
    """spec view_match (IC2 round 3): Codex paints some 2x2 batches more orange than others, so each painted view's
    per-channel mean and spread (solid pixels) are matched to the median over all views. Gains held to 0.85-1.18."""
    stats = {h: (np.asarray(v).astype(float)[solid(v)][:, :3].mean(0), np.asarray(v).astype(float)[solid(v)][:, :3].std(0))
             for h, v in views.items()}
    tm = np.median([s[0] for s in stats.values()], 0)
    ts = np.median([s[1] for s in stats.values()], 0)
    out = {}
    for h, v in views.items():
        m, s = stats[h]
        k = np.clip(ts / np.maximum(s, 1e-3), 0.85, 1.18)
        a = np.asarray(v).astype(float)
        a[..., :3] = np.clip((a[..., :3] - m) * k + tm, 0, 255)
        out[h] = Image.fromarray(a.astype(np.uint8), "RGBA")
    return out
