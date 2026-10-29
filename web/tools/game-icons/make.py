"""Make the game's painted UI icons (web/public/ui/icons/) from the approved art.

usage: python -I make.py <art-samples/icons folder from branch art/game-icons> [name,name,...]
       python -I make.py ../../../art-samples/mr2-ground/icons range,range2,income,height
         (the Map Room ground icons: tower range, its second option, income, height)

Reads each icon's tight crop at painted size (large/<name>.png) and writes
<name>-<side>.webp for every side in SIDES: square, the icon centred with a
1 px clear margin, resized with premultiplied alpha and sharpened the way the
approved 32 and 24 px samples were (web/tools/icon-sample-kit/cut.py), so
16, 24 and 32 px show at 1x and 32, 48 and 64 px serve sharp screens.
web/src/ui/gameIcon.ts picks between them with srcset.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

NAMES = [
    "health", "damage", "speed", "housing", "time", "yarddamage", "lost", "storagefull", "retreat",
    "lastarmy", "resourcebomb", "levelup", "shield", "production", "swords", "fist", "lastarmy2",
    "production2", "yarddamage2", "lost2",
]
SIDES = (16, 24, 32, 48, 64)
OUT = Path(__file__).resolve().parents[2] / "public" / "ui" / "icons"


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes)."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def fit(im, side, margin):
    """im scaled to fit side x side minus margin, centred on a clear square, sharpened."""
    s = (side - 2 * margin) / max(im.size)
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    small = resize_pm(im, (w, h))
    c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    c.alpha_composite(small, ((side - w) // 2, (side - h) // 2))
    rgb = c.convert("RGB").filter(ImageFilter.UnsharpMask(0.6, 60, 2))
    return Image.merge("RGBA", (*rgb.split(), c.getchannel("A")))


def main(src, names=NAMES):
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in names:
        im = Image.open(Path(src) / "large" / f"{name}.png").convert("RGBA")
        for side in SIDES:
            path = OUT / f"{name}-{side}.webp"
            fit(im, side, 1).save(path, "WEBP", quality=90, alpha_quality=100, method=6)
            total += path.stat().st_size
    print(f"{len(names)} icons x {len(SIDES)} sides, {total / 1024:.1f} KB")


if __name__ == "__main__":
    main(sys.argv[1], *([sys.argv[2].split(",")] if len(sys.argv) > 2 else []))
