"""Cut a style's Codex paintings (green background) into transparent game UI assets.

usage:
  python cut.py frame <style> <corner_px>   gen/<style>/frame/sample-new.png -> assets/<style>/frame@2x.png (+ frame.json)
  python cut.py kit <style>                 gen/<style>/kit/sample-new.png   -> assets/<style>/<piece>@2x.png (+ kit.json)

frame@2x.png is rebuilt for CSS border-image: the four painted corners (corner_px of the painting each way),
and between them one seamless tile of each edge and of the fill, cut at the same rows/columns so edges and
fill line up. Its period is picked where the painting repeats best (rivets, planks). Saved at half the
painted size: CSS shows it at a quarter (so the file is @2x).
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def key(path):
    """Green screen -> RGBA float array (0..1), with the green spill taken out of the edge pixels."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = g - np.maximum(r, b)
    alpha = 1 - np.clip((d - 0.22) / 0.55, 0, 1)
    alpha[np.maximum(r, b) > 0.45] = 1
    # unmix the key colour (0,1,0) from part-transparent pixels
    k = np.zeros_like(a)
    k[..., 1] = 1
    al = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - (1 - al) * k) / al, 0, 1)
    # despill a 3 px band next to the background
    band = ndimage.binary_dilation(alpha < 0.5, iterations=3) & (alpha > 0)
    gg = rgb[..., 1]
    lim = np.maximum(rgb[..., 0], rgb[..., 2]) + 0.04
    rgb[..., 1] = np.where(band, np.minimum(gg, lim), gg)
    alpha[alpha < 0.04] = 0
    return np.dstack([rgb, alpha])


def to_img(arr):
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def crop_alpha(arr, pad=0):
    ys, xs = np.nonzero(arr[..., 3] > 0.5)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return arr[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]


def best_period(strip, axis, lo, hi, ov):
    """Period E in [lo, hi] where the strip repeats best (compare the first ov px with the ov px after E)."""
    s = np.moveaxis(strip[..., :3] * strip[..., 3:], axis, 0)
    best, be = None, lo
    for e in range(lo, min(hi, s.shape[0] - ov)):
        err = np.mean((s[:ov] - s[e:e + ov]) ** 2)
        if best is None or err < best:
            best, be = err, e
    return be


def seam(seg, e, ov, axis):
    """Tile of length e from seg (length >= e+ov) whose end runs smoothly into its start."""
    seg = np.moveaxis(seg, axis, 0).copy()
    w = np.linspace(0, 1, ov, endpoint=False)[:, None, None]
    tile = seg[:e].copy()
    tile[:ov] = seg[e:e + ov] * (1 - w) + seg[:ov] * w
    return np.moveaxis(tile, 0, axis)


def rebuild(arr, c, axis, ov=48):
    n = arr.shape[axis]
    mid0 = c + (n - 2 * c) // 6
    take = lambda s, e: arr[s:e] if axis == 0 else arr[:, s:e]
    # period from the outer border band (it carries the pattern: rivets, nails, planks)
    probe = take(mid0, n - c)
    band = probe[: c // 2] if axis == 1 else probe[:, : c // 2]
    e = best_period(band, axis, 220, min(520, n - 2 * c - ov - (mid0 - c)), ov)
    tile = seam(take(mid0, mid0 + e + ov), e, ov, axis)
    return np.concatenate([take(0, c), tile, take(n - c, n)], axis=axis), e


def flatten(arr, band):
    """Even out the fill's slow light changes (a lit corner would show as blocks once tiled); keeps the border.
    The slow light is measured over the fill only, so the dark border does not leak into it."""
    inside = ndimage.distance_transform_edt(arr[..., 3] > 0.5)
    m = (inside > band).astype(np.float32)
    w = np.clip((inside - band) / 12, 0, 1)[..., None]
    rgb = arr[..., :3]
    norm = ndimage.gaussian_filter(m, 50) + 1e-4
    low = np.dstack([ndimage.gaussian_filter(rgb[..., i] * m, 50) / norm for i in range(3)])
    ref = np.array([np.median(rgb[..., i][m > 0]) for i in range(3)])
    flat = np.clip(rgb - low + ref, 0, 1)
    arr[..., :3] = rgb * (1 - w) + flat * w
    return arr


BANDS = {"flash": 62, "wood": 92, "scrap": 84, "cardboard": 38}


def frame(style, c):
    arr = crop_alpha(key(f"{M}/gen/{style}/frame/sample-new.png"))
    arr = flatten(arr, BANDS[style])
    arr, ex = rebuild(arr, c, 1)
    arr, ey = rebuild(arr, c, 0)
    out = f"{M}/assets/{style}"
    os.makedirs(out, exist_ok=True)
    img = to_img(arr)
    img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    img.save(f"{out}/frame@2x.png", optimize=True)
    info = {"slice": c // 2, "size": img.size, "tile": [ex // 2, ey // 2]}
    json.dump(info, open(f"{out}/frame.json", "w"))
    print(style, info)


NAMES = [["title"], ["close"], ["button", "button-pressed", "button-small"], ["tab-on", "tab-off", "chip"]]
ORDER = ["title", "close", "button", "button-pressed", "button-small", "tab-on", "tab-off", "chip"]


def kit(style):
    arr = key(f"{M}/gen/{style}/kit/sample-new.png")
    lab, n = ndimage.label(arr[..., 3] > 0.5)
    boxes = [(s[0], s[1], i + 1) for i, s in enumerate(ndimage.find_objects(lab)) if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 3000]
    # rows: group by vertical overlap
    boxes.sort(key=lambda s: (s[0].start + s[0].stop) / 2)
    rows = []
    for s in boxes:
        cy = (s[0].start + s[0].stop) / 2
        if rows and abs(cy - rows[-1][-1][0]) < 90:
            rows[-1].append((cy, s))
        else:
            rows.append([(cy, s)])
    pieces = [s for row in rows for _, s in sorted(row, key=lambda t: t[1][1].start)]
    if len(pieces) != len(ORDER):
        print(style, "found", len(pieces), "pieces:", [(p[0].start, p[1].start, p[0].stop - p[0].start, p[1].stop - p[1].start) for p in pieces])
        sys.exit(1)
    out = f"{M}/assets/{style}"
    os.makedirs(out, exist_ok=True)
    info = {}
    for name, s in zip(ORDER, pieces):
        y0, y1, x0, x1, li = s[0].start, s[0].stop, s[1].start, s[1].stop, s[2]
        sub = arr[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3].copy()
        # keep only this piece (drop bits of neighbours inside the box)
        m = lab[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3]
        own = ndimage.binary_dilation(m == li, iterations=3)
        sub[..., 3] *= own
        img = to_img(sub)
        img.save(f"{out}/{name}@2x.png", optimize=True)
        info[name] = img.size
    json.dump(info, open(f"{out}/kit.json", "w"))
    print(style, info)


if __name__ == "__main__":
    if sys.argv[1] == "frame":
        frame(sys.argv[2], int(sys.argv[3]))
    else:
        kit(sys.argv[2])
