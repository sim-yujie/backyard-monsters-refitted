"""prev.py [scale] [levels] : v3 frame 0 of each level side by side on grass (one crop), for a quick look -> scratch."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
R = Path(__file__).resolve().parent.parent / "render"
sc = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
lvs = [int(x) for x in sys.argv[2].split(",")] if len(sys.argv) > 2 else [1, 3, 6, 10]
ims = []
for l in lvs:
    b = Image.open(R / f"L{l}-base.png").convert("RGBA")
    p = R / f"L{l}-parts-00.png"
    if p.exists():
        b.alpha_composite(Image.open(p).convert("RGBA"))
    ims.append(b)
a = np.zeros(ims[0].size[::-1], bool)
for im in ims:
    a |= np.array(im.getchannel("A")) > 30
ys, xs = np.nonzero(a)
box = (xs.min() - 10, ys.min() - 10, xs.max() + 10, ys.max() + 10)
w, h = box[2] - box[0], box[3] - box[1]
out = Image.new("RGB", (w * len(ims), h), (96, 140, 60))
for i, im in enumerate(ims):
    g = Image.new("RGBA", im.size, (96, 140, 60, 255))
    g.alpha_composite(im)
    out.paste(g.crop(box).convert("RGB"), (i * w, 0))
out = out.resize((int(out.width * sc), int(out.height * sc)), Image.LANCZOS)
out.save(sys.argv[3] if len(sys.argv) > 3 else "C:/Users/simyu/AppData/Local/Temp/claude/D--Coding-BYMR-backyard-monsters-refitted/95c2cc99-ad9f-4717-9a87-0bd89c1ad0e3/scratchpad/prev.png")
print(out.size)
