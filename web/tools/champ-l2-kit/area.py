"""area.py <sheet> <col>[,..] : per row, old body area (1x px) and the repaint's solid area (1x px) and their ratio."""
import sys
from common import *
name = sys.argv[1]; S = SHEETS[name]; w, h = S["cell"]
old = sheet(name); new = Image.open(ASSETS / (S["file"][:-4] + "-repaint@4x.png")).convert("RGBA")
for c in [int(x) for x in sys.argv[2].split(",")]:
    out = []
    for r in range(S["rows"]):
        o = (np.asarray(old.crop((c*w, r*h, (c+1)*w, (r+1)*h)))[..., 3] >= 200).sum()
        n = (np.asarray(new.crop((c*w*4, r*h*4, (c+1)*w*4, (r+1)*h*4)))[..., 3] > 200).sum() / 16
        out.append(f"{r}:{n/o:.2f}")
    print(c, " ".join(out))
