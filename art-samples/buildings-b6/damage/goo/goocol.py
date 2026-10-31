"""goocol.py <level> : green-pixel percentiles (sorted by G) of Flash and of work/fit-L<level>.png in the goo area."""
import sys
from PIL import Image
import fref
lv = int(sys.argv[1])
box = {1: (-22, -14, 18, 8), 3: (-20, -20, 18, 6), 6: (-20, -20, 18, 6), 10: (-20, -20, 18, 6)}[lv]
x0, y0, x1, y1 = fref.FRAME
fit = Image.open(f"work/fit-L{lv}.png").convert("RGBA")
fit = fit.resize((x1 - x0, y1 - y0), Image.BOX)
for name, im in (("flash", fref.flash_rgba(lv)), ("3d", fit)):
    px = []
    for x in range(box[0], box[2]):
        for y in range(box[1], box[3]):
            r, g, b, a = im.getpixel((x - x0, y - y0))
            if a > 200 and g > r + 10 and g > b + 10:
                px.append((r, g, b))
    px.sort(key=lambda c: c[1])
    n = len(px)
    print(name, n, [px[int(n * q)] for q in (0.05, 0.2, 0.4, 0.6, 0.8, 0.95)])
