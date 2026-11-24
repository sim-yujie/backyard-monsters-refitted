"""Stone toward grey without touching the bronze or gold (no Codex): pixels whose saturation is below LIMIT get
their saturation multiplied by F (soft above it).    python greyen.py <in> <out> <F> [LIMIT=0.32]"""
import colorsys, sys
from PIL import Image
src, dst, f = sys.argv[1], sys.argv[2], float(sys.argv[3]); lim = float(sys.argv[4]) if len(sys.argv) > 4 else 0.32
im = Image.open(src).convert("RGBA"); px = im.load(); w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0: continue
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        t = 1.0 if s < lim else max(0.0, 1 - (s - lim) / 0.1)
        if t == 0: continue
        r2, g2, b2 = colorsys.hsv_to_rgb(hh, s * (1 - (1 - f) * t), v)
        px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
im.save(dst)
