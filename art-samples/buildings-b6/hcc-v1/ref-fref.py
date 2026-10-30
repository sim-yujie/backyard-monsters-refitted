"""fref.py : the Flash Hatchery in the game's own pixel frame (origin = the building's ground middle), for fitting.

    python fref.py grid <level>        -> work/flash-grid-L<level>.png (top + crank cell 0, 10x, 5 px grid in origin coords)
Used as a module: flash_rgba(level, frame) -> (RGBA image at 1x covering FRAME, no ground shadow), shadow_rgba(level).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-58, -128, 156, 98)      # x0, y0, x1, y1 in Flash px around the origin: every look and its shadow fits
LEVELS = (1, 2, 3)


def level_row(level):
    row = F.rows()[13]
    return row, [l for l in row["levels"] if l[0] == level][0]


def _layers(level, frame=0, shadow=False):
    row, lv = level_row(level)
    folder = F.ASSETS / row["folder"]
    out = []
    if shadow:
        out.append(("shadow", Image.open(folder / lv[4][0]).convert("RGB"), lv[4][1], lv[4][2]))
        return out
    out.append(("top", Image.open(folder / lv[1][0]).convert("RGBA"), lv[1][1], lv[1][2]))
    f, x, y, w, h, n = lv[7][0]
    strip = Image.open(folder / f).convert("RGBA")
    k = frame % n
    out.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(level, frame=0):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, frame):
        c.alpha_composite(im, (x - x0, y - y0))
    return c


def shadow_rgba(level):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, shadow=True):
        a = ImageChops.invert(im.convert("L"))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a)
        c.alpha_composite(sh, (x - x0, y - y0))
    return c


def frames(level):
    return level_row(level)[1][7][0][5]


if __name__ == "__main__" and sys.argv[1] == "grid":
    lv = int(sys.argv[2])
    k = 10
    im = flash_rgba(lv)
    big = Image.new("RGBA", (im.width * k, im.height * k), (90, 140, 60, 255))
    big.alpha_composite(im.resize(big.size, Image.NEAREST))
    d = ImageDraw.Draw(big)
    x0, y0, _, _ = FRAME
    for x in range(im.width):
        if (x + x0) % 5 == 0:
            d.line((x * k, 0, x * k, big.height), fill=(255, 255, 255, 140) if x + x0 else (255, 0, 0, 255))
            d.text((x * k + 2, 2), str(x + x0), fill=(255, 255, 0))
    for y in range(im.height):
        if (y + y0) % 5 == 0:
            d.line((0, y * k, big.width, y * k), fill=(255, 255, 255, 140) if y + y0 else (255, 0, 0, 255))
            d.text((2, y * k + 2), str(y + y0), fill=(255, 255, 0))
    (HERE / "work").mkdir(exist_ok=True)
    big.save(HERE / f"work/flash-grid-L{lv}.png")
