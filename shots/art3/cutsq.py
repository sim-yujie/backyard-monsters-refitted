# Cut framed square icons off a black sheet: find each square by its non-black box, crop, save full and 96x96.
import sys
from PIL import Image
src, prefix, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB"); W, H = im.size
g = im.convert("L").point(lambda v: 255 if v > 22 else 0)
cols = [any(g.getpixel((x, y)) for y in range(0, H, 2)) for x in range(W)]
runs, start = [], None
for x, on in enumerate(cols + [False]):
    if on and start is None: start = x
    if not on and start is not None:
        if x - start > 100: runs.append((start, x))
        start = None
assert len(runs) == n, runs
for i, (x0, x1) in enumerate(runs, 1):
    sub = g.crop((x0, 0, x1, H)); bb = sub.getbbox()
    sq = im.crop((x0, bb[1], x1, bb[3]))
    s = min(sq.size); sq = sq.crop(((sq.size[0] - s) // 2, (sq.size[1] - s) // 2, (sq.size[0] - s) // 2 + s, (sq.size[1] - s) // 2 + s))
    sq.save(f"{prefix}{i}.full.png"); sq.resize((96, 96), Image.LANCZOS).save(f"{prefix}{i}.png")
    print(i, (x0, x1), bb, s)
