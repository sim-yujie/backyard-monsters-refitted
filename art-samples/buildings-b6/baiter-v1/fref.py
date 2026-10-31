"""fref.py : the Flash Wild Monster Baiter (building 19) in the game's own pixel frame (origin = the building's anchor),
for fitting. Flash has one look for every level: the spray can (top.1) with the turning rig drawn over it from a
41-frame strip (anim.1: the toothed ring, the nozzle and its wire hoop, the spray, the side cog).

    python fref.py grid [zoom] [frame]   -> work/flash-grid.png (zoomed, 5 px grid in origin coords, every 10th labelled)
Used as a module: flash_rgba(look, k) -> RGBA at 1x covering FRAME (no ground shadow), shadow_rgba(look), FRAMES.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-50, -36, 62, 72)      # x0, y0, x1, y1 in Flash px around the origin: the building and its shadow fit
TID = 19
FRAMES = 41


def level_row():
    row = F.rows()[TID]
    return row, row["levels"][0]


def _layers(shadow=False, look=1, k=0):
    """look: 1 the building, 2 damaged, 3 destroyed. k: the animation frame (look 1 only)."""
    row, lv = level_row()
    folder = F.ASSETS / row["folder"]
    if shadow:
        s = lv[3 + look]
        return [("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2])]
    t = lv[look]
    out = [("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2])]
    if look == 1 and k is not None:
        f, x, y, w, h, n = lv[7][0]
        strip = Image.open(folder / f).convert("RGBA")
        k = k % n
        out.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    return out


def flash_rgba(look=1, k=0):
    x0, y0, x1, y1 = FRAME
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for _, im, x, y in _layers(look=look, k=k):
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


def grid(z=6, x0=-42, y0=-28, x1=42, y1=62, k=0, look=1):
    im = flash_rgba(look, k).crop((x0 - FRAME[0], y0 - FRAME[1], x1 - FRAME[0], y1 - FRAME[1]))
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
        k = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        look = int(sys.argv[4]) if len(sys.argv) > 4 else 1
        grid(z, k=k if look == 1 else None, look=look).save(HERE / "work/flash-grid.png")
