"""magmalevelsample.py : the Magma Tower's two new directions at all three levels (buildings-3d-5, 29 Oct 2026): a row
each for A "Furnace" and B "Volcanic", columns level 1 (worn) | 2 (Brimstone) | 3 (Forged Steel), each taller than the
last; large (4.8x game size), then at game size (1x) and on a sharp screen (@2x). From the full renders
render/t3-dirX[-lookN]/full-hHH.png (MAGMA_DIR=A|B, INFERNO_LOOK=1-3).

  python magmalevelsample.py [H] [OUT]      -> magma-directions-levels.png (or OUT)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from infsample import BG, resize_pm  # noqa: E402

ROWS = (("A", "A: Furnace"), ("B", "B: Volcanic"))
COLS = ("Level 1: worn", "Level 2: Brimstone", "Level 3: Forged Steel")


def main():
    h = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "magma-directions-levels.png"
    ims = [[Image.open(HERE / "render" / (f"t3-dir{d}" + (f"-look{n}" if n > 1 else "")) / f"full-h{h:02d}.png").convert("RGBA")
            for n in (1, 2, 3)] for d, _ in ROWS]
    boxes = [im.getbbox() for row in ims for im in row]
    m = 40
    crop = (min(b[0] for b in boxes) - m, min(b[1] for b in boxes) - m, max(b[2] for b in boxes) + m,
            max(b[3] for b in boxes) + m)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    font, small = ImageFont.truetype("arialbd.ttf", 30), ImageFont.truetype("arialbd.ttf", 20)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    K = 1.2                                   # the large rows: 1.2 x the 4x render = 4.8 x game size
    w, hh = round(cw * K), round(ch * K)
    gap, lab, side = 32, 50, 64               # side: the row label's strip
    small_w, small_h = cw // 4 + 30 + cw // 2, ch // 2 + 36
    W_ = side + 3 * w + 4 * gap
    H_ = 2 * lab + 2 * hh + lab + 2 * (small_h + gap) + gap
    g = Image.new("RGBA", (W_, H_), BG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, W_, lab), fill=dark)
    d.text((gap, 9), "Magma Tower, two new looks, each at levels 1-3 (4.8x game size; taller each level)", fill=white,
           font=font)
    d.rectangle((0, lab, W_, 2 * lab), fill=(44, 44, 44, 255))
    for j, c in enumerate(COLS):
        d.text((side + gap + j * (w + gap) + 8, lab + 9), c, fill=white, font=font)
    y = 2 * lab
    for i, (_, rl) in enumerate(ROWS):
        d.rectangle((0, y, side, y + hh), fill=dark)
        tl = Image.new("RGBA", (hh, side), (0, 0, 0, 0))
        ImageDraw.Draw(tl).text((hh // 2, side // 2), rl, fill=white, font=font, anchor="mm")
        g.alpha_composite(tl.rotate(90, expand=True), (0, y))
        for j, im in enumerate(ims[i]):
            x = side + gap + j * (w + gap)
            g.alpha_composite(resize_pm(im.crop(crop), (w, hh)), (x, y))
        y += hh
        if i == 0:
            d.line((0, y, W_, y), fill=dark, width=4)
    d.rectangle((0, y, W_, y + lab), fill=dark)
    d.text((gap, y + 12), "Game size (1x) and on a sharp screen (@2x)", fill=white, font=small)
    y += lab + gap // 2
    for i, (_, rl) in enumerate(ROWS):
        d.text((gap, y + small_h // 2 - 12), rl[0], fill=white, font=font, stroke_width=3, stroke_fill=(0, 0, 0))
        for j, im in enumerate(ims[i]):
            x = side + gap + j * (w + gap)
            c = im.crop(crop)
            g.alpha_composite(resize_pm(c, (cw // 4, ch // 4)), (x + 10, y + ch // 2 - ch // 4))
            g.alpha_composite(resize_pm(c, (cw // 2, ch // 2)), (x + 30 + cw // 4, y))
            d.text((x + 10, y + ch // 2 + 6), f"{rl[:2]} {COLS[j]}", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        y += small_h + gap
    g.convert("RGB").save(out, optimize=True)
    print("wrote", out, g.size)


if __name__ == "__main__":
    main()
