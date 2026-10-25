"""finish.py <tower> : key sample-new.png (green ground), fit the painted tower onto the old one (same solid area, same base line,
same centre), write new-4x.png / new-1x.png (same canvas and origin as the old tower, 4x and 1x), and compare.png:
old Flash | new, on the yard grass with the old shadow, at game size (1x) and zoomed in (3x, the game's close zoom on a sharp screen)."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, bbox, grass, key, old_rgba, resize_pm, shadow_on  # noqa: E402

t = sys.argv[1]
out = OUT / t
UP = 4


def solid(im, thr):
    m = np.asarray(im)[..., 3] >= thr
    ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, m.sum()


painted = key(np.asarray(Image.open(out / "sample-new.png").convert("RGB")))
painted.save(out / "sample-cut.png")
old, ox, oy = old_rgba(t)
pb = solid(painted, 128)
ob = solid(old, 200)
k = np.sqrt(ob[4] * UP * UP / pb[4])
crop = painted.crop(pb[:4])
crop = resize_pm(crop, (max(1, round(crop.width * k)), max(1, round(crop.height * k))))
c4 = Image.new("RGBA", (old.width * UP, old.height * UP), (0, 0, 0, 0))
cx = (ob[0] + ob[2]) / 2 * UP
c4.alpha_composite(crop, (round(cx - crop.width / 2), round(ob[3] * UP - crop.height)))
c4.save(out / "new-4x.png")
resize_pm(c4, old.size).save(out / "new-1x.png")

# compare.png
x0, y0, x1, y1 = bbox(t)
W, H = x1 - x0, y1 - y0
g = grass(W * 2 + 30, H, seed=5)


def tile(im, s, src_scale):
    """im (canvas at src_scale) on grass with the old shadow, shown at scale s."""
    bg = g.crop((0, 0, W, H))
    bg = shadow_on(bg, t, ox, oy).convert("RGBA")
    if src_scale == 1:
        bg.alpha_composite(im)
        return bg.resize((W * s, H * s), Image.BILINEAR) if s > 1 else bg
    big = bg.resize((W * s, H * s), Image.BILINEAR)
    big.alpha_composite(resize_pm(im, (W * s, H * s)))
    return big


rows = []
for s, label in ((1, "game size (1x)"), (2, "2x"), (4, "close zoom (4x)")):
    rows.append((label, tile(old, s, 1).convert("RGB"), tile(c4, s, UP).convert("RGB")))
cw = max(r[1].width for r in rows)
hh = sum(r[1].height + 26 for r in rows) + 30
cmp = Image.new("RGB", (2 * cw + 36, hh), (36, 36, 40))
d = ImageDraw.Draw(cmp)
d.text((12, 6), f"{t}: Flash original", fill=(230, 230, 230))
d.text((24 + cw, 6), "new sample", fill=(230, 230, 230))
y = 26
for label, a, b in rows:
    d.text((12, y), label, fill=(200, 200, 200))
    cmp.paste(a, (12, y + 16)); cmp.paste(b, (24 + cw, y + 16))
    y += a.height + 26
cmp.save(out / "compare.png")
print("done", out.as_posix(), "scale", round(k, 3))
