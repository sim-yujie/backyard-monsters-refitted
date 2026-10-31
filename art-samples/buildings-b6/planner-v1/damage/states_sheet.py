"""states_sheet.py : a building's three looks per level, Flash beside 3D, at one scale: whole | damaged | destroyed.

    python states_sheet.py --type 1 --name "Twig Snapper" --levels 1,3,6,10 --frame -44,-64,52,60 \
        --whole "D:/.../twig-v3/render/L{lv}-base.png+D:/.../twig-v3/render/L{lv}-parts-00.png" \
        --damaged "twig/render/L{lv}-damaged-base.png" --destroyed "twig/render/L3-destroyed-base.png" \
        -o twig/twig-states.png [--scale 0.5]

Each row is a level: Flash whole, 3D whole, Flash damaged, 3D damaged, Flash destroyed, 3D destroyed. The 3D still
files ({lv} = the level; a+b lays b over a) are the full renders (the game frame at 12 px a Flash px); Flash is
composed as the game draws it (flashstates.py) and resized to the same frame. All on the yard's grass, cropped to the
box round everything in the sheet.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flashstates as FS  # noqa: E402

GRASS = (96, 140, 60, 255)


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def still(spec, lv):
    parts = [p.replace("{lv}", str(lv)) for p in spec.split("+")]
    im = Image.open(parts[0]).convert("RGBA")
    for p in parts[1:]:
        if Path(p).exists():
            im.alpha_composite(Image.open(p).convert("RGBA"))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", type=int, required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--levels", default="1,3,6,10")
    ap.add_argument("--frame", required=True)
    ap.add_argument("--whole", required=True)
    ap.add_argument("--damaged", required=True)
    ap.add_argument("--destroyed", required=True)
    ap.add_argument("--scale", type=float, default=0.5)
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    frame = tuple(int(v) for v in a.frame.split(","))
    row = FS.rows()[a.type]
    levels = [int(v) for v in a.levels.split(",")]
    cells = []
    for lv in levels:
        lrow = [l for l in row["levels"] if l[0] <= lv][-1]
        line = []
        for st, spec in (("whole", a.whole), ("damaged", a.damaged), ("destroyed", a.destroyed)):
            d = still(spec, lv)
            f = FS.compose(row, lrow, st, frame).resize(d.size, Image.BICUBIC)
            line += [(f"Flash {st}", f), (f"3D {st}", d)]
        cells.append((lv, line))
    w, h = cells[0][1][1][1].size
    # one crop for every cell: the box round all their pixels
    acc = np.zeros((h, w), bool)
    for _, line in cells:
        for _, im in line:
            acc |= np.asarray(im)[:, :, 3] > 8
    ys, xs = np.nonzero(acc)
    pad = 20
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad), min(h, ys.max() + pad))
    cw, ch = int((box[2] - box[0]) * a.scale), int((box[3] - box[1]) * a.scale)
    head, lab = 50, 34
    sheet = Image.new("RGBA", (cw * 6 + 5 * 6, head + len(cells) * (ch + lab + 6)), (24, 24, 24, 255))
    d = ImageDraw.Draw(sheet)
    d.text((8, 10), f"{a.name}: whole | damaged | destroyed, Flash beside 3D, one scale", fill=(255, 255, 255),
           font=font(26))
    for r, (lv, line) in enumerate(cells):
        y = head + r * (ch + lab + 6)
        for c, (label, im) in enumerate(line):
            x = c * (cw + 6)
            g = Image.new("RGBA", im.size, GRASS)
            g.alpha_composite(im)
            sheet.paste(g.crop(box).resize((cw, ch), Image.LANCZOS), (x, y + lab))
            d.text((x + 6, y + 4), f"Level {lv}  {label}", fill=(255, 255, 255), font=font(22))
    sheet.convert("RGB").save(a.out)
    print("sheet", a.out, sheet.size)


if __name__ == "__main__":
    main()
