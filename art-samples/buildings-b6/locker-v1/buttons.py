"""buttons.py : build-menu pictures (server/public/assets/buildingbuttons/8.<n>.jpg, 120x160, white) from the 3D renders.

    python buttons.py   -> buttons/8.<n>.png (n = 1..4; 8.png = level 2 as the game's 8.jpg) and locker-buttons.png
Each 3D picture (building and its ground shadow) is scaled and placed so its outline fills the same box as the Flash
button's drawing.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from post import font, frame3d

HERE = Path(__file__).resolve().parent
BTN = HERE.parents[2] / "server/public/assets/buildingbuttons"
OUT = HERE / "buttons"


def drawn_box(im):
    a = np.array(im.convert("L")) < 225
    ys, xs = np.nonzero(a)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def button(lv):
    fl = Image.open(BTN / f"8.{lv}.jpg").convert("RGB")
    fx0, fy0, fx1, fy1 = drawn_box(fl)
    im = frame3d(lv, 0)     # the still body and the moving parts at frame 0
    a = np.array(im.getchannel("A")) > 24
    ys, xs = np.nonzero(a)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    s = (fy1 - fy0) / im.height
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", fl.size, (255, 255, 255, 255))
    cx = (fx0 + fx1) // 2
    out.alpha_composite(im, (max(0, cx - im.width // 2), fy0))
    return fl, out.convert("RGB")


def main():
    OUT.mkdir(exist_ok=True)
    pairs = []
    for lv in (1, 2, 3, 4):
        fl, b = button(lv)
        b.save(OUT / f"8.{lv}.png")
        if lv == 2:
            b.save(OUT / "8.png")
        pairs.append((lv, fl, b))
    k = 3
    w, h = pairs[0][1].size
    sheet = Image.new("RGB", (len(pairs) * (w * k + 16) + 16, 2 * h * k + 110), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), "Monster Locker build-menu pictures (120x160, shown 3x): Flash above 3D", fill=(255, 255, 255),
           font=font(20))
    for i, (lv, fl, b) in enumerate(pairs):
        x = 16 + i * (w * k + 16)
        d.text((x, 40), f"Level {lv}", fill=(255, 220, 120), font=font(18))
        sheet.paste(fl.resize((w * k, h * k), Image.NEAREST), (x, 66))
        sheet.paste(b.resize((w * k, h * k), Image.NEAREST), (x, 66 + h * k + 12))
    sheet.save(HERE / "locker-buttons.png")
    print("wrote locker-buttons.png", sheet.size)


if __name__ == "__main__":
    main()
