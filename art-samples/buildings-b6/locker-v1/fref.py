"""fref.py : the Flash Monster Locker (building 8) in the game's own pixel frame (origin = the building's ground middle), for fitting.

    python fref.py grid <level>        -> work/flash-grid-L<level>.png (top + animation cell 0, 10x, 5 px grid in origin coords)
Used as a module: flash_rgba(level, frame) -> (RGBA image at 1x covering FRAME, no ground shadow), shadow_rgba(level).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-72, -100, 170, 116)     # x0, y0, x1, y1 in Flash px around the origin: every look and its shadow fits
LEVELS = (1, 2, 3, 4)
TID = 8


def level_row(level):
    row = F.rows()[TID]
    return row, [l for l in row["levels"] if l[0] == level][0]


def _layers(level, frame=0, shadow=False, look=1):
    """look: 1 the building (with its animation cell), 2 damaged, 3 destroyed."""
    row, lv = level_row(level)
    folder = F.ASSETS / row["folder"]
    out = []
    if shadow:
        s = lv[3 + look]
        out.append(("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2]))
        return out
    t = lv[look]
    out.append(("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2]))
    if look != 1:
        return out
    f, x, y, w, h, n = lv[7][0]
    strip = Image.open(folder / f).convert("RGBA")
    k = frame % n
    out.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(level, frame=0, look=1):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, frame, look=look):
        c.alpha_composite(im, (x - x0, y - y0))
    return c


def shadow_rgba(level, look=1):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, shadow=True, look=look):
        a = ImageChops.invert(im.convert("L"))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a)
        c.alpha_composite(sh, (x - x0, y - y0))
    return c


def frames(level):
    """The loop's length: the data's count, but no more than the strip has cells (level 4 says 21, has 20)."""
    row, lv = level_row(level)
    f, x, y, w, h, n = lv[7][0]
    return min(n, Image.open(F.ASSETS / row["folder"] / f).width // w)


if __name__ == "__main__" and sys.argv[1] == "grid":
    lv = int(sys.argv[2])
    k = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    look = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    im = flash_rgba(lv, look=look)
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
    big.save(HERE / f"work/flash-grid-L{lv}-{look}.png")
