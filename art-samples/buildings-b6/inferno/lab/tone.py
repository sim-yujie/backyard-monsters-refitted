"""tone.py <picture>... : each picture's tone over its solid pixels (alpha > 230): mean brightness, the 10th and 90th
percentile, mean saturation and the share of bright pixels (> 0.7). For checking a new Inferno building is as dark and
worn as its neighbours (the owner found round 1 too clean and bright), by number."""
import sys
from PIL import Image

for p in sys.argv[1:]:
    im = Image.open(p).convert("RGBA")
    px = [q for q in im.getdata() if q[3] > 230]
    lum = sorted((0.299 * r + 0.587 * g + 0.114 * b) / 255 for r, g, b, _ in px)
    sat = sum((max(q[:3]) - min(q[:3])) / max(1, max(q[:3])) for q in px) / len(px)
    n = len(lum)
    print("%-46s brightness %.3f (10%%: %.3f, 90%%: %.3f)  saturation %.3f  bright pixels %.1f%%" % (
        p[-46:], sum(lum) / n, lum[n // 10], lum[9 * n // 10], sat, 100 * sum(v > 0.7 for v in lum) / n))
