"""uh_final_lib.py : shared parts of the final Under Hall pass (levels 4-6, direction B): the frame every picture is
worked in, cutting a Codex edit out of its green sheet, lining it up on the level below, and small helpers.
Needs numpy (~/.cache/bymr-art-venv/bin/python)."""
import glob
import random

import numpy as np
from PIL import Image, ImageFilter

from b8lib import B, HERE, REPO, key_green, multiply, resize_pm  # noqa: F401

UH = HERE / "underhall-levels"
FINAL = UH / "final"
WORK = FINAL / "work"
F = B / "itownhall"
# The frame: every still, body and anim cell is worked at 2x game size in one 340x660 box whose pixel (160, 400) is
# the building's origin (the yard's 0,0). Level 3 (top.c3@2x.webp, 234x340, at -51,-54) has its corner at (58, 292).
FW, FH, OX2, OY2 = 340, 660, 160, 400
L3X, L3Y = OX2 - 51 * 2, OY2 - 54 * 2
# Codex jobs: the level below stands 3x enlarged in a 1024x1536 canvas, its corner at (CX, CY) (uh_final_prep.py)
UPB, CX, CY = 3, 161, 410
SHADOW3 = ("shadow.3.v2.jpg", -74, 35)


def frame_of(im2x, x, y):
    """A 2x game picture at 1x offset (x, y) as a frame."""
    f = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    f.alpha_composite(im2x.convert("RGBA"), (OX2 + round(x * 2), OY2 + round(y * 2)))
    return f


def level3():
    return frame_of(Image.open(F / "top.c3@2x.webp"), -51, -54)


def arr(im):
    return np.asarray(im.convert("RGBA")).astype(np.float32) / 255.0


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def sheet_to_big(sheet_rgb, k=1.0, dx=0.0, dy=0.0):
    """A keyed 1024x1536 Codex sheet as the frame at 3x (1020x1980), scaled by k about the foot and shifted (canvas px)."""
    cut = key_green(sheet_rgb).convert("RGBa")
    big = Image.new("RGBa", (FW * UPB, FH * UPB), (0, 0, 0, 0))
    big.paste(cut, (L3X * UPB - CX, L3Y * UPB - CY))
    if k != 1.0 or dx or dy:
        fx, fy = FW * UPB / 2, (L3Y + 340) * UPB      # scale about the middle of the ground line
        # output (x, y) takes input ((x - dx - fx) / k + fx, (y - dy - fy) / k + fy)
        big = big.transform(big.size, Image.AFFINE, (1 / k, 0, fx - (dx + fx) / k, 0, 1 / k, fy - (dy + fy) / k), Image.BICUBIC)
    return big


def big_to_frame(big):
    return big.resize((FW, FH), Image.LANCZOS).convert("RGBA")


def grey(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def register(sheet_rgb, below_frame, rows=None):
    """(k, dx, dy) that lays the sheet on the level below (a frame), by the grey picture inside both shapes; rows =
    (y0, y1) frame rows to compare (default: everything of the level below)."""
    ref = arr(below_frame)
    best = None
    y0, y1 = rows or (0, FH)
    for k in (0.97, 0.98, 0.985, 0.99, 0.995, 1.0, 1.005, 1.01, 1.015, 1.02, 1.03):
        base = sheet_to_big(sheet_rgb, k)
        for dx in range(-9, 10, 3):
            for dy in range(-9, 10, 3):
                sh = base.transform(base.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy)) if dx or dy else base
                a = arr(big_to_frame(sh))
                m = (ref[..., 3] > 0.9) & (a[..., 3] > 0.9)
                m[:y0] = False
                m[y1:] = False
                err = float(np.abs(grey(a) - grey(ref))[m].mean()) + 0.5 * float(np.abs(a[..., 3] - ref[..., 3])[y0:y1].mean())
                if best is None or err < best[0]:
                    best = (err, k, dx, dy)
    return best


def ground(w, h, seed=5):
    """The Inferno yard's lava ground, tiled from Flash's 200x100 lava tiles."""
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(REPO / "server/public/assets/yardbg/lava/*inferno_lava*.png")))]
    rng = random.Random(seed)
    g = Image.new("RGB", (w, h), (60, 30, 24))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(rng.choice(tiles), (x, y))
    return g


def tile_noise(h, w, cells, seed, period_t=None):
    """Smooth value noise in 0..1, tileable in both directions, `cells` lumps across each side (cy, cx)."""
    rng = np.random.default_rng(seed)
    cy, cx = cells
    g = rng.random((cy, cx)).astype(np.float32)
    ys = np.arange(h) / h * cy
    xs = np.arange(w) / w * cx
    y0 = np.floor(ys).astype(int) % cy
    x0 = np.floor(xs).astype(int) % cx
    fy = ys - np.floor(ys)
    fx = xs - np.floor(xs)
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy
    x1 = (x0 + 1) % cx
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx
    b = g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx
    return a * (1 - fy)[:, None] + b * fy[:, None]


def blur(a2d, r):
    im = Image.fromarray((np.clip(a2d, 0, 1) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im).astype(np.float32) / 255.0
