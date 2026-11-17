"""Shared bits of the Inferno paint kit (beta 8, owner 12 + 17 Nov 2026: Codex for the Inferno buildings with no
animation, no 3D for still buildings). Grown from web/tools/pod-repaint/ (the approved painted Resource Pod).

Three buildings, each painted from Flash's own looks and fitted onto Flash's footprint, on Flash's own shadows:
- a = the Inferno ACADEMY (type 26 in an Inferno yard, buildings/iacademy/): 2 looks (level 1, levels 2-4), each
  with a damaged and a destroyed top (Flash has one shadow per look; damaged/destroyed fall back to it).
- b = the HOUSING BUNKER / Compound (type 128, buildings/ihousingbunker/): 1 look, damaged and destroyed.
- c = the INFERNO CAVERN (type 127, Moloch's cave on the MAIN yard, buildings/iportal/): 5 looks (cave levels 1-5),
  no damaged/destroyed; on the main yard Flash draws a shadow for look 5 only.

A look id is <building><level>[d|x], e.g. a1, a2d, b1x, c5 (d = damaged, x = destroyed). Every look is placed on its
building's shared 1x canvas (CW x CH, the origin at OX, OY); the painted pictures are kept at UP x.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets"
OUT = REPO / "art-samples" / "b8-inferno-paint"
UP = 4

# per building: folder, canvas (CW, CH, OX, OY), ground ("lava" or "grass"), looks {level: {state: (file, x, y)}}
# state keys: top, damaged, destroyed, shadow (the shadow the game draws under every state of that look; None = none)
B = {
    "a": dict(name="Academy", type=26, folder="iacademy", canvas=(240, 230, 120, 140), ground="lava", looks={
        1: dict(top=("top.1.png", -50, -55), damaged=("top.1.damaged.png", -48, -21),
                destroyed=("top.1.destroyed.png", -59, -21), shadow=("shadow.1.jpg", -50, -30)),
        2: dict(top=("top.2.png", -56, -95), damaged=("top.2.damaged.png", -56, -91),
                destroyed=("top.2.destroyed.png", -59, -76), shadow=("shadow.2.jpg", -61, -30)),
    }),
    "b": dict(name="Housing Bunker", type=128, folder="ihousingbunker", canvas=(320, 250, 160, 80), ground="lava", looks={
        1: dict(top=("top.1.v2.png", -110, -49), damaged=("top.1.damaged.v2.png", -106, -39),
                destroyed=("top.1.destroyed.v2.png", -73, 10), shadow=("shadow.1.jpg", -118, 26),
                dshadow=("shadow.1.damaged.jpg", -117, 30), xshadow=("shadow.1.destroyed.jpg", -96, 8)),
    }),
    "c": dict(name="Inferno Cavern", type=127, folder="iportal", canvas=(460, 400, 220, 200), ground="grass", looks={
        1: dict(top=("top.1.v2.png", -85, -5), shadow=None),
        2: dict(top=("top.2.v2.png", -105, -29), shadow=None),
        3: dict(top=("top.3.v2.png", -136, -64), shadow=None),
        4: dict(top=("top.4.v2.png", -140, -114), shadow=None),
        5: dict(top=("top.5.v2.png", -160, -172), shadow=("shadow.5.v2.jpg", -169, 0)),
    }),
}
TOPKEY = {"": "top", "damaged": "damaged", "destroyed": "destroyed"}
SHADOWKEY = {"": "shadow", "damaged": "dshadow", "destroyed": "xshadow"}


def parse(look):
    """'a2' -> ('a', 2, ''), 'a2d' -> ('a', 2, 'damaged'), 'b1x' -> ('b', 1, 'destroyed')."""
    st = "damaged" if look.endswith("d") else "destroyed" if look.endswith("x") else ""
    return look[0], int(look[1]), st


def canvas(b):
    return B[b]["canvas"]


def folder(b):
    return ASSETS / "buildings" / B[b]["folder"]


def flash_top(look):
    b, lv, st = parse(look)
    return B[b]["looks"][lv][TOPKEY[st]]


def flash_shadow(look):
    """The shadow the game draws under this look (a state with none of its own takes the look's own), or None."""
    b, lv, st = parse(look)
    L = B[b]["looks"][lv]
    return L.get(SHADOWKEY[st]) or L.get("shadow")


def flash_rgba(look):
    """The Flash look on its building's shared canvas (1x, clear ground)."""
    b = look[0]
    CW, CH, OX, OY = canvas(b)
    f, x, y = flash_top(look)
    c = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    c.alpha_composite(Image.open(folder(b) / f).convert("RGBA"), (OX + x, OY + y))
    return c


def ground(kind, w, h, seed=3):
    """The yard's ground tiled from Flash's 200x100 tiles: the Inferno's lava or the main yard's grass."""
    import glob
    pat = "*inferno_lava*.png" if kind == "lava" else "*isograss*.png"
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(ASSETS / "yardbg" / kind / pat)))]
    if kind == "grass":   # the plain grass tiles only, not the dirt ones
        tiles = [t for t in tiles if np.asarray(t).mean(axis=(0, 1))[1] > np.asarray(t).mean(axis=(0, 1))[0] * 1.2]
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
    if x1 > x0 and y1 > y0:
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


def key(rgb, keep_small=0.01):
    """RGBA cutout of a painting on flat green: the green ground flood-filled from the edge, rim despilled.
    keep_small: drop pieces smaller than this share of the biggest (0 keeps every piece: the Bunker's loose spikes)."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground_ = (g > 150) & (g > r * 1.45) & (g > b * 1.45)
    lab, _ = ndi.label(ground_)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ~np.isin(lab, list(edge))
    # enclosed holes of pure ground (between spikes, under arches) are ground too
    fg &= ~(ground_ & (g > 200) & (r < 90) & (b < 90))
    fg = ndi.binary_opening(fg, iterations=1)
    lab2, _ = ndi.label(fg)
    ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
    keep = np.zeros_like(fg)
    for i, c in zip(ids, cnt):
        if c > max(cnt.max() * keep_small, 40):
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


def body_mask(im):
    """The solid object of a Flash look (the Cavern's rocks without its soft ground of cracks and glow): its
    opaque pixels with thin lines (cracks) opened away, grown back by 2 px over the soft edge."""
    a = np.asarray(im)[..., 3]
    m = ndi.binary_opening(a >= 200, structure=np.ones((5, 5)))
    lab, _ = ndi.label(m)
    ids, cnt = np.unique(lab[lab > 0], return_counts=True)
    m = np.isin(lab, ids[cnt >= 25])
    return ndi.binary_dilation(m, iterations=2) & (a > 0)


def flash_body(look):
    """The Flash look with only its solid object (body_mask) kept."""
    im = flash_rgba(look)
    a = np.asarray(im).copy()
    a[..., 3] = np.where(body_mask(im), a[..., 3], 0)
    return Image.fromarray(a, "RGBA")


def flash_ground(look, sigma=6.0):
    """The Cavern's soft ground (cracks, lava glow, dark earth) without its rocks, on the shared canvas at 1x: Flash's
    look outside body_mask, and under it the ground around filled in (a normalised blur), fading out where no ground
    is near (above the spires)."""
    im = flash_rgba(look)
    a = np.asarray(im).astype(float)
    body = body_mask(im)
    al = np.where(body, 0, a[..., 3]) / 255
    pre = a[..., :3] * al[..., None]
    bl = ndi.gaussian_filter(al, sigma)
    fill = np.dstack([ndi.gaussian_filter(pre[..., i], sigma) for i in range(3)]) / np.maximum(bl, 1e-4)[..., None]
    rgb = np.where(body[..., None], fill, a[..., :3])
    alpha = np.where(body, np.clip(bl * 1.3, 0, 1), al)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype("uint8"), "RGBA")
