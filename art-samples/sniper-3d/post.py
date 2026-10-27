"""post.py : turn the Blender renders (render/tN/) into the sample's pieces and pictures (run after renderall.sh).

  python post.py

Makes, next to this file:
  tN/body@2x.png            the body without its turret, @2x, on the painted body.tN@2x canvas (same pivot), so the
                            game's body entry for tier N works unchanged
  tN/turret@2x.png          the turret at 32 headings, @2x, one row of cells, cell k = heading 11.25k (as the painted strip)
  tN/strip.json             cell size, the pivot in each cell, and the strip entry for buildingArtTiers.ts
  tN/body-4x.png, tN/turret-4x/hNN.png   the raw 4x renders
  tiers-compare.png         tiers 1-3: painted above, 3D below (3x game size), game size in a strip under them
  tiers-turning-3x.gif      the three 3D tiers turning together through the 32 headings, 3x
  compare-turning-3x.gif    painted (above) and 3D (below) turning, all three tiers, 3x
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PA = Path("D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/snipertower")   # read only
# the painted pieces (buildingArtTiers.ts, Sniper): body (x, y), strip (x, y, w, h), pivot y, in game px
GAME = {1: dict(body=(-40, -37), strip=(-27, -53, 53, 36), pivot=-20, top=(-40, -45)),
        2: dict(body=(-40, -70), strip=(-26, -83, 52, 35), pivot=-50, top=(-40, -75)),
        3: dict(body=(-40, -86), strip=(-27, -99, 53, 35), pivot=-67, top=(-40, -92))}
T_PIV4 = (160, 210)        # the turret renders' pivot (sniper3d.py turret: 320 x 300 canvas)
GIFBG = (92, 136, 60, 255)  # flat grass green for the GIFs (the grass texture makes them too big)
REST = 0                   # the heading of the still pictures (gun down-right, as the painted tops)


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in ch], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def grass(w, h, seed=3):
    tiles = [Image.open(p).convert("RGB") for p in sorted((REPO / "server/public/assets/yardbg/grass").glob("*.png"))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g


def gif(frames, path, ms=90, colors=160):
    """One palette for every frame (made from every 4th frame side by side): smaller files and no colour flicker."""
    w, h = frames[0].size
    some = frames[::4]
    m = Image.new("RGB", (w * len(some), h))
    for i, f in enumerate(some):
        m.paste(f, (i * w, 0))
    pal = m.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0, disposal=1, optimize=True)


class Tier:
    """One tier's pieces, painted and 3D, at @2x, placed in game px (x, y of each piece's top-left from the origin)."""

    def __init__(self, t):
        self.t = t
        g = GAME[t]
        R = HERE / "render" / f"t{t}"
        out = HERE / f"t{t}"
        (out / "turret-4x").mkdir(parents=True, exist_ok=True)
        shutil.copy(R / "body-4x.png", out / "body-4x.png")
        for k in range(32):
            shutil.copy(R / "turret-4x" / f"h{k:02d}.png", out / "turret-4x" / f"h{k:02d}.png")
        body4 = Image.open(R / "body-4x.png").convert("RGBA")
        self.body = resize_pm(body4, (body4.width // 2, body4.height // 2))
        self.body.save(out / "body@2x.png", optimize=True)
        tur4 = [Image.open(R / "turret-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
        # the cell: what any heading covers, round the pivot, in whole @2x px (even 4x px)
        bbs = [im.getbbox() for im in tur4]
        px, py = T_PIV4
        l = max(px - min(b[0] for b in bbs), max(b[2] for b in bbs) - px) + 4
        u, d = py - min(b[1] for b in bbs) + 4, max(b[3] for b in bbs) - py + 4
        l, u, d = (v + v % 2 for v in (l, u, d))
        box = (px - l, py - u, px + l, py + d)
        cw, ch = (box[2] - box[0]) // 2, (box[3] - box[1]) // 2
        self.cells = [resize_pm(im.crop(box), (cw, ch)) for im in tur4]
        self.cpiv = (l // 2, u // 2)
        strip = Image.new("RGBA", (cw * 32, ch))
        for k, c in enumerate(self.cells):
            strip.alpha_composite(c, (k * cw, 0))
        strip.save(out / "turret@2x.png", optimize=True)
        # game px: each @2x cell is (cw/2 x ch/2); its pivot sits on the painted pivot (0, g["pivot"])
        sx, sy = -self.cpiv[0] / 2, g["pivot"] - self.cpiv[1] / 2
        (out / "strip.json").write_text(json.dumps(dict(
            tier=t, cells=32, cell_w_2x=cw, cell_h_2x=ch, pivot_in_cell_2x=list(self.cpiv),
            body_entry=[f"body.t{t}@2x.png", *g["body"]],
            strip_entry=[f"turret.t{t}@2x.png", sx, sy, cw / 2, ch / 2, 32],
            pivot=[0, g["pivot"]],
            rule="cell k = heading 11.25k (0 down-right on screen, 45 at the viewer), as the painted strip",
            note="body@2x.png is on the painted body.t%d@2x.webp canvas with the pivot on the same pixel; the turret "
                 "cells are bigger than the painted 53 x 36 because the 3D gun reaches further down when it points at "
                 "the viewer. Nothing of the body stands in front of the turret, so no front layer." % t), indent=1))
        # painted pieces
        self.pbody = Image.open(PA / f"body.t{t}@2x.webp").convert("RGBA")
        ps = Image.open(PA / f"turret.t{t}@2x.webp").convert("RGBA")
        pw = ps.width // 32
        self.pcells = [ps.crop((k * pw, 0, (k + 1) * pw, ps.height)) for k in range(32)]
        self.ppiv = (-2 * g["strip"][0], 2 * (g["pivot"] - g["strip"][1]))

    def frame(self, k, painted=False):
        """The whole tower at heading k, @2x, on a canvas from game x -48..48, y -112..+60 (origin at (96, 224))."""
        g = GAME[self.t]
        f = Image.new("RGBA", (192, 344))
        ox, oy = 96, 224
        body = self.pbody if painted else self.body
        f.alpha_composite(body, (ox + 2 * g["body"][0], oy + 2 * g["body"][1]))
        cell, cp = (self.pcells[k], self.ppiv) if painted else (self.cells[k], self.cpiv)
        f.alpha_composite(cell, (ox - cp[0], oy + 2 * g["pivot"] - cp[1]))
        return f


def main():
    tiers = [Tier(t) for t in (1, 2, 3)]
    # common crop over all tiers, headings, painted and 3D
    boxes = []
    for T in tiers:
        for k in range(0, 32, 2):
            boxes += [T.frame(k).getbbox(), T.frame(k, True).getbbox()]
    crop = (min(b[0] for b in boxes) - 6, min(b[1] for b in boxes) - 6, max(b[2] for b in boxes) + 6, max(b[3] for b in boxes) + 6)
    cw, chh = crop[2] - crop[0], crop[3] - crop[1]
    font = ImageFont.truetype("arialbd.ttf", 22)
    small = ImageFont.truetype("arialbd.ttf", 16)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)

    # ---- tiers-compare.png: painted above, 3D below, 3x game size (1.5x the @2x art); game size strip under
    S = 1.5
    bw, bh = int(cw * S), int(chh * S)
    gap, lab = 20, 34
    W = 3 * bw + 4 * gap
    one_h = chh // 2
    H = lab + 2 * bh + gap + lab + one_h + gap
    g = grass(W, H, seed=7).convert("RGBA")
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, W, lab), fill=dark)
    for i, T in enumerate(tiers):
        x = gap + i * (bw + gap)
        d.text((x, 6), f"Tier {T.t}", fill=white, font=font)
        for j, painted in enumerate((True, False)):
            im = resize_pm(T.frame(REST, painted).crop(crop), (bw, bh))
            g.alpha_composite(im, (x, lab + j * bh))
        d.text((x + 4, lab + 4), "painted", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((x + 4, lab + bh + 4), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
    y = lab + 2 * bh + gap
    d.rectangle((0, y, W, y + lab), fill=dark)
    d.text((gap, y + 6), "Game size (painted | 3D)", fill=white, font=font)
    for i, T in enumerate(tiers):
        x = gap + i * (bw + gap)
        for j, painted in enumerate((True, False)):
            im = T.frame(REST, painted).crop(crop)
            im = resize_pm(im, (cw // 2, chh // 2))
            g.alpha_composite(im, (x + bw // 2 - cw // 2 - 4 + j * (cw // 2 + 8), y + lab + gap // 2))
    g.convert("RGB").save(HERE / "tiers-compare.png", optimize=True)

    # ---- tiers-turning-3x.gif: the three 3D tiers, 3x game size
    pad = 8
    W2 = 3 * bw + 2 * pad
    bg = Image.new("RGBA", (W2 + 2 * pad, bh + 2 * pad), GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            f.alpha_composite(resize_pm(T.frame(k).crop(crop), (bw, bh)), (pad + i * (bw + pad), pad))
        frames.append(f.convert("RGB"))
    gif(frames, HERE / "tiers-turning-3x.gif")

    # ---- compare-turning-3x.gif: painted row above, 3D row below
    lab2 = 26
    bg = Image.new("RGBA", (W2 + 2 * pad, 2 * bh + 3 * pad), GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            for j, painted in enumerate((True, False)):
                f.alpha_composite(resize_pm(T.frame(k, painted).crop(crop), (bw, bh)), (pad + i * (bw + pad), pad + j * (bh + pad)))
        d = ImageDraw.Draw(f)
        d.text((pad + 4, pad + 2), "painted", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((pad + 4, 2 * pad + bh + 2), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        frames.append(f.convert("RGB"))
    gif(frames, HERE / "compare-turning-3x.gif")
    for n in ("tiers-turning-3x.gif", "compare-turning-3x.gif", "tiers-compare.png"):
        print(n, round((HERE / n).stat().st_size / 1e6, 2), "MB")
    print("crop", crop, "cells", [(T.cells[0].size, T.cpiv) for T in tiers])


main()
