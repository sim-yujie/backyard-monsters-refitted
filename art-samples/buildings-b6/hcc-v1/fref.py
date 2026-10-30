"""fref.py : the Flash Hatchery Control Center (building 16) in the game's own pixel frame (origin = the building's
anchor), for fitting. Flash has one look for every level and no animation.

    python fref.py grid [zoom]     -> work/flash-grid.png (the top, zoomed, 5 px grid in origin coords, every 10th labelled)
Used as a module: flash_rgba() -> (RGBA image at 1x covering FRAME, no ground shadow), shadow_rgba().
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-56, -66, 116, 104)      # x0, y0, x1, y1 in Flash px around the origin: the building and its shadow fit
TID = 16


def level_row():
    row = F.rows()[TID]
    return row, row["levels"][0]


def _layers(shadow=False, look=1):
    """look: 1 the building, 2 damaged, 3 destroyed."""
    row, lv = level_row()
    folder = F.ASSETS / row["folder"]
    if shadow:
        s = lv[3 + look]
        return [("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2])]
    t = lv[look]
    return [("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2])]


def flash_rgba(look=1):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(look=look):
        c.alpha_composite(im, (x - x0, y - y0))
    return c


def shadow_rgba(look=1):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(shadow=True, look=look):
        a = ImageChops.invert(im.convert("L"))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a)
        c.alpha_composite(sh, (x - x0, y - y0))
    return c


def grid(z=6, x0=-44, y0=-62, x1=46, y1=78):
    im = flash_rgba().crop((x0 - FRAME[0], y0 - FRAME[1], x1 - FRAME[0], y1 - FRAME[1]))
    bg = Image.new("RGBA", im.size, (96, 140, 60, 255))
    bg.alpha_composite(im)
    big = bg.convert("RGB").resize((im.width * z, im.height * z), Image.NEAREST)
    d = ImageDraw.Draw(big)
    for x in range(x0 - x0 % 5, x1 + 1, 5):
        X = (x - x0) * z
        d.line((X, 0, X, big.height), fill=(255, 0, 0) if x % 10 == 0 else (255, 160, 160), width=1)
        if x % 10 == 0:
            d.text((X + 2, 2), str(x), fill=(255, 255, 0))
    for y in range(y0 - y0 % 5, y1 + 1, 5):
        Y = (y - y0) * z
        d.line((0, Y, big.width, Y), fill=(0, 0, 255) if y % 10 == 0 else (150, 150, 255), width=1)
        if y % 10 == 0:
            d.text((2, Y + 2), str(y), fill=(0, 255, 255))
    return big


if __name__ == "__main__":
    (HERE / "work").mkdir(exist_ok=True)
    if sys.argv[1] == "grid":
        z = int(sys.argv[2]) if len(sys.argv) > 2 else 6
        grid(z).save(HERE / "work/flash-grid.png")
