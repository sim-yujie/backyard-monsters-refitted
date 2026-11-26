"""tone.py <@2x png> [factor]: mean value/saturation of the bronze of the mother (left), Rizal and the new right-hand
figure; with a factor, darkens the right-hand figure's bronze in place (only inside <png>-figmask.png from composite.py)."""
import colorsys, sys
from PIL import Image
f = sys.argv[1]; im = Image.open(f).convert("RGBA"); px = im.load()
def isb(r, g, b, a):
    if a < 200: return None
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return (h, s, v) if (s > 0.28 and 15 <= h * 360 <= 50) else None
def stat(x0, x1, y0, y1):
    vs = [isb(*px[x, y]) for x in range(x0, x1) for y in range(y0, y1)]; vs = [v for v in vs if v]
    return len(vs), sum(v[2] for v in vs) / max(1, len(vs)), sum(v[1] for v in vs) / max(1, len(vs))
for n, b in (("mother", (52, 80, 95, 125)), ("rizal", (80, 97, 80, 128)), ("right", (99, 135, 95, 140))):
    print(n, "n=%d V=%.3f S=%.3f" % stat(*b))
if len(sys.argv) > 2:
    k = float(sys.argv[2])
    fm = Image.open(f.replace(".png", "-figmask.png")).load()   # the new figure only (composite.py)
    for y in range(88, 142):
        for x in range(99, 140):
            hsv = isb(*px[x, y]) if fm[x, y] else None
            if hsv:
                r, g, b = colorsys.hsv_to_rgb(hsv[0], hsv[1], hsv[2] * k); px[x, y] = (int(r * 255), int(g * 255), int(b * 255), px[x, y][3])
    im.save(f); print("darkened", k)
