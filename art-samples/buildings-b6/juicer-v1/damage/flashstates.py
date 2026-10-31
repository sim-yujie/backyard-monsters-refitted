"""flashstates.py : Flash's three looks of a yard building per level (whole, damaged, destroyed), composed as the game
draws them: the state's shadow multiplied under the state's top; the whole look adds its anim cell 0 (Flash has no
damaged or destroyed anim for these buildings).

    python flashstates.py <typeId> <x0,y0,x1,y1> [scale]   -> flash/<id>-L<level>-<state>.png (1x, frame-sized RGBA)
                                                            and flash/<id>-states.png (a sheet: rows = levels, scale x)
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[4]          # (one folder deeper here than on the damage branch)
ASSETS = ROOT / "server/public/assets"
DATA = ROOT / "web/src/game/yard/buildingArtData.ts"
HERE = Path(__file__).resolve().parent
STATES = (("whole", 1, 4), ("damaged", 2, 5), ("destroyed", 3, 6))


def rows():
    out, cur = {}, None
    for line in DATA.read_text(encoding="utf8").splitlines():
        m = re.match(r'  \[(\d+), "([^"]+)", "([^"]+)", \[$', line)
        if m:
            cur = dict(id=int(m[1]), name=m[2], folder=m[3], levels=[])
            out[cur["id"]] = cur
        elif cur and line.startswith("    [") and line.rstrip().endswith("],"):
            cur["levels"].append(json.loads(line.strip()[:-1]))
    return out


def shadow_layer(im):
    a = ImageChops.invert(im.convert("L"))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(a)
    return sh


def compose(row, lv, state, frame, shadow=True, top=True):
    """The look on a transparent canvas covering frame (x0, y0, x1, y1 in px round the origin); shadow as black alpha."""
    folder = ASSETS / row["folder"]
    x0, y0, x1, y1 = frame
    c = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    _, ti, si = [s for s in STATES if s[0] == state][0]
    if shadow and lv[si]:
        s = lv[si]
        c.alpha_composite(shadow_layer(Image.open(folder / s[0]).convert("RGB")), (s[1] - x0, s[2] - y0))
    if top and lv[ti]:
        t = lv[ti]
        im = Image.open(folder / t[0]).convert("RGBA")
        if len(t) > 3:
            im = im.crop((0, 0, t[3], t[4]))
        c.alpha_composite(im, (t[1] - x0, t[2] - y0))
        if state == "whole":
            for a in (lv[7] if len(lv) > 7 else []):
                f, x, y, w, h, n = a
                c.alpha_composite(Image.open(folder / f).convert("RGBA").crop((0, 0, w, h)), (x - x0, y - y0))
    return c


if __name__ == "__main__":
    tid = int(sys.argv[1])
    frame = tuple(int(v) for v in sys.argv[2].split(","))
    k = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    row = rows()[tid]
    out = HERE / "flash"
    out.mkdir(exist_ok=True)
    w, h = frame[2] - frame[0], frame[3] - frame[1]
    sheet = Image.new("RGBA", (w * k * 3, h * k * len(row["levels"])), (236, 230, 214, 255))
    d = ImageDraw.Draw(sheet)
    for r, lv in enumerate(row["levels"]):
        for c, (st, _, _) in enumerate(STATES):
            im = compose(row, lv, st, frame)
            im.save(out / f"{tid}-L{lv[0]}-{st}.png")
            sheet.alpha_composite(im.resize((w * k, h * k), Image.NEAREST), (c * w * k, r * h * k))
            d.text((c * w * k + 6, r * h * k + 6), f"L{lv[0]} {st}", fill=(0, 0, 0))
    sheet.save(out / f"{tid}-states.png")
    print(row["name"], [lv[0] for lv in row["levels"]], sheet.size)
