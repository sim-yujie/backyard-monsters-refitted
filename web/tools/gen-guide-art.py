"""
Publish Bob, the tutorial guide (issue #227), as web files.

Usage (from the repo root):

    pip install pillow
    python web/tools/gen-guide-art.py <source folder>

The source folder holds the owner-approved paintings of Bob, design A
("Round buddy"), made with Gemini the way the portraits were (see
docs/art/portraits.md), each with its background cut away:

    bob-A-bust-cut.png      Bob pointing, cheerful (990 square)
    bob-A-worried-cut.png   the same, worried (the lost-attack retry)
    bob-A-icon-cut.png      his head only, for screen tips
    bob-A-hand-cut.png      his pointing hand, the pointer (Flash's
                            TUTORIALARROWMC_CLIP hand, repainted)

Output goes to web/public/guide/, at twice the size the UI draws, for sharp
displays (docs/design/tutorial.md section 3):

    bob.webp            240 square, drawn at 120 px (80 px on a phone)
    bob-worried.webp    240 square
    bob-icon.webp       96 square, drawn at 48 px
    hand.webp           200 wide, drawn at 100 px; points right
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency: {exc}. Run: pip install pillow")

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "web" / "public" / "guide"
WEBP = {"quality": 82, "method": 6}


def trimmed(path: Path) -> Image.Image:
    """The painting cropped to what is not transparent."""
    image = Image.open(path).convert("RGBA")
    box = image.getchannel("A").getbbox()
    if box is None:
        sys.exit(f"{path.name} is empty")
    return image.crop(box)


def square(image: Image.Image, size: int, bottom: bool) -> Image.Image:
    """
    Fits `image` inside a `size` square, centred across; a bust sits on the
    bottom edge (it is cut off there), a head in the middle.
    """
    scale = size / max(image.width, image.height)
    fitted = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.LANCZOS,
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - fitted.width) // 2
    y = size - fitted.height if bottom else (size - fitted.height) // 2
    out.alpha_composite(fitted, (x, y))
    return out


def wide(image: Image.Image, width: int) -> Image.Image:
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    jobs = [
        ("bob-A-bust-cut.png", "bob.webp", lambda im: square(im, 240, bottom=True)),
        ("bob-A-worried-cut.png", "bob-worried.webp", lambda im: square(im, 240, bottom=True)),
        ("bob-A-icon-cut.png", "bob-icon.webp", lambda im: square(im, 96, bottom=False)),
        ("bob-A-hand-cut.png", "hand.webp", lambda im: wide(im, 200)),
    ]
    for name, out, shape in jobs:
        path = source / name
        if not path.exists():
            sys.exit(f"missing {path}")
        image = shape(trimmed(path))
        image.save(OUT_DIR / out, "WEBP", **WEBP)
        print(f"{out}: {image.width}x{image.height}, {(OUT_DIR / out).stat().st_size} bytes")


if __name__ == "__main__":
    main()
