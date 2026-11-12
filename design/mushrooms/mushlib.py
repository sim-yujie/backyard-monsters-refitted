"""Shared helpers for the yard mushroom art (branch art/yard-mushrooms).

A mushroom picture is baked as ONE transparent sprite: the shadow (Flash's multiply-on-white JPEG turned into
black with alpha = 1 - brightness, which looks exactly like a multiply blend) under the mushroom itself, laid out
so the mushroom's foot stands on the picture's anchor point. The anchor is the mushroom's spot in the yard (the
centre of its 30 x 30 footprint).
"""
from PIL import Image
import numpy as np


def shadow_alpha(path, strength=1.0):
    """Flash's white-ground shadow JPEG as a black RGBA picture (alpha = 1 - brightness)."""
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float32) / 255.0
    a = np.clip((1.0 - g) * strength, 0, 1)
    a[a < 0.03] = 0
    out = np.zeros((g.shape[0], g.shape[1], 4), np.uint8)
    out[..., 3] = (a * 255).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def soft_shadow(width, height, dx=0.0):
    """A soft oval contact shadow, black with alpha, for art that has no Flash shadow of its own."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    cx, cy = (width - 1) / 2 + dx, (height - 1) / 2
    d = np.sqrt(((xx - cx) / (width / 2)) ** 2 + ((yy - cy) / (height / 2)) ** 2)
    a = np.clip(1.0 - d, 0, 1) ** 0.8 * 0.62
    out = np.zeros((height, width, 4), np.uint8)
    out[..., 3] = (a * 255).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def dark_core(shadow):
    """Where a shadow is darkest: the centroid of its top quarter of alpha (x, y)."""
    a = np.asarray(shadow)[..., 3].astype(np.float32)
    cut = np.percentile(a[a > 0], 75)
    ys, xs = np.nonzero(a >= cut)
    w = a[ys, xs]
    return float((xs * w).sum() / w.sum()), float((ys * w).sum() / w.sum())


def foot(top):
    """Where a mushroom group stands: the middle of its opaque width, at its lowest opaque row (x, y).

    Centred across the whole group (not under one stalk) so a cluster sits in the middle of its 30 x 30
    ground and the tap box stays even on both sides."""
    a = np.asarray(top)[..., 3]
    ys, xs = np.nonzero(a > 128)
    return float(xs.min() + xs.max() + 1) / 2, float(ys.max())


def bake(top, shadow, top_at, shadow_at, pad=2):
    """One picture: shadow pasted with its point `shadow_at` and top with its point `top_at` both on the anchor.

    Returns (picture, anchor_x, anchor_y) in the picture's pixels."""
    tx, ty = top_at
    sx, sy = shadow_at
    # Each layer's top-left relative to the anchor.
    t0 = (-tx, -ty)
    s0 = (-sx, -sy)
    left = min(t0[0], s0[0]) - pad
    up = min(t0[1], s0[1]) - pad
    right = max(t0[0] + top.width, s0[0] + shadow.width) + pad
    down = max(t0[1] + top.height, s0[1] + shadow.height) + pad
    w, h = int(np.ceil(right - left)), int(np.ceil(down - up))
    # Even size so an @2x file halves cleanly.
    w += w % 2
    h += h % 2
    ax, ay = round(-left), round(-up)
    pic = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pic.alpha_composite(shadow, (round(ax + s0[0]), round(ay + s0[1])))
    pic.alpha_composite(top, (round(ax + t0[0]), round(ay + t0[1])))
    return pic, ax, ay


def base_mask(top, band=3):
    """The pixels where a mushroom meets the ground: in each column, the lowest few opaque pixels, for columns
    reaching into the lowest third of the picture (stalk feet, not cap rims)."""
    a = np.asarray(top)[..., 3] > 128
    h, w = a.shape
    m = np.zeros_like(a)
    for x in range(w):
        ys = np.nonzero(a[:, x])[0]
        if len(ys) and ys.max() >= h * 0.62:
            m[max(0, ys.max() - band):ys.max() + 1, x] = True
    return m


def fit_shadow(top, shadow, search=24):
    """The shadow offset (dx, dy: shadow top-left minus top top-left) that puts its darkest parts under the
    mushroom's feet."""
    m = base_mask(top)
    sa = np.asarray(shadow)[..., 3].astype(np.float32)
    ys, xs = np.nonzero(m)
    best = None
    for dy in range(-search, top.height + 1):
        for dx in range(-search, search + 1):
            sy, sx = ys - dy, xs - dx
            ok = (sy >= 0) & (sy < sa.shape[0]) & (sx >= 0) & (sx < sa.shape[1])
            if ok.sum() < len(ys) * 0.9:
                continue
            score = sa[sy[ok], sx[ok]].sum()
            if best is None or score > best[0]:
                best = (score, dx, dy)
    return best[1], best[2]
