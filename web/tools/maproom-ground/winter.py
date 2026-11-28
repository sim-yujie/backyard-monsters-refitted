"""Winter copies of Map Room 2's ground tile sheets, for Christmas (owner, 27 Nov 2026: "a winter ground on
the Map Room 2 map").

usage (from web/):  python tools/maproom-ground/winter.py [--report]
needs numpy and Pillow.

For each sheet in public/maproom/ (`ground@2x.webp` and its pointy copies, Classic; `ground-painted*`, the
Modern look's tiles where its painted ground cannot draw), writes `<name>-winter@2x.webp` beside it: the
eleven tiles (`groundArt.ts`) with every LAND tile's top face (sand, the four grasses, the two rocks) turned to
snow by a luminance gradient map mixed over it, so each keeps its own grain and the cells still join; the
water and every cliff stay as they were. `groundArt.ts` loads the winter sheet only while it is Christmas.

`--report` prints each land tile's top-face average, for `WINTER_LAND` in `cellVisuals.ts` (the far view's
one colour per cell).
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "maproom"
SHEETS = [
    ("ground@2x.webp", "flat"),
    ("ground-pointy100@2x.webp", "pointy"),
    ("ground-pointy150@2x.webp", "pointy"),
    ("ground-painted@2x.webp", "flat"),
    ("ground-painted-pointy100@2x.webp", "pointy"),
    ("ground-painted-pointy150@2x.webp", "pointy"),
]
COLS, ROWS, CLIFF = 4, 3, 50
LAND = range(3, 11)
# Snow, dark to light: luminance 0..255 -> colour. Cool blue-grey shade, off-white light (never pure white,
# so the map's white plates and pins still read on it).
STOPS = [(0, (92, 104, 124)), (90, (160, 172, 190)), (170, (214, 222, 233)), (255, (242, 246, 250))]
# How much of the snow lies over the tile: the rocks keep a little more of their own shape.
AMOUNT = {9: 0.82, 10: 0.72}


def ramp():
    xs = np.arange(256, dtype=np.float32)
    out = np.zeros((256, 3), np.float32)
    for c in range(3):
        out[:, c] = np.interp(xs, [s[0] for s in STOPS], [s[1][c] for s in STOPS])
    return out


def face_mask(w, h, shape):
    """The top face of one tile (w x h, cliff below), as a 0..1 float mask."""
    face = h - CLIFF
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    if shape == "flat":
        q = w / 4
        pts = [(q, 0), (w - q, 0), (w, face / 2), (w - q, face), (q, face), (0, face / 2)]
    else:
        pts = [(w / 2, 0), (w, face / 4), (w, face * 3 / 4), (w / 2, face), (0, face * 3 / 4), (0, face / 4)]
    d.polygon(pts, fill=255)
    # A pixel past the edge, so no green rim is left where the face's antialiased edge was.
    im = im.filter(ImageFilter.MaxFilter(5))
    return np.asarray(im, np.float32)[..., None] / 255


def winter(path, shape, table, report):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    W, H = im.size
    w, h = W // COLS, H // ROWS
    mask = face_mask(w, h, shape)
    for index in LAND:
        x, y = (index % COLS) * w, (index // COLS) * h
        tile = a[y:y + h, x:x + w, :3]
        lum = (tile @ np.array([0.299, 0.587, 0.114], np.float32)).clip(0, 255)
        # Spread the tile's own light over the ramp, so dark grass and pale sand both come out snow.
        lo, hi = np.percentile(lum[mask[..., 0] > 0.5], [2, 98])
        # (the cliff below the face keeps its earth: the mask stops at the face's lower edges)
        spread = ((lum - lo) / max(hi - lo, 1) * 150 + 95).clip(0, 255).astype(np.uint8)
        snow = table[spread]
        k = mask * AMOUNT.get(index, 0.92)
        a[y:y + h, x:x + w, :3] = tile * (1 - k) + snow * k
        if report:
            face = a[y:y + h, x:x + w, :3][mask[..., 0] > 0.5].mean(0)
            print(f"  tile {index}: 0x{int(face[0]):02x}{int(face[1]):02x}{int(face[2]):02x}")
    out = path.with_name(path.name.replace("@2x.webp", "-winter@2x.webp"))
    Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA").save(out, quality=82, method=6)
    print(out.name, out.stat().st_size // 1024, "KB")


def main():
    report = "--report" in sys.argv
    table = ramp()
    for name, shape in SHEETS:
        path = PUBLIC / name
        if path.exists():
            winter(path, shape, table, report)


if __name__ == "__main__":
    main()
