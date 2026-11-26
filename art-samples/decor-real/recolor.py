"""Magellan's Cross colour fixes after the cut (no Codex): Codex painted the roof orange terracotta; the real one is
dark maroon-brown. Roof pixels (warm hue, saturated, above the eave row) turn darker and redder; with --walls the
cream walls and stone turn whiter (the real kiosk is whitewashed).
    python recolor.py <in.full.png> <out.full.png> <eave fraction of height> [--walls]"""
import colorsys, sys
from PIL import Image
src, dst, eave = sys.argv[1], sys.argv[2], float(sys.argv[3]); walls = "--walls" in sys.argv
im = Image.open(src).convert("RGBA"); px = im.load(); w, h = im.size; ey = eave * h
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0: continue
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        deg = hh * 360
        if y < ey and (deg < 40 or deg > 345) and s > 0.3:
            t = min(1.0, (s - 0.3) / 0.15)                      # soft edge into less saturated pixels
            nh = (deg - (deg - 4 if deg < 40 else deg - 364) * 0.75 * t) % 360
            nv = v * (1 - 0.38 * t); ns = s * (1 - 0.15 * t)
            r2, g2, b2 = colorsys.hsv_to_rgb(nh / 360, ns, nv)
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
        elif walls and y >= ey * 0.9 and 20 < deg < 60 and s < 0.35:
            ns = s * 0.45
            r2, g2, b2 = colorsys.hsv_to_rgb(hh, ns, min(1.0, v * 1.04))
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
im.save(dst)
