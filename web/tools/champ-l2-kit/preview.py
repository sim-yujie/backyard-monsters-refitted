"""preview.py <sheet> <col>[,<col>...] [scale] : for each column, the old frames (every row) above the built repaint (from the @4x sheet),
on grey, with the game's anchor point as a red cross. With col "all": row 0 of all 16 headings instead (turning check).
Writes <full folder>/preview-<cols>.png and prints its path."""
import sys
from PIL import ImageDraw
from common import *

ANCHOR = {"ape_2": (38, 36), "dragon_2": (38, 36), "fly_2": (38, 36), "krallen_1": (64, 50)}
name = sys.argv[1]
S = SHEETS[name]
w, h = S["cell"]
k = int(sys.argv[3]) if len(sys.argv) > 3 else 2
old = sheet(name)
new = Image.open(ASSETS / (S["file"][:-4] + "-repaint@4x.png")).convert("RGBA")
if sys.argv[2] == "all":
    pairs = [[(c, 0) for c in range(16)]]
else:
    pairs = [[(int(c), r) for r in range(S["rows"])] for c in sys.argv[2].split(",")]
n = max(len(p) for p in pairs)
out = Image.new("RGB", (n * w * k, len(pairs) * 2 * h * k), (128, 128, 128))
d = ImageDraw.Draw(out)
for j, p in enumerate(pairs):
    for i, (c, r) in enumerate(p):
        o = old.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)).resize((w * k, h * k), Image.NEAREST)
        nw = new.crop((c * w * 4, r * h * 4, (c + 1) * w * 4, (r + 1) * h * 4)).resize((w * k, h * k), Image.LANCZOS)
        for t, im in enumerate((o, nw)):
            x, y = i * w * k, (j * 2 + t) * h * k
            out.paste(on((128, 128, 128), im), (x, y))
            ax, ay = x + ANCHOR[name][0] * k, y + ANCHOR[name][1] * k
            d.line((ax - 4, ay, ax + 4, ay), fill=(255, 0, 0))
            d.line((ax, ay - 4, ax, ay + 4), fill=(255, 0, 0))
            d.rectangle((x, y, x + w * k - 1, y + h * k - 1), outline=(100, 100, 100))
p = S["full"] / f"preview-{sys.argv[2].replace(',', '-')}.png"
out.save(p)
print(p, out.size)
