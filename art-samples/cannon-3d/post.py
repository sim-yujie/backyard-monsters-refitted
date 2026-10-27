"""post.py : turn the Blender renders into the sample's pictures (run after cannon3d.py body / barrel / full 7).

  python post.py

Makes, next to this file:
  strip@2x.png + strip.json   the barrel at 32 headings, 2x game size, 188 px square cells with the pivot in the middle of
                              each (the layout of turret/T1/strip@2x.png); cell k shows heading 11.25k
  body-4x.png                 the body without its barrel (copied from render/), 620 x 640, the approved picture's canvas
  barrel-4x/hNN.png           the barrel alone at heading NN on the same canvas (from render/)
  turning-3d-3x.gif           the whole tower turning through the 32 headings, 3x, on the game's grass
  compare-3x.gif              left today's hand-painted turning-T1-3x.gif, right the 3D one, same scale and speed
  still-compare.png           the approved painted tier 1 | the 3D tier 1, at game size and at 3x
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = HERE / "render"
REPO = HERE.parents[1]
PAINTED = Path("D:/Coding/BYMR/worktrees/codex-art/art-samples/redesign/cannon")   # read only
CELL = 188                     # the strip's cell at 2x, as turret/T1/strip.json
UP = 4                         # the renders are at 4x game size


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in ch], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def grass(w, h, seed=3):
    """The yard's grass, tiled from the 200x100 Flash tiles (as the tower kits do)."""
    tiles = [Image.open(p).convert("RGB") for p in sorted((REPO / "server/public/assets/yardbg/grass").glob("*.png"))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g


def main():
    cam = json.loads((R / "camera.json").read_text())
    px, py = cam["pivot_4x"]
    body = Image.open(R / "body-4x.png").convert("RGBA")
    barrels = [Image.open(R / "barrel-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
    shutil.copy(R / "body-4x.png", HERE / "body-4x.png")
    (HERE / "barrel-4x").mkdir(exist_ok=True)
    for k in range(32):
        shutil.copy(R / "barrel-4x" / f"h{k:02d}.png", HERE / "barrel-4x" / f"h{k:02d}.png")

    # the game strip: each heading cropped round the pivot (to the nearest 4x pixel, under 0.25 game px off) and halved
    c4 = CELL * 2
    x0, y0 = round(px - c4 / 2), round(py - c4 / 2)
    strip = Image.new("RGBA", (CELL * 32, CELL), (0, 0, 0, 0))
    for k, b in enumerate(barrels):
        cell = Image.new("RGBA", (c4, c4), (0, 0, 0, 0))
        cell.alpha_composite(b, (-x0, -y0))
        assert b.getbbox() and cell.getbbox(), k
        bb = b.getbbox()
        assert bb[0] >= x0 and bb[1] >= y0 and bb[2] <= x0 + c4 and bb[3] <= y0 + c4, f"heading {k} leaves its cell"
        strip.alpha_composite(resize_pm(cell, (CELL, CELL)), (k * CELL, 0))
    strip.save(HERE / "strip@2x.png", optimize=True)
    (HERE / "strip.json").write_text(json.dumps(dict(
        cells=32, cell_w=CELL, cell_h=CELL, pivot_in_body_4x=[round(px, 2), round(py, 2)], body_4x_size=[body.width, body.height],
        rule="cell k = heading 11.25k (the same 32 headings as turret/T1/strip.json)",
        heading_of_cell=[round(11.25 * k, 2) for k in range(32)],
        note="pivot = middle of each cell; heading = ground bearing in degrees (0 down-right on screen, 45 at the viewer). "
             "Rendered from cannon3d.py: the body's parts that stand in front of the barrel are already cut out of each "
             "cell, so no front layer is needed."), indent=1))

    # the whole tower per heading on the 4x canvas, cropped to what any heading covers
    full = []
    for b in barrels:
        f = body.copy()
        f.alpha_composite(b)
        full.append(f)
    bbs = [f.getbbox() for f in full]
    box = (min(b[0] for b in bbs) - 8, min(b[1] for b in bbs) - 8, max(b[2] for b in bbs) + 8, max(b[3] for b in bbs) + 8)
    sc = 3
    big = [resize_pm(f.crop(box), ((box[2] - box[0]) * sc // UP, (box[3] - box[1]) * sc // UP)) for f in full]
    pad = 10
    bg = grass(big[0].width + 2 * pad, big[0].height + 2 * pad, seed=5).convert("RGBA")
    frames = []
    for im in big:
        f = bg.copy()
        f.alpha_composite(im, (pad, pad))
        frames.append(f.convert("RGB"))
    gif(frames, HERE / "turning-3d-3x.gif")

    # side by side with today's painted turret: both at 3x, bottoms lined up, 90 ms a frame
    old = Image.open(PAINTED / "turret" / "turning-T1-3x.gif")
    oldf = []
    for i in range(old.n_frames):
        old.seek(i)
        oldf.append(old.convert("RGB"))
    W = oldf[0].width + frames[0].width + 6
    H = max(oldf[0].height, frames[0].height) + 34
    font = ImageFont.truetype("arial.ttf", 16)
    cmp_ = []
    for a, b in zip(oldf, frames):
        f = Image.new("RGB", (W, H), (20, 20, 20))
        f.paste(a, (0, H - a.height))
        f.paste(b, (a.width + 6, H - b.height))
        d = ImageDraw.Draw(f)
        d.text((6, 8), "painted (today)", fill=(255, 255, 255), font=font)
        d.text((a.width + 12, 8), "3D model", fill=(255, 255, 255), font=font)
        cmp_.append(f)
    gif(cmp_, HERE / "compare-3x.gif")

    # the still: the approved painting and the 3D tower at its pose (heading 7, muzzle down-left toward the viewer)
    appr = Image.open(PAINTED / "R2A" / "new-4x.png").convert("RGBA")
    mine = full[7]
    sbox = appr.getbbox()
    mb = mine.getbbox()
    sbox = (min(sbox[0], mb[0]) - 12, min(sbox[1], mb[1]) - 12, max(sbox[2], mb[2]) + 12, max(sbox[3], mb[3]) + 12)
    # big pictures first (the 4x renders as they are, the sharpest size), game size below; one short label per panel
    big = [im.crop(sbox) for im in (appr, mine)]
    one = [resize_pm(im, (im.width // UP, im.height // UP)) for im in big]
    wb, hb = big[0].size
    w1, h1 = one[0].size
    lab, gap = 34, 16
    Wd = 2 * wb + 3 * gap
    Hd = lab + hb + gap + lab + h1 + gap
    g = grass(Wd, Hd, seed=7).convert("RGBA")
    d = ImageDraw.Draw(g)
    font = ImageFont.truetype("arialbd.ttf", 20)
    white = (255, 255, 255, 255)
    d.rectangle((0, 0, Wd, lab), fill=(20, 20, 20, 255))
    for i, n in enumerate(("Painted (approved)", "3D model")):
        d.text((gap + i * (wb + gap), 6), n, fill=white, font=font)
    for i, im in enumerate(big):
        g.alpha_composite(im, (gap + i * (wb + gap), lab))
    y = lab + hb + gap
    d.rectangle((0, y, Wd, y + lab), fill=(20, 20, 20, 255))
    d.text((gap, y + 6), "Game size: painted left, 3D right", fill=white, font=font)
    for i, im in enumerate(one):
        g.alpha_composite(im, (gap + i * (wb + gap) + (wb - w1) // 2, y + lab + gap // 2))
    g.convert("RGB").save(HERE / "still-compare.png", optimize=True)
    print("box", box, "gif", frames[0].size, "compare", cmp_[0].size, "still", g.size)


def gif(frames, path):
    q = [f.quantize(colors=255, method=Image.MEDIANCUT, dither=Image.NONE) for f in frames]
    q[0].save(path, save_all=True, append_images=q[1:], duration=90, loop=0, disposal=1)


main()
