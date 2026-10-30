"""Level 3 batch sheet specs (from monsterSpriteData.ts on origin/revamp) and shared helpers for the champ-l3 kit."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, "D:/Coding/BYMR/art-trials/champions/_kit/scripts")
from parts import PARTS, COLOUR  # noqa: E402

ASSETS = Path(__file__).resolve().parents[3] / "server" / "public" / "assets" / "monsters"
CH = Path("D:/Coding/BYMR/art-trials/champions")

# key: champion, sample folder, cell w/h, rows, painted columns (rest mirrored), calls {mode: rows}, action text per mode
SPECS = {
    "ape_3": dict(champ="Gorgo", fam="ape", sample=CH / "gorgo/L3", w=103, h=88, rows=15, painted=list(range(2, 11)),
                  calls={"A": [0] + list(range(1, 8)), "B": [0] + list(range(8, 15))},
                  what={"A": "WALK cycle frames 1-7",
                        "B": "ATTACK frames 1-7 (a heavy pounding attack: the Gorgo crouches, rears up and slams forward with the arms and claws, mouth open, then settles)"}),
    "dragon_3": dict(champ="Drull", fam="dragon", sample=CH / "drull/L3", w=114, h=85, rows=15, painted=list(range(16)),
                     calls={"A": [0] + list(range(1, 8)), "B": [0] + list(range(8, 15))},
                     what={"A": "WALK cycle frames 1-7",
                           "B": "ATTACK frames 1-7 (the dragon rears its two heads back and lunges forward, jaws open, then settles)"}),
    "fly_3": dict(champ="Fomor", fam="fly", sample=CH / "fomor/L3", w=98, h=81, rows=7, painted=list(range(16)),
                  calls={"A": list(range(7))},
                  what={"A": "FLYING wing-beat frames 1-6. In these frames the creature is IN THE AIR, NOT standing: its four legs hang loosely below the body with the feet pointing down and the body tilted a little forward; the bat wings beat through a full cycle, following the wing position of each old frame exactly (the pale blurred shape in the old frame is the wing in motion: raised high, level, or swept DOWN below the belly). Cell 8 stays empty magenta"}),
    "krallen_2_rev_65": dict(champ="Krallen", fam="krallen", sample=CH / "krallen/L2", w=131, h=90, rows=16, painted=list(range(2, 11)),
                             calls={"A": list(range(10)), "B": [0] + list(range(10, 16))},
                             what={"A": "RUN cycle frames 1-10 (a galloping big cat; cell 1 is ALSO the first run frame, not a standing pose)",
                                   "B": "ATTACK frames 1-6 (the cat crouches, then rears and swipes/bites forward with claws and the extra back arms, then settles; cell 1 is a run frame for size reference, cell 8 stays empty magenta)"}),
    "krallen_3_rev_65": dict(champ="Krallen", fam="krallen", sample=CH / "krallen/L3", w=142, h=100, rows=16, painted=list(range(2, 11)),
                             calls={"A": list(range(10)), "B": [0] + list(range(10, 16))},
                             what={"A": "RUN cycle frames 1-10 (a galloping big cat; cell 1 is ALSO the first run frame, not a standing pose)",
                                   "B": "ATTACK frames 1-6 (the cat crouches, then rears and swipes/bites forward with claws and the extra back arms, then settles; cell 1 is a run frame for size reference, cell 8 stays empty magenta)"}),
}
PARTS_KEY = {"ape_3": "ape_3", "dragon_3": "dragon_3", "fly_3": "fly_3", "krallen_2_rev_65": "krallen_2", "krallen_3_rev_65": "krallen_3"}
EXTRA_PARTS = {
    "dragon_3": " The body is SQUAT and WIDE (not tall and narrow): the two heads sit close together at mid height on short thick necks, the four legs splay out wide, and the long pointed red TAIL rises straight UP behind the middle between the heads as a tall spike.",
    "fly_3": " At level 3 the Fomor has two big pink bat WINGS: folded and standing up behind the head when standing (idle), spread wide and flapping when flying.",
    "krallen_2_rev_65": "",
    "krallen_3_rev_65": " The two curved dark purple TUSKS hang down beside the jaw, and one tall golden horn-spike stands up from the shoulders, just behind the head.",
    "ape_3": "",
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
