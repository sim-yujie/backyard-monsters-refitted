"""fref.py : the Flash Monster Academy (building 26) in the game's own pixel frame (origin = the building's anchor), for
fitting. Flash has four art levels (1-4; higher game levels use level 4's) and one 21-frame loop per level: the gold
blocks turning inside the dome's top opening.

    python fref.py grid <level> [zoom] [look]  -> work/flash-grid-L<level>.png (zoomed, 5 px grid in origin coords)
Used as a module: flash_rgba(level, look, frame) -> RGBA at 1x covering FRAME (no ground shadow), shadow_rgba(level, look).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-76, -44, 94, 92)      # x0, y0, x1, y1 in Flash px round the origin: every look and its shadow fit
TID = 26
LEVELS = (1, 2, 3, 4)


def level_row(level):
    row = F.rows()[TID]
    lv = [x for x in row["levels"] if x[0] <= level][-1]
    return row, lv


def frames(level):
    _, lv = level_row(level)
    return lv[7][0][5] if look_anim(lv) else 1


def look_anim(lv):
    return len(lv) > 7 and lv[7]


def _layers(level, shadow=False, look=1, frame=None):
    """look: 1 the building, 2 damaged, 3 destroyed. frame: the loop's cell laid on the top (look 1 only)."""
    row, lv = level_row(level)
    folder = F.ASSETS / row["folder"]
    if shadow:
        s = lv[3 + look]
        return [("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2])]
    t = lv[look]
    out = [("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2])]
    if look == 1 and frame is not None and look_anim(lv):
        f, x, y, w, h, n = lv[7][0]
        k = frame % n
        strip = Image.open(folder / f).convert("RGBA")
        out.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(level=1, look=1, frame=0):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, look=look, frame=frame):
        c.alpha_composite(im, (x - x0, y - y0))
    return c


def shadow_rgba(level=1, look=1):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(level, shadow=True, look=look):
        a = ImageChops.invert(im.convert("L"))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a)
        c.alpha_composite(sh, (x - x0, y - y0))
    return c


def grid(level, z=6, look=1, x0=-60, y0=-42, x1=60, y1=82):
    im = flash_rgba(level, look).crop((x0 - FRAME[0], y0 - FRAME[1], x1 - FRAME[0], y1 - FRAME[1]))
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
        lv = int(sys.argv[2])
        z = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        look = int(sys.argv[4]) if len(sys.argv) > 4 else 1
        grid(lv, z, look).save(HERE / f"work/flash-grid-L{lv}.png")
