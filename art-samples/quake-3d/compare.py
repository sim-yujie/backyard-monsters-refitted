"""compare.py : Flash beside 3D at the same scale (the game's 4x), for the Quake Tower.

    python compare.py OUT.png T:KIND:CELL [T:KIND:CELL ...] [--overlay] [--scale S]

KIND is cell, dmg or destroyed. Each column: Flash's cell (damaged strip for dmg, top.1.destroyed for destroyed) above,
the 3D render below, both with the footprint's middle on the same pixel; --overlay adds a third row, the 3D at half
strength over Flash. Flash is enlarged 4x with hard pixels, so it sits on the 3D's grid (a 1x game px = 4 px here).
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FLASH = ROOT / "server" / "public" / "assets" / "buildings" / "iquaketower"
BG = (104, 132, 84, 255)
# Flash's pictures: file, cell size or None, top-left from the building's origin (1x), and the footprint's middle (0, 35)
GROUND_1X = (0, 35)
FL = {"cell": ("anim.1.png", (75, 132), (-37, -75)), "dmg": ("anim.1.damaged.png", (84, 133), (-40, -75)),
      "destroyed": ("top.1.destroyed.png", None, (-42, -8))}


def flash(kind, cell):
    f, size, (ox, oy) = FL[kind]
    im = Image.open(FLASH / f).convert("RGBA")
    if size:
        im = im.crop((cell * size[0], 0, cell * size[0] + size[0], size[1]))
    return im.resize((im.width * 4, im.height * 4), Image.NEAREST), (4 * (ox - GROUND_1X[0]), 4 * (oy - GROUND_1X[1]))


def model(t, kind, cell):
    d = HERE / "render" / f"t{t}"
    name = "destroyed.png" if kind == "destroyed" else f"{kind}-{cell:02d}.png"
    cam = json.loads((d / "camera.json").read_text())
    return Image.open(d / name).convert("RGBA"), cam["ground_4x"]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    overlay = "--overlay" in sys.argv
    out, specs = args[0], args[1:]
    cols = []
    for sp in specs:
        t, kind, cell = sp.split(":")
        t, cell = int(t), int(cell)
        m, (gx, gy) = model(t, kind, cell)
        f, (fx, fy) = flash(kind, cell)
        cw, ch = m.size
        top = Image.new("RGBA", (cw, ch), BG)
        top.alpha_composite(f, (round(gx + fx), round(gy + fy)))
        bot = Image.new("RGBA", (cw, ch), BG)
        bot.alpha_composite(m)
        rows = [top, bot]
        if overlay:
            ov = top.copy()
            mm = m.copy()
            mm.putalpha(mm.getchannel("A").point(lambda a: a // 2))
            ov.alpha_composite(mm)
            rows.append(ov)
        cols.append(rows)
    cw, ch = cols[0][0].size
    sheet = Image.new("RGBA", (cw * len(cols), ch * len(cols[0])), BG)
    for i, rows in enumerate(cols):
        for j, r in enumerate(rows):
            sheet.paste(r, (i * cw, j * ch))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
