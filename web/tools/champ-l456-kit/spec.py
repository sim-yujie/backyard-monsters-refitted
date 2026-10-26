"""Level 4-6 champion sheet specs (Gorgo, Drull, Fomor) (from monsterSpriteData.ts on origin/revamp) and shared helpers for the champ-l456 kit."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, "D:/Coding/BYMR/art-trials/champions/_kit/scripts")
from parts import PARTS, COLOUR  # noqa: E402

import os
ASSETS = Path(os.environ.get("BYM_REPO", "D:/Coding/BYMR/worktrees/champ-l456")) / "server" / "public" / "assets" / "monsters"
CH = Path("D:/Coding/BYMR/art-trials/champions")

# key: champion, level, sample folder, cell w/h, rows, painted columns (rest mirrored: the Flash bodies are mirror images), calls {mode: rows}, action text
_WALK = "WALK cycle frames 1-7"
_ATK = {"ape": "ATTACK frames 1-8 (a heavy pounding attack: the Gorgo crouches, rears up and slams forward with the arms and claws, mouth open, then settles)",
        "dragon": "ATTACK frames 1-8 (the dragon rears its two heads back and lunges forward, jaws open, then settles)"}
_FLY = ("FLYING wing-beat frames 1-6. In these frames the creature is IN THE AIR, NOT standing: its legs hang loosely below the body with the feet "
        "pointing down and the body tilted a little forward; the bat wings beat through a full cycle, following the wing position of each old frame "
        "exactly (the pale blurred shape in the old frame is the wing in motion: raised high, level, or swept DOWN below the belly). Paint the wings CRISP and solid in every frame at that position: NO motion blur, smear or ghost wings. Cell 8 stays empty magenta")
_DIMS = {"ape_4": (148, 127), "ape_5": (160, 137), "ape_6": (140, 120), "dragon_4": (131, 93), "dragon_5": (156, 117), "dragon_6": (171, 125),
         "fly_4": (120, 92), "fly_5": (133, 105), "fly_6": (124, 105)}
_CH = {"ape": ("Gorgo", "gorgo"), "dragon": ("Drull", "drull"), "fly": ("Fomor", "fomor")}
SPECS = {}
for _n, (_w, _h) in _DIMS.items():
    _fam, _lv = _n.split("_")
    _champ, _dir = _CH[_fam]
    if _fam == "fly":
        SPECS[_n] = dict(champ=_champ, fam=_fam, level=int(_lv), sample=CH / f"{_dir}/L{_lv}", w=_w, h=_h, rows=7, painted=list(range(2, 11)),
                         calls={"A": list(range(7))}, what={"A": _FLY})
    else:
        SPECS[_n] = dict(champ=_champ, fam=_fam, level=int(_lv), sample=CH / f"{_dir}/L{_lv}", w=_w, h=_h, rows=16, painted=list(range(2, 11)),
                         calls={"A": list(range(8)), "B": [0] + list(range(8, 16))}, what={"A": _WALK, "B": _ATK[_fam]})
PARTS_KEY = {n: n for n in SPECS}
_WINGS = " The two big pink bat WINGS: folded and standing up behind the head when standing (idle), spread wide and flapping when flying."
EXTRA_PARTS = {
    "ape_4": "", "ape_5": "",
    "ape_6": " ARMOUR COLOURS exactly as in style.png (the Flash colours): SILVER helmet, helmet spike and back plates, PALE TAN shoulder pads (never bright yellow-gold).",
    "dragon_4": " ONE long tail only: it leaves the rump and curves UP behind the body to a pointed red tip (seen from the front, the tip rises between the two heads; from the side, it trails behind and curves up). Never a second tail or extra spike.",
    "dragon_5": " ONE long tail only: it leaves the rump and curves UP behind the body to a pointed red tip (seen from the front, the tip rises between the two heads; from the side, it trails behind and curves up). Never a second tail or extra spike.",
    "dragon_6": " The two heads are held HIGH on tall necks; red skin everywhere; gold discs ONLY on the shoulders, elbows and knees; ONE long tail that curves UP behind the body to a pointed tip (from the front the tip rises between the heads). Never a second tail or extra spike.",
    "fly_4": _WINGS, "fly_5": _WINGS, "fly_6": _WINGS,
}
FACING = {
    0: "three-quarter front view turned about 45 degrees to screen RIGHT: mostly facing the viewer, head pointing to the lower right",
    1: "facing the viewer, turned slightly (about 22 degrees) to screen RIGHT",
    2: "facing the viewer straight on (front view)",
    3: "facing the viewer, turned slightly (about 22 degrees) to screen LEFT",
    4: "three-quarter front view turned about 45 degrees to screen LEFT: head pointing to the lower left",
    5: "nearly a left profile (about 67 degrees from front), still showing a little of the front, head pointing left",
    6: "left side profile: head on the LEFT, tail on the RIGHT",
    7: "turned past the left profile (about 112 degrees from front): head pointing left and slightly away from the viewer, tail toward the viewer on the right",
    8: "three-quarter back view (about 135 degrees from front): head pointing up-left away from the viewer, rump toward the viewer",
    9: "mostly seen from behind, turned a little (about 157 degrees from front) to screen left",
    10: "seen straight from BEHIND: back and tail toward the viewer, the head beyond them",
    11: "mostly seen from behind, turned a little (about 157 degrees) toward screen right",
    12: "three-quarter back view (about 135 degrees toward screen RIGHT): head pointing up-right away from the viewer",
    13: "turned past the right profile (about 112 degrees toward the right): head pointing right and slightly away from the viewer, tail to the left",
    14: "right side profile: head on the RIGHT, tail on the LEFT",
    15: "nearly a right profile (about 67 degrees to screen RIGHT of front): head pointing right and slightly toward the viewer",
}
HEADINGS = {14: ("new-heading0.png", "facing screen RIGHT"), 2: ("new-heading1.png", "facing the viewer"),
            6: ("new-heading2.png", "facing screen LEFT"), 10: ("new-heading3.png", "seen from behind")}


def parts(name):
    return PARTS[PARTS_KEY[name]] + EXTRA_PARTS[name]


def sheet(name):
    return Image.open(ASSETS / f"{name}.png").convert("RGBA")


def cell(sh, name, col, row):
    s = SPECS[name]
    return sh.crop((col * s["w"], row * s["h"], (col + 1) * s["w"], (row + 1) * s["h"]))


def key_cell(rgb):
    """RGBA cutout of one painted cell: the magenta ground is flood-filled from the cell edge."""
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
