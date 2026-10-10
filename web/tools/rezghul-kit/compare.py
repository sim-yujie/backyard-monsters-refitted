"""compare.py <out dir>: final-compare.png (old row 1 over new row 1 for every 2nd heading, portrait bottom-left), realsize.png, area ratio."""
import sys
from pathlib import Path
from PIL import Image
import numpy as np
A = Path(__file__).resolve().parents[3] / "server/public/assets/monsters"
OUT = Path(sys.argv[1])
W, H = 48, 43
old = Image.open(A / "rezghul.png").convert("RGBA"); new = Image.open(A / "rezghul-repaint@4x.png").convert("RGBA")
def flat(im, s):
    bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
    return bg.resize((int(im.width * s), int(im.height * s)), Image.NEAREST if s > 1 else Image.LANCZOS)
cw, ch = W * 4, H * 4
out = Image.new("RGB", (15 * cw, 2 * ch + 240), (128, 128, 128))
for i, c in enumerate(range(0, 30, 2)):
    out.paste(flat(old.crop((c * W, H, c * W + W, 2 * H)), 4).convert("RGB"), (i * cw, 0))
    out.paste(flat(new.crop((c * W * 4, H * 4, (c + 1) * W * 4, 2 * H * 4)), 1).convert("RGB"), (i * cw, ch))
out.paste(Image.open(OUT / "portrait-big.png").convert("RGB").resize((240, 240)), (0, 2 * ch))
out.save(OUT / "final-compare.png")
n1 = new.resize((1536, 258), Image.LANCZOS)
rs = Image.new("RGB", (1536, 270), (128, 128, 128))
rs.paste(flat(old, 1).convert("RGB"), (0, 0)); rs.paste(flat(n1, 1).convert("RGB"), (0, 130))
rs.save(OUT / "realsize.png")
r = []
for c in range(30):
    o = (np.asarray(old.crop((c * W, H, c * W + W, 2 * H)))[..., 3] > 60).sum()
    n = (np.asarray(new.crop((c * W * 4, H * 4, (c + 1) * W * 4, 2 * H * 4)))[..., 3] > 60).sum() / 16
    r.append(n / o)
print("area ratio mean %.2f min %.2f max %.2f" % (np.mean(r), min(r), max(r)))
