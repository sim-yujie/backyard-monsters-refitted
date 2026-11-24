"""Rizal Monument: Codex painted the bronze a light golden brown; the real figures are dark brown-black bronze (refs/
rizal-monument/). Warm saturated pixels below the stars turn darker (no Codex).   python bronze.py <in> <out> <factor>"""
import colorsys, sys
from PIL import Image
src, dst, f = sys.argv[1], sys.argv[2], float(sys.argv[3])
im = Image.open(src).convert("RGBA"); px = im.load(); w, h = im.size
for y in range(int(0.2 * h), h):                # the stars sit in the top fifth: they stay gold
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0: continue
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if not (15 <= hh * 360 <= 55) or s < 0.3: continue
        t = min(1.0, (s - 0.3) / 0.1)
        r2, g2, b2 = colorsys.hsv_to_rgb(hh, s * (1 - 0.15 * t), v * (1 - (1 - f) * t))
        px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
im.save(dst)
