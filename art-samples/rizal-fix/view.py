"""view.py <out.png> <img@2x>... : side by side on grass, 4x, cropped to the figures zone (or --full at 2x)"""
import sys
from PIL import Image
out, fs = sys.argv[1], sys.argv[2:]
full = "--full" in fs; fs = [f for f in fs if f != "--full"]
ims = []
for f in fs:
    g = Image.open(f).convert("RGBA"); o = Image.new("RGBA", (196, 250), (96, 140, 70, 255)); o.alpha_composite(g)
    if full: ims.append(o.resize((392, 500), Image.LANCZOS))
    else: ims.append(o.crop((45, 60, 155, 150)).resize((440, 360), Image.NEAREST))
w = ims[0].width; s = Image.new("RGB", (len(ims) * (w + 8), ims[0].height), "white")
for k, i in enumerate(ims): s.paste(i.convert("RGB"), (k * (w + 8), 0))
s.save(out)
