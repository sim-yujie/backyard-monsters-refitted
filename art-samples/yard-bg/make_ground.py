"""Codex ground sheet (2 x 2 cells of 768x512) -> four seamless ground layers at the game's sizes.

    python make_ground.py <sheet.png> <out dir> [--inset 16] [--sat 1] [--gamma 1] [--bright 1]
                          [--match 0.5] [--flatten 110]

Each cell: inset crop (drops any bleed between cells), its slow light changes flattened (a vignette or a
light side would repeat as a pattern), tone fixes, then made seamless in two passes (left-right, then
top-bottom: the cell blended with itself rolled by half, so each edge meets the other side's middle), with a
variance-keeping blend so the seam bands do not wash out. Then each layer's mean is pulled part way to the
first layer's (`--match`), so the noise blend in the game shows texture, not blotches.

Writes <out>/layerN@2x.png (800x400, 2 px a world px: one tile is 400x200 world px), layerN@1.5x.png
(600x300) and layerN.png (400x200), plus preview.png.
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter

TILE_W, TILE_H = 400, 200


def flatten(a, sigma):
    """Removes slow light changes: each channel minus its heavy blur plus its mean."""
    if sigma <= 0:
        return a
    from scipy.ndimage import gaussian_filter
    out = np.empty_like(a)
    for c in range(3):
        b = gaussian_filter(a[..., c], sigma, mode="wrap")
        out[..., c] = a[..., c] - b + a[..., c].mean()
    return out


def seam_pass(a, axis, frac=0.22, seed=0):
    n = a.shape[axis]
    rolled = np.roll(a, n // 2, axis=axis)
    idx = np.arange(n, dtype=np.float32)
    d = np.minimum(idx, n - 1 - idx)  # distance to the nearest edge along the axis
    band = n * frac
    m = np.clip(d / band, 0, 1)
    m = m * m * (3 - 2 * m)
    shape = [1, 1, 1]
    shape[axis] = n
    m = m.reshape(shape)
    mean = a.reshape(-1, 3).mean(0)
    w = np.sqrt(m * m + (1 - m) ** 2)
    return mean + ((a - mean) * m + (rolled - mean) * (1 - m)) / w


def tone(a, sat, gamma, bright, hue=0):
    a = np.clip(a, 0, 255) / 255
    if hue:
        hsv = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).convert("HSV")).astype(np.float32)
        hsv[..., 0] = (hsv[..., 0] + hue / 360 * 255) % 256
        a = np.asarray(Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")).astype(np.float32) / 255
    if gamma != 1:
        a = a ** gamma
    if sat != 1:
        g = (a * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
        a = g + (a - g) * sat
    return np.clip(a * bright, 0, 1) * 255


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--inset", type=int, default=16)
    ap.add_argument("--sat", type=float, default=1)
    ap.add_argument("--gamma", type=float, default=1)
    ap.add_argument("--bright", type=float, default=1)
    ap.add_argument("--match", type=float, default=0.5)
    ap.add_argument("--hue", type=float, default=0, help="hue turn in degrees (+ toward yellow from orange)")
    ap.add_argument("--flatten", type=float, default=110)
    ap.add_argument("--order", default="0,1,2,3", help="cells in layer order (0 TL, 1 TR, 2 BL, 3 BR)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sheet = np.asarray(Image.open(a.sheet).convert("RGB")).astype(np.float32)
    H, W = sheet.shape[:2]
    cw, ch = W // 2, H // 2
    cells = []
    for i in range(4):
        x, y = (i % 2) * cw, (i // 2) * ch
        c = sheet[y + a.inset:y + ch - a.inset, x + a.inset:x + cw - a.inset]
        c = flatten(c, a.flatten)
        c = tone(c, a.sat, a.gamma, a.bright, a.hue)
        cells.append(c)
    cells = [cells[int(k)] for k in a.order.split(",")]
    base = cells[0].reshape(-1, 3).mean(0)
    prev = []
    for n, c in enumerate(cells):
        if n:
            c = c + (base - c.reshape(-1, 3).mean(0)) * a.match
        c = seam_pass(c, 1)
        c = seam_pass(c, 0)
        img = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8))
        for suffix, size in (("@2x", (TILE_W * 2, TILE_H * 2)), ("@1.5x", (TILE_W * 3 // 2, TILE_H * 3 // 2)),
                             ("", (TILE_W, TILE_H))):
            img.resize(size, Image.LANCZOS).save(os.path.join(a.out, f"layer{n + 1}{suffix}.png"))
        prev.append(img.resize((TILE_W * 2, TILE_H * 2), Image.LANCZOS))
    # preview: each layer tiled 2 x 2 (seams would show as a cross in the middle)
    p = Image.new("RGB", (TILE_W * 4 * 2, TILE_H * 4 * 2))
    for n, im in enumerate(prev):
        for dx in (0, 1):
            for dy in (0, 1):
                p.paste(im, ((n % 2) * TILE_W * 4 + dx * TILE_W * 2, (n // 2) * TILE_H * 4 + dy * TILE_H * 2))
    p.resize((p.width // 2, p.height // 2), Image.LANCZOS).save(os.path.join(a.out, "preview.png"))
    for n in range(len(cells)):
        im = np.asarray(Image.open(os.path.join(a.out, f"layer{n + 1}.png")).convert("HSV")).astype(float)
        print(f"layer{n + 1}: bright {im[..., 2].mean() / 2.55:.0f}% sat {im[..., 1].mean() / 2.55:.0f}%")


if __name__ == "__main__":
    main()
