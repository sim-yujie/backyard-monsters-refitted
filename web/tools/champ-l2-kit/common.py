"""Shared bits of the level 2 champion kit (Gorgo ape_2, Drull dragon_2, Fomor fly_2, Krallen krallen_1_rev_65).

Paths: the old sheets come from server/public/assets/monsters, the approved samples and all Codex output live in
D:/Coding/BYMR/art-trials/champions/<champ>/L2 (Krallen: krallen/L1, its first look).
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ART = Path("D:/Coding/BYMR/art-trials/champions")

# sheet: champ, sample folder, cell w, h, rows, walk rows, attack rows, idle row, painted columns, key colour, part checklist
SHEETS = {
    "ape_2": dict(champ="gorgo", file="ape_2.png", cell=(89, 73), rows=15, walk=list(range(1, 8)), attack=list(range(8, 15)),
                  painted=list(range(2, 11)), key=(255, 0, 255)),
    "dragon_2": dict(champ="drull", file="dragon_2.png", cell=(87, 58), rows=15, walk=list(range(1, 8)), attack=list(range(8, 15)),
                     painted=list(range(16)), key=(255, 0, 255)),
    "fly_2": dict(champ="fomor", file="fly_2.png", cell=(63, 46), rows=9, walk=list(range(1, 9)), attack=[],
                  painted=[*range(11), 14], key=(0, 255, 0)),
    "krallen_1": dict(champ="krallen", file="krallen_1_rev_65.png", cell=(130, 80), rows=16, walk=list(range(0, 10)),
                      attack=list(range(10, 16)), painted=list(range(2, 11)), key=(0, 255, 0)),
}
for k, v in SHEETS.items():
    v["level_dir"] = ART / v["champ"] / ("L1" if k == "krallen_1" else "L2")
    v["full"] = v["level_dir"] / "full"

KEYNAME = {(255, 0, 255): "flat pure magenta #FF00FF", (0, 255, 0): "flat pure green #00FF00"}

FACING = {
    0: "three-quarter view, turned about 45 degrees to screen RIGHT of facing the viewer: mostly facing the viewer, head pointing to the lower right",
    1: "facing the viewer but turned slightly (about 22 degrees) to screen RIGHT",
    2: "facing the viewer straight on (front view)",
    3: "facing the viewer but turned slightly (about 22 degrees) to screen LEFT",
    4: "three-quarter view, turned about 45 degrees to screen LEFT of facing the viewer, head pointing to the lower left",
    5: "turned about 67 degrees to screen LEFT: nearly a left profile, still showing a little of the front, head pointing left",
    6: "left side profile: head on the LEFT, tail on the RIGHT",
    7: "turned past the left profile (about 112 degrees from front): head pointing left and slightly away from the viewer, tail to the right and toward the viewer",
    8: "three-quarter back view, turned about 135 degrees from the front: head pointing up-left away from the viewer, rump toward the viewer's right",
    9: "mostly seen from behind, turned a little (about 157 degrees from front) to screen left",
    10: "seen straight from BEHIND: back and tail toward the viewer, head hidden or barely visible",
    11: "mostly seen from behind, turned a little (about 157 degrees) toward screen right",
    12: "three-quarter back view, turned about 135 degrees toward screen RIGHT: head pointing up-right away from the viewer",
    13: "turned past the right profile (about 112 degrees from front toward the right): head pointing right and slightly away from the viewer, tail to the left and toward the viewer",
    14: "right side profile: head on the RIGHT, tail on the LEFT",
    15: "nearly a right profile (about 67 degrees to screen RIGHT of front): head pointing right and slightly toward the viewer, tail to the left",
}
# the four turnaround views (new-heading0..3) and the column each one is
TURN = {14: 0, 2: 1, 6: 2, 10: 3}
TURN_NAME = {14: "facing screen RIGHT", 2: "facing the viewer", 6: "facing screen LEFT", 10: "seen from behind"}


def sheet(name):
    return Image.open(ASSETS / SHEETS[name]["file"]).convert("RGBA")


def old_cell(name, col, row, im=None):
    w, h = SHEETS[name]["cell"]
    im = im or sheet(name)
    return im.crop((col * w, row * h, (col + 1) * w, (row + 1) * h))


def on(bg, im):
    b = Image.new("RGBA", im.size, tuple(bg) + (255,))
    b.alpha_composite(im.convert("RGBA"))
    return b.convert("RGB")


def is_key(a, key):
    """Ground pixels of a painted RGB array for key colour `key` (magenta or green)."""
    r, g, b = a[..., 0].astype(float), a[..., 1].astype(float), a[..., 2].astype(float)
    if key == (0, 255, 0):
        return (g > 170) & (r < 120) & (b < 120)
    return (r > 175) & (b > 175) & (g < 120) & (np.abs(r - b) < 70)


def key_cell(rgb, key):
    """RGBA cutout of one painted cell: the ground is flood-filled from the cell edge, rim despilled."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lab, _ = ndi.label(is_key(rgb, key))
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ndi.binary_opening(~np.isin(lab, list(edge)), iterations=1)
    lab2, _ = ndi.label(fg)
    keep = np.zeros_like(fg)
    if lab2.max():
        ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
        for i, c in zip(ids, cnt):
            if c > cnt.max() * 0.02:
                keep |= lab2 == i
    keep = ndi.binary_fill_holes(keep)
    # ground trapped inside the body (between the legs, under the tail, inside an open mouth) is not edge-connected: cut out the
    # pockets that are clearly the key colour; small off-colour ones (pink highlights) stay
    near = np.sqrt(((rgb - np.array(key, float)) ** 2).sum(-1)) < 80
    pocket, _ = ndi.label(is_key(rgb, key) & ~np.isin(lab, list(edge)))
    if pocket.max():
        for i, c in zip(*np.unique(pocket[pocket > 0], return_counts=True)):
            hole = pocket == i
            if c > 40 and near[hole].mean() > 0.6:
                keep &= ~ndi.binary_dilation(hole, iterations=1)
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    out = rgb.copy()
    if key == (0, 255, 0):
        spill = (g > r + 25) & (g > b + 25)      # no green parts on Fomor or Krallen: green anywhere is spill
        out[..., 1] = np.where(spill, np.maximum(r, b), g)
    else:
        spill = rim & (r > g + 25) & (b > g + 25)
        out[..., 0] = np.where(spill, np.minimum(r, g + 0.35 * (b - g)), r)
        out[..., 2] = np.where(spill, np.minimum(b, g + 0.35 * (r - g) + 20), b)
    return Image.fromarray(np.dstack([out, alpha]).astype("uint8"), "RGBA")


def tight(im):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 20)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def strip(views, key, pad=40):
    """Cutouts side by side on the key colour, feet on one line."""
    Hh = max(v.height for v in views)
    s = Image.new("RGB", (sum(v.width for v in views) + pad * (len(views) + 1), Hh + 2 * pad), key)
    x = pad
    for v in views:
        a = np.asarray(v.convert("RGBA")).copy()
        a[..., 3] = np.clip(a[..., 3].astype(int) * 4, 0, 255)      # some approved cutouts are partly see-through inside
        a[..., 3][ndi.binary_fill_holes(a[..., 3] > 60)] = 255
        s.paste(on(key, Image.fromarray(a, "RGBA")), (x, pad + Hh - v.height)); x += v.width + pad
    return s


def sample_cells(name):
    """The approved sample (sample-new.png: idle | walk, two equal halves) keyed: [idle, walk] cutouts."""
    d = SHEETS[name]["level_dir"]
    im = Image.open(d / "sample-new.png").convert("RGB")
    w, h = im.size
    return [tight(key_cell(np.asarray(im.crop((i * w // 2, 0, (i + 1) * w // 2, h))), (255, 0, 255))) for i in range(2)]

# part checklists (approved samples, champ-art-desk checks and the old Flash sheets)
PARTS = {
    "ape_2": ("squat bulky deep royal-blue toad-ape body (a bit bigger and more muscular than level 1), heavy head with a thick brow ridge, "
              "glowing yellow eyes, wide frowning mouth with small lower tusks/teeth, two pointed ear flaps, small red stud on the forehead, "
              "white spikes on the head and a row of small white spikes down the back, two thick front arms with white claws, two short hind legs "
              "with white-clawed feet (both feet), short thick tail. NO armour."),
    "dragon_2": ("TWO dragon heads splayed apart left and right with the chest between them (one head slightly bigger), each head with a spiky "
                 "yellow-orange crest, yellow eyes and a mouth with small white teeth; a long pointed TAIL that rises straight UP from the back "
                 "between/behind the two heads with a spiny ridge (as in the old sprite at this heading); deep brick-red skin with gold-orange spots, "
                 "cream chest, low four-legged crawling body, four short legs with white claws, small white spikes along the back."),
    "fly_2": ("squat round dark maroon-purple toad body (a little bigger than level 1), ONE wide head (exactly one head) with a scowling wide mouth "
              "full of small white teeth and a cream lower jaw, glowing yellow eyes, SMALL POINTED glowing cyan cone spikes set in pairs exactly where "
              "the old sprite has them (front view: exactly four, two on top of the head and two on the brow above the eyes; from the side and back a "
              "further pair down the back), small pale bumps on the sides, four short legs with white claws (exactly four legs), body tapering to a "
              "short pointed tail at the back. NO armour, NO plates, NO collar, NO crest, NO wings."),
    "krallen_1": ("four-legged big cat (leopard-like), golden-yellow fur covered in dark brown leopard rosette spots, lighter cream belly and chin, "
                  "head with an open snarling mouth showing pink inside and white fangs, yellow eyes, small ears, long spotted tail, white claws on all "
                  "four feet (exactly four legs). NO extra arms and NO spines at this level."),
}


def grid_rows(name, mode):
    """(rows shown cell by cell, grid columns, grid rows)"""
    s = SHEETS[name]
    if name == "krallen_1":
        return (s["walk"], 5, 2) if mode == "A" else ([0] + s["attack"] + [0], 4, 2)
    if mode == "A":
        rows = [0] + s["walk"]
        return (rows, 3, 3) if len(rows) == 9 else (rows, 4, 2)
    return [0] + s["attack"], 4, 2


def union_box(name, cells, pad=4, im=None):
    """Bounding box (in cell pixels) of the solid old body over several (col, row) cells, padded: the grids show only this part of
    each cell so Codex paints the creature big (Krallen's cells are mostly empty)."""
    w, h = SHEETS[name]["cell"]
    im = im or sheet(name)
    m = np.zeros((h, w), bool)
    for c, r in cells:
        m |= np.asarray(old_cell(name, c, r, im))[..., 3] >= 200
    ys, xs = np.where(m)
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad)
