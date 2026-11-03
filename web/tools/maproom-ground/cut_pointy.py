"""Cuts Map Room 2's ground tile sheets to the pointy-top hex shape.

usage: python cut_pointy.py <flat sheet.webp> <out.webp> <cell height in points>

MR2 look plan step 1 (`MR2_HEX_SHAPE=pointy`): the world's hexes turn
pointy-top, and Classic keeps Flash's own pixels (owner, 3 Nov 2026: no new
painting). This reads a flat-top sheet laid out as `groundArt.ts` expects
(eleven 300 x 200 px tiles, four a row: a 300 x 150 hex top face and 50 px of
cliff) and writes the same eleven tiles cut to a pointy-top cell 150 points
wide and `<cell height>` points tall (100 for Classic, 150 for Modern; see
`POINTY_CELL_HEIGHT` in `web/src/config.ts`), with the same 25 points of cliff
below its two lower edges:

- The top face is Flash's face at its own scale (Classic; stretched to the
  taller top-down cell for Modern), its texture carried past the flat face's
  rim into the new hex's corners by mirroring across the rim (just inside
  its thin dark line, which the grid's own outline replaces).
- The cliff under the lower-left edge is Flash's lighter left cliff face and
  the one under the lower-right edge its darker right face (each 75 px face
  read forwards, then mirrored, across the new 150 px half), each column
  shifted down to hang from the new edge.

Run from the repo root:
  python web/tools/maproom-ground/cut_pointy.py web/public/maproom/ground@2x.webp web/public/maproom/ground-pointy100@2x.webp 100
  python web/tools/maproom-ground/cut_pointy.py web/public/maproom/ground@2x.webp web/public/maproom/ground-pointy150@2x.webp 150
  python web/tools/maproom-ground/cut_pointy.py web/public/maproom/ground-painted@2x.webp web/public/maproom/ground-painted-pointy150@2x.webp 150
"""

import sys

import numpy as np
from PIL import Image

# The flat-top sheet, in @2x pixels.
TILE_W, TILE_H, FACE_H, COLS, ROWS, COUNT = 300, 200, 150, 4, 3, 11
CLIFF = 50  # 25 points of cliff at @2x
HALF_W = TILE_W / 2  # 150: half a cell's width
FLAT_HALF_H = FACE_H / 2  # 75: half the flat face's height
# Flat-top cliff faces: the left one under the lower-left edge (x < 75), the
# right one under the lower-right edge (x >= 225).
FLAT_LEFT_FACE = (0, 75)
FLAT_RIGHT_FACE = (225, 300)


def pointy_norm(u, v):
    """Hex norm of a pointy-top hex with corners (0, +-1), (+-1, +-0.5)."""
    return np.maximum(np.abs(u), np.abs(v) + 0.5 * np.abs(u))


# The flat face, inset from its rim: |y| <= 75 s and |x| + |y| <= 150 s.
INSET = 0.94
SQRT2 = np.sqrt(2)
MIRRORS = [
    (np.array([0.0, 1.0]), FLAT_HALF_H * INSET),
    (np.array([0.0, -1.0]), FLAT_HALF_H * INSET),
    (np.array([1.0, 1.0]) / SQRT2, HALF_W * INSET / SQRT2),
    (np.array([-1.0, 1.0]) / SQRT2, HALF_W * INSET / SQRT2),
    (np.array([1.0, -1.0]) / SQRT2, HALF_W * INSET / SQRT2),
    (np.array([-1.0, -1.0]) / SQRT2, HALF_W * INSET / SQRT2),
]


def mirror_into_face(x, y):
    """Folds points (centred, pixels) into the inset flat face by mirroring across its sides."""
    x = x.astype(float).copy()
    y = y.astype(float).copy()
    for _ in range(12):
        moved = False
        for n, d in MIRRORS:
            over = n[0] * x + n[1] * y - d
            out = over > 0
            if out.any():
                moved = True
                x = np.where(out, x - 2 * over * n[0], x)
                y = np.where(out, y - 2 * over * n[1], y)
        if not moved:
            break
    return x, y


def flat_bottom_edge(x):
    """The flat face's lower edge, in tile pixels, at tile column x (0..299)."""
    dx = np.abs(x + 0.5 - HALF_W)
    return np.where(dx <= HALF_W / 2, FACE_H, FLAT_HALF_H + (HALF_W - dx) * (FLAT_HALF_H / (HALF_W / 2)))


def cut_tile(tile, cell_h):
    """One flat-top tile (200 x 300 x 4) to one pointy-top tile."""
    face_h = cell_h * 2  # @2x
    half_h = face_h / 2
    out_h = face_h + CLIFF
    out = np.zeros((out_h, TILE_W, 4), dtype=np.uint8)

    ys, xs = np.mgrid[0:out_h, 0:TILE_W]
    px = xs + 0.5 - HALF_W
    py = ys + 0.5 - half_h
    u = px / HALF_W
    v = py / half_h

    # Top face: inside the pointy hex, Flash's face at its own scale (Classic)
    # or stretched up to the taller top-down cell (Modern), its texture
    # carried past the flat face's rim by mirroring across the rim (just
    # inside the rim's thin dark line, so the line is not copied in).
    n_p = pointy_norm(u, v)
    inside = n_p <= 1.0
    stretch = cell_h / 100
    fx, fy = mirror_into_face(px, py / stretch)
    face = tile[np.round(fy + FLAT_HALF_H - 0.5).astype(int).clip(0, FACE_H - 1),
                np.round(fx + HALF_W - 0.5).astype(int).clip(0, TILE_W - 1)]
    out[inside] = face[inside]
    out[inside, 3] = 255

    # Cliff: below the two lower edges, down to the tile's bottom.
    edge = half_h + half_h / 2 + (HALF_W - np.abs(xs + 0.5 - HALF_W)) * ((half_h / 2) / HALF_W)
    below = (~inside) & (ys + 0.5 > half_h) & (ys + 0.5 >= edge - 1)
    left = xs < HALF_W
    # Which flat column feeds this one: the left face for the left half, the
    # right face for the right half, at its own scale (each 75 px face read
    # forwards then mirrored back across the 150 px half).
    lo_l, hi_l = FLAT_LEFT_FACE
    lo_r, hi_r = FLAT_RIGHT_FACE
    width = hi_l - lo_l
    along = np.where(left, xs, xs - int(HALF_W))
    fold = np.where(along < width, along, 2 * width - 1 - along).clip(0, width - 1)
    src_x = np.where(left, lo_l + fold, hi_r - 1 - fold)
    depth = ys + 0.5 - edge
    src_y = np.clip(np.round(flat_bottom_edge(src_x) + 1 + depth), 0, TILE_H - 1).astype(int)
    cliff = tile[src_y, src_x]
    # A band of cliff as deep as Flash's under its front edge; past that the
    # cells of the next row cover the tile anyway.
    band = below & (depth < CLIFF)
    out[band] = cliff[band]
    return out


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    src, dst, cell_h = sys.argv[1], sys.argv[2], int(sys.argv[3])
    sheet = np.array(Image.open(src).convert("RGBA"))
    assert sheet.shape[:2] == (TILE_H * ROWS, TILE_W * COLS), sheet.shape
    out_h = cell_h * 2 + CLIFF
    out = np.zeros((out_h * ROWS, TILE_W * COLS, 4), dtype=np.uint8)
    for index in range(COUNT):
        r, c = divmod(index, COLS)
        tile = sheet[r * TILE_H : (r + 1) * TILE_H, c * TILE_W : (c + 1) * TILE_W]
        out[r * out_h : (r + 1) * out_h, c * TILE_W : (c + 1) * TILE_W] = cut_tile(tile, cell_h)
    Image.fromarray(out).save(dst, "WEBP", quality=88, method=6)
    print(f"{dst}: {out.shape[1]} x {out.shape[0]}, tiles 300 x {out_h}")


if __name__ == "__main__":
    main()
