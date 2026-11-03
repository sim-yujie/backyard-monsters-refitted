#!/usr/bin/env python3
"""Build the Map Room 2 painted-landscape art (plan steps 2, 3, 5, 6) from the Codex sheets.

The sheets were painted by Codex (`run.sh`, prompts in `prompts/`, mock-up B crops attached with -i)
and copied into `source/` by `python build.py --take` from the git-ignored `work/runs/<job>/sheet.png`.

Textures (2 x 2 sheets and the canopy square) are cut, made seamless (the square is blended with its
half-rolled copy through a noisy mask, so the wrap seam moves into the middle where the original is
whole), nudged half-way towards mock-up B's average colour for that ground, and packed into one
atlas of 512 px squares, `TEXTURE_ORDER` order (the same as `GroundTexture` in
`web/src/game/maproom/painted/groundKinds.ts`):

  web/public/maproom/painted/ground@4x.webp   512 px a texture (Quality High)
  web/public/maproom/painted/ground@2x.webp   256 px (Medium)
  web/public/maproom/painted/ground.webp      128 px (Low)

Sprites (decals, sea rocks, cliff pieces, forest bits, marsh and rocks) are keyed out of the magenta
(`key_out`, the same un-mixing as `web/tools/land-art/build.py`) into one sheet per family, each
piece in its own 256 px frame (High; 128 / 64 px Medium / Low), foot at the bottom centre:

  web/public/maproom/painted/<family>@4x.webp, @2x, plain

Strips (cliff faces, canopy edge) keep their full width and are made to repeat sideways.

  python web/tools/mr2-paint/build.py [--take]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, label

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source"
RUNS = HERE / "work" / "runs"
OUT = HERE.parents[1] / "public" / "maproom" / "painted"
MOCKUP = Path("C:/Coding/BYMR/worktrees/mr2-mockup2/art-samples/mr2-mockup2/variant-B-soft-lines.jpg")

TEXTURE = 512
FRAME = 256
KEY = np.array([255.0, 0.0, 255.0])
JOBS = ["ground-a", "ground-b", "sea", "canopy", "decals", "sea-rocks", "cliff", "forest-bits", "marsh-rocks"]

# (sheet, quadrant 0..3 row by row or None for the whole square, mock-up B box to match or None)
TEXTURE_ORDER: list[tuple[str, str, int | None, tuple[int, int, int, int] | None]] = [
    ("meadow", "ground-a", 0, (600, 660, 800, 760)),
    ("lush", "ground-a", 1, None),
    ("sand", "ground-a", 2, (200, 760, 260, 920)),
    ("rock", "ground-a", 3, None),
    ("marsh", "ground-b", 0, None),
    ("forest-floor", "ground-b", 1, None),
    ("snow", "ground-b", 2, None),
    ("meadow-plain", "ground-b", 3, (600, 660, 800, 760)),
    ("shallows", "sea", 0, None),
    ("deep", "sea", 1, (0, 300, 80, 600)),
    ("wet-sand", "sea", 2, None),
    ("foam", "sea", 3, None),
    ("canopy", "canopy", None, (1250, 200, 1500, 400)),
]
ATLAS_COLUMNS = 4


def take() -> None:
    """Copies each run's sheet into source/ as a quality-95 webp (committed)."""
    SOURCE.mkdir(exist_ok=True)
    for job in JOBS:
        sheet = RUNS / job / "sheet.png"
        if sheet.exists():
            Image.open(sheet).convert("RGB").save(SOURCE / f"{job}.webp", quality=95, method=6)
            print("took", job)


def seamless(square: np.ndarray, seed: int) -> np.ndarray:
    """Blends a square with its half-rolled copy so it wraps with no seam."""
    n = square.shape[0]
    rolled = np.roll(square, (n // 2, n // 2), axis=(0, 1))
    t = np.abs(np.linspace(-1, 1, n))  # 0 in the middle, 1 at the edges
    edge = np.maximum(t[:, None], t[None, :])
    rng = np.random.default_rng(seed)
    wobble = gaussian_filter(rng.standard_normal((n, n)), n / 24)
    wobble /= np.abs(wobble).max() + 1e-6
    # Keep the original inside, the rolled copy near the edges, with a wandering, fairly
    # sharp boundary (a soft cross-fade would ghost two layers of grass over each other).
    keep = np.clip((0.72 - edge + 0.16 * wobble) / 0.08, 0, 1)
    keep = gaussian_filter(keep, 1.5)[..., None]
    return square * keep + rolled * (1 - keep)


def match_colour(square: np.ndarray, box: tuple[int, int, int, int] | None, strength: float = 0.5) -> np.ndarray:
    if box is None or not MOCKUP.exists():
        return square
    target = np.asarray(Image.open(MOCKUP).convert("RGB").crop(box), dtype=np.float64).reshape(-1, 3).mean(0)
    mean = square.reshape(-1, 3).mean(0)
    return np.clip(square + strength * (target - mean), 0, 255)


def cut_texture(sheet: str, quadrant: int | None) -> np.ndarray:
    image = Image.open(SOURCE / f"{sheet}.webp").convert("RGB")
    w, h = image.size
    if quadrant is not None:
        half_w, half_h = w // 2, h // 2
        x, y = (quadrant % 2) * half_w, (quadrant // 2) * half_h
        inset = 8  # the squares touch; keep clear of any line where they meet
        image = image.crop((x + inset, y + inset, x + half_w - inset, y + half_h - inset))
    else:
        inset = 6
        image = image.crop((inset, inset, w - inset, h - inset))
    return np.asarray(image.resize((TEXTURE, TEXTURE), Image.LANCZOS), dtype=np.float64)


def build_textures() -> None:
    rows = -(-len(TEXTURE_ORDER) // ATLAS_COLUMNS)
    atlas = Image.new("RGB", (ATLAS_COLUMNS * TEXTURE, rows * TEXTURE))
    for index, (name, sheet, quadrant, box) in enumerate(TEXTURE_ORDER):
        if not (SOURCE / f"{sheet}.webp").exists():
            print(f"texture {index:2} {name}: no sheet yet")
            continue
        square = match_colour(seamless(cut_texture(sheet, quadrant), index), box)
        tile = Image.fromarray(square.round().astype(np.uint8), "RGB")
        atlas.paste(tile, ((index % ATLAS_COLUMNS) * TEXTURE, (index // ATLAS_COLUMNS) * TEXTURE))
        print(f"texture {index:2} {name}")
    write_copies(atlas, "ground", quality=86)


def key_out(cell: Image.Image) -> Image.Image:
    """Magenta to transparent; part-magenta pixels (soft shadows, anti-aliased edges) un-mixed."""
    rgb = np.asarray(cell.convert("RGB")).astype(np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    alpha = np.max(np.stack([1.0 - r / 255.0, 1.0 - b / 255.0, g / 255.0]), axis=0)
    gap = np.clip((np.minimum(r, b) - g - 10.0) / 30.0, 0.0, 1.0)
    alpha = 1.0 - gap * (1.0 - alpha)
    alpha = np.where(alpha < 0.08, 0.0, np.clip((alpha - 0.08) / 0.92, 0.0, 1.0) ** 0.9)
    keep = alpha > 0
    a = np.where(keep, alpha, 1.0)[..., None]
    colour = np.clip((rgb - (1.0 - a) * KEY) / a, 0, 255)
    cr, cg, cb = colour[..., 0], colour[..., 1], colour[..., 2]
    pink = (alpha < 0.98) & (np.minimum(cr, cb) > cg + 8)
    colour[pink] = np.array([40.0, 48.0, 30.0])  # a soft shadow, not a pink glow
    speck = (r > 200) & (b > 180) & (g < 110)
    alpha = np.where(speck, 0.0, alpha)
    out = np.dstack([colour, alpha * 255.0]).round().astype(np.uint8)
    out[alpha <= 0] = 0
    return Image.fromarray(out, "RGBA")


def pieces(sheet: Image.Image, min_area: int = 900) -> list[Image.Image]:
    """Every separate keyed piece on a sheet, row by row (top to bottom, then left to right)."""
    keyed = key_out(sheet)
    alpha = np.asarray(keyed)[..., 3]
    solid = gaussian_filter((alpha > 40).astype(float), 3) > 0.15
    labels, count = label(solid)
    found = []
    for index in range(1, count + 1):
        ys, xs = np.nonzero(labels == index)
        if len(ys) < min_area or ys.max() - ys.min() < 40:
            continue  # a sliver of shadow cut off a strip above, not a piece
        found.append((ys.min(), xs.min(), ys.max() + 1, xs.max() + 1))
    row_height = sheet.height / 8
    found.sort(key=lambda box: (round(((box[0] + box[2]) / 2) / row_height), box[1]))
    return [keyed.crop((x0, y0, x1, y1)) for y0, x0, y1, x1 in found]


def framed(items: list[Image.Image], columns: int) -> Image.Image:
    rows = -(-len(items) // columns)
    sheet = Image.new("RGBA", (columns * FRAME, rows * FRAME), (0, 0, 0, 0))
    for index, item in enumerate(items):
        scale = min(1.0, (FRAME - 4) / item.width, (FRAME - 4) / item.height)
        if scale < 1:
            item = item.resize((max(1, round(item.width * scale)), max(1, round(item.height * scale))), Image.LANCZOS)
        x = (index % columns) * FRAME + (FRAME - item.width) // 2
        y = (index // columns) * FRAME + FRAME - 2 - item.height
        sheet.alpha_composite(item, (x, y))
    return sheet


def build_sprites() -> None:
    for family in ["decals", "sea-rocks", "marsh-rocks"]:
        path = SOURCE / f"{family}.webp"
        if not path.exists():
            continue
        found = pieces(Image.open(path))
        print(f"{family}: {len(found)} pieces")
        write_copies(framed(found, 4), family)


def repeat_sideways(strip: Image.Image, overlap: int = 96) -> Image.Image:
    """Cross-fades a strip's two ends so copies laid end to end join with no seam."""
    data = np.asarray(strip, dtype=np.float64)
    w = data.shape[1]
    body = data[:, : w - overlap].copy()
    ramp = np.linspace(0, 1, overlap)[None, :, None]
    body[:, :overlap] = data[:, w - overlap :] * (1 - ramp) + data[:, :overlap] * ramp
    return Image.fromarray(body.round().astype(np.uint8), "RGBA")


def build_strips() -> None:
    """Cliff faces and the canopy edge: wide bands keyed out and kept whole, plus the small bits."""
    for family in ["cliff", "forest-bits"]:
        path = SOURCE / f"{family}.webp"
        if not path.exists():
            continue
        sheet = Image.open(path)
        keyed = key_out(sheet)
        alpha = np.asarray(keyed)[..., 3]
        wide = (alpha > 40).sum(axis=1) > 0.85 * sheet.width  # rows the full-width bands cover
        bands, start = [], None
        for y, on in enumerate(list(wide) + [False]):
            if on and start is None:
                start = y
            if not on and start is not None:
                if y - start > 30:
                    bands.append((max(0, start - 12), min(sheet.height, y + 12)))
                start = None
        strips = [repeat_sideways(keyed.crop((0, y0, sheet.width, y1))) for y0, y1 in bands]
        below = bands[-1][1] if bands else 0
        rest = pieces(sheet.crop((0, below, sheet.width, sheet.height)))
        print(f"{family}: {len(strips)} strips, {len(rest)} pieces")
        for index, strip in enumerate(strips):
            write_copies(strip.resize((1024, round(strip.height * 1024 / strip.width)), Image.LANCZOS),
                         f"{family}-strip{index + 1}")
        write_copies(framed(rest, 4), f"{family}-pieces")


def write_copies(picture: Image.Image, name: str, quality: int = 90) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for suffix, factor in (("@4x", 1), ("@2x", 2), ("", 4)):
        copy = picture if factor == 1 else picture.resize(
            (picture.width // factor, picture.height // factor), Image.LANCZOS)
        options = {"quality": quality, "method": 6}
        if copy.mode == "RGBA":
            options["alpha_quality"] = 90
        copy.save(OUT / f"{name}{suffix}.webp", **options)


if __name__ == "__main__":
    if "--take" in sys.argv:
        take()
    build_textures()
    build_sprites()
    build_strips()
    totals = {"@4x": 0, "@2x": 0, "": 0}
    for path in sorted(OUT.glob("*.webp")):
        size = path.stat().st_size
        suffix = "@4x" if "@4x" in path.name else "@2x" if "@2x" in path.name else ""
        totals[suffix] += size
        print(f"{path.name:34} {size // 1024:5} KB")
    print("High {:.2f} MB, Medium {:.2f} MB, Low {:.2f} MB".format(
        totals["@4x"] / 2**20, totals["@2x"] / 2**20, totals[""] / 2**20))
