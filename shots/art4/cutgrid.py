# Cut framed square icons off a black sheet laid out as a grid: find the non-black boxes by row and column runs.
# usage: cutgrid.py sheet.png outdir name1,name2,...   (names in reading order; "-" skips one)
import sys, os
from PIL import Image
src, outdir, names = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
os.makedirs(outdir, exist_ok=True)
im = Image.open(src).convert("RGB"); W, H = im.size
g = im.convert("L").point(lambda v: 255 if v > 12 else 0)
def runs(flags, minlen=150):
    out, start = [], None
    for i, on in enumerate(flags + [False]):
        if on and start is None: start = i
        if not on and start is not None:
            if i - start > minlen: out.append((start, i))
            start = None
    return out
rows = runs([g.crop((0, y, W, y + 1)).getbbox() is not None for y in range(H)])
boxes = []
for y0, y1 in rows:
    band = g.crop((0, y0, W, y1))
    cols = runs([band.crop((x, 0, x + 1, y1 - y0)).getbbox() is not None for x in range(W)])
    for x0, x1 in cols: boxes.append((x0, y0, x1, y1))
print(len(boxes), boxes)
for name, (x0, y0, x1, y1) in zip(names, boxes):
    if name == "-": continue
    w, h = x1 - x0, y1 - y0
    assert abs(w - h) <= 8, (name, w, h)
    s = min(w, h); cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    sq = im.crop((cx - s // 2, cy - s // 2, cx - s // 2 + s, cy - s // 2 + s))
    sq.save(f"{outdir}/{name}.full.png")
    print(name, s)
