"""compare.py <out dir>: final-compare.png (old over new, every heading: idle, walk 2, walk 5), walk-compare.gif
(old left, new right, headings right/front/left/back), realsize.png (1x), and the per-heading area ratio and feet-jitter report."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

A = Path(__file__).resolve().parents[3] / "server/public/assets/monsters"
OUT = Path(sys.argv[1])
W, H = 53, 40
old = Image.open(A / "fly_1.png").convert("RGBA")
new = Image.open(A / "fly_1-repaint@4x.png").convert("RGBA")
GREY = (128, 128, 128, 255)


def flat(im, size):
    bg = Image.new("RGBA", im.size, GREY)
    bg.alpha_composite(im)
    return bg.resize(size, Image.NEAREST if size[0] > im.width else Image.LANCZOS)


def oc(c, r, s=1):
    return flat(old.crop((c * W, r * H, (c + 1) * W, (r + 1) * H)), (W * s, H * s))


def nc(c, r, s=1):
    return flat(new.crop((c * W * 4, r * H * 4, (c + 1) * W * 4, (r + 1) * H * 4)), (W * s, H * s))


S = 2
rows = [(0, "idle"), (2, "walk 2"), (5, "walk 5")]
out = Image.new("RGB", (16 * W * S, len(rows) * 2 * H * S), GREY[:3])
for i, (r, _) in enumerate(rows):
    for c in range(16):
        out.paste(oc(c, r, S).convert("RGB"), (c * W * S, i * 2 * H * S))
        out.paste(nc(c, r, S).convert("RGB"), (c * W * S, (i * 2 + 1) * H * S))
out.save(OUT / "final-compare.png")

heads = [15, 2, 6, 10]
fr = []
for r in range(1, 8):
    f = Image.new("RGB", (4 * W * 3, 2 * H * 3), GREY[:3])
    for i, c in enumerate(heads):
        f.paste(oc(c, r, 3).convert("RGB"), (i * W * 3, 0))
        f.paste(nc(c, r, 3).convert("RGB"), (i * W * 3, H * 3))
    fr.append(f)
fr[0].save(OUT / "walk-compare.gif", save_all=True, append_images=fr[1:], duration=130, loop=0)

rs = Image.new("RGB", (16 * W, 2 * H), GREY[:3])
for c in range(16):
    rs.paste(oc(c, 0).convert("RGB"), (c * W, 0))
    rs.paste(nc(c, 0).convert("RGB"), (c * W, H))
rs.save(OUT / "realsize.png")

ratios, jit = [], []
for c in range(16):
    o = (np.asarray(old.crop((c * W, 0, (c + 1) * W, H)))[..., 3] >= 200).sum()
    n = np.asarray(new.crop((c * W * 4, 0, (c + 1) * W * 4, H * 4)))[..., 3] > 200
    ratios.append(n.sum() / 16 / o)
    bots = []
    for r in range(8):
        n = np.asarray(new.crop((c * W * 4, r * H * 4, (c + 1) * W * 4, (r + 1) * H * 4)))[..., 3] > 200
        ys = np.where(n.any(axis=1))[0]
        if len(ys):
            bots.append(ys.max() / 4)
    jit.append(max(bots) - min(bots) if bots else 0)
print("idle area ratio new/old per heading:", [round(x, 2) for x in ratios])
print("idle area ratio new/old: mean %.2f min %.2f max %.2f" % (np.mean(ratios), min(ratios), max(ratios)))
print("walk lowest-pixel spread per heading (1x px):", [round(j, 2) for j in jit])
