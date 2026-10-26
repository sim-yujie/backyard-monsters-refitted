"""Exports the owner-approved tower tier paintings into the game's assets.

    python -I web/tools/tower-tiers/export.py <codex-art worktree> [tiers...]
    python -I web/tools/tower-tiers/export.py <codex-art worktree> townhall

Reads `art-samples/redesign/<tower>/<combo>/new-4x.png` from the sample worktree (branch art/samples-towers-champs-l4),
where each painting already sits on the old tower's footprint: the building-redesign kit's `finish.py` fitted it by the
width of its bottom 30% and put the building's isometric origin at `canvas(b, up)` (4x pixels = 4 x that). From it this
writes, per tower and tier, into `server/public/assets/buildings/<folder>/`:

- `top.t<N>@2x.webp`: the picture cropped to its pixels, at half the 4x size; the `@2x` is how Pixi knows the resolution.
- `shadow.t<N>.jpg`: a stand-in shadow (the sample sheets' one: the silhouette leaned back, flattened and blurred),
  a white JPEG multiplied onto the grass like the Flash shadows.

and prints one line of JSON per picture with the 1x offsets (`buildingArtTiers.ts` holds them) and `lift`, the world px
the picture's top stands above the Flash tower's, which is how much higher the gun sits.

`townhall` exports the Town Hall instead: one picture per level (codex-art Part 13), `top.new<N>@2x.webp` for
levels 1-10. finish.py fits every level onto the level 10 canvas, origin `canvas("townhall")`. It writes no shadow:
each level keeps Flash's own painted `shadow.<N>.jpg`, which fits the same footprint (owner, 26 Oct 2026).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

KIT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(KIT / "web" / "tools" / "tower-sample-kit"))
sys.path.insert(0, str(KIT / "web" / "tools" / "building-redesign-kit"))
from common import TOWERS, old_rgba, resize_pm  # noqa: E402
from finish import canvas  # noqa: E402

ASSETS = Path(__file__).resolve().parents[3] / "server" / "public" / "assets" / "buildings"
SAMPLES = KIT / "art-samples" / "redesign"
UP = 4
# The approved pictures per tier (compare.py `all`): the Cannon's tier 1 is its T2 sample, the others' their R2-A one.
TIER_COMBO = {1: {"cannon": "T2"}, 2: {}, 3: {}}
TIER_DEFAULT = {1: "R2A", 2: "TALL2", 3: "TALL3"}
ORDER = ["cannon", "sniper", "bunker", "laser", "tesla", "aerial", "railgun"]
# The Town Hall's approved picture per level: L<n>, except levels 2, 5 and 10, which reuse earlier approved ones.
TH_COMBO = {2: "T1", 5: "GOLD", 10: "BLACK"}


def shadow(alpha, bot):
    """The sample sheets' stand-in: the silhouette leaned back and flattened onto the ground line `bot`, blurred."""
    h, w = alpha.shape
    pad = h  # room to the right for the lean
    a = np.zeros((h, w + pad), "uint8")
    a[:, :w] = (alpha * 255).astype("uint8")
    sq = Image.fromarray(a).transform((w + pad, h), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35),
                                      Image.BILINEAR)
    return np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255


def export(b, tier, combo=None, flash=None, name=None, stand_in=True):
    """`flash` is the Flash picture the lift is measured against (default `b`), `name` the file tag (default `t<tier>`);
    `stand_in` False writes no shadow (the Town Hall keeps Flash's)."""
    combo = combo or TIER_COMBO[tier].get(b, TIER_DEFAULT[tier])
    name = name or f"t{tier}"
    im4 = Image.open(SAMPLES / b / combo / "new-4x.png").convert("RGBA")
    # The canvas is the old one widened by 30% each side and raised (by 0.6 of its height for tier 1, 1.4 or 1.7 for
    # the taller tiers: see `canvas`), sharing its bottom; so the origin follows from the size.
    old, ox, oy = old_rgba(b)
    W, H = im4.width // UP, im4.height // UP
    _, _, cx0, _ = canvas(b)
    cy0 = oy + H - old.height
    assert im4.size == (W * UP, H * UP) and W == canvas(b)[0], (b, combo, im4.size)
    x0, y0, x1, y1 = im4.getbbox()
    # Whole 1x pixels, so the offsets in the table are integers.
    x0, y0 = x0 // UP * UP, y0 // UP * UP
    x1, y1 = -(-x1 // UP) * UP, -(-y1 // UP) * UP
    crop = im4.crop((x0, y0, x1, y1))
    two = resize_pm(crop, (crop.width // 2, crop.height // 2))
    folder = ASSETS / TOWERS[b]["folder"]
    top_name = f"top.{name}@2x.webp"
    two.save(folder / top_name, "WEBP", quality=90, alpha_quality=100, method=6)

    shadow_row, shadow_bytes = None, 0
    if stand_in:
        # Shadow at 1x on the whole canvas, then cropped to where it darkens.
        one = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
        bot = int(np.where(one.max(1) > 0.5)[0].max())
        sh = shadow(one, bot)
        ys, xs = np.where(sh > 0.02)
        sx0, sy0, sx1, sy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        mult = (255 * (1 - 0.45 * sh[sy0:sy1, sx0:sx1])).round().astype("uint8")
        shadow_name = f"shadow.{name}.jpg"
        Image.fromarray(mult).convert("RGB").save(folder / shadow_name, "JPEG", quality=85, optimize=True)
        shadow_row, shadow_bytes = [shadow_name, int(sx0 - cx0), int(sy0 - cy0)], (folder / shadow_name).stat().st_size

    flash_old, _, flash_oy = old_rgba(flash or b)
    old_top = np.where(np.asarray(flash_old)[..., 3] >= 200)[0].min() - flash_oy
    new_top = y0 / UP - cy0 + np.where(np.asarray(crop)[..., 3] >= 200)[0].min() / UP
    return dict(tower=b, tier=tier, combo=combo, folder=TOWERS[b]["folder"],
                top=[top_name, round(x0 / UP - cx0), round(y0 / UP - cy0)],
                shadow=shadow_row,
                lift=max(0, round(old_top - new_top)),
                bytes=(folder / top_name).stat().st_size + shadow_bytes)


if __name__ == "__main__":
    if sys.argv[2:] == ["townhall"]:
        for n in range(1, 11):
            print(json.dumps(export("townhall", n, TH_COMBO.get(n, f"L{n}"), f"townhall{n}", f"new{n}", stand_in=False)))
        sys.exit()
    tiers = [int(t) for t in sys.argv[2:]] or [2, 3]
    for b in ORDER:
        for t in tiers:
            print(json.dumps(export(b, t)))
