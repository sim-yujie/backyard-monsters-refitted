"""steel.py x0 y0 x1 y1 zoom out render : mask of grey (steel) pixels, Flash red / 3D cyan, overlaid, 10 px grid."""
import sys
from PIL import Image, ImageDraw, ImageFont
import numpy as np
sys.path.insert(0, '.')
import fref
x0, y0, x1, y1, z = map(int, sys.argv[1:6]); out = sys.argv[6]
fx, fy = fref.FRAME[:2]
def mask(src, k):
    c = src.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize((x1 - x0, y1 - y0), Image.BOX)
    a = np.asarray(c).astype(float)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    return (al > 128) & (mx - mn < 28) & (mx > 95) & (b >= r - 6)
r = Image.open(sys.argv[7]).convert('RGBA'); k = r.width // (fref.FRAME[2] - fref.FRAME[0])
mf, m3 = mask(fref.flash_rgba(), 1), mask(r, k)
o = np.zeros(mf.shape + (3,), np.uint8)
o[mf] = (255, 60, 60); o[m3] = (60, 220, 255); o[mf & m3] = (255, 255, 255)
im = Image.fromarray(o).resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST)
d = ImageDraw.Draw(im); fnt = ImageFont.truetype("arial.ttf", 12)
for x in range(x0 - x0 % 10 + 10, x1, 10):
    d.line([((x - x0) * z, 0), ((x - x0) * z, im.height)], fill=(90, 90, 0)); d.text(((x - x0) * z + 2, 0), str(x), fill=(255, 255, 0), font=fnt)
for y in range(y0 - y0 % 10 + 10, y1, 10):
    d.line([(0, (y - y0) * z), (im.width, (y - y0) * z)], fill=(90, 90, 0)); d.text((2, (y - y0) * z - 13), str(y), fill=(255, 255, 0), font=fnt)
im.save(out)
