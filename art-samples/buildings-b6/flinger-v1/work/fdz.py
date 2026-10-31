"""fdz.py look x0 y0 x1 y1 zoom out [render] : Flash look 2/3 (and a 3D render covering PB_FRAME -78,-72,92,90) zoomed, 10 px grid."""
import sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, '.')
import fref
look = int(sys.argv[1]); x0, y0, x1, y1, z = map(int, sys.argv[2:7]); out = sys.argv[7]
FR = (-78, -72, 92, 90)
fnt = ImageFont.truetype("arial.ttf", 12)
r, lv = fref.level_row(); t = lv[look]
fl = Image.new('RGBA', (FR[2] - FR[0], FR[3] - FR[1]), (0, 0, 0, 0))
fl.alpha_composite(Image.open(fref.F.ASSETS / r['folder'] / t[0]).convert('RGBA'), (t[1] - FR[0], t[2] - FR[1]))
def panel(src, k):
    c = src.crop(((x0 - FR[0]) * k, (y0 - FR[1]) * k, (x1 - FR[0]) * k, (y1 - FR[1]) * k)).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
    bg = Image.new('RGBA', c.size, (96, 140, 60, 255)); bg.alpha_composite(c)
    im = bg.convert('RGB'); d = ImageDraw.Draw(im)
    if __import__('os').environ.get('NOGRID'):
        return im
    for x in range(x0 - x0 % 10 + 10, x1, 10):
        d.line([((x - x0) * z, 0), ((x - x0) * z, im.height)], fill=(255, 0, 0) if x else (255, 255, 255)); d.text(((x - x0) * z + 2, 0), str(x), fill=(255, 255, 0), font=fnt)
    for y in range(y0 - y0 % 10 + 10, y1, 10):
        d.line([(0, (y - y0) * z), (im.width, (y - y0) * z)], fill=(255, 0, 0) if y else (255, 255, 255)); d.text((2, (y - y0) * z - 13), str(y), fill=(255, 255, 0), font=fnt)
    return im
ims = [panel(fl, 1)]
if len(sys.argv) > 8:
    rr = Image.open(sys.argv[8]).convert('RGBA'); k = rr.width // (FR[2] - FR[0]); ims.append(panel(rr, k))
o = Image.new('RGB', (sum(i.width for i in ims) + 6 * (len(ims) - 1), ims[0].height), (20, 20, 20))
x = 0
for i in ims:
    o.paste(i, (x, 0)); x += i.width + 6
o.save(out)
