"""fref.py : the Flash Monster Lab (building 116) in the game's own pixel frame (origin = the building's anchor), for
fitting. Flash has one look for every level (levels 1-4), animated: the glass dome's swirling brew (anim.1, 32 frames)
and steam pouring out of the two side doors (anim.2 left, anim.3 right, 5 frames each).

    python fref.py grid [zoom]     -> work/flash-grid.png (the top, zoomed, 5 px grid in origin coords, every 10th labelled)
Used as a module: flash_rgba(look, frame) -> (RGBA image at 1x covering FRAME, no ground shadow), shadow_rgba(look).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

HERE = Path(__file__).resolve().parent
FRAME = (-86, -104, 126, 82)      # x0, y0, x1, y1 in Flash px around the origin: the building and its shadow fit
TID = 116
ANIMS = 3                         # anim layers: dome (32 frames), left door steam (5), right door steam (5)


def level_row():
    row = F.rows()[TID]
    return row, row["levels"][0]


def _layers(shadow=False, look=1, frame=0):
    """look: 1 the building, 2 damaged, 3 destroyed."""
    row, lv = level_row()
    folder = F.ASSETS / row["folder"]
    if shadow:
        s = lv[3 + look]
        return [("shadow", Image.open(folder / s[0]).convert("RGB"), s[1], s[2])]
    t = lv[look]
    out = [("top", Image.open(folder / t[0]).convert("RGBA"), t[1], t[2])]
    if look == 1 and frame is not None:
        for f, x, y, w, h, n in lv[7]:
            strip = Image.open(folder / f).convert("RGBA")
            k = frame % n
            out.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
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


def grid(z=6, x0=-76, y0=-98, x1=74, y1=64, frame=0):
    im = flash_rgba(frame=frame).crop((x0 - FRAME[0], y0 - FRAME[1], x1 - FRAME[0], y1 - FRAME[1]))
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
        a = [int(v) for v in sys.argv[3:7]] if len(sys.argv) > 6 else []
        grid(z, *a).save(HERE / "work/flash-grid.png")
