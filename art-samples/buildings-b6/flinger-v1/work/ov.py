"""ov.py x0 y0 x1 y1 zoom out render : Flash | 3D | overlay (Flash red, 3D cyan) zoomed, with a 10 px grid."""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps
sys.path.insert(0, '.')
import fref
x0, y0, x1, y1, z = map(int, sys.argv[1:6]); out = sys.argv[6]
fx, fy = fref.FRAME[:2]
fnt = ImageFont.truetype("arial.ttf", 12)
def crop(src, k):
    c = src.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS if k > 1 else Image.NEAREST)
    bg = Image.new('RGBA', c.size, (96, 140, 60, 255)); bg.alpha_composite(c)
    return bg.convert('RGB')
def grid(im):
    d = ImageDraw.Draw(im)
    for x in range(x0 - x0 % 10 + 10, x1, 10):
        d.line([((x - x0) * z, 0), ((x - x0) * z, im.height)], fill=(255, 255, 0)); d.text(((x - x0) * z + 2, 0), str(x), fill=(255, 255, 0), font=fnt)
    for y in range(y0 - y0 % 10 + 10, y1, 10):
        d.line([(0, (y - y0) * z), (im.width, (y - y0) * z)], fill=(255, 255, 0)); d.text((2, (y - y0) * z - 13), str(y), fill=(255, 255, 0), font=fnt)
    return im
r = Image.open(sys.argv[7]).convert('RGBA'); k = r.width // (fref.FRAME[2] - fref.FRAME[0])
a = crop(fref.flash_rgba(), 1); b = crop(r, k)
ga, gb = ImageOps.grayscale(a), ImageOps.grayscale(b)
o3 = Image.merge('RGB', (ga, gb, gb))
ims = [grid(a), grid(b), grid(o3)]
o = Image.new('RGB', (sum(i.width for i in ims) + 12, ims[0].height), (20, 20, 20))
x = 0
for i in ims:
    o.paste(i, (x, 0)); x += i.width + 6
o.save(out)
