"""mean brightness (V), mean saturation, darkest-5% brightness of opaque pixels: stats.py pics..."""
import sys, colorsys
from PIL import Image
for p in sys.argv[1:]:
    im = Image.open(p).convert("RGBA"); im.thumbnail((300, 300))
    px = [(r, g, b) for r, g, b, a in im.getdata() if a > 200]
    hsv = [colorsys.rgb_to_hsv(r / 255, g / 255, b / 255) for r, g, b in px]
    v = sorted(h[2] for h in hsv)
    print(f"{p.split('/')[-1]:40s} V {sum(v)/len(v)*100:4.0f}%  S {sum(h[1] for h in hsv)/len(hsv)*100:4.0f}%  dark5 {v[len(v)//20]*100:3.0f}%")
