"""Shared bits of the Monster Locker repaint kit (beta 7, owner decision 34: a Codex-painted Modern Locker).

The Flash Locker, put together the way the yard draws it (rows from web/src/game/yard/buildingArtData.ts, type 8):
shadow JPEG multiplied onto the grass, then the top picture, then cell 0 of its animation strip (the key and, from
level 2, the gold cogs: Flash's top pictures have a hole where the strip goes). Damaged looks have no strip.
Everything is placed on one shared 1x canvas, CANVAS, origin at (OX, OY), so every look lines up.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets"
FOLDER = ASSETS / "buildings" / "monsterlocker"
OUT = REPO / "art-samples" / "locker"

# Flash's four looks (levels 1-4): top, damaged top, shadow, damaged shadow, anim strip [file, x, y, w, h, frames]
LOOKS = {
    1: dict(top=("top.1.png", -31, -29), damaged=("top.1.damaged.png", -38, -23), shadow=("shadow.1.jpg", -27, 37),
            dshadow=("shadow.1.damaged.jpg", -52, 26), anim=("anim.1.png", -42, -44, 36, 41, 21)),
    2: dict(top=("top.2.png", -51, -64), damaged=("top.2.damaged.png", -57, -47), shadow=("shadow.2.jpg", -40, 18),
            dshadow=("shadow.2.damaged.jpg", -52, 26), anim=("anim.2.png", -46, -93, 61, 69, 20)),
    3: dict(top=("top.3.png", -53, -79), damaged=("top.3.damaged.png", -54, -69), shadow=("shadow.3.jpg", -55, 23),
            dshadow=("shadow.3.damaged.jpg", -56, 31), anim=("anim.3.png", -48, -90, 87, 89, 20)),
    4: dict(top=("top.4.png", -54, -98), damaged=("top.4.damaged.png", -69, -78), shadow=("shadow.4.jpg", -54, 30),
            dshadow=("shadow.4.damaged.jpg", -59, 30), anim=("anim.4.png", -50, -91, 92, 89, 21)),
}
DESTROYED = dict(top=("top.2.destroyed.png", -53, -41), shadow=("shadow.2.destroyed.jpg", -52, 25))

# the shared 1x canvas: x -110..110, y -150..110 from the building's origin
CW, CH, OX, OY = 220, 260, 110, 150
UP = 4                                    # the painted pictures are kept at 4x


def img(f):
    return Image.open(FOLDER / f)


def flash_layers(level, state="", frame=0):
    """[(RGBA, x, y)] of the Flash look (no shadow). state: '' | 'damaged' | 'destroyed'."""
    if state == "destroyed":
        f, x, y = DESTROYED["top"]
        return [(img(f).convert("RGBA"), x, y)]
    d = LOOKS[level]
    f, x, y = d["damaged" if state == "damaged" else "top"]
    out = [(img(f).convert("RGBA"), x, y)]
    if state != "damaged":
        f, x, y, w, h, _n = d["anim"]
        out.append((img(f).convert("RGBA").crop((frame * w, 0, (frame + 1) * w, h)), x, y))
    return out


def flash_shadow(level, state=""):
    if state == "destroyed":
        return DESTROYED["shadow"]
    return LOOKS[level]["dshadow" if state == "damaged" else "shadow"]


def flash_rgba(level, state="", frame=0):
    """The Flash look on the shared canvas (1x, clear ground)."""
    c = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    for im, x, y in flash_layers(level, state, frame):
        c.alpha_composite(im, (OX + x, OY + y))
    return c


def grass(w, h, seed=3):
    """The yard's grass, tiled from the 200x100 Flash tiles."""
    import glob
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(ASSETS / "yardbg" / "grass" / "*.png")))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
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
    ground = (g > 150) & (g > r * 1.45) & (g > b * 1.45)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ~np.isin(lab, list(edge))
    # enclosed holes of pure ground (inside the key's ring, between legs) are ground too
    fg &= ~(ground & (g > 200) & (r < 90) & (b < 90))
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
