"""Shared picture helpers for the Inferno monster kit: numpy + Pillow only (no scipy)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from spec import ASSETS

Image.MAX_IMAGE_PIXELS = None


def flash_sheet(spec):
    return Image.open(ASSETS / spec["flash"]).convert("RGBA")


def flash_cell(spec, col, row=0):
    w, h = spec["cell"]
    return flash_sheet(spec).crop((col * w, row * h, (col + 1) * w, (row + 1) * h))


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


def key_cell(img, min_part=0.03, choose=None):
    """One painted creature on magenta -> tight RGBA cutout (or None).
    Keeps blobs >= min_part of the biggest; `choose(labels, sizes)` may pick the label set instead."""
    rgb = np.asarray(img.convert("RGB"), dtype=float)
    fg = ~magenta(rgb)
    fg = grow(shrink(fg, 2), 2)  # drop specks and noise
    lab, sizes = coarse_labels(fg)
    if sizes.max() == 0:
        return None
    ids = choose(lab, sizes) if choose else [i for i in range(1, len(sizes)) if sizes[i] >= sizes.max() * min_part]
    keep = fill_holes(np.isin(lab, ids))
    keep = shrink(keep, 1)
    core = shrink(keep, 3)
    col = fill_out(rgb, core) if core.any() else rgb
    col = np.where(core[..., None], rgb, col)
    alpha = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)))
    ys, xs = np.nonzero(alpha > 20)
    if len(xs) == 0:
        return None
    out = Image.fromarray(np.dstack([col, alpha]).astype(np.uint8), "RGBA")
    return out.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


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


def flash_body_and_shadow(spec, col):
    """Flash cell -> (body mask, shadow box (x0,y0,x1,y1), shadow alpha) in 1x pixels."""
    a = np.asarray(flash_cell(spec, col)).astype(int)
    body = a[..., 3] > 235
    dark = (a[..., 3] > 0) & (a[..., :3].max(-1) < 90) & ~grow(body, 1)
    sx0, sy0, sx1, sy1 = bbox(dark) if dark.any() else (0, 0, 0, 0)
    return body, (sx0, sy0, sx1, sy1), int(np.median(a[..., 3][dark])) if dark.any() else 0


def flat(im, bg=(86, 92, 74)):
    b = Image.new("RGBA", im.size, bg + (255,))
    b.alpha_composite(im)
    return b.convert("RGB")
