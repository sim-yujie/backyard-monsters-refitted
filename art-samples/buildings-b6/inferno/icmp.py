"""icmp.py <dir> <look> out.png [x,y,w,h] [scale] [grid] : Flash beside the 3D still, the same area of each, with an
optional grid every <grid> render px on both (to read where each part sits). Prints the output path."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import ipost

ipost.D = Path(sys.argv[1]).resolve()
ipost.C = ipost.load(ipost.D)
lv = int(sys.argv[2])
out = Path(sys.argv[3])
m = ipost.on_ground(ipost.frame3d(lv, 0)).convert("RGB")
f = ipost.flash(lv, 0, m.size).convert("RGB")
x, y, w, h = (int(v) for v in sys.argv[4].split(",")) if len(sys.argv) > 4 else (0, 0) + m.size
s = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
grid = int(sys.argv[6]) if len(sys.argv) > 6 else 0
pics = []
for im in (f, m):
    im = im.copy()
    if grid:
        d = ImageDraw.Draw(im)
        for gx in range(0, im.width, grid):
            d.line([(gx, 0), (gx, im.height)], (255, 255, 0), 1)
        for gy in range(0, im.height, grid):
            d.line([(0, gy), (im.width, gy)], (255, 255, 0), 1)
    im = im.crop((x, y, x + w, y + h))
    pics.append(im.resize((int(w * s), int(h * s)), Image.LANCZOS))
pic = Image.new("RGB", (pics[0].width * 2 + 6, pics[0].height), (255, 255, 255))
pic.paste(pics[0], (0, 0))
pic.paste(pics[1], (pics[0].width + 6, 0))
pic.save(out)
print(out)
