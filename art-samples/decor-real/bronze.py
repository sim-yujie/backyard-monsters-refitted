"""Rizal Monument: Codex painted the bronze a light golden brown; the real figures are dark brown-black bronze (refs/
rizal-monument/). Darkens only the bronze: a mask from the block-out's bronze pixels (the figures and the plaque;
the gold stars and the granite are left alone), widened a few px, applied to the 1024 Codex picture before the cut.
    python bronze.py <codex 1024 png> <block-out 1024 png> <out png> <factor>"""
import colorsys, sys
from PIL import Image, ImageFilter
src, bo, dst, f = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
im = Image.open(src).convert("RGB"); b = Image.open(bo).convert("RGBA").resize(im.size)
m = Image.new("L", im.size, 0); mp = m.load(); bp = b.load(); w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, bb, a = bp[x, y]
        if a < 128: continue
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, bb / 255)
        if v < 0.42 and s > 0.25 and 10 <= hh * 360 <= 60: mp[x, y] = 255
m = m.filter(ImageFilter.MaxFilter(13))
px = im.load()
for y in range(h):
    for x in range(w):
        if not mp[x, y]: continue
        r, g, bb = px[x, y]
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, bb / 255)
        if not (10 <= hh * 360 <= 60) or s < 0.2: continue
        t = min(1.0, (s - 0.2) / 0.1)
        r2, g2, b2 = colorsys.hsv_to_rgb(hh, s * (1 - 0.15 * t), v * (1 - (1 - f) * t))
        px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255))
im.save(dst)
