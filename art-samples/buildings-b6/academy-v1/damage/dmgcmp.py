"""dmgcmp.py <level> <damaged|destroyed> [prev|still] : Flash's look beside the 3D render (render/<..>), on grass,
cropped to the building -> work/dmg-L<level>-<state>.png"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import flashstates as FS  # noqa: E402
import fref  # noqa: E402
from post import GRASS, pair  # noqa: E402

lv, st = int(sys.argv[1]), sys.argv[2]
kind = sys.argv[3] if len(sys.argv) > 3 else "prev"
src = HERE.parent / "render" / (f"prev-L{lv}-{st}.png" if kind == "prev" else f"L{lv}-{st}-base.png")
im = Image.open(src).convert("RGBA")
row = FS.rows()[26]
fl = FS.compose(row, row["levels"][lv - 1], st, fref.FRAME).resize(im.size, Image.BICUBIC)
out = []
for a in (fl, im):
    g = Image.new("RGBA", im.size, GRASS + (255,))
    g.alpha_composite(a)
    out.append(g)
m = (np.array(fl.getchannel("A")) > 20) | (np.array(im.getchannel("A")) > 20)
ys, xs = np.nonzero(m)
p = im.width // 40
box = (max(0, xs.min() - p), max(0, ys.min() - p), min(im.width, xs.max() + p), min(im.height, ys.max() + p))
o = HERE.parent / "work" / f"dmg-L{lv}-{st}.png"
pair([a.crop(box) for a in out], ["Flash", "3D"], f"Monster Academy level {lv} {st}").save(o)
print(o)
