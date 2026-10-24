"""jitter.py <sheet> <col>[,..] [rows a-b] : per row, x of the upper-body centre (1x px) in the old sheet and the repaint, and
their difference minus the row-0 difference: a steady sheet keeps it within ~1-2 px."""
import sys
from common import *
name = sys.argv[1]; S = SHEETS[name]; w, h = S["cell"]
a, b = (sys.argv[3].split("-") if len(sys.argv) > 3 else (0, S["rows"] - 1))
rows = range(int(a), int(b) + 1)
old = sheet(name); new = Image.open(ASSETS / (S["file"][:-4] + "-repaint@4x.png")).convert("RGBA")
def ux(m):
    ys, xs = np.where(m); return xs[ys < (ys.min() + ys.max()) / 2].mean()
for c in [int(x) for x in sys.argv[2].split(",")]:
    d = []
    for r in rows:
        o = np.asarray(old.crop((c*w, r*h, (c+1)*w, (r+1)*h)))[..., 3] >= 200
        n = np.asarray(new.crop((c*w*4, r*h*4, (c+1)*w*4, (r+1)*h*4)))[..., 3] > 200
        d.append(ux(n) / 4 - ux(o))
    print(c, " ".join(f"{x - d[0]:+.1f}" for x in d))
