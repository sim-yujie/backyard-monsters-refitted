"""zf.py x0 y0 x1 y1 zoom out [render] : Flash (and 3D) zoomed, nearest, with a 5 px grid tick + labels every 10."""
import sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, '.')
import fref
x0, y0, x1, y1, z = map(int, sys.argv[1:6]); out = sys.argv[6]
fx, fy = fref.FRAME[:2]
fnt = ImageFont.truetype("arial.ttf", 12)
def panel(src, k):
    c = src.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS if k > 1 else Image.NEAREST)
    bg = Image.new('RGBA', c.size, (96, 140, 60, 255)); bg.alpha_composite(c)
    im = bg.convert('RGB'); d = ImageDraw.Draw(im)
    for x in range(x0 - x0 % 10 + 10, x1, 10):
        d.line([((x - x0) * z, 0), ((x - x0) * z, 8)], fill=(255, 0, 0)); d.text(((x - x0) * z + 2, 0), str(x), fill=(255, 255, 0), font=fnt)
    for y in range(y0 - y0 % 10 + 10, y1, 10):
        d.line([(0, (y - y0) * z), (8, (y - y0) * z)], fill=(255, 0, 0)); d.text((10, (y - y0) * z - 7), str(y), fill=(255, 255, 0), font=fnt)
    return im
ims = [panel(fref.flash_rgba(), 1)]
if len(sys.argv) > 7:
    r = Image.open(sys.argv[7]).convert('RGBA'); k = r.width // (fref.FRAME[2] - fref.FRAME[0]); ims.append(panel(r, k))
W = sum(i.width for i in ims) + 6 * (len(ims) - 1)
o = Image.new('RGB', (W, ims[0].height), (20, 20, 20))
x = 0
for i in ims:
    o.paste(i, (x, 0)); x += i.width + 6
o.save(out)
