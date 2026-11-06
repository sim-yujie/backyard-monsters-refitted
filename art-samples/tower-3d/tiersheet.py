"""tiersheet.py : a tower's 3D renders side by side for the owner (towers-3d-export, 29 Oct 2026): large (K x the 4x
render, cropped to the tower) with a label each, then a row at game size (1x) and on a sharp screen (@2x), with the
Flash picture beside them for reference.

  python tiersheet.py OUT "TITLE" [--flash FLASH.png] [--k 1.25] LABEL=RENDER.png [LABEL=RENDER.png ...]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG = (88, 134, 64, 255)


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes)."""
    a = np.asarray(im.convert("RGBA")).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def main():
    args = sys.argv[1:]
    out, title = Path(args.pop(0)), args.pop(0)
    flash, k = None, 1.25
    while args and args[0].startswith("--"):
        opt = args.pop(0)
        if opt == "--flash":
            flash = Image.open(args.pop(0)).convert("RGBA")
        elif opt == "--k":
            k = float(args.pop(0))
    items = [(a.split("=", 1)[0], Image.open(a.split("=", 1)[1]).convert("RGBA")) for a in args]
    boxes = [im.getbbox() for _, im in items]
    m = 24
    # one crop for all, so the renders keep their sizes relative to each other and stand on one ground line
    crop = (min(b[0] for b in boxes) - m, min(b[1] for b in boxes) - m, max(b[2] for b in boxes) + m,
            max(b[3] for b in boxes) + m)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    font, small = ImageFont.truetype("arialbd.ttf", 30), ImageFont.truetype("arialbd.ttf", 20)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    n = len(items)
    w, hh = round(cw * k), round(ch * k)
    gap, lab = 20, 50
    small_h = ch // 2 + 44
    g = Image.new("RGBA", (max(n * w + (n + 1) * gap, 900), lab + hh + lab + small_h + gap), BG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, g.width, lab), fill=dark)
    d.text((gap, 9), f"{title} ({round(4 * k)}x game size)", fill=white, font=font)
    for i, (label, im) in enumerate(items):
        x = gap + i * (w + gap)
        g.alpha_composite(resize_pm(im.crop(crop), (w, hh)), (x, lab))
        d.text((x + 8, lab + 8), label, fill=white, font=font, stroke_width=3, stroke_fill=(0, 0, 0))
    y = lab + hh
    d.rectangle((0, y, g.width, y + lab), fill=dark)
    d.text((gap, y + 12), "Game size (1x) and on a sharp screen (@2x)" + ("; Flash at the far left" if flash else ""),
           fill=white, font=small)
    y += lab + 10
    x = gap
    if flash:
        g.alpha_composite(flash, (x, y + ch // 2 - flash.height))
        x += flash.width + 3 * gap
    slot = max((g.width - x) // n, cw * 3 // 4 + 40)
    for i, (label, im) in enumerate(items):
        c = im.crop(crop)
        a1 = resize_pm(c, (cw // 4, ch // 4))
        a2 = resize_pm(c, (cw // 2, ch // 2))
        g.alpha_composite(a1, (x + 10, y + ch // 2 - ch // 4))
        g.alpha_composite(a2, (x + 20 + cw // 4, y))
        d.text((x + 10, y + ch // 2 + 6), label, fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        x += slot
    g.convert("RGB").save(out, optimize=True)
    print("wrote", out, g.size)


if __name__ == "__main__":
    main()
