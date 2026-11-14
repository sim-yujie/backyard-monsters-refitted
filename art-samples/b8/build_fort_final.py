"""build_fort_final.py : the FINAL Modern fortification "A Thorn and Bone" (owner's choice, 14 Nov 2026).

Codex sheets (magenta ground), painted per ring size so nothing is upscaled:
  fortification/final/<job>  (jobs.json names the chosen sheet of each size; prompts beside each sheet)
  either 4 columns = fortify 1-4 with back halves in the top row and front halves in the bottom row, or "nested":
  the four back halves stacked in the left half and the four front halves in the right half, all at ~4x game size
Each cut piece is put on a TRUE 2:1 isometric diamond: its rope's underside is measured (two straight lines), then
every column is moved up or down (no rotation, so spikes stay upright) until the rope's centre line lies on the
diamond, and the piece is scaled so its two end caps sit on the diamond's left and right corners. The back and the
front half of every level therefore share the same corners, and every level the same ring.
A soft contact shadow of the rope is baked under each piece (as Flash's pieces have).

Writes  server/public/assets/buildings/fortifications/fort{70,130}_{B,F}{1..4}.modern@2x.webp
        fortification/final/out/offsets.json  (top-left of each piece from the RING CENTRE, game px)
        fortification/final/sheets/*.png      (owner sheets, with the game's real building pictures)
Run: ~/.cache/bymr-art-venv/bin/python build_fort_final.py [--no-game-files]     (needs numpy)
"""
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

from b8lib import B, HERE, REPO, artlib, despill_magenta, hstack, label, multiply, resize_pm, titled, vstack

FORT = HERE / "fortification"
FINAL = FORT / "final"
OUT = FINAL / "out"
SHEETS = FINAL / "sheets"
# size -> [(job folder, columns, first tier)], or (job folder, "nested", 1) for a sheet of stacked chevrons (see cut_nested)
JOBS = {"70": [("s70c", "nested", 1)], "130": [("s130d", "nested", 1)]}
# half-width of the rope's centre-line diamond, game px (its half-height is half of this)
HALF = {70: 69, 130: 124}
# ring centre below the building's isometric origin, game px: the middle of the footprint (towers 70, hall 130);
# the Silo (footprint 80) keeps Flash's 6-7 px drop. These must match web/src/game/yard/fortArt.ts.
CENTRE = {"tower": 35, "silo": 41, "hall": 65}
# Flash offsets (fortArt.ts): [front x, front y, back x, back y] per tier
F_TOWER = [[-73, 21, -70, -10], [-69, 22, -65, -12], [-72, 10, -68, -12], [-70, -11, -61, -36]]
F_SILO = [[-73, 28, -71, -4], [-69, 26, -65, -7], [-73, 17, -69, -5], [-70, -3, -62, -31]]
F_HALL = [[-127, 46, -122, -10], [-124, 48, -120, -15], [-124, 32, -110, -11], [-124, 15, -116, -49]]
GRASS = (98, 132, 72)
SS = 4          # work scale of the warp, px per game px (the files are 2x)
TONE = {"sat": 1.0, "gamma": 1.0}


# ---------- cutting ----------

def cut(job, cols):
    sheet = Image.open(FINAL / job / "sheet.png").convert("RGB")
    out = []
    for cell in artlib.cells(sheet, cols, 2):
        im = despill_magenta(artlib.largest_blob_only(artlib.clean(artlib.key(cell)), 0.03))
        out.append(im.crop(im.getbbox()))
    return out      # row-major: backs then fronts


def blobs(mask):
    """Connected pieces of a boolean array (8-neighbour), biggest first, as boolean arrays. Run-based union-find."""
    h, w = mask.shape
    parent = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    runs, prev = [], []
    for y in range(h):
        row = mask[y]
        d = np.diff(np.r_[0, row.astype(np.int8), 0])
        cur = []
        for a, b in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            i = len(parent)
            parent.append(i)
            for pa, pb, pi in prev:
                if pa <= b and pb >= a:
                    ra, rb = find(i), find(pi)
                    if ra != rb:
                        parent[ra] = rb
            cur.append((a, b, i))
            runs.append((y, a, b, i))
        prev = cur
    size = {}
    for y, a, b, i in runs:
        r = find(i)
        size[r] = size.get(r, 0) + b - a
    out = []
    for r in sorted(size, key=size.get, reverse=True)[:12]:
        m = np.zeros_like(mask)
        for y, a, b, i in runs:
            if find(i) == r:
                m[y, a:b] = True
        out.append(m)
    return out


def cut_nested(job):
    """A sheet with the four back halves stacked in its left half and the four front halves in its right half
    (fortify 1 at the top): {(part, tier): piece}. The chevrons nest, so they are cut by connected piece."""
    sheet = Image.open(FINAL / job / "sheet.png").convert("RGB")
    keyed = artlib.clean(artlib.key(sheet))
    alpha = np.asarray(keyed.getchannel("A"))
    big = blobs(alpha > 128)[:8]
    soft = Image.fromarray(alpha)
    out = {}
    for part, side in (("B", lambda m: np.where(m.any(0))[0].mean() < sheet.width / 2), ("F", lambda m: np.where(m.any(0))[0].mean() >= sheet.width / 2)):
        mine = sorted((m for m in big if side(m)), key=lambda m: np.where(m.any(1))[0].mean())
        assert len(mine) == 4, (job, part, len(mine))
        for tier, m in enumerate(mine, 1):
            near = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))   # keep the soft rim
            im = keyed.copy()
            im.putalpha(Image.fromarray(np.minimum(alpha, np.asarray(near))))
            im = despill_magenta(im)
            out[(part, tier)] = im.crop(im.getbbox())
    return out


def fit_line(xs, ys):
    """Least squares with the bulges (straps, clamps, knots hanging under the rope) thrown out."""
    keep = np.ones(len(xs), bool)
    for _ in range(6):
        k, c = np.polyfit(xs[keep], ys[keep], 1)
        res = ys - (k * xs + c)
        tol = max(1.5, 1.5 * np.std(res[keep]))
        new = np.abs(res) <= tol
        if new.sum() < 8 or (new == keep).all():
            break
        keep = new
    return k, c


def measure(piece):
    """The rope of one cut piece: ends, bend, underside lines of both arms, vertical thickness (source px)."""
    a = np.asarray(piece.getchannel("A")) > 128
    h, w = a.shape
    cols = np.where(a.any(0))[0]
    x0, x1 = cols[0], cols[-1]
    bot = np.array([np.where(a[:, x])[0][-1] if a[:, x].any() else -1 for x in range(w)], float)
    top = np.array([np.where(a[:, x])[0][0] if a[:, x].any() else -1 for x in range(w)], float)
    xm = (x0 + x1) / 2
    span = x1 - x0
    for _ in range(3):
        xs = np.arange(int(x0 + 0.10 * span), int(xm - 0.06 * span))
        kl, cl = fit_line(xs.astype(float), bot[xs])
        xs = np.arange(int(xm + 0.06 * span), int(x1 - 0.10 * span))
        kr, cr = fit_line(xs.astype(float), bot[xs])
        xm = (cr - cl) / (kl - kr)
    arm = np.r_[np.arange(int(x0 + 0.12 * span), int(xm - 0.08 * span)), np.arange(int(xm + 0.08 * span), int(x1 - 0.12 * span))]
    th = float(np.percentile(bot[arm] - top[arm], 12))
    n = max(3, int(0.05 * span))                      # the round end caps: radius = half their height
    capl = float(np.max(bot[x0:x0 + n] - top[x0:x0 + n]) + 1) / 2
    capr = float(np.max(bot[x1 - n + 1:x1 + 1] - top[x1 - n + 1:x1 + 1]) + 1) / 2
    # the middle of each end disc (its column of full height), so the two halves' discs land on each other
    xl, xr = int(round(x0 + capl)), int(round(x1 - capr))
    return dict(x0=float(x0), x1=float(x1), xm=float(xm), kl=kl, cl=cl, kr=kr, cr=cr, th=th, capl=capl, capr=capr,
                discl=float(top[xl] + bot[xl] + 1) / 2, discr=float(top[xr] + bot[xr] + 1) / 2)


def warp(piece, m, half, part, th_t, margin):
    """The piece on the true diamond, at SS px per game px, on a canvas whose (0, 0) is (-half-margin, -top) from
    the ring centre. `th_t`: rope thickness wanted in game px (the level's back and front share it)."""
    src = np.asarray(piece.convert("RGBa"), np.float32)          # premultiplied
    sh, sw = src.shape[:2]
    xl, xr, xa = m["x0"] + m["capl"], m["x1"] - m["capr"], m["xm"]   # the end caps' middles sit on the corners
    kxl, kxr = (xa - xl) / half, (xr - xa) / half                 # source px per game px, each arm
    ky = (kxl + kxr) / 2
    sign = -1.0 if part == "B" else 1.0
    top, bottom = -(half // 2 + 80), half // 2 + 31                 # game px from the ring centre
    W, H = int((2 * half + 2 * margin) * SS), int((bottom - top) * SS)
    u = (np.arange(W) + 0.5) / SS - half - margin                 # game x from the centre
    v = (np.arange(H) + 0.5) / SS + top
    uc = np.clip(u, -half, half)
    s = np.where(u < 0, xa + u * kxl, xa + u * kxr)               # source column (runs on past the corners)
    sc = np.where(uc < 0, xa + uc * kxl, xa + uc * kxr)
    under = np.where(uc < 0, m["kl"] * sc + m["cl"], m["kr"] * sc + m["cr"])
    c_src = under - m["th"] / 2                                   # rope centre line in the source
    # the end discs' middles go exactly on the corners: the rope line is bent to them over the outer third of the arm
    dl = m["discl"] - (m["kl"] * xl + m["cl"] - m["th"] / 2)
    dr = m["discr"] - (m["kr"] * xr + m["cr"] - m["th"] / 2)
    fade = np.clip((np.abs(uc) / half - 0.67) / 0.33, 0, 1)
    c_src = c_src + np.where(uc < 0, dl, dr) * fade
    c_ideal = sign * (half - np.abs(uc)) / 2
    ys = c_src[None, :] + (v[:, None] - c_ideal[None, :]) * ky
    xs = np.broadcast_to(s[None, :], ys.shape)
    # bilinear sample
    x0 = np.floor(xs - 0.5).astype(int); y0 = np.floor(ys - 0.5).astype(int)
    fx = (xs - 0.5 - x0)[..., None]; fy = (ys - 0.5 - y0)[..., None]

    def at(yy, xx):
        ok = (yy >= 0) & (yy < sh) & (xx >= 0) & (xx < sw)
        return src[np.clip(yy, 0, sh - 1), np.clip(xx, 0, sw - 1)] * ok[..., None]

    out = (at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy)
           + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy)
    im = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBa")
    return im.resize((W * 2 // SS, H * 2 // SS), Image.LANCZOS).convert("RGBA"), (-half - margin, top)


def with_shadow(im, origin, half, part, th):
    """Bakes a soft contact shadow of the rope (not of the spikes) under the piece. im is 2x; th in game px."""
    a = np.asarray(im.getchannel("A"), np.float32) / 255
    H, W = a.shape
    u = (np.arange(W) + 0.5) / 2 + origin[0]
    v = (np.arange(H) + 0.5) / 2 + origin[1]
    sign = -1.0 if part == "B" else 1.0
    c = sign * (half - np.abs(np.clip(u, -half, half))) / 2
    body = a * (np.abs(v[:, None] - c[None, :]) <= th * 0.75)     # the rope and its straps, no spikes
    sh = Image.fromarray((body * 255).astype(np.uint8))
    dx, dy = round(th * 0.55 * 2), round(th * 0.6 * 2)             # light from the upper left
    moved = Image.new("L", sh.size, 0)
    moved.paste(sh, (dx, dy))
    moved = moved.filter(ImageFilter.GaussianBlur(th * 0.42 * 2)).point(lambda p: round(p * 0.5))
    under = Image.new("RGBA", im.size, (14, 18, 10, 0))
    under.putalpha(moved)
    under.alpha_composite(im)
    return under


def tone(im):
    if TONE["sat"] != 1.0:
        im = artlib.saturate(im, TONE["sat"])
    if TONE["gamma"] != 1.0:
        im = artlib.gamma(im, TONE["gamma"])
    return im


def build(size):
    """{(part, tier): (2x image, x, y from the ring centre in game px)} for one ring size."""
    cuts = {}
    for job, cols, first in JOBS[str(size)]:
        if cols == "nested":
            cuts.update(cut_nested(job))
            continue
        ps = cut(job, cols)
        for n, p in enumerate(ps):
            cuts[("BF"[n // cols], first + n % cols)] = p
    half = HALF[size]
    out = {}
    report = {}
    ms = {k: measure(p) for k, p in cuts.items()}
    scale = {k: (m["x1"] - m["x0"] - m["capl"] - m["capr"]) / (2 * half) for k, m in ms.items()}   # source px per game px
    # one rope for the whole ring size: the median thickness (a tusk row can fool a single piece's measure)
    th_t = float(np.median([ms[k]["th"] / scale[k] for k in ms]))
    for tier in (1, 2, 3, 4):
        for part in "BF":
            m = ms[(part, tier)]
            raw = m["th"] / scale[(part, tier)]
            m["th"] = th_t * scale[(part, tier)]
            im, origin = warp(cuts[(part, tier)], m, half, part, th_t, margin=24)
            im = with_shadow(tone(im), origin, half, part, th_t)
            # crop on whole game px (even 2x px)
            x0, y0, x1, y1 = im.getbbox()
            x0 -= x0 % 2; y0 -= y0 % 2; x1 += x1 % 2; y1 += y1 % 2
            out[(part, tier)] = (im.crop((x0, y0, x1, y1)), origin[0] + x0 // 2, origin[1] + y0 // 2)
            report[f"{part}{tier}"] = dict(src_scale=round((m["x1"] - m["x0"]) / (2 * half), 2), slope_l=round(float(m["kl"]), 3),
                                           slope_r=round(float(m["kr"]), 3), rope_px=round(raw, 1), rope_used=round(th_t, 1))
    return out, report


# ---------- scenes ----------

def lava(w, h, up):
    tiles = [Image.open(B.parent / "yardbg/lava" / f).convert("RGBA") for f in
             ("2169_inferno_lava1_inferno_lava1.png", "2171_inferno_lava2_inferno_lava2.png",
              "2170_inferno_lava3_inferno_lava3.png", "2165_inferno_lava4_inferno_lava4.png")]
    bg = Image.new("RGBA", (w, h), (40, 20, 16, 255))
    for i in range(-6, 8):                       # 200x100 diamonds on the isometric grid, as the yard lays them
        for j in range(-6, 8):
            bg.alpha_composite(tiles[(i * 3 + j * 5) % 4], ((i - j) * 100 + w // 2 - 100, (i + j) * 50 + h // 2 - 50))
    return bg.convert("RGB")


# name: (title, size, group, flash offsets, top, x, y, shadow, x, y, view box 1x (w, h, ox, oy), ground)
SHOW = {
    "townhall": ("Town Hall level 5", 130, "hall", F_HALL, "townhall/top.new5@2x.webp", -67, -64, "townhall/shadow.5.jpg", -67, 33, (310, 270, 155, 112), "grass"),
    "tower": ("Cannon Tower level 4", 70, "tower", F_TOWER, "cannontower/top.t2@2x.webp", -33, -33, "cannontower/shadow.t2.jpg", -31, 17, (190, 170, 95, 72), "grass"),
    "silo": ("Storage Silo", 70, "silo", F_SILO, "storagesilo/top.3d1@2x.webp", -36, -51, "storagesilo/shadow.3d1.jpg", -37, 32, (190, 180, 95, 76), "grass"),
    "underhall": ("Under Hall level 3 (Inferno)", 130, "hall", F_HALL, "itownhall/top.c3@2x.webp", -51, -54, "itownhall/shadow.3.v2.jpg", -74, 35, (310, 270, 155, 112), "lava"),
}


def scene(key, new, tier, up):
    """One fortified building as the yard draws it: shadow, back, building, front. new False = Flash pieces."""
    name, size, group, flash, top, tx, ty, sh, sx, sy, (w, h, ox, oy), ground = SHOW[key]
    bg = lava(w, h, up) if ground == "lava" else Image.new("RGB", (w, h), GRASS)
    bg = multiply(bg, Image.open(B / sh), ox + sx, oy + sy)
    c = bg.resize((w * up, h * up), Image.LANCZOS).convert("RGBA")

    def put(im, x, y, src=1):
        im = im.convert("RGBA")
        if up != src:
            im = resize_pm(im, (im.width * up // src, im.height * up // src))
        c.alpha_composite(im, (round((ox + x) * up), round((oy + y) * up)))

    def part(p):
        if new:
            im, x, y = PIECES[size][(p, tier)]
            put(im, x, y + CENTRE[group], 2)
        else:
            f = flash[tier - 1]
            put(Image.open(B / f"fortifications/fort{size}_{p}{tier}.png"), *(f[2:] if p == "B" else f[:2]))

    if tier:
        part("B")
    put(Image.open(B / top), tx, ty, 2)
    if tier:
        part("F")
    return c.convert("RGB")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    SHEETS.mkdir(exist_ok=True)
    PIECES = {}
    offsets = {}
    for size in (70, 130):
        PIECES[size], rep = build(size)
        print(size, json.dumps(rep))
        for (part, tier), (im, x, y) in PIECES[size].items():
            name = f"fort{size}_{part}{tier}.modern@2x"
            im.save(OUT / f"{name}.png")
            offsets[name] = [x, y, im.width // 2, im.height // 2]
            if "--no-game-files" not in sys.argv:
                im.save(B / f"fortifications/{name}.webp", quality=92, method=6, exact=False)
    (OUT / "offsets.json").write_text(json.dumps(offsets, indent=1))

    ups = {"townhall": 3, "tower": 5, "silo": 5, "underhall": 3}
    for key, up in ups.items():
        rows = []
        for tier in (1, 2, 3, 4):
            a = label(scene(key, False, tier, up), f"Fortify {tier}  TODAY / Classic (Flash art)", fill=(255, 220, 150))
            b = label(scene(key, True, tier, up), f"Fortify {tier}  NEW Modern  A Thorn and Bone")
            rows.append(hstack([a, b]))
        titled(f"Final fortification A on the {SHOW[key][0]} ({up}x)", vstack(rows), 34).save(SHEETS / f"fortA-final-{key}.png")
    # true game size: rows = building, columns = Flash 1-4 then new 1-4
    rows = []
    for key in SHOW:
        cs = [scene(key, new, t, 1) for new in (False, True) for t in (1, 2, 3, 4)]
        rows.append(hstack(cs, 2))
    wide = max(r.width for r in rows)
    titled("True game size: Flash fortify 1-4, then new Modern A fortify 1-4", vstack(rows, 2), 22).save(SHEETS / "fortA-final-gamesize.png")
    # the pieces alone on dark and on grass, 2x files as they are (joins, fringe, sharpness)
    for size in (70, 130):
        cells = []
        for tier in (1, 2, 3, 4):
            for bgc in (GRASS, (30, 30, 34)):
                half = HALF[size]
                w, h = (2 * half + 60) * 2, (half + 190) * 2
                c = Image.new("RGBA", (w, h), bgc + (255,))
                for p in "BF":
                    im, x, y = PIECES[size][(p, tier)]
                    c.alpha_composite(im, (round((x + half + 30) * 2), round((y + half / 2 + 110) * 2)))
                cells.append(label(c.convert("RGB"), f"size {size} fortify {tier} (file size, 2x)", 20))
        g = vstack([hstack(cells[i:i + 2]) for i in range(0, 8, 2)])
        g.save(SHEETS / f"fortA-final-ring-{size}.png")
    print("ok")
