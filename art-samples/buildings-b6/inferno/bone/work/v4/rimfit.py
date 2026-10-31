"""rimfit.py : fit an axis-aligned ellipse to the teal rim pixels of Flash and 3D (look 1, and look 3) and print
width, height, ratio in Flash px. Usage: python rimfit.py [ymax_render_L1] [ymax_L3]"""
import sys; from pathlib import Path
import numpy as np; from PIL import Image
sys.path.insert(0, '.')
import ipost
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
YMAX = {1: 800, 3: 900}
def fit(mk):
    ys, xs = np.nonzero(mk); x = xs.astype(float); y = ys.astype(float)
    M = np.stack([x*x, y*y, x, y], 1); p, *_ = np.linalg.lstsq(M, np.ones_like(x), rcond=None)
    A, C, D, E = p; cx, cy = -D/(2*A), -E/(2*C); k = 1 + A*cx*cx + C*cy*cy
    a, b = np.sqrt(k/A), np.sqrt(k/C); return cx, cy, a, b
for lv in (1, 3):
    m = ipost.on_ground(ipost.frame3d(lv, 0)).convert('RGB')
    f = ipost.flash(lv, 0, m.size).convert('RGB')
    for nm, im in (('flash', f), ('3d', m)):
        a = np.asarray(im).astype(float); r, g, b = a[..., 0], a[..., 1], a[..., 2]
        mk = (g > r + 14) & (b > r) & (g > 80)
        mk[YMAX[lv]:] = False
        # keep the largest blob roughly: drop small specks by requiring neighbours
        from scipy import ndimage
        lab, n = ndimage.label(ndimage.binary_closing(mk, iterations=3))
        sizes = ndimage.sum(mk, lab, range(1, n + 1)); keep = np.argsort(sizes)[::-1][:6] + 1
        mk2 = np.isin(lab, keep[sizes[keep - 1] > 2000]) & mk
        cx, cy, A, B = fit(mk2)
        print(f"L{lv} {nm:5s} centre ({cx/12:6.1f},{cy/12:6.1f}) Fpx  width {2*A/12:5.1f}  height {2*B/12:5.1f}  ratio {B/A:.3f}  px {mk2.sum()}")
        from PIL import ImageDraw
        if lv == 1:
            im2 = im.copy(); d = ImageDraw.Draw(im2)
            for t in (0, 1, 2): d.ellipse([cx-A-t, cy-B-t, cx+A+t, cy+B+t], outline=(255, 0, 0))
            im2.crop((150, 350, 1150, 950)).resize((500, 300)).save(f'bone/work/v4/fit-L{lv}-{nm}.png')
