"""
Publish the painted monster and champion portraits (issue #34) as web files.

Usage (from the repo root):

    pip install pillow numpy
    python web/tools/gen-portraits.py <source folder>

The source folder holds the owner-approved paintings, made with Gemini from the
original Kixeye art (see docs/art/portraits.md):

    <id>-new2.png            a monster painting, 1264x848 on its painted ground
    G<n>-new2-cut.png        a champion at level 3 (Krallen, G5: her only one),
                             1024 square, background cut away
    G<n>-L<l>-new2-cut.png   a champion at another level

Output goes to web/public/portraits/, sized for what the UI draws, at twice
that for sharp displays:

    <id>.webp            monster card, 360x240 (drawn up to 96 px tall)
    <id>-icon.webp       monster icon, 112 square crop round the creature
                         (drawn at 24-56 px)
    G<n>-L<l>.webp       champion, 176 square, the whole frame so the creature
                         grows with its level as in the original art (drawn
                         at 56-88 px)
    G<n>-L<l>-icon.webp  champion icon, 72 square, trimmed to the creature
                         (drawn at 36 px)

Krallen has one painting, written as G5.webp and G5-icon.webp. A champion
level whose painting is missing is skipped and reported; the game falls back
to the original art for it (web/src/game/portraits.ts lists what exists).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageFilter, ImageOps
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency: {exc}. Run: pip install pillow numpy")

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "web" / "public" / "portraits"

MONSTERS = [f"C{n}" for n in range(1, 18)] + ["C19"] + [f"IC{n}" for n in range(1, 9)]
CHAMPIONS = ["G1", "G2", "G3", "G4"]
CHAMPION_LEVELS = range(1, 7)

CARD = (360, 240)
ICON = 112
CHAMPION = 176
CHAMPION_ICON = 72
WEBP = {"quality": 82, "method": 6}

# How far a pixel must sit from the painted ground to count as creature when
# finding the crop (sum of RGB differences, on a 4x smaller copy).
GROUND_TOLERANCE = 36


def ground_fit(rgb: np.ndarray) -> np.ndarray:
    """
    The painted ground as a smooth quadratic surface fitted to the border.

    Many creatures run off the frame, so the fit starts from the border pixels
    near the border's median colour and is redone a few times without the
    pixels that still sit far from it.
    """
    h, w, _ = rgb.shape
    ys, xs = np.mgrid[0:h, 0:w]
    band = max(2, round(min(h, w) * 0.05))
    border = np.zeros((h, w), bool)
    border[:band, :] = border[-band:, :] = border[:, :band] = border[:, -band:] = True
    u, v = xs / w, ys / h
    terms = np.stack([np.ones_like(u), u, v, u * u, v * v, u * v], axis=-1)
    use = border & (np.abs(rgb - np.median(rgb[border], axis=0)).sum(axis=-1) < 90)
    fitted = np.empty_like(rgb, dtype=float)
    for _ in range(4):
        for channel in range(3):
            coef, *_ = np.linalg.lstsq(terms[use], rgb[..., channel][use], rcond=None)
            fitted[..., channel] = terms @ coef
        use = border & (np.abs(rgb - fitted).sum(axis=-1) < 30)
    return fitted


def creature_box(painting: Image.Image) -> tuple[int, int, int, int]:
    """The creature's bounds in a monster painting (its shadow included)."""
    scale = 4
    small = painting.convert("RGB").reduce(scale)
    rgb = np.asarray(small, dtype=float)
    away = np.abs(rgb - ground_fit(rgb)).sum(axis=-1) > GROUND_TOLERANCE
    mask = Image.fromarray((away * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    box = mask.getbbox()
    if box is None:
        return (0, 0, painting.width, painting.height)
    return tuple(c * scale for c in box)  # type: ignore[return-value]


def icon_crop(painting: Image.Image) -> Image.Image:
    """A square round the creature, a little margin kept, inside the painting."""
    left, top, right, bottom = creature_box(painting)
    side = min(round(max(right - left, bottom - top) * 1.06), painting.width, painting.height)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    x = int(min(max(cx - side / 2, 0), painting.width - side))
    y = int(min(max(cy - side / 2, 0), painting.height - side))
    return painting.crop((x, y, x + side, y + side))


def trimmed_square(cut: Image.Image) -> Image.Image:
    """A cut-out champion trimmed to its opaque bounds and centred in a square."""
    box = cut.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox() or (0, 0, cut.width, cut.height)
    creature = cut.crop(box)
    side = max(creature.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(creature, ((side - creature.width) // 2, (side - creature.height) // 2))
    return square


def save(image: Image.Image, name: str) -> Path:
    out = OUT_DIR / name
    image.save(out, "WEBP", **WEBP)
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    missing: list[str] = []

    for monster in MONSTERS:
        painting = Image.open(source / f"{monster}-new2.png").convert("RGB")
        written.append(save(ImageOps.fit(painting, CARD, Image.LANCZOS), f"{monster}.webp"))
        written.append(save(icon_crop(painting).resize((ICON, ICON), Image.LANCZOS), f"{monster}-icon.webp"))

    champions = [(g, level, f"{g}-new2-cut.png" if level == 3 else f"{g}-L{level}-new2-cut.png", f"{g}-L{level}")
                 for g in CHAMPIONS for level in CHAMPION_LEVELS]
    champions.append(("G5", 0, "G5-new2-cut.png", "G5"))
    for _, _, file, name in champions:
        if not (source / file).exists():
            missing.append(file)
            continue
        cut = Image.open(source / file).convert("RGBA")
        written.append(save(cut.resize((CHAMPION, CHAMPION), Image.LANCZOS), f"{name}.webp"))
        icon = trimmed_square(cut).resize((CHAMPION_ICON, CHAMPION_ICON), Image.LANCZOS)
        written.append(save(icon, f"{name}-icon.webp"))

    total = sum(path.stat().st_size for path in written)
    print(f"wrote {len(written)} files, {total / 1024:.0f} KB, to {OUT_DIR.relative_to(REPO)}")
    for file in missing:
        print(f"missing (the game shows the original art): {file}")


if __name__ == "__main__":
    main()
