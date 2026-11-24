"""Magenta-key fringe left next to see-through holes (inside arches, behind the cross): within R px of a transparent
pixel, a pixel whose blue is at least its green and whose red stands clearly above green (a magenta/red-violet
cast; real warm stone, wood and tiles have blue below green) is turned to the grey of its own brightness.
    python fringe.py <file.full.png> ...      (in place; prints the count)"""
import sys
from PIL import Image, ImageFilter
R = 4
for p in sys.argv[1:]:
    im = Image.open(p).convert("RGBA"); w, h = im.size
    a = im.getchannel("A")
    near = a.point(lambda v: 255 if v < 128 else 0).filter(ImageFilter.MaxFilter(2 * R + 1)).load()
    px = im.load(); n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, al = px[x, y]
            if al == 0 or not near[x, y]: continue
            if b >= g and r > g + 15:
                l = int(0.3 * r + 0.59 * g + 0.11 * b); px[x, y] = (l, l, l, al); n += 1
    im.save(p); print(p, n)
