"""fcrop.py <level> x0 y0 x1 y1 [zoom] [render] : Flash | 3D (with both outlines) of one area in Flash px, for fitting.
-> work/fcrop-L<level>.png"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import fit
import fref

HERE = Path(__file__).resolve().parent
lv = int(sys.argv[1])
bx0, by0, bx1, by1 = (int(v) for v in sys.argv[2:6])
zoom = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
src = Path(sys.argv[7]) if len(sys.argv) > 7 else HERE / f"work/fit-L{lv}.png"
im, k, f, t = fit.masks(lv, src)
bg = Image.new("RGBA", im.size, fit.GRASS + (255,))
bg.alpha_composite(im)
a = np.array(bg.convert("RGB"))
a[fit.edge(f)] = (255, 30, 30)
a[fit.edge(t)] = (40, 230, 255)
fl = Image.new("RGBA", im.size, fit.GRASS + (255,))
fl.alpha_composite(fref.flash_rgba(lv).resize(im.size, Image.BICUBIC))
fx, fy = fref.FRAME[:2]
box = ((bx0 - fx) * k, (by0 - fy) * k, (bx1 - fx) * k, (by1 - fy) * k)
p1, p2 = fl.convert("RGB").crop(box), Image.fromarray(a).crop(box)
out = Image.new("RGB", (p1.width * 2 + 6, p1.height), (0, 0, 0))
out.paste(p1, (0, 0))
out.paste(p2, (p1.width + 6, 0))
if zoom != 1.0:
    out = out.resize((int(out.width * zoom), int(out.height * zoom)), Image.LANCZOS)
out.save(HERE / f"work/fcrop-L{lv}.png")
print(out.size)
