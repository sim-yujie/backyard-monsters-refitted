"""Builds the champion-ability effect sheets from the Codex sheets.

python3 -I art-samples/ability-fx/build_atlas.py <worktree>   (the Codex sheets beside it, m1 m2 c1)
Writes server/public/assets/fx/ability-fx.modern.webp and ability-fx.classic.webp:
24 cells of 192 px, 6 across, 4 down, in the order of ABILITY_CELLS (web/src/game/attack/abilityBits.ts).
Row 1-2: the solid pieces (m1 Modern / c1 Classic, keyed off magenta).
Row 3: the light pieces (m2, black ground: alpha from brightness, white), shared by both looks.
Row 4: six cells copied from the towers' sheet (fx/tower-fx.png): smoke, debris, ring, wisp, glow, burst.
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter

sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from artlib import cells, clean, key  # noqa: E402

WT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
CELL = 192
COLS = 6
FIT = 176
TOWER_CELLS = ["smoke", "debris", "ring", "wisp", "glow", "burst"]
TOWER_ORDER = ["glow", "flare", "muzzle", "spark", "burst", "zap", "smoke", "wisp", "ring", "orb", "beam",
               "scorch", "flak", "shrapnel", "rifleflash", "ricochet", "debris", "shell", "fireball", "aaflash"]


def fit(piece, size=FIT):
    box = piece.getbbox()
    if not box:
        return Image.new("RGBA", (CELL, CELL))
    piece = piece.crop(box)
    z = min(size / piece.width, size / piece.height)
    piece = piece.resize((max(1, round(piece.width * z)), max(1, round(piece.height * z))), Image.LANCZOS)
    out = Image.new("RGBA", (CELL, CELL))
    out.alpha_composite(piece, ((CELL - piece.width) // 2, (CELL - piece.height) // 2))
    return out


def seamless(swatch):
    """A square stone swatch that repeats without a seam: blended with itself shifted by half."""
    rgb = swatch.convert("RGB").resize((CELL, CELL), Image.LANCZOS)
    shifted = ImageChops.offset(rgb, CELL // 2, CELL // 2)
    mask = Image.new("L", (CELL, CELL))
    px = mask.load()
    for y in range(CELL):
        for x in range(CELL):
            # 255 in the middle of the cell, 0 at its edges: the edges come from the shifted copy.
            d = min(x, y, CELL - 1 - x, CELL - 1 - y) / (CELL / 2)
            px[x, y] = int(255 * min(1, d * 2.2))
    out = Image.composite(rgb, shifted, mask.filter(ImageFilter.GaussianBlur(4)))
    return out.convert("RGBA")


def solids(path):
    sheet = key(Image.open(path))
    pieces = [clean(c) for c in cells(sheet, 4, 3)]
    out = []
    for i, piece in enumerate(pieces):
        if i == 0:
            box = piece.getbbox()
            w, h = box[2] - box[0], box[3] - box[1]
            inset = (int(w * 0.1), int(h * 0.1))
            square = piece.crop((box[0] + inset[0], box[1] + inset[1], box[2] - inset[0], box[3] - inset[1]))
            out.append(seamless(square))
        else:
            out.append(fit(piece))
    return out


def lights(path):
    sheet = Image.open(path).convert("RGB")
    out = []
    for c in cells(sheet, 3, 2):
        grey = c.convert("L")
        # Black is see-through; the faint haze Codex leaves on the ground is dropped.
        alpha = grey.point(lambda v: 0 if v < 10 else min(255, int((v - 10) * 1.06)))
        white = Image.new("RGBA", c.size, (255, 255, 255, 0))
        white.putalpha(alpha)
        out.append(fit(white, 184))
    return out


def tower_cells():
    sheet = Image.open(os.path.join(WT, "server/public/assets/fx/tower-fx.png")).convert("RGBA")
    out = []
    for name in TOWER_CELLS:
        i = TOWER_ORDER.index(name)
        out.append(sheet.crop(((i % 4) * CELL, (i // 4) * CELL, (i % 4 + 1) * CELL, (i // 4 + 1) * CELL)))
    return out


def build(solid_path, name):
    tiles = solids(solid_path) + lights(os.path.join(HERE, "m2/sheet.png")) + tower_cells()
    atlas = Image.new("RGBA", (COLS * CELL, (len(tiles) + COLS - 1) // COLS * CELL))
    for i, tile in enumerate(tiles):
        atlas.alpha_composite(tile, ((i % COLS) * CELL, (i // COLS) * CELL))
    out = os.path.join(WT, "server/public/assets/fx", name)
    atlas.save(out, "WEBP", quality=90, method=6, exact=True)
    print(out, atlas.size, os.path.getsize(out))


build(os.path.join(HERE, "m1/sheet.png"), "ability-fx.modern.webp")
build(os.path.join(HERE, "c1/sheet.png"), "ability-fx.classic.webp")
