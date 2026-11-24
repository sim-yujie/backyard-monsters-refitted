"""Picture enlarged with a coordinate grid (source px) to read edge end points: grid.py <pic> <scale> <out> [x0 y0 x1 y1]"""
import sys
from PIL import Image, ImageDraw
p, sc, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
im = Image.open(p).convert("RGBA")
if len(sys.argv) > 4:
    x0, y0, x1, y1 = map(int, sys.argv[4:8]); im = im.crop((x0, y0, x1, y1))
else: x0 = y0 = 0
bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
big = bg.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS)
d = ImageDraw.Draw(big)
for gx in range((x0 // 10) * 10, x0 + im.width, 10):
    X = (gx - x0) * sc
    d.line([(X, 0), (X, big.height)], fill=(0, 255, 255, 110 if gx % 50 else 220), width=1)
    if gx % 50 == 0: d.text((X + 2, 2), str(gx), fill=(255, 255, 0, 255))
for gy in range((y0 // 10) * 10, y0 + im.height, 10):
    Y = (gy - y0) * sc
    d.line([(0, Y), (big.width, Y)], fill=(0, 255, 255, 110 if gy % 50 else 220), width=1)
    if gy % 50 == 0: d.text((2, Y + 2), str(gy), fill=(255, 255, 0, 255))
big.convert("RGB").save(out)
