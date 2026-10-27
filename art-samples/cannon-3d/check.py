"""check.py : side by side, painted tier picture | 3D full render, on flat green, enlarged (a working check, not a deliverable).

  python check.py TIER H [H ...]     -> render/TIER/check.png
"""
import sys
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
PAINTED = Path("D:/Coding/BYMR/worktrees/codex-art/art-samples/redesign/cannon")   # read only
TOP = {"t1": "T2", "t1b": "T2", "t2": "TALL2", "t3": "TALL3"}
name = sys.argv[1]
appr = Image.open(PAINTED / TOP[name] / "new-4x.png").convert("RGBA")
ims = [Image.open(HERE / "render" / name / f"full-h{int(h):02d}.png").convert("RGBA") for h in sys.argv[2:]]
bb = appr.getbbox()
for im in ims:
    b = im.getbbox()
    bb = (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
bb = (bb[0] - 8, bb[1] - 8, bb[2] + 8, bb[3] + 8)
def onbg(im):
    g = Image.new("RGBA", im.size, (90, 140, 70, 255)); g.alpha_composite(im); return g.crop(bb)
row = [onbg(appr)] + [onbg(im) for im in ims]
w, h = row[0].size
g = Image.new("RGB", (w * len(row), h))
for i, r in enumerate(row):
    g.paste(r.convert("RGB"), (i * w, 0))
s = min(2.0, 1400 / g.width)
g.resize((int(g.width * s), int(g.height * s)), Image.LANCZOS).save(HERE / "render" / name / "check.png")
