"""tiersample.py : the Blast Tower's three level looks side by side for the owner (buildings-3d-4, 29 Oct 2026): tier 1 (worn) |
tier 2 (gold) | tier 3 (black diamond with gold trim), large and at game size, from the full renders render/t1/full-hHH.png,
render/t1-look2/ and render/t1-look3/ (made with INFERNO_LOOK=2|3).

  python tiersample.py [H] [OUT]      -> tiers-sample.png (or OUT)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from infsample import BG, resize_pm  # noqa: E402


def main():
    h = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "tiers-sample.png"
    ims = [Image.open(HERE / "render" / d / f"full-h{h:02d}.png").convert("RGBA") for d in ("t1", "t1-look2", "t1-look3")]
    labels = ["Tier 1: worn", "Tier 2: gold", "Tier 3: black diamond"]
    boxes = [im.getbbox() for im in ims]
    crop = (min(b[0] for b in boxes) - 12, min(b[1] for b in boxes) - 12, max(b[2] for b in boxes) + 12,
            max(b[3] for b in boxes) + 12)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    font, small = ImageFont.truetype("arialbd.ttf", 30), ImageFont.truetype("arialbd.ttf", 20)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    K = 1.5                                   # the large row: 1.5 x the 4x render = 6 x game size
    w, hh = round(cw * K), round(ch * K)
    gap, lab = 20, 50
    small_h = ch // 2 + 40
    g = Image.new("RGBA", (3 * w + 4 * gap, lab + hh + lab + small_h + gap), BG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, g.width, lab), fill=dark)
    d.text((gap, 9), "Inferno Blast Tower levels: tier 1 | tier 2 | tier 3 (6x game size)", fill=white, font=font)
    for i, (im, label) in enumerate(zip(ims, labels)):
        x = gap + i * (w + gap)
        g.alpha_composite(resize_pm(im.crop(crop), (w, hh)), (x, lab))
        d.text((x + 8, lab + 8), label, fill=white, font=font, stroke_width=3, stroke_fill=(0, 0, 0))
    y = lab + hh
    d.rectangle((0, y, g.width, y + lab), fill=dark)
    d.text((gap, y + 12), "Game size (1x) and on a sharp screen (@2x)", fill=white, font=small)
    y += lab + 10
    for i, (im, label) in enumerate(zip(ims, labels)):
        x = gap + i * (w + gap)
        c = im.crop(crop)
        a1 = resize_pm(c, (cw // 4, ch // 4))
        a2 = resize_pm(c, (cw // 2, ch // 2))
        g.alpha_composite(a1, (x + 10, y + ch // 2 - ch // 4))
        g.alpha_composite(a2, (x + 30 + cw // 4, y))
        d.text((x + 10, y + ch // 2 + 6), label, fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
    g.convert("RGB").save(out, optimize=True)
    print("wrote", out, g.size)


if __name__ == "__main__":
    main()
