"""cmp.py <tier> [frame] : work/cmp-L<tier>.png = Flash | 3D fit render | 3D with Flash's outline, at 4 px a Flash px."""
import sys
import numpy as np
from PIL import Image, ImageFilter
import fref
t = int(sys.argv[1]); fr = int(sys.argv[2]) if len(sys.argv) > 2 else 0
look = 1 if t == 1 else 2
BG = (96, 60, 50, 255)
fit = Image.open('work/fit-L%d.png' % t).convert('RGBA')
k = fit.width // (fref.FRAME[2] - fref.FRAME[0])
fl = fref.flash(look, fr, shadow=False)
flb = fl.resize(fit.size, Image.NEAREST)
def on(im):
    b = Image.new('RGBA', im.size, BG); b.alpha_composite(im); return b
# Flash's outline (alpha edge) and strong inner edges, drawn green over the 3D
a = np.array(flb)[..., 3] > 128
edge = a ^ np.array(Image.fromarray(a).filter(ImageFilter.MinFilter(3)))
g = np.array(flb.convert('L').filter(ImageFilter.FIND_EDGES)) > 70
ov = np.array(on(fit))
ov[edge] = (0, 255, 0, 255)
ov2 = np.array(on(flb))
a3 = np.array(fit)[..., 3] > 128
e3 = a3 ^ np.array(Image.fromarray(a3).filter(ImageFilter.MinFilter(3)))
ov2[e3] = (0, 255, 255, 255)
W, H = fit.size
out = Image.new('RGB', (W * 4 + 30, H), (30, 30, 30))
for i, im in enumerate((on(flb), on(fit), Image.fromarray(ov), Image.fromarray(ov2))):
    out.paste(im.convert('RGB'), (i * (W + 10), 0))
out.save('work/cmp-L%d.png' % t)
ys, xs = np.nonzero(a); y3, x3 = np.nonzero(a3)
f = lambda v: v / k
print('flash box x %.1f..%.1f y %.1f..%.1f' % (f(xs.min()) + fref.FRAME[0], f(xs.max()) + fref.FRAME[0], f(ys.min()) + fref.FRAME[1], f(ys.max()) + fref.FRAME[1]))
print('3D    box x %.1f..%.1f y %.1f..%.1f' % (f(x3.min()) + fref.FRAME[0], f(x3.max()) + fref.FRAME[0], f(y3.min()) + fref.FRAME[1], f(y3.max()) + fref.FRAME[1]))
