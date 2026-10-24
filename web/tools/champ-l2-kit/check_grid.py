"""check_grid.py <sheet> <A|B> <col> [width] : cmp.png in the batch folder: old frames (top) over the painted frames (bottom), on grey,
plus idle.png (the first painted cell keyed, used as a design reference for neighbour headings)."""
import sys
from common import *

name, mode, col = sys.argv[1], sys.argv[2], int(sys.argv[3])
W = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
S = SHEETS[name]
d = S["full"] / f"{mode}{col}"
rows, gc, gr = grid_rows(name, mode)
a = Image.open(d / "frames.png").convert("RGB")
b = Image.open(d / "frames-new.png").convert("RGB")
cw, ch = b.width // gc, b.height // gr
cells = [key_cell(np.asarray(b.crop(((i % gc) * cw, (i // gc) * ch, (i % gc + 1) * cw, (i // gc + 1) * ch))), S["key"]) for i in range(len(rows))]
tight(cells[0]).save(d / "idle.png")
nb = Image.new("RGB", b.size, (128, 128, 128))
for i, c in enumerate(cells):
    nb.paste(on((128, 128, 128), c), ((i % gc) * cw, (i // gc) * ch))
nb = nb.resize((a.width, round(nb.height * a.width / nb.width)))
g = Image.new("RGB", (a.width, a.height + nb.height + 8), (30, 30, 30))
g.paste(a, (0, 0)); g.paste(nb, (0, a.height + 8))
g.resize((W, round(g.height * W / g.width))).save(d / "cmp.png")
print(d / "cmp.png", b.size)
