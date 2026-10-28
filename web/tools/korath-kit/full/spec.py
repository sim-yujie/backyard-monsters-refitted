"""Korath full-sheet specs (levels 1-6, monsterSpriteData.ts G4_1-G4_6) and shared helpers for the Korath sheet kit
(the champ-l456 kit's interface: SPECS, HEADINGS, FACING, sheet, cell, on, strip, parts, COLOUR, key_cell, tight, sample_views)."""
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kparts import KPARTS, KCOLOUR  # noqa: E402

ASSETS = Path(os.environ.get("BYM_REPO", "D:/Coding/BYMR/worktrees/korath-art")) / "server" / "public" / "assets" / "monsters"
CH = Path("D:/Coding/BYMR/art-trials/champions")
COLOUR = {"korath": KCOLOUR}

# (cell w, h, walk rows, attack rows). Walk starts at row 0 (= idle); levels 5 and 6 also have 10 stomp rows (20-29) that the
# game never plays (AttackBattleLayer.animationFor has no stomp): the sheet builder fills them with the painted attack.
_DIMS = {1: (72, 49, 8, 9), 2: (119, 81, 8, 9), 3: (128, 102, 9, 9), 4: (153, 123, 10, 10), 5: (199, 162, 10, 10), 6: (202, 167, 10, 10)}
_ROWS = {1: 17, 2: 17, 3: 18, 4: 20, 5: 30, 6: 30}
_WALK = {1: "CRAWL cycle frames (the molten blob oozes forward: it stretches out, the front lifts and flows, the back end follows)",
         2: "CRAWL cycle frames (the two front fists step forward in turn and the molten tail drags behind)"}
_ATK = {1: "ATTACK frames (the blob rears its front end up off the ground and slams it down onto the target, flattening, then settles)",
        2: "ATTACK frames (it lifts one big rock fist high and pounds it down onto the target, then settles back on both fists)"}
_ATK_APE = ("ATTACK frames (Korath rears up, raises one huge rock fist high overhead and smashes it down onto the target in front, "
            "then settles back onto its knuckles)")
SPECS = {}
for _lv, (_w, _h, _wc, _ac) in _DIMS.items():
    _walk = list(range(_wc)); _atk = list(range(_wc, _wc + _ac))
    SPECS[f"korath_{_lv}"] = dict(champ="Korath", fam="korath", level=_lv, sample=CH / f"korath/L{_lv}", w=_w, h=_h, rows=_ROWS[_lv],
                                  painted=list(range(2, 11)), calls={"A": _walk, "B": [0] + _atk},
                                  what={"A": _WALK.get(_lv, "WALK cycle frames (a heavy knuckle-walk: the big fists and the short hind legs step in turn, body bobbing)"),
                                        "B": _ATK.get(_lv, _ATK_APE)})

FACING = {
    0: "three-quarter front view turned about 45 degrees to screen RIGHT: mostly facing the viewer, head pointing to the lower right",
    1: "facing the viewer, turned slightly (about 22 degrees) to screen RIGHT",
    2: "facing the viewer straight on (front view)",
    3: "facing the viewer, turned slightly (about 22 degrees) to screen LEFT",
    4: "three-quarter front view turned about 45 degrees to screen LEFT: head pointing to the lower left",
    5: "nearly a left profile (about 67 degrees from front), still showing a little of the face, head pointing left",
    6: "left side profile: head on the LEFT, back end on the RIGHT",
    7: "turned past the left profile (about 112 degrees from front): head pointing left and slightly away from the viewer, back end toward the viewer on the right",
    8: "three-quarter back view (about 135 degrees from front): head pointing up-left away from the viewer, back end toward the viewer; the face is NOT visible",
    9: "mostly seen from behind, turned a little (about 157 degrees from front) to screen left; the face is NOT visible",
    10: "seen straight from BEHIND: the back toward the viewer, the head beyond it; the face is NOT visible",
}
HEADINGS = {14: ("new-heading0.png", "facing screen RIGHT"), 2: ("new-heading1.png", "facing the viewer"),
            6: ("new-heading2.png", "facing screen LEFT"), 10: ("new-heading3.png", "seen from behind")}
FACING[14] = "right side profile: head on the RIGHT, back end on the LEFT"


def parts(name):
    return KPARTS[SPECS[name]["level"]]


def grid_cols(n):
    """cells per row of a call's 2-row grid."""
    return 4 if n <= 8 else 5 if n <= 10 else 6


def sheet(name):
    return Image.open(ASSETS / f"{name}.png").convert("RGBA")


def cell(sh, name, col, row):
    s = SPECS[name]
    return sh.crop((col * s["w"], row * s["h"], (col + 1) * s["w"], (row + 1) * s["h"]))


def key_cell(rgb):
    """RGBA cutout of one painted cell: the magenta ground is flood-filled from the cell edge; Korath has no pink or purple of its
    own, so magenta-hued pockets (ground seen between an arm and the body) are cut too."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground = (r > 175) & (b > 175) & (g < 120) & (np.abs(r - b) < 70)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ndi.binary_opening(~np.isin(lab, list(edge)), iterations=1)
    lab2, _ = ndi.label(fg)
    ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
    keep = np.zeros_like(fg)
    for i, c in zip(ids, cnt):
        if c > cnt.max() * 0.02:
            keep |= lab2 == i
    keep = ndi.binary_fill_holes(keep)
    keep &= ~ndi.binary_dilation(((r - g) > 40) & ((b - g) > 40), iterations=1)
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    spill = rim & (r > g + 25) & (b > g + 25)
    out = rgb.copy()
    out[..., 0] = np.where(spill, np.minimum(r, g + 0.35 * (b - g)), r)
    out[..., 2] = np.where(spill, np.minimum(b, g + 0.35 * (r - g)), b)
    return Image.fromarray(np.dstack([out, alpha]).astype("uint8"), "RGBA")


def tight(im, pad=0):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 20)
    return im.crop((xs.min() - pad, ys.min() - pad, xs.max() + 1 + pad, ys.max() + 1 + pad))


def on(bg, im):
    b = Image.new("RGBA", im.size, bg + (255,))
    b.alpha_composite(im)
    return b.convert("RGB")


def strip(views, bg=(255, 0, 255), height=None):
    """Tight cutouts side by side on one ground, bottoms aligned."""
    if height:
        views = [v.resize((round(v.width * height / v.height), height), Image.LANCZOS) for v in views]
    Hh = max(v.height for v in views)
    out = Image.new("RGBA", (sum(v.width for v in views) + 40 * (len(views) + 1), Hh + 80), bg + (255,))
    x = 40
    for v in views:
        out.alpha_composite(v, (x, 40 + Hh - v.height))
        x += v.width + 40
    return out.convert("RGB")


def sample_views(name):
    """The approved sample (idle + walk frame, facing the viewer) keyed into two tight cutouts."""
    im = Image.open(SPECS[name]["sample"] / "sample-new.png").convert("RGB")
    w, h = im.size
    return [tight(key_cell(np.asarray(im.crop((i * w // 2, 0, (i + 1) * w // 2, h))))) for i in range(2)]
