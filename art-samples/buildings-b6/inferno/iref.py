"""iref.py : an Inferno building's Flash art in the game's own pixel frame (origin = the art's anchor point), for fitting
and the comparison pictures. Like ../putty-v3/fref.py, for any Inferno type id.

    python iref.py grid <typeId> <level> [x0 y0 x1 y1]   -> work/i<id>-grid-L<level>.png (10x, 5 px grid, anchor coords)
Module: flash_rgba(tid, level, frame, box), shadow_rgba(tid, level, box), frames(tid, level), looks(tid).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

import iflash as I

F = I.F
HERE = Path(__file__).resolve().parent


def looks(tid):
    return [l[0] for l in I.rows()[tid]["levels"]]


def level_row(tid, level):
    row = I.rows()[tid]
    return row, [l for l in row["levels"] if l[0] == level][0]


def _layers(tid, level, frame=0, shadow=False):
    row, lv = level_row(tid, level)
    folder = F.ASSETS / row["folder"]
    if shadow:
        return [(Image.open(folder / lv[4][0]).convert("RGB"), lv[4][1], lv[4][2])]
    out = [(Image.open(folder / lv[1][0]).convert("RGBA"), lv[1][1], lv[1][2])]
    for f, x, y, w, h, n in (lv[7] if len(lv) > 7 and lv[7] else []):
        strip = Image.open(folder / f).convert("RGBA")
        k = frame % n
        out.append((strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(tid, level, frame, box):
    x0, y0, x1, y1 = box
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, x, y in _layers(tid, level, frame):
        c.alpha_composite(im, (int(round(x)) - x0, int(round(y)) - y0))
    return c


def shadow_rgba(tid, level, box):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    x0, y0, x1, y1 = box
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, x, y in _layers(tid, level, shadow=True):
        a = ImageChops.invert(im.convert("L"))
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(a)
        c.alpha_composite(sh, (int(round(x)) - x0, int(round(y)) - y0))
    return c


def frames(tid, level):
    lv = level_row(tid, level)[1]
    return max([a[5] for a in (lv[7] if len(lv) > 7 and lv[7] else [])] or [1])


if __name__ == "__main__" and sys.argv[1] == "grid":
    tid, lv = int(sys.argv[2]), int(sys.argv[3])
    box = tuple(int(v) for v in sys.argv[4:8]) if len(sys.argv) > 7 else (-60, -70, 60, 60)
    k = 10
    im = flash_rgba(tid, lv, 0, box)
    big = Image.new("RGBA", (im.width * k, im.height * k), (70, 50, 44, 255))
    big.alpha_composite(im.resize(big.size, Image.NEAREST))
    d = ImageDraw.Draw(big)
    x0, y0 = box[:2]
    for x in range(im.width):
        if (x + x0) % 5 == 0:
            d.line((x * k, 0, x * k, big.height), fill=(255, 255, 255, 110) if x + x0 else (255, 0, 0, 255))
            d.text((x * k + 2, 2), str(x + x0), fill=(255, 255, 0))
    for y in range(im.height):
        if (y + y0) % 5 == 0:
            d.line((0, y * k, big.width, y * k), fill=(255, 255, 255, 110) if y + y0 else (255, 0, 0, 255))
            d.text((2, y * k + 2), str(y + y0), fill=(255, 255, 0))
    (HERE / "work").mkdir(exist_ok=True)
    big.save(HERE / f"work/i{tid}-grid-L{lv}.png")
