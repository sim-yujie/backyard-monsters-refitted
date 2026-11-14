"""cmp.py <tier> [frame] : work/cmp-L<tier>.png = Flash | 3D fit render | 3D with Flash's outline (green) | Flash with
the 3D's outline (cyan), at the fit render's scale. PIL only (this PC's Python has no numpy, and PIL's NEAREST resize
is broken here: BOX is the same thing for whole-number enlargements)."""
import sys
from PIL import Image, ImageChops, ImageFilter
import fref
t = int(sys.argv[1]); fr = int(sys.argv[2]) if len(sys.argv) > 2 else 0
look = 1 if t == 1 else 2
BG = (96, 60, 50, 255)
fit = Image.open('work/fit-L%d.png' % t).convert('RGBA')
k = fit.width // (fref.FRAME[2] - fref.FRAME[0])
flb = fref.flash(look, fr, shadow=False).resize(fit.size, Image.BOX)
def on(im):
    b = Image.new('RGBA', im.size, BG); b.alpha_composite(im); return b
def edge(im):
    a = im.getchannel('A').point(lambda v: 255 if v > 128 else 0)
    return a, ImageChops.difference(a, a.filter(ImageFilter.MinFilter(3)))
aF, eF = edge(flb); a3, e3 = edge(fit)
ov = on(fit); ov.paste((0, 255, 0, 255), mask=eF)
ov2 = on(flb); ov2.paste((0, 255, 255, 255), mask=e3)
W, H = fit.size
out = Image.new('RGB', (W * 4 + 30, H), (30, 30, 30))
for i, im in enumerate((on(flb), on(fit), ov, ov2)):
    out.paste(im.convert('RGB'), (i * (W + 10), 0))
out.save('work/cmp-L%d.png' % t)
for n, a in (('flash', aF), ('3D   ', a3)):
    b = a.getbbox()
    print('%s box x %.1f..%.1f y %.1f..%.1f' % (n, b[0] / k + fref.FRAME[0], b[2] / k + fref.FRAME[0], b[1] / k + fref.FRAME[1], b[3] / k + fref.FRAME[1]))
