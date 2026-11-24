"""Contact sheet: pictures side by side on grey, each scaled by its own factor.  sheet.py out.png scale path...
"""
import sys
from PIL import Image
out = sys.argv[1]; sc = float(sys.argv[2]); ps = sys.argv[3:]
ims = []
for p in ps:
    im = Image.open(p).convert("RGBA")
    f = sc * (0.5 if "@2x" in p else 1)
    ims.append(im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.LANCZOS))
W = sum(i.width for i in ims) + 10 * (len(ims) + 1); H = max(i.height for i in ims) + 20
s = Image.new("RGBA", (W, H), (110, 110, 100, 255)); x = 10
for i in ims:
    s.alpha_composite(i, (x, H - 10 - i.height)); x += i.width + 10
s.convert("RGB").save(out)
