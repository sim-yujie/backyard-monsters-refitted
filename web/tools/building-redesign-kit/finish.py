"""finish.py <building> <combo> : cut out sample-new.png (green ground) and fit it onto the old building's footprint.

Fit: the width of the bottom 30% of the new building = the same band of the old one (same footprint), centred on the old band,
base on the old base line. Tiers (T1, T2) fit onto the Flash picture they were painted from (Town Hall: level 2 / 5) and are
capped lower (tier 1 about Flash's height). Writes new-4x.png on a canvas with room above and to the sides (see CANVAS), origin in fit.txt.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
from common import REPO, key, old_rgba, resize_pm  # noqa: E402

UP = 4


def band(im, thr):
    """(left, right, bottom, top) of the solid shape, left/right measured over its bottom 30%."""
    m = np.asarray(im)[..., 3] >= thr
    ys, xs = np.where(m)
    top, bot = ys.min(), ys.max() + 1
    cut = bot - 0.3 * (bot - top)
    sel = ys >= cut
    return xs[sel].min(), xs[sel].max() + 1, bot, top


def canvas(b, up=0.6):
    """1x canvas for the new art: the old canvas widened by 30% each side and raised by 60% (up); returns (w, h, origin x, origin y).
    The taller towers (TALL2/TALL3) use up=1.7 (1.4 for the first cannon test); the canvases share the bottom, so pictures line up by their bottom edge."""
    old, ox, oy = old_rgba(b)
    dx, dy = round(old.width * 0.3), round(old.height * up)
    return old.width + 2 * dx, old.height + dy, ox + dx, oy + dy


if __name__ == "__main__":
    b, combo = sys.argv[1], sys.argv[2]
    out = REPO / "art-samples" / "redesign" / b / combo
    painted = key(np.asarray(Image.open(out / "sample-new.png").convert("RGB")))
    painted.save(out / "sample-cut.png")
    lvl = b == "townhall" and combo[:1] == "L" and combo[1:].isdigit()   # Town Hall per level (L1..L10): fits onto that level's Flash picture
    fk = f"townhall{combo[1:]}" if lvl else {("townhall", "T1"): "townhall2", ("townhall", "T2"): "townhall5", ("townhall", "GOLD"): "townhall5"}.get((b, combo), b)   # same as make.py
    old, ox, oy = old_rgba(fk)
    l0, r0, b0, t0 = band(old, 200)
    l1, r1, b1, t1 = band(painted, 128)
    k = (r0 - l0) * UP / (r1 - l1)
    cap = 1.15 if lvl else {"T1": 1.1, "T2": 1.25, "TALL2": 1.8, "TALL3": 2.3}.get(combo, 1.35)   # TALL: the owner wants taller tiers
    k = min(k, (b0 - t0) * cap * UP / (b1 - t1))           # never more than 35% taller than Flash (tiers: less)
    crop = painted.crop(painted.getbbox())
    bx0, by0 = painted.getbbox()[:2]
    crop = resize_pm(crop, (max(1, round(crop.width * k)), max(1, round(crop.height * k))))
    W, H, cx0, cy0 = canvas(b, 1.7 if combo.startswith("TALL") else 0.6)
    c4 = Image.new("RGBA", (W * UP, H * UP), (0, 0, 0, 0))
    dx, dy = cx0 - ox, cy0 - oy                              # old canvas -> new canvas
    mid_old = ((l0 + r0) / 2 + dx) * UP
    mid_new = ((l1 + r1) / 2 - bx0) * k
    c4.alpha_composite(crop, (round(mid_old - mid_new), round((b0 + dy) * UP - (b1 - by0) * k)))
    c4.save(out / "new-4x.png")
    print("done", out.as_posix(), "scale", round(k, 3))
