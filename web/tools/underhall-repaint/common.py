"""Shared bits of the Under Hall repaint kit (beta 7, owner on Desk 4, 6 Nov 2026: "Underhall can be repainted").

Adapted from web/tools/locker-repaint/ (the Codex-painted Monster Locker). The Under Hall is the Inferno's centre
building (type 14 in an Inferno yard, folder buildings/itownhall/, rows from web/src/game/yard/buildingArtInfernoData.ts):
three looks (level 1, level 2, levels 3-6), each with its own damaged and destroyed picture and shadow, no animation.
Everything is placed on one shared 1x canvas (CW x CH, the building's origin at (OX, OY)), so every look lines up.
The ground in the comparison sheets is the Inferno yard's lava, not grass.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets"
FOLDER = ASSETS / "buildings" / "itownhall"
OUT = REPO / "art-samples" / "underhall"

# Flash's three looks: [top, damaged, destroyed, shadow, damaged shadow, destroyed shadow] (file, x, y)
LOOKS = {
    1: dict(top=("top.1.v2.png", -52, -31), damaged=("top.1.damaged.v2.png", -56, -33),
            destroyed=("top.1.destroyed.v2.png", -63, 10), shadow=("shadow.1.v2.jpg", -65, 49),
            dshadow=("shadow.1.damaged.v2.jpg", -65, 47), xshadow=("shadow.1.destroyed.v2.jpg", -68, 43)),
    2: dict(top=("top.2.v2.png", -50, -46), damaged=("top.2.damaged.v2.png", -49, -46),
            destroyed=("top.2.destroyed.v2.png", -52, 5), shadow=("shadow.2.v2.jpg", -70, 35),
            dshadow=("shadow.2.damaged.v2.jpg", -59, 44), xshadow=("shadow.2.destroyed.v2.jpg", -76, 33)),
    3: dict(top=("top.3.v2.png", -51, -57), damaged=("top.3.damaged.v2.png", -56, -55),
            destroyed=("top.3.destroyed.v2.png", -62, -12), shadow=("shadow.3.v2.jpg", -74, 35),
            dshadow=("shadow.3.damaged.v2.jpg", -73, 33), xshadow=("shadow.3.destroyed.v2.jpg", -75, 29)),
}
TOPKEY = {"": "top", "damaged": "damaged", "destroyed": "destroyed"}
SHADOWKEY = {"": "shadow", "damaged": "dshadow", "destroyed": "xshadow"}

# the shared 1x canvas: x -85..145, y -85..185 from the building's origin
CW, CH, OX, OY = 230, 270, 85, 85
UP = 4                                    # the painted pictures are kept at 4x


def parse(look):
    """'2' -> (2, ''), '2d' -> (2, 'damaged'), '2x' -> (2, 'destroyed')."""
    state = "damaged" if look.endswith("d") else "destroyed" if look.endswith("x") else ""
    return int(look[0]), state


def img(f):
    return Image.open(FOLDER / f)


def flash_layers(level, state=""):
    f, x, y = LOOKS[level][TOPKEY[state]]
    return [(img(f).convert("RGBA"), x, y)]


def flash_shadow(level, state=""):
    return LOOKS[level][SHADOWKEY[state]]


def flash_rgba(level, state=""):
    """The Flash look on the shared canvas (1x, clear ground)."""
    c = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    for im, x, y in flash_layers(level, state):
        c.alpha_composite(im, (OX + x, OY + y))
    return c


def ground(w, h, seed=3):
    """The Inferno yard's lava ground, tiled from Flash's 200x100 lava tiles."""
    import glob
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(ASSETS / "yardbg" / "lava" / "*inferno_lava*.png")))]
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g


def multiply(bg, sh, x, y):
    """Multiply a shadow JPEG (RGB) onto bg at (x, y)."""
    a = np.asarray(bg.convert("RGB")).astype(float)
    s = np.asarray(sh.convert("RGB")).astype(float)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(a.shape[1], x + s.shape[1]), min(a.shape[0], y + s.shape[0])
    a[y0:y1, x0:x1] *= s[y0 - y:y1 - y, x0 - x:x1 - x] / 255
    return Image.fromarray(a.astype("uint8"))


def on(bg, im):
    b = Image.new("RGBA", im.size, tuple(bg) + (255,))
    b.alpha_composite(im.convert("RGBA"))
    return b.convert("RGB")


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes)."""
    a = np.asarray(im.convert("RGBA")).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def key(rgb):
    """RGBA cutout of a painting on flat green: the green ground flood-filled from the edge, rim despilled."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground_ = (g > 150) & (g > r * 1.45) & (g > b * 1.45)
    lab, _ = ndi.label(ground_)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ~np.isin(lab, list(edge))
    # enclosed holes of pure ground (between legs, under arches) are ground too
    fg &= ~(ground_ & (g > 200) & (r < 90) & (b < 90))
    fg = ndi.binary_opening(fg, iterations=1)
    lab2, _ = ndi.label(fg)
    ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
    keep = np.zeros_like(fg)
    for i, c in zip(ids, cnt):
        if c > cnt.max() * 0.01:
            keep |= lab2 == i
    keep = ndi.binary_erosion(keep, iterations=1)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    o = rgb.copy()
    spill = (alpha > 0) & (g > np.maximum(r, b))
    o[..., 1] = np.where(spill, np.maximum(r, b), g)    # green fringe -> neutral
    return Image.fromarray(np.dstack([o, alpha]).astype("uint8"), "RGBA")


def band(im, thr):
    """(left, right, bottom, top) of the solid shape, left/right measured over its bottom 30%."""
    m = np.asarray(im)[..., 3] >= thr
    ys, xs = np.where(m)
    top, bot = ys.min(), ys.max() + 1
    cut = bot - 0.3 * (bot - top)
    sel = ys >= cut
    return xs[sel].min(), xs[sel].max() + 1, bot, top
