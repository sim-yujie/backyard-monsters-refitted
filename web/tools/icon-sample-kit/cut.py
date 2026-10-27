"""Cut one painted batch (four icons on flat magenta) into transparent icons.

usage: cut.py <batch>
Writes, for each icon name in the batch: art-samples/icons/large/<name>.png (tight crop at the painted size),
<name>.png (256 x 256), <name>-32.png and <name>-24.png.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

from icons import OUT


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark or magenta fringes)."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def fit(im, side, margin):
    """im (tight RGBA crop) scaled to fit side x side minus margin, centred on a clear square."""
    s = (side - 2 * margin) / max(im.size)
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    small = resize_pm(im, (w, h))
    c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    c.alpha_composite(small, ((side - w) // 2, (side - h) // 2))
    return c


def key(rgb):
    """Foreground mask and a despilled RGBA image: magenta ground flood-filled from the edge, magenta holes too."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mag = np.minimum(r, b) - g              # how magenta a pixel is
    ground = (mag > 110) & (r > 170) & (b > 170)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ~np.isin(lab, list(edge))
    fg &= ~(ground & (mag > 180))           # enclosed holes of pure ground (inside an arrow loop, under a flag)
    fg = ndi.binary_opening(fg, iterations=1)
    return fg


def main(batch):
    d = OUT / "batches" / batch
    names = (d / "names.txt").read_text(encoding="utf-8").split(",")
    rgb = np.asarray(Image.open(d / "sheet.png").convert("RGB")).astype(float)
    H, W = rgb.shape[:2]
    fg = key(rgb)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    cents = ndi.center_of_mass(fg, lab, range(1, n + 1))
    quarter = [np.zeros_like(fg) for _ in range(4)]
    for i, (sz, (cy, cx)) in enumerate(zip(sizes, cents)):
        if sz < 40:                         # specks
            continue
        q = (2 if cy >= H / 2 else 0) + (1 if cx >= W / 2 else 0)
        quarter[q] |= lab == i + 1
    for name, m in zip(names, quarter):
        ys, xs = np.nonzero(m)
        if not len(ys):
            print("EMPTY", name)
            continue
        m = ndi.binary_erosion(m, iterations=1)
        alpha = np.asarray(Image.fromarray((m * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.8))).astype(float)
        o = rgb.copy()
        # magenta spill on the rim: pull red and blue back down toward green
        rim = (alpha > 0) & (alpha < 255) | (ndi.binary_dilation(~m, iterations=3) & m)
        spill = np.clip(np.minimum(o[..., 0], o[..., 2]) - o[..., 1], 0, None) * rim
        o[..., 0] -= spill * 0.8
        o[..., 2] -= spill * 0.8
        x0, x1, y0, y1 = xs.min() - 2, xs.max() + 3, ys.min() - 2, ys.max() + 3
        im = Image.fromarray(np.dstack([np.clip(o, 0, 255), alpha]).astype("uint8"), "RGBA").crop((x0, y0, x1, y1))
        (OUT / "large").mkdir(exist_ok=True)
        im.save(OUT / "large" / f"{name}.png")
        fit(im, 256, 6).save(OUT / f"{name}.png")
        for side in (32, 24):
            small = fit(im, side, 1)
            small = Image.merge("RGBA", (*small.convert("RGB").filter(ImageFilter.UnsharpMask(0.6, 60, 2)).split(),
                                         small.getchannel("A")))
            small.save(OUT / f"{name}-{side}.png")
        print("cut", name, im.size)


if __name__ == "__main__":
    main(sys.argv[1])
