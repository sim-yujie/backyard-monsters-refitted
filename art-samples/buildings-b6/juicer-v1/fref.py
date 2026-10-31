"""fref.py : the Flash Monster Juicer (building 9) in the game's own pixel frame (origin = the building's anchor), for
fitting. Flash has one look for every level (levels 1-3), and a 51-frame animation strip drawn over the top: the
spiked rollers turn, sink into the pit, a burst of red juice, the empty pit, the rollers rise and turn again.

    python fref.py grid [zoom] [frame]   -> work/flash-grid.png (zoomed, 5 px grid in origin coords, every 10th labelled)
Used as a module: flash_rgba(look=1, frame=0) -> RGBA at 1x covering FRAME (no ground shadow), shadow_rgba(look).
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-50,-22,62,72").split(","))   # x0, y0, x1, y1 Flash px
TID = 9
FRAMES = 51


def level_row():
    row = F.rows()[TID]
    return row, row["levels"][0]


def _layers(shadow=False, look=1, frame=0):
    """look: 1 the building, 2 damaged, 3 destroyed. The whole look adds the animation cell `frame`."""
    row, lv = level_row()
    folder = F.ASSETS / row["folder"]
    if shadow:
        s = lv[3 + look]
        return [("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2])]
    t = lv[look]
    out = [("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2])]
    if look == 1 and frame is not None:
        f, x, y, w, h, n = lv[7][0]
        k = frame % n
        out.append(("anim", Image.open(folder / f).convert("RGBA").crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(look=1, frame=0):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(look=look, frame=frame):
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


def grid(z=6, frame=0, look=1):
    x0, y0, x1, y1 = FRAME
    im = flash_rgba(look, frame)
    bg = Image.new("RGBA", im.size, (96, 140, 60, 255))
    bg.alpha_composite(shadow_rgba(look))
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
        z = int(sys.argv[2]) if len(sys.argv) > 2 else 6
        fr = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        grid(z, fr).save(HERE / "work/flash-grid.png")
