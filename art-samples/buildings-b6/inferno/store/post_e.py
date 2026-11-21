"""post_e.py : the finished look E's loop cells and pictures, from all.sh's renders (e/render, 12 px per Flash px).

    ~/.cache/bymr-art-venv/bin/python post_e.py cells     e/render/L1-cell-00..31.png: the loop, whole scenes
    ~/.cache/bymr-art-venv/bin/python post_e.py mp4       shots/istore-e/e-loop.mp4 (three times round, 10 a second)
    ~/.cache/bymr-art-venv/bin/python post_e.py sheets    shots/istore-e/*.png

The loop: only light moves. The pips' lava swells and fades once a loop, the magma in the die's cracks twice, both
subtle; nothing else changes (the letters and the flame on the cover hold still, and so does everything the glow does
not light by at least GLOW levels). Its 32 cells are mixed from three
renders of the standing store, all with the same noise seed: every glow low (L1-lo-base.png), the pips high
(L1-pip-base.png), the cracks high (L1-crk-base.png):   cell = lo + a (pip - lo) + b (crk - lo)
with a = (1 + sin t) / 2 and b = (1 + sin 2t) / 2, so cell 0 has both half way, as the still. Light adds, so the mix is
what a render at those strengths would give (up to the display curve, which is small over so slight a change).
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
R = HERE / "e" / "render"
OUT = ROOT / "shots" / "istore-e"
ART = ROOT / "server/public/assets/buildings"
N = 32
GLOW = 6                     # levels of 255 a glow must change a pixel by for it to count as lit
BG = (74, 42, 36)            # the Inferno yard's ground, as round 2's pictures
ORIGIN, FRAME = (3.0, 33.5), (-56, -60)


def load(p):
    a = np.asarray(Image.open(p).convert("RGBA")).astype("float32") / 255
    a[..., :3] *= a[..., 3:]
    return a


def unpre(a):
    al = np.clip(a[..., 3:], 0, 1)
    rgb = np.where(al > 0, a[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), al]) * 255 + 0.5).astype("uint8"), "RGBA")


def weights(k):
    t = 2 * np.pi * k / N
    return (1 + np.sin(t)) / 2, (1 + np.sin(2 * t)) / 2


def cells():
    lo, pip, crk = (load(R / f"L1-{n}-base.png") for n in ("lo", "pip", "crk"))
    dp, dc = pip - lo, crk - lo
    # Only the lit places move: where a glow changes the picture by more than GLOW (the pips, the cracks and the stone
    # right beside them), grown a little and feathered; everywhere else, and on the ground, every cell is the half-way
    # picture exactly. (The glow also throws a faint light, a level or two of 255, over the whole body and the ground:
    # left in, the game's strip would have to hold the whole building in every cell.)
    alone = np.asarray(Image.open(R / "L1-alone.png").getchannel("A")) > 128
    lit = (np.maximum(np.abs(dp), np.abs(dc)).max(axis=2) > GLOW / 255) & alone
    lit = ndimage.binary_dilation(lit, iterations=10)
    w = np.clip(ndimage.gaussian_filter(lit.astype("float32"), 5) * 1.2, 0, 1)
    w[w < 0.02] = 0
    w = w[..., None]
    mid = lo + 0.5 * dp + 0.5 * dc
    for k in range(N):
        a, b = weights(k)
        unpre(mid + w * ((a - 0.5) * dp + (b - 0.5) * dc)).save(R / f"L1-cell-{k:02d}.png")
    ys, xs = np.nonzero(w[..., 0] > 0)
    print("cells", N, "moving box", xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, "of", lo.shape[1], lo.shape[0])


def on_ground(im, scale=None, crop=None):
    """A render (with its ground shadow) on the Inferno's ground colour, scaled, cut to crop (in the scaled picture)."""
    if scale:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    s = Image.new("RGBA", im.size, BG + (255,))
    s.alpha_composite(im)
    return (s.crop(crop) if crop else s).convert("RGB")


def label(im, text, size=26):
    ImageDraw.Draw(im).text((14, 10), text, fill=(255, 236, 200), font_size=size)
    return im


def row(ims, gap=0):
    h = max(i.height for i in ims)
    s = Image.new("RGB", (sum(i.width for i in ims) + gap * (len(ims) - 1), h), BG)
    x = 0
    for i in ims:
        s.paste(i, (x, h - i.height))
        x += i.width + gap
    return s


def mp4():
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="istore-e-"))
    for k in range(N):
        im = on_ground(Image.open(R / f"L1-cell-{k:02d}.png").convert("RGBA"), 0.5)
        im = im.crop((0, 0, im.width // 2 * 2, im.height // 2 * 2))
        for rep in range(3):
            im.save(tmp / f"{rep * N + k:03d}.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "10", "-i", str(tmp / "%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", str(OUT / "e-loop.mp4")], check=True)
    print(OUT / "e-loop.mp4")


def game_pic(name):
    return Image.open(ART / "generalstore" / name).convert("RGBA")


def sheets():
    OUT.mkdir(parents=True, exist_ok=True)
    full = {}
    for st, name in (("", "E  standing"), ("-damaged", "E  damaged"), ("-destroyed", "E  destroyed")):
        base = Image.open(R / f"L1{st}-base.png").convert("RGBA")
        full[st] = base
        label(on_ground(base, 0.5), name).save(OUT / f"e{st or '-standing'}-detail.png")        # 6 px per Flash px
    row([label(on_ground(full[st], 1 / 3), n) for st, n in
         (("", "standing"), ("-damaged", "damaged"), ("-destroyed", "destroyed"))]).save(OUT / "e-states.png")
    # with and without the words
    plain = HERE / "e-plain" / "render" / "L1-base.png"
    if plain.exists():
        row([label(on_ground(full[""], 0.5), "E  with MATCH BOOK (as built into the game)"),
             label(on_ground(Image.open(plain).convert("RGBA"), 0.5), "E  without the words (STORE_LETTERS=0)")]
            ).save(OUT / "e-letters-vs-plain.png")
    # the two faults, before (round 2's picture, shots/e-detail.png, 6 px per Flash px on a 30 px margin) and after
    old = ROOT / "shots" / "e-detail.png"
    if old.exists():
        o = Image.open(old).convert("RGB")
        n = on_ground(full[""], 0.5)
        ox, oy = (o.width - n.width) // 2, (o.height - n.height) // 2      # round 2's margin
        for tag, (x0, y0, x1, y1) in (("horns", (250, 20, 590, 290)), ("left-seat", (300, 150, 480, 260))):
            a = o.crop((x0 + ox, y0 + oy, x1 + ox, y1 + oy))
            b = n.crop((x0, y0, x1, y1))
            z = 2 if tag == "horns" else 4
            a, b = (i.resize((i.width * z, i.height * z), Image.LANCZOS) for i in (a, b))
            row([label(a, "before (round 2)"), label(b, "after")], gap=8).save(OUT / f"fix-{tag}-before-after.png")
    # surface Store | E | the live Inferno store today: the game's own @2x pictures, each set on the game's ground
    # point (so they stand as they do in the yard), 4 px per Flash px
    looks = (("Surface General Store", "top.3d1@2x.webp", (-42, -38)), ("E  Bone and Brimstone", "top.i3d1@2x.webp", None),
             ("Live Inferno store today", "top.ishop3C@2x.webp", (-52, -52)))
    tiles = []
    for name, file, at in looks:
        if not (ART / "generalstore" / file).exists():
            continue
        if at is None:
            at = OFFSETS.get(file)
        im = game_pic(file)
        t = Image.new("RGBA", (150 * 4, 150 * 4), BG + (255,))
        big = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        t.alpha_composite(big, ((75 + at[0]) * 4, (95 + at[1]) * 4))
        tiles.append(label(t.convert("RGB"), name))
    if len(tiles) == 3:
        row(tiles).save(OUT / "compare-surface-e-live.png")
    print(OUT)


OFFSETS = {}        # the exported E's game offsets (top.i3d1@2x.webp), given on the command line: sheets <x> <y>

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "sheets" and len(sys.argv) > 3:
        OFFSETS["top.i3d1@2x.webp"] = (int(sys.argv[2]), int(sys.argv[3]))
    {"cells": cells, "mp4": mp4, "sheets": sheets}[mode]()
