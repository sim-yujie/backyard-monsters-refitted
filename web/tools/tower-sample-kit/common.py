"""Shared bits of the tower sample kit: the old Flash tower pictures, put together the way the yard draws them.

A tower is: shadow JPEG (multiplied onto the grass), base picture ("top"), then one frame of its animation strip on top,
each placed at its offset from the building's origin (rows copied from web/src/game/yard/buildingArtData.ts).
All samples and Codex output live in <worktree>/art-samples/towers/<tower>/.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets"
OUT = REPO / "art-samples" / "towers"

# name: folder, button id, top [file, x, y, (w, h)], shadow [file, x, y], anim [file, x, y, w, h, frames] or None,
#       frame = the strip frame shown in the sample, what = words for the prompt
TOWERS = {
    "cannon": dict(folder="cannontower", button=20, top=("top.3.png", -33, -25), shadow=("shadow.3.jpg", -38, 20), anim=None, frame=0,
                   what="the CANNON TOWER: a red-and-white striped drum on three tan stone feet, a tan ring frame with curved prongs around the top, and a wide grey steel cannon tube in the middle"),
    "sniper": dict(folder="snipertower", button=21, top=("top.3.png", -40, -30), shadow=("shadow.3.jpg", -43, 12),
                   anim=("anim.3.png", -27, -50, 55, 47, 30), frame=0,
                   what="the SNIPER TOWER: a tan octagonal tower with red-and-white striped corners, standing on four short legs with round iron ball feet, red and blue wires on its side, and a round silver domed gun turret with a barrel on its top deck"),
    "bunker": dict(folder="bunker", button=22, top=("anim.1.png", -46, -15, 90, 83), shadow=("shadow.1.jpg", -66, 10), anim=None, frame=0,
                   what="the MONSTER BUNKER: a low grey metal bunker with red-and-white striped sloping roof panels, a grated metal vent box on top, wooden log beams, and a dark round door at the front where monsters come out"),
    "laser": dict(folder="lasertower", button=23, top=("top.1.png", -33, -29), shadow=("shadow.1.jpg", -36, 15),
                  anim=("anim.1.png", -13, -50, 29, 32, 54), frame=0,
                  what="the LASER TOWER: a grey-green metal box with a yellow hazard triangle, on a red-and-white striped base with black rubber bumpers, with a metal cage on top holding a laser head with a blue lens"),
    "tesla": dict(folder="lightningtower", button=25, top=("top.3.png", -33, -57), shadow=("shadow.3.jpg", -38, 18),
                  anim=("anim.3.png", -25, -15, 27, 53, 55), frame=0,
                  what="the TESLA TOWER: a tall tan box tower with red-and-white striped poles at the corners, a copper coil and wires inside, topped by a big silver mushroom-shaped dome electrode"),
    "aerial": dict(folder="flaktower", button=115, top=("top.3.png", -39, 6), shadow=("shadow.3.jpg", -43, 14),
                   anim=("anim.3.png", -32, -23, 62, 52, 32), frame=26,
                   what="the AERIAL DEFENSE TOWER: a low square metal platform with red-and-white striped sides and grated panels, with a tan armoured anti-air gun turret with twin long barrels aimed up into the sky"),
    "railgun": dict(folder="railguntower", button=118, top=("top.3.png", -39, 7), shadow=("shadow.3.jpg", -40, 20),
                    anim=("anim.3.loaded.png", -49, -9, 96, 56, 32), frame=0,
                    what="the RAILGUN: a red-and-white striped pyramid base with a red turret carrying two gold coil capacitors and a long twin-rail gun barrel with a glowing blue core"),
    # Town Hall, top level (10): no animation; used by the building-redesign samples
    "townhall": dict(folder="townhall", button=14, top=("top.10.png", -77, -110), shadow=("shadow.10.jpg", -85, 24), anim=None, frame=0,
                     what="the TOWN HALL, the main building of the yard"),
}
# Town Hall levels 1-10 (top / shadow rows from buildingArtData.ts): each level has its own Flash picture; the redesign samples
# paint tiers 1-2 (levels 2 and 5) and, per the owner (25 Oct night), one picture per level (L1..L10) from them
TH_ROWS = {1: (-45, -52, -55, 37), 2: (-48, -62, -55, 36), 3: (-65, -67, -70, 28), 4: (-66, -72, -88, 20), 5: (-67, -75, -67, 33),
           6: (-72, -82, -84, 26), 7: (-81, -88, -121, -3), 8: (-80, -87, -94, 8), 9: (-77, -97, -76, 24), 10: (-77, -110, -85, 24)}
for _n, (_tx, _ty, _sx, _sy) in TH_ROWS.items():
    TOWERS[f"townhall{_n}"] = dict(folder="townhall", button=f"14.{_n}", top=(f"top.{_n}.png", _tx, _ty), shadow=(f"shadow.{_n}.jpg", _sx, _sy),
                                   anim=None, frame=0, what=f"the TOWN HALL at level {_n}")


def img(t, f):
    return Image.open(ASSETS / "buildings" / TOWERS[t]["folder"] / f)


def layers(t):
    """[(RGBA image, x, y)] of the old tower above its origin, without the shadow."""
    d = TOWERS[t]
    f, x, y, *wh = d["top"]
    top = img(t, f).convert("RGBA")
    if wh:
        top = top.crop((0, 0, wh[0], wh[1]))
    out = [(top, x, y)]
    if d["anim"]:
        f, x, y, w, h, n = d["anim"]
        s = img(t, f).convert("RGBA")
        i = d["frame"]
        out.append((s.crop((i * w, 0, (i + 1) * w, h)), x, y))
    return out


def bbox(t, pad=6):
    """Box (x0, y0, x1, y1) around the tower and its shadow, relative to the origin."""
    d = TOWERS[t]
    boxes = [(x, y, x + im.width, y + im.height) for im, x, y in layers(t)]
    f, x, y = d["shadow"]
    sh = img(t, f)
    boxes.append((x, y, x + sh.width, y + sh.height))
    return (min(b[0] for b in boxes) - pad, min(b[1] for b in boxes) - pad,
            max(b[2] for b in boxes) + pad, max(b[3] for b in boxes) + pad)


def grass(w, h, seed=3):
    """The yard's grass, tiled from the 200x100 Flash tiles."""
    import glob
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(ASSETS / "yardbg" / "grass" / "*.png")))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]   # grass only, no bare earth
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g


def shadow_on(bg, t, ox, oy):
    """Multiply the tower's shadow JPEG onto bg (origin at ox, oy)."""
    f, x, y = TOWERS[t]["shadow"]
    sh = img(t, f).convert("RGB")
    a = np.asarray(bg).astype(float)
    region = a[oy + y: oy + y + sh.height, ox + x: ox + x + sh.width]
    s = np.asarray(sh).astype(float)[: region.shape[0], : region.shape[1]]
    a[oy + y: oy + y + s.shape[0], ox + x: ox + x + s.shape[1]] = region * s / 255
    return Image.fromarray(a.astype("uint8"))


def old_on(bg, t, ox, oy, with_shadow=True):
    """The old tower drawn on bg (RGB) with its origin at (ox, oy)."""
    b = shadow_on(bg, t, ox, oy) if with_shadow else bg.copy()
    b = b.convert("RGBA")
    for im, x, y in layers(t):
        b.alpha_composite(im, (ox + x, oy + y))
    return b.convert("RGB")


def old_rgba(t):
    """The old tower (no shadow) on a clear canvas the size of bbox; returns (image, origin x, origin y)."""
    x0, y0, x1, y1 = bbox(t)
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, x, y in layers(t):
        c.alpha_composite(im, (x - x0, y - y0))
    return c, -x0, -y0


def on(bg, im):
    b = Image.new("RGBA", im.size, tuple(bg) + (255,))
    b.alpha_composite(im.convert("RGBA"))
    return b.convert("RGB")


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes)."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def key(rgb):
    """RGBA cutout: the green ground flood-filled from the edge, rim despilled."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground = (g > 170) & (r < 120) & (b < 120)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ~np.isin(lab, list(edge))
    # enclosed holes of pure ground (between barrels, under a cage) are ground too
    fg &= ~(ground & (g > 220) & (r < 60) & (b < 60))
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
