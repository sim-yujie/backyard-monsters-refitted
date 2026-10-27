"""post.py : turn laser3d.py's renders into the game pieces and the owner's pictures (run after `laser3d.py T all` and
`laser3d.py T cells54` for T = 1, 2, 3).

  python post.py

Makes, next to this file:
  tT/body-4x.png              the tower without its head, 400 x 640, anchor (game 0,0) at (200, 400)
  tT/body@2x.png              the same at 2x game size, cropped to the painted body picture's box (136 px wide)
  tT/strip32@2x.png + .json   the head at 32 headings (cell k = ground bearing 11.25k), square cells, pivot in the middle
  tT/strip54@2x.png + .json   the head in the game's laser strip layout (54 cells by screen angle, as turret.tT@2x.webp)
  tiers-compare.png           tiers 1-3: painted above, 3D below, 3x; game size underneath
  tiers-turning-3x.gif        the three 3D tiers turning together through the 32 headings, 3x
  compare-turning-3x.gif      painted (above) and 3D (below) turning through the game's 54 laser cells, 3x
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = HERE / "render"
REPO = HERE.parents[1]
P = Path("D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/lasertower")   # read only
AX, AY = 200, 400              # the anchor on the 4x canvas
UP = 4
# the painted tiers (buildingArtTiers.ts): top/body picture position and turret strip rect, game px from the anchor
TOP = {1: (-33, -48), 2: (-33, -73), 3: (-33, -89)}
BODY = {1: (-33, -29), 2: (-33, -54), 3: (-33, -71)}
STRIP = {1: (-15, -55, 34, 37), 2: (-14, -78, 33, 35), 3: (-14, -96, 32, 37)}
STILL_CELL = 53               # the strip cell the painted stills (top.tT) show: lens to the right, a little toward us
CELL32 = 140                   # strip32's square cell at 2x (70 game px), the pivot in its middle


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in ch], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def scale(im, k):
    return resize_pm(im, (round(im.width * k), round(im.height * k)))


def grass(w, h, seed=3):
    """The yard's grass, tiled from the 200x100 Flash tiles (as the tower kits do)."""
    tiles = [Image.open(p).convert("RGB") for p in sorted((REPO / "server/public/assets/yardbg/grass").glob("*.png"))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g.convert("RGBA")


def on4x(im2x, pos):
    """A 2x painted picture placed on the 4x canvas at game position pos."""
    c = Image.new("RGBA", (400, 640))
    c.alpha_composite(scale(im2x, 2), (AX + UP * pos[0], AY + UP * pos[1]))
    return c


def union_box(ims, pad=8):
    bbs = [im.getbbox() for im in ims]
    return (min(b[0] for b in bbs) - pad, min(b[1] for b in bbs) - pad, max(b[2] for b in bbs) + pad,
            max(b[3] for b in bbs) + pad)


def gif(frames, path, ms=90, bg=None):
    """One palette for all frames, so the still grass keeps the same pixels and the GIF only stores what moves: 48
    colours for the grass (bg), the rest for whatever differs from it in a sample of frames (the towers)."""
    rgb = [f.convert("RGB") for f in frames]
    if bg is None:
        bg = rgb[0]
    b = np.asarray(bg.convert("RGB"))
    fg = [np.asarray(f)[np.any(np.asarray(f) != b, -1)] for f in rgb[::max(1, len(rgb) // 12)]]
    fg = np.concatenate(fg)
    side = int(np.ceil(np.sqrt(len(fg))))
    fg = np.concatenate([fg, np.repeat(fg[:1], side * side - len(fg), 0)]).reshape(side, side, 3)
    pa = bg.convert("RGB").quantize(colors=48, method=Image.MEDIANCUT, dither=Image.NONE).getpalette()[:48 * 3]
    pb = Image.fromarray(fg).quantize(colors=207, method=Image.MEDIANCUT, dither=Image.NONE).getpalette()[:207 * 3]
    pal = Image.new("P", (1, 1))
    pal.putpalette(pa + pb + [0, 0, 0] * (256 - 255))
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in rgb]
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0, disposal=1, optimize=True)
    return path.stat().st_size


def painted_cells(t):
    s = Image.open(P / f"turret.t{t}@2x.webp").convert("RGBA")
    cw = s.width // 54
    return [s.crop((i * cw, 0, (i + 1) * cw, s.height)) for i in range(54)]


def tier_pieces(t):
    src = R / f"t{t}"
    out = HERE / f"t{t}"
    out.mkdir(exist_ok=True)
    cam = json.loads((src / "camera.json").read_text())
    px, py = cam["pivot_4x"]
    body = Image.open(src / "body-4x.png").convert("RGBA")
    heads = [Image.open(src / "head-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
    cells = [Image.open(src / "cell54-4x" / f"c{i:02d}.png").convert("RGBA") for i in range(54)]
    shutil.copy(src / "body-4x.png", out / "body-4x.png")
    bx, by = BODY[t]
    pb = Image.open(P / f"body.t{t}@2x.webp")
    b2 = scale(body, 0.5)
    b2.crop((AX // 2 + 2 * bx, AY // 2 + 2 * by, AX // 2 + 2 * bx + pb.width, AY // 2 + 2 * by + pb.height)).save(
        out / "body@2x.png", optimize=True)
    # strip32: square cells round the pivot (to the nearest 4x pixel)
    c4 = CELL32 * 2
    x0, y0 = round(px - c4 / 2), round(py - c4 / 2)
    strip = Image.new("RGBA", (CELL32 * 32, CELL32))
    for k, hd in enumerate(heads):
        bb = hd.getbbox()
        assert bb[0] >= x0 and bb[1] >= y0 and bb[2] <= x0 + c4 and bb[3] <= y0 + c4, f"t{t} heading {k} leaves its cell"
        cell = Image.new("RGBA", (c4, c4))
        cell.alpha_composite(hd, (-x0, -y0))
        strip.alpha_composite(resize_pm(cell, (CELL32, CELL32)), (k * CELL32, 0))
    strip.save(out / "strip32@2x.png", optimize=True)
    (out / "strip32.json").write_text(json.dumps(dict(
        cells=32, cell_w=CELL32, cell_h=CELL32, pivot_4x=[round(px, 2), round(py, 2)], anchor_4x=[AX, AY],
        cell_origin_game_px=[(x0 - AX) / UP, (y0 - AY) / UP],
        rule="cell k = ground bearing 11.25k (0 = down-right on screen, 45 = at the viewer); pivot in each cell's middle",
        note="body parts standing in front of the head are already cut out of each cell, so no front layer is needed"),
        indent=1))
    # strip54: the game's laser layout; the cell rect grows past the painted one only if the 3D head needs it
    x, y, w, h = STRIP[t]
    r = [AX + UP * x, AY + UP * y, AX + UP * (x + w), AY + UP * (y + h)]
    for c in cells:
        bb = c.getbbox()
        r = [min(r[0], bb[0] // 4 * 4), min(r[1], bb[1] // 4 * 4), max(r[2], -(-bb[2] // 4) * 4),
             max(r[3], -(-bb[3] // 4) * 4)]
    cw, ch = (r[2] - r[0]) // 2, (r[3] - r[1]) // 2
    s54 = Image.new("RGBA", (cw * 54, ch))
    for i, c in enumerate(cells):
        s54.alpha_composite(resize_pm(c.crop(r), (cw, ch)), (i * cw, 0))
    s54.save(out / "strip54@2x.png", optimize=True)
    rect = [(r[0] - AX) / UP, (r[1] - AY) / UP, (r[2] - r[0]) / UP, (r[3] - r[1]) / UP]
    (out / "strip54.json").write_text(json.dumps(dict(
        cells=54, cell_w=cw, cell_h=ch, rect_game_px=rect, painted_rect_game_px=list(STRIP[t]),
        rule="cell i shows the beam's screen angle 25 + 6.66 i degrees (0 = right, 90 = down), as turret.tT@2x.webp"),
        indent=1))
    return dict(body=body, heads=heads, cells=cells, rect=rect)


def label_bar(g, y, h, texts, xs, font):
    d = ImageDraw.Draw(g)
    d.rectangle((0, y, g.width, y + h), fill=(20, 20, 20, 255))
    for tx, x in zip(texts, xs):
        d.text((x, y + 6), tx, fill=(255, 255, 255, 255), font=font)


def main():
    font = ImageFont.truetype("arialbd.ttf", 22)
    small = ImageFont.truetype("arialbd.ttf", 18)
    T = {t: tier_pieces(t) for t in (1, 2, 3)}
    pcs = {t: painted_cells(t) for t in (1, 2, 3)}

    # frames on the 4x canvas: painted (body + strip cell) and 3D (body + head), per tier
    def painted_frame(t, i):
        f = on4x(Image.open(P / f"body.t{t}@2x.webp").convert("RGBA"), BODY[t])
        f.alpha_composite(on4x(pcs[t][i], STRIP[t][:2]))
        return f

    def mine(t, im):
        f = T[t]["body"].copy()
        f.alpha_composite(im)
        return f

    # ---- tiers-compare.png: the painted still above, the 3D tower at the same strip cell below, 3x; game size below
    paint = {t: on4x(Image.open(P / f"top.t{t}@2x.webp").convert("RGBA"), TOP[t]) for t in (1, 2, 3)}
    three = {t: mine(t, T[t]["cells"][STILL_CELL]) for t in (1, 2, 3)}
    box = union_box([paint[t] for t in (1, 2, 3)] + [three[t] for t in (1, 2, 3)], pad=10)
    big = {t: [scale(im.crop(box), 0.75) for im in (paint[t], three[t])] for t in (1, 2, 3)}
    one = {t: [scale(im.crop(box), 0.25) for im in (paint[t], three[t])] for t in (1, 2, 3)}
    wb, hb = big[1][0].size
    w1, h1 = one[1][0].size
    gap, lab = 18, 36
    Wd = 3 * wb + 4 * gap
    Hd = lab + hb + 8 + hb + gap + lab + h1 + 2 * gap
    g = grass(Wd, Hd, seed=7)
    xs = [gap + i * (wb + gap) for i in range(3)]
    label_bar(g, 0, lab, ["Tier 1", "Tier 2", "Tier 3"], [x + 6 for x in xs], font)
    d = ImageDraw.Draw(g)
    for i, t in enumerate((1, 2, 3)):
        g.alpha_composite(big[t][0], (xs[i], lab))
        g.alpha_composite(big[t][1], (xs[i], lab + hb + 8))
    for y0, tx in ((lab, "painted"), (lab + hb + 8, "3D")):
        d.rectangle((0, y0, 74, y0 + 30), fill=(20, 20, 20, 200))
        d.text((8, y0 + 4), tx, fill=(255, 255, 255, 255), font=small)
    y = lab + hb + 8 + hb + gap
    label_bar(g, y, lab, ["Game size: painted | 3D"], [gap], font)
    for i, t in enumerate((1, 2, 3)):
        cx = xs[i] + wb // 2
        g.alpha_composite(one[t][0], (cx - w1 - 6, y + lab + gap))
        g.alpha_composite(one[t][1], (cx + 6, y + lab + gap))
    g.convert("RGB").save(HERE / "tiers-compare.png", optimize=True)

    # ---- tiers-turning-3x.gif: the three 3D tiers turning together, 32 headings, 3x
    fr = {t: [mine(t, hd) for hd in T[t]["heads"]] for t in (1, 2, 3)}
    box = union_box([f for t in (1, 2, 3) for f in fr[t]], pad=8)
    sm = {t: [scale(f.crop(box), 0.75) for f in fr[t]] for t in (1, 2, 3)}
    w, h = sm[1][0].size
    gap = 10
    bg = grass(3 * w + 4 * gap, h + 2 * gap + lab, seed=5)
    label_bar(bg, 0, lab, ["Tier 1", "Tier 2", "Tier 3"], [gap + i * (w + gap) + 6 for i in range(3)], font)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, t in enumerate((1, 2, 3)):
            f.alpha_composite(sm[t][k], (gap + i * (w + gap), lab + gap))
        frames.append(f)
    n1 = gif(frames, HERE / "tiers-turning-3x.gif", bg=bg)

    # ---- compare-turning-3x.gif: painted above, 3D below, the game's 54 laser cells, 3x
    pf = {t: [painted_frame(t, i) for i in range(54)] for t in (1, 2, 3)}
    mf = {t: [mine(t, c) for c in T[t]["cells"]] for t in (1, 2, 3)}
    box = union_box([f for t in (1, 2, 3) for f in pf[t] + mf[t]], pad=8)
    ps = {t: [scale(f.crop(box), 0.75) for f in pf[t]] for t in (1, 2, 3)}
    ms = {t: [scale(f.crop(box), 0.75) for f in mf[t]] for t in (1, 2, 3)}
    w, h = ps[1][0].size
    bg = grass(3 * w + 4 * gap, lab + 2 * h + 3 * gap, seed=9)
    label_bar(bg, 0, lab, ["Tier 1", "Tier 2", "Tier 3"], [gap + i * (w + gap) + 6 for i in range(3)], font)
    d = ImageDraw.Draw(bg)
    frames = []
    for k in range(54):
        f = bg.copy()
        for i, t in enumerate((1, 2, 3)):
            f.alpha_composite(ps[t][k], (gap + i * (w + gap), lab + gap))
            f.alpha_composite(ms[t][k], (gap + i * (w + gap), lab + 2 * gap + h))
        d = ImageDraw.Draw(f)
        for y0, tx in ((lab + gap, "painted"), (lab + 2 * gap + h, "3D")):
            d.rectangle((0, y0, 74, y0 + 30), fill=(20, 20, 20, 255))
            d.text((8, y0 + 4), tx, fill=(255, 255, 255, 255), font=small)
        frames.append(f)
    n2 = gif(frames, HERE / "compare-turning-3x.gif", ms=70, bg=bg)
    print("tiers-compare", g.size, "tiers-turning", n1, "compare-turning", n2,
          {t: T[t]["rect"] for t in (1, 2, 3)})


main()
