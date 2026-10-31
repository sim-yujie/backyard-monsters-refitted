"""fit.py : how well the 3D outline covers the Flash Town Hall at one level.

    python fit.py <level> [render.png] [panels] [scale]  -> work/fit-overlay-L<level>.png, overlap (IoU) printed
Panels (default 0123): 0 Flash, 1 3D, 2 both outlines (Flash red, 3D cyan) on the 3D, 3 miss map (red: Flash only,
cyan: 3D only, grey: both). The render covers fref.FRAME at K px per Flash px.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

import fref

HERE = Path(__file__).resolve().parent
GRASS = (96, 140, 60)


def edge(m):
    im = Image.fromarray((m * 255).astype(np.uint8))
    return (np.array(im.filter(ImageFilter.MaxFilter(3))) > 0) & ~(np.array(im.filter(ImageFilter.MinFilter(3))) > 0)


def overlay(level, path, out, panels="0123", scale=1.0):
    im = Image.open(path).convert("RGBA")
    fa = fref.flash_rgba(level).resize(im.size, Image.BILINEAR)
    f = np.array(fa.getchannel("A")) > 128
    t = np.array(im.getchannel("A")) > 128
    def on(x):
        bg = Image.new("RGBA", im.size, GRASS + (255,))
        bg.alpha_composite(x)
        return np.array(bg.convert("RGB"))
    p3 = on(im)
    p2 = p3.copy()
    p2[edge(f)] = (255, 30, 30)
    p2[edge(t)] = (40, 230, 255)
    miss = np.zeros(p3.shape, np.uint8) + np.array(GRASS, np.uint8)
    miss[f & t] = (150, 150, 150)
    miss[f & ~t] = (230, 40, 40)
    miss[t & ~f] = (40, 200, 240)
    pans = {"0": on(fref.flash_rgba(level).resize(im.size, Image.BICUBIC)), "1": p3, "2": p2, "3": miss}
    ys, xs = np.nonzero(f | t)
    pad = 12
    y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad, max(0, xs.min() - pad), xs.max() + pad
    both = np.concatenate([pans[c][y0:y1, x0:x1] for c in panels], 1)
    o = Image.fromarray(both)
    if scale != 1.0:
        o = o.resize((int(o.width * scale), int(o.height * scale)), Image.LANCZOS)
    o.save(out)
    iou = (f & t).sum() / max(1, (f | t).sum())
    return iou, (f & ~t).sum() / f.sum(), (t & ~f).sum() / f.sum()


if __name__ == "__main__":
    lv = int(sys.argv[1])
    src = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "-" else HERE / f"work/fit-L{lv}.png"
    panels = sys.argv[3] if len(sys.argv) > 3 else "0123"
    sc = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    r = overlay(lv, src, HERE / f"work/fit-overlay-L{lv}.png", panels, sc)
    print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
