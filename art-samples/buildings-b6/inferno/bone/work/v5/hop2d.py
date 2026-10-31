"""hop2d.py : quick 2D check of the level 3 hopper's rest pose: its boxes projected with the game camera (kit.scr) as
outlines over Flash's frame 0 at 10x. Run from inferno/:  python bone/work/v5/hop2d.py out.png"""
import math, sys
from PIL import Image, ImageDraw
import iref
ORIGIN = (2.0, 38.0)
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * 0.5, 10 * math.cos(math.radians(30))
BOX = (-20, -48, 46, 10)
K = 10


def scr(v):
    return (ORIGIN[0] + SX * (v[0] + v[1]), ORIGIN[1] + SY * (v[0] - v[1]) - SZ * v[2])


P = dict(piv=(0.9, 1.0, 6.2), tip=34.0, yaw=0.0, x0=-1.95, x1=1.9, yb=0.75, yf=-0.75, zt=0.95, zl=-1.5, zr=-0.6,
         door=2.3)
for a in sys.argv[2:]:
    k, v = a.split('=')
    P[k] = eval(v)


def world(p):
    x, y, z = p
    t = math.radians(P['tip'])
    y, z = y * math.cos(t) - z * math.sin(t), y * math.sin(t) + z * math.cos(t)
    w = math.radians(P['yaw'])
    x, y = x * math.cos(w) - y * math.sin(w), x * math.sin(w) + y * math.cos(w)
    px, py, pz = P['piv']
    return (px + x, py + y, pz + z)


def poly(d, pts, col, wd=2):
    s = [((scr(world(p))[0] - BOX[0]) * K, (scr(world(p))[1] - BOX[1]) * K) for p in pts]
    d.line(s + [s[0]], fill=col, width=wd)


im = iref.flash_rgba(1, 3, 0, BOX)
big = Image.new('RGBA', (im.width * K, im.height * K), (62, 44, 38, 255))
big.alpha_composite(im.resize(big.size, Image.NEAREST))
d = ImageDraw.Draw(big)
x0, x1, yb, yf, zt = P['x0'], P['x1'], P['yb'], P['yf'], P['zt']
zl, zr = P['zl'], P['zr']
# lid top face and its front edge
poly(d, [(x0, yb, zt), (x1, yb, zt), (x1, yf, zt), (x0, yf, zt)], (0, 255, 255))
poly(d, [(x0, yf, zt), (x1, yf, zt), (x1, yf, zt - 0.3), (x0, yf, zt - 0.3)], (0, 160, 255))
# body front: deep at the left (the mouth), shallow at the right
yb2 = yf + 0.15
poly(d, [(x0 + 0.1, yb2, zt - 0.3), (x1 - 0.1, yb2, zt - 0.3), (x1 - 0.1, yb2, zr), (x0 + 0.1, yb2, zl)], (255, 255, 0))
xd = x0 + P['door']
poly(d, [(x0 + 0.1, yb2 - 0.02, zt - 0.3), (xd, yb2 - 0.02, zt - 0.3), (xd, yb2 - 0.02, zl + (zr - zl) * (xd - x0) / (x1 - x0)),
         (x0 + 0.1, yb2 - 0.02, zl)], (255, 0, 255))
# right end
poly(d, [(x1 - 0.1, yb2, zt - 0.3), (x1 - 0.1, yb, zt - 0.3), (x1 - 0.1, yb, zr), (x1 - 0.1, yb2, zr)], (0, 255, 0))
c = scr(world((0, 0, 0)))
d.ellipse(((c[0] - BOX[0]) * K - 6, (c[1] - BOX[1]) * K - 6, (c[0] - BOX[0]) * K + 6, (c[1] - BOX[1]) * K + 6), fill=(255, 0, 0))
c = scr((3.05, 2.1, 6.55))
d.ellipse(((c[0] - BOX[0]) * K - 6, (c[1] - BOX[1]) * K - 6, (c[0] - BOX[0]) * K + 6, (c[1] - BOX[1]) * K + 6), fill=(0, 255, 0))
for v in (0.0, 1.0):     # the rim's front/back at x=0
    pass
big.convert('RGB').save(sys.argv[1])
print({k: P[k] for k in P})
