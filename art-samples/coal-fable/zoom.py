"""zoom.py <tier> x0 y0 x1 y1 [frame] : work/zoom-L<tier>.png = Flash beside the 3D fit render, that Flash-px box at
8 px a Flash px, a line every 5 Flash px (labelled every 10) to read positions off."""
import sys
from PIL import Image, ImageDraw
import fref
t = int(sys.argv[1]); x0, y0, x1, y1 = map(int, sys.argv[2:6]); fr = int(sys.argv[6]) if len(sys.argv) > 6 else 0
Z = 8
BG = (96, 60, 50, 255)
def on(im):
    b = Image.new('RGBA', im.size, BG); b.alpha_composite(im); return b.convert('RGB')
box = (x0 - fref.FRAME[0], y0 - fref.FRAME[1], x1 - fref.FRAME[0], y1 - fref.FRAME[1])
fl = on(fref.flash(1 if t == 1 else 2, fr, shadow=False)).crop(box).resize(((x1 - x0) * Z, (y1 - y0) * Z), Image.NEAREST)
fit = Image.open('work/fit-L%d.png' % t).convert('RGBA'); k = fit.width // (fref.FRAME[2] - fref.FRAME[0])
m = on(fit).crop(tuple(v * k for v in box)).resize(fl.size, Image.BICUBIC)
out = Image.new('RGB', (fl.width * 2 + 10, fl.height), (20, 20, 20))
for i, im in enumerate((fl, m)):
    d = ImageDraw.Draw(im)
    for x in range(x0 - x0 % 5 + 5, x1, 5):
        d.line([((x - x0) * Z, 0), ((x - x0) * Z, im.height)], fill=(255, 255, 255) if x % 10 == 0 else (150, 150, 150), width=1)
        if x % 10 == 0: d.text(((x - x0) * Z + 2, 2), str(x), fill=(255, 255, 0))
    for y in range(y0 - y0 % 5 + 5, y1, 5):
        d.line([(0, (y - y0) * Z), (im.width, (y - y0) * Z)], fill=(255, 255, 255) if y % 10 == 0 else (150, 150, 150), width=1)
        if y % 10 == 0: d.text((2, (y - y0) * Z + 2), str(y), fill=(255, 255, 0))
    out.paste(im, (i * (fl.width + 10), 0))
out.save('work/zoom-L%d.png' % t)
