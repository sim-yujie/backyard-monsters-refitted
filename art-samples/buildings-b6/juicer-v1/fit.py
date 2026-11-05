"""fit.py : how well the 3D outline covers the Flash HCC (one look).

    python fit.py <level> [render.png]   -> work/fit-overlay-L<level>.png and the overlap (IoU) printed
The 3D picture is in the Flash frame (fref.FRAME) at K px per Flash px, so the Flash alpha is scaled up to it. Overlay:
the 3D render on grass, the Flash outline in red, the 3D outline in cyan; beside it the miss map (red: Flash only, cyan:
3D only, grey: both).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

import fref

HERE = Path(__file__).resolve().parent
GRASS = (96, 140, 60)


def masks(level, path):
    im = Image.open(path).convert("RGBA")
    k = im.width // (fref.FRAME[2] - fref.FRAME[0])
    fa = fref.flash_rgba().getchannel("A").resize(im.size, Image.BILINEAR)
    f = np.array(fa) > 128
    t = np.array(im.getchannel("A")) > 128
    return im, k, f, t


def edge(m):
    im = Image.fromarray((m * 255).astype(np.uint8))
    return np.array(im.filter(ImageFilter.MaxFilter(5))) > 0 & ~m if False else \
        (np.array(im.filter(ImageFilter.MaxFilter(5))) > 0) & ~(np.array(im.filter(ImageFilter.MinFilter(3))) > 0)


def iou(f, t):
    return (f & t).sum() / max(1, (f | t).sum())


def overlay(level, path, out):
    im, k, f, t = masks(level, path)
    bg = Image.new("RGBA", im.size, GRASS + (255,))
    bg.alpha_composite(im)
    a = np.array(bg.convert("RGB"))
    a[edge(f)] = (255, 30, 30)
    a[edge(t)] = (40, 230, 255)
    miss = np.zeros(a.shape, np.uint8) + np.array(GRASS, np.uint8)
    miss[f & t] = (150, 150, 150)
    miss[f & ~t] = (230, 40, 40)
    miss[t & ~f] = (40, 200, 240)
    fl = Image.new("RGBA", im.size, GRASS + (255,))
    fl.alpha_composite(fref.flash_rgba().resize(im.size, Image.BICUBIC))
    plain = Image.new("RGBA", im.size, GRASS + (255,))
    plain.alpha_composite(im)
    both = np.concatenate([np.array(fl.convert("RGB")), np.array(plain.convert("RGB")), a, miss], 1)
    ys, xs = np.nonzero(f | t)
    pad = 2 * k
    crop = both[max(0, ys.min() - pad):ys.max() + pad, :]
    xs2 = np.nonzero((f | t).any(0))[0]
    x0, x1 = max(0, xs2.min() - pad), xs2.max() + pad
    w = a.shape[1]
    crop = np.concatenate([crop[:, i * w + x0:i * w + x1] for i in range(4)], 1)
    Image.fromarray(crop).save(out)
    return iou(f, t), (f & ~t).sum() / f.sum(), (t & ~f).sum() / f.sum()


if __name__ == "__main__":
    lv = int(sys.argv[1])
    src = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / f"work/fit-L{lv}.png"
    r = overlay(lv, src, HERE / f"work/fit-overlay-L{lv}.png")
    print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
