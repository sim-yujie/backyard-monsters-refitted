"""view.py : pick panels of work/fit-overlay-L1.png (0 Flash, 1 3D, 2 outlines, 3 miss map) side by side, to look at."""
import sys
from PIL import Image
im = Image.open("work/fit-overlay-L1.png")
w = im.width // 4
ps = [int(c) for c in sys.argv[1]] if len(sys.argv) > 1 else [0, 1]
sc = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
out = Image.new("RGB", (w * len(ps), im.height))
for i, p in enumerate(ps):
    out.paste(im.crop((p * w, 0, (p + 1) * w, im.height)), (i * w, 0))
if sc != 1.0:
    out = out.resize((int(out.width * sc), int(out.height * sc)), Image.LANCZOS)
out.save("work/_v.png")
