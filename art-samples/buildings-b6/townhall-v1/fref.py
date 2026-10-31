"""fref.py : the Flash Town Hall (building 14) in the game's own pixel frame (origin = the building's anchor), per level.
Flash has a different picture for each of the 10 levels and no animation strip.

    python fref.py grid <level> [zoom] [x0 y0 x1 y1]  -> work/flash-grid-L<level>.png (5 px grid, every 10th labelled)
Used as a module: flash_rgba(level) / shadow_rgba(level) -> RGBA at 1x covering FRAME.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-124, -116, 190, 142)    # x0, y0, x1, y1 in Flash px: every level's building and ground shadow fit
TID = 14


def level_row(level):
    row = F.rows()[TID]
    return row, next(lv for lv in row["levels"] if lv[0] == level)


def _layer(level, shadow=False, look=1):
    """look: 1 the building, 2 damaged, 3 destroyed."""
    row, lv = level_row(level)
    folder = F.ASSETS / row["folder"]
    s = lv[3 + look] if shadow else lv[look]
    im = Image.open(folder / s[0])
    return (im.convert("RGB") if shadow else im.convert("RGBA")), s[1], s[2]


def flash_rgba(level, look=1):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    im, x, y = _layer(level, look=look)
    c.alpha_composite(im, (x - x0, y - y0))
    return c


def shadow_rgba(level, look=1):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    im, x, y = _layer(level, shadow=True, look=look)
    a = ImageChops.invert(im.convert("L"))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(a)
    c.alpha_composite(sh, (x - x0, y - y0))
    return c


def grid(level, z=6, x0=-90, y0=-115, x1=90, y1=110):
    im = flash_rgba(level).crop((x0 - FRAME[0], y0 - FRAME[1], x1 - FRAME[0], y1 - FRAME[1]))
    bg = Image.new("RGBA", im.size, (96, 140, 60, 255))
    bg.alpha_composite(im)
    big = bg.convert("RGB").resize((im.width * z, im.height * z), Image.NEAREST)
    d = ImageDraw.Draw(big)
    for x in range(x0 - x0 % 5, x1 + 1, 5):
        X = (x - x0) * z
        d.line((X, 0, X, big.height), fill=(255, 0, 0) if x % 10 == 0 else (255, 170, 170), width=1)
        if x % 10 == 0:
            d.text((X + 2, 2), str(x), fill=(255, 255, 0))
    for y in range(y0 - y0 % 5, y1 + 1, 5):
        Y = (y - y0) * z
        d.line((0, Y, big.width, Y), fill=(0, 0, 255) if y % 10 == 0 else (160, 160, 255), width=1)
        if y % 10 == 0:
            d.text((2, Y + 2), str(y), fill=(0, 255, 255))
    return big


if __name__ == "__main__":
    (HERE / "work").mkdir(exist_ok=True)
    if sys.argv[1] == "grid":
        lv = int(sys.argv[2])
        z = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        box = list(map(int, sys.argv[4:8])) if len(sys.argv) > 7 else []
        grid(lv, z, *box).save(HERE / f"work/flash-grid-L{lv}.png")
