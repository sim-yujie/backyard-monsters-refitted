"""compare.py <out dir>: final-compare.png (old rows 0-2 over new rows 0-2 for every 2nd heading, portrait bottom-left), realsize.png, area ratio."""
import sys
from pathlib import Path
from PIL import Image
import numpy as np
A = Path(__file__).resolve().parents[3] / "server/public/assets/monsters"
OUT = Path(sys.argv[1])
old = Image.open(A / "vorg_anim.png").convert("RGBA"); new = Image.open(A / "vorg-repaint@4x.png").convert("RGBA")
def flat(im, s):
    bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
    return bg.resize((int(im.width * s), int(im.height * s)), Image.NEAREST if s > 1 else Image.LANCZOS)
out = Image.new("RGB", (16 * 160, 6 * 160 + 240), (128, 128, 128))
for i, c in enumerate(range(0, 32, 2)):
    for r in range(3):
        out.paste(flat(old.crop((c * 40, r * 40, c * 40 + 40, r * 40 + 40)), 4).convert("RGB"), (i * 160, r * 160))
        out.paste(flat(new.crop((c * 160, r * 160, c * 160 + 160, r * 160 + 160)), 1).convert("RGB"), (i * 160, (3 + r) * 160))
out.paste(Image.open(OUT / "portrait-big.png").convert("RGB"), (0, 960))
out.save(OUT / "final-compare.png")
n1 = new.resize((1280, 120), Image.LANCZOS)
rs = Image.new("RGB", (1280, 250), (128, 128, 128))
rs.paste(flat(old, 1).convert("RGB"), (0, 0)); rs.paste(flat(n1, 1).convert("RGB"), (0, 130))
rs.save(OUT / "realsize.png")
r = []
for c in range(32):
    o = (np.asarray(old.crop((c * 40, 40, c * 40 + 40, 80)))[..., 3] > 60).sum()
    n = (np.asarray(new.crop((c * 160, 160, c * 160 + 160, 320)))[..., 3] > 60).sum() / 16
    r.append(n / o)
print("area ratio mean %.2f min %.2f max %.2f" % (np.mean(r), min(r), max(r)))
