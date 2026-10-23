"""split_turn.py <sheet> : key the painted 2x2 turnaround (full/turn/frames-new.png) into new-heading0..3.png (right, front, left, back)
and write full/turn/check.png: old idle blown up over the new view, for the four sides, on grey."""
import sys
from common import *

name = sys.argv[1]
S = SHEETS[name]
d = S["full"] / "turn"
im = Image.open(d / "frames-new.png").convert("RGB")
W, H = im.size
cuts = []
for i in range(4):
    c = im.crop(((i % 2) * W // 2, (i // 2) * H // 2, (i % 2 + 1) * W // 2, (i // 2 + 1) * H // 2))
    cut = tight(key_cell(np.asarray(c), S["key"]))
    cut.save(d / f"new-heading{i}.png")
    cuts.append(cut)
old = sheet(name)
w, h = S["cell"]
T = 260
row1 = [on((128, 128, 128), old_cell(name, c, 0, old)).resize((w * 3, h * 3), Image.NEAREST) for c in (14, 2, 6, 10)]
row2 = []
for c in cuts:
    c = c.copy(); c.thumbnail((w * 3, h * 3)); row2.append(on((128, 128, 128), c))
g = Image.new("RGB", (4 * (w * 3 + 6), 2 * (h * 3 + 6)), (40, 40, 40))
for i in range(4):
    g.paste(row1[i], (i * (w * 3 + 6), 0)); g.paste(row2[i], (i * (w * 3 + 6), h * 3 + 6))
g.thumbnail((1400, 900)); g.save(d / "check.png")
print(d / "check.png")
