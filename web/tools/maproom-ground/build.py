"""Builds Map Room 2's painted ground sheet from one Codex texture sheet.

usage: python build.py <codex sheet.png> <out.webp> [--water calm] [--report]

The Codex sheet is 1536 x 1024: six square, tileable swatches in a 3 x 2 grid
(water, sand, grass / dark grass, stone, earth). Out comes a sheet laid out
like Flash's (`web/public/maproom/ground@2x.webp`, see `groundArt.ts`): eleven
300 x 200 tiles, four a row, each a 300 x 150 hex top and 50 px of cliff.

- Each tile keeps its Flash tile's colour: the swatch is shifted to the Flash
  face's (or cliff's) average and spread, so the far view's one colour per
  cell (`TERRAIN_BANDS` in `cellVisuals.ts`) still matches.
- The top faces are cut from the swatch wrapped onto the map's cell lattice
  (columns 112.5 points apart, odd ones half a row down), so neighbouring
  cells of one kind join without a seam.
- `--water calm` tones the three waters down (less cyan, a little darker).
  Shown to the owner with the water sheet in `MapChunk.ts` at 0x2a8fc8, 0.4
  (Flash's is 0x00ccff, 0.5); not wired.
- `--report` prints each tile's top-face average, for `TERRAIN_BANDS`.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FLASH = "web/public/maproom/ground@2x.webp"
TILE_W, TILE_H, FACE_H, COLS = 300, 200, 150, 4
# One cell step on the lattice, in sheet pixels: (225, 75) and (0, 150).
STEP_X, STEP_Y = 225, 150
SWATCH, INSET = 512, 10

WATER, SAND, GRASS, DARK, STONE, EARTH = range(6)
# Tile index -> (top swatch, lattice offset in cells so repeats differ).
TOPS = [
    (WATER, (0.0, 0.0)), (WATER, (0.37, 0.21)), (WATER, (0.71, 0.55)),
    (SAND, (0.0, 0.0)), (SAND, (0.5, 0.33)),
    (GRASS, (0.0, 0.0)), (GRASS, (0.31, 0.6)), (GRASS, (0.63, 0.17)), (DARK, (0.0, 0.0)),
    (DARK, (0.45, 0.4)),
    (STONE, (0.0, 0.0)),
]
# How much of the painted contrast to keep against Flash's (1 = Flash's spread).
CONTRAST = 0.6


def swatches(path):
    sheet = np.asarray(Image.open(path).convert("RGB").resize((1536, 1024), Image.LANCZOS), dtype=np.float32)
    out = []
    for i in range(6):
        x, y = (i % 3) * SWATCH, (i // 3) * SWATCH
        out.append(seamless(sheet[y + INSET : y + SWATCH - INSET, x + INSET : x + SWATCH - INSET]))
    return out


def seamless(img):
    """Blend the swatch with itself rolled by half, weighted so neither's seam shows."""
    h, w, _ = img.shape
    rolled = np.roll(img, (h // 2, w // 2), (0, 1))
    wy = 1 - np.abs(np.linspace(-1, 1, h))
    wx = 1 - np.abs(np.linspace(-1, 1, w))
    weight = np.minimum.outer(wy, wx)[..., None]
    weight = np.clip(weight * 2.5, 0, 1)  # the original wins everywhere but near its edges
    return img * weight + rolled * (1 - weight)


def resize(img, size):
    return np.asarray(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize(size, Image.LANCZOS), dtype=np.float32)


def masks():
    """Top face and whole tile (face plus 50 px cliff), anti-aliased, 0..1."""
    hexagon = [(0, 75), (75, 0), (225, 0), (300, 75), (225, 150), (75, 150)]
    hull = [(0, 75), (75, 0), (225, 0), (300, 75), (300, 125), (225, 200), (75, 200), (0, 125)]
    big = 4

    def draw(points):
        im = Image.new("L", (TILE_W * big, TILE_H * big), 0)
        ImageDraw.Draw(im).polygon([(x * big, y * big) for x, y in points], fill=255)
        return np.asarray(im.resize((TILE_W, TILE_H), Image.LANCZOS), dtype=np.float32) / 255

    return draw(hexagon), draw(hull)


def lattice_top(swatch, offset):
    """The swatch wrapped onto the cell lattice, as one tile's 300 x 200 pixels."""
    period = resize(swatch, (STEP_X, STEP_Y))
    ys, xs = np.mgrid[0:TILE_H, 0:TILE_W]
    u = (xs + offset[0] * STEP_X) % STEP_X
    v = (ys - xs / 3 + offset[1] * STEP_Y) % STEP_Y
    return period[v.astype(int) % STEP_Y, u.astype(int) % STEP_X]


def cliff_texture(swatch):
    """Earth for the cliff sides: the swatch at half size, tiled straight."""
    small = resize(swatch, (swatch.shape[1] // 2, swatch.shape[0] // 2))
    reps = (TILE_H // small.shape[0] + 1, TILE_W // small.shape[1] + 1, 1)
    return np.tile(small, reps)[:TILE_H, :TILE_W]


def match(img, region, target, target_region):
    """Shift img's colour (inside region) to target's average and spread (inside target_region)."""
    sel, tsel = region > 0.9, target_region > 0.9
    out = img.copy()
    for c in range(3):
        sm, ss = img[..., c][sel].mean(), img[..., c][sel].std() + 1e-3
        tm, ts = target[..., c][tsel].mean(), target[..., c][tsel].std()
        spread = ts / ss * CONTRAST + (1 - CONTRAST)
        out[..., c] = (img[..., c] - sm) * spread + tm
    return out


def calm(rgb):
    """Toned-down water: a little less saturated and darker, nudged from cyan towards blue."""
    grey = rgb.mean(axis=2, keepdims=True)
    out = grey + (rgb - grey) * 0.85
    out = out * 0.88
    out[..., 1] *= 0.93
    out[..., 2] *= 1.04
    return out


def shade_cliff(tile, face, whole):
    """Darker towards the bottom, the right side darker than the left, and a dark lip under the face."""
    ys, xs = np.mgrid[0:TILE_H, 0:TILE_W].astype(np.float32)
    # Depth below the face's lower edge at this column.
    edge = np.where(xs < 75, 75 + xs, np.where(xs > 225, 75 + (300 - xs), 150))
    depth = np.clip((ys - edge) / 50, 0, 1)
    side = np.where(xs < 75, 1.0, np.where(xs > 225, 0.72, 0.86))
    light = side * (1 - 0.35 * depth)
    lip = np.exp(-np.clip(ys - edge, 0, None) / 2.5) * 0.35
    light = light * (1 - lip)
    cliff = (whole - face).clip(0, 1)[..., None]
    return tile * (1 - cliff) + tile * light[..., None] * cliff


def main():
    args = sys.argv[1:]
    src, out = args[0], args[1]
    calm_water = "--water" in args and args[args.index("--water") + 1] == "calm"
    sw = swatches(src)
    flash = np.asarray(Image.open(FLASH).convert("RGBA"), dtype=np.float32)
    face, whole = masks()
    cliff_only = (whole - face).clip(0, 1)
    sheet = np.zeros((TILE_H * 3, TILE_W * COLS, 4), dtype=np.float32)
    earth = cliff_texture(sw[EARTH])
    for index, (top_kind, offset) in enumerate(TOPS):
        x, y = (index % COLS) * TILE_W, (index // COLS) * TILE_H
        ref = flash[y : y + TILE_H, x : x + TILE_W, :3]
        ref_alpha = flash[y : y + TILE_H, x : x + TILE_W, 3] / 255
        top = match(lattice_top(sw[top_kind], offset), face, ref, face * ref_alpha)
        if calm_water and index < 3:
            top = calm(top)
        side = match(earth, cliff_only, ref, cliff_only * ref_alpha)
        tile = top * face[..., None] + side * (1 - face[..., None])
        tile = shade_cliff(tile, face, whole)
        sheet[y : y + TILE_H, x : x + TILE_W, :3] = tile
        sheet[y : y + TILE_H, x : x + TILE_W, 3] = whole * 255
        if "--report" in args:
            sel = face > 0.9
            mean = [int(round(top[..., c][sel].clip(0, 255).mean())) for c in range(3)]
            print(f"tile {index}: 0x{mean[0]:02x}{mean[1]:02x}{mean[2]:02x}")
    image = Image.fromarray(sheet.clip(0, 255).astype(np.uint8), "RGBA")
    image.save(out, quality=88, method=6) if out.endswith(".webp") else image.save(out)


if __name__ == "__main__":
    main()
