"""infsample.py : one tower's sample for the owner (buildings-3d-3, 29 Oct 2026): Flash | old 3D | new 3D, large and at game
size, all at one heading, from the full renders (render/tT/full-hHH.png; the old one from a copy of the render before the
worn look).

  python infsample.py T H OLD_FULL_PNG [OUT]      -> sample-tT.png (or OUT)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from infcheck import ASSETS, BODY_G, FLASH, GROUND_GAME, flash  # noqa: E402

NAME = {1: "Inferno Blast Tower", 2: "Sharpshooter", 3: "Magma Tower"}
BG = (92, 136, 60, 255)


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    r = np.stack([np.asarray(Image.fromarray(a[..., i]).resize(size, Image.LANCZOS)) for i in range(4)], -1)
    r = np.clip(r, 0, 1)
    r[..., :3] /= np.maximum(r[..., 3:4], 1e-6)
    return Image.fromarray((np.clip(r, 0, 1) * 255).astype(np.uint8), "RGBA")


def flash_4x(t, h, size):
    """The Flash tower at the 3D render's 4x scale and place (its cell for heading h: bearing 11.25 h)."""
    gx, gy = GROUND_GAME[t]
    folder, _, anims = FLASH[t]
    name, _, _, w, _ = anims[0]
    n = Image.open(ASSETS / folder / name).width // w
    p = flash(t, min(h, n - 1))           # as infpost.py: heading k shows cell k (the last one past the end)
    p = resize_pm(p, (p.width * 4, p.height * 4))
    c = Image.new("RGBA", size)
    c.alpha_composite(p, (round(BODY_G[0] - 4 * gx - 320), round(BODY_G[1] - 4 * gy - 480)))
    return c


def main():
    t, h, old = int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    out = Path(sys.argv[4]) if len(sys.argv) > 4 else HERE / f"sample-t{t}.png"
    new = Image.open(HERE / "render" / f"t{t}" / f"full-h{h:02d}.png").convert("RGBA")
    ims = [flash_4x(t, h, new.size), Image.open(old).convert("RGBA"), new]
    labels = ["Flash (original)", "3D before", "3D now"]
    boxes = [im.getbbox() for im in ims]
    crop = (min(b[0] for b in boxes) - 12, min(b[1] for b in boxes) - 12, max(b[2] for b in boxes) + 12,
            max(b[3] for b in boxes) + 12)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    font, small = ImageFont.truetype("arialbd.ttf", 30), ImageFont.truetype("arialbd.ttf", 20)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    K = 1.5                                   # the large row: 1.5 x the 4x render = 6 x game size
    w, hh = round(cw * K), round(ch * K)
    gap, lab = 20, 50
    gw = [cw // 4, cw // 2]                    # game size (1x) and @2x (what a sharp screen shows)
    small_h = ch // 2 + 40
    g = Image.new("RGBA", (3 * w + 4 * gap, lab + hh + lab + small_h + gap), BG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, g.width, lab), fill=dark)
    d.text((gap, 9), f"{NAME[t]}: Flash | 3D before | 3D now (6x game size)", fill=white, font=font)
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
        a1 = resize_pm(c, (gw[0], ch // 4))
        a2 = resize_pm(c, (gw[1], ch // 2))
        g.alpha_composite(a1, (x + 10, y + ch // 2 - ch // 4))
        g.alpha_composite(a2, (x + 30 + gw[0], y))
        d.text((x + 10, y + ch // 2 + 6), label, fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
    g.convert("RGB").save(out, optimize=True)
    print("wrote", out, g.size)


main()
