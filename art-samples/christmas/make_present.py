"""Game files for the Christmas yard present (placeholder art, beta 10).

python3 make_present.py <classic full.png> <modern full.png> <golden full.png> <out dir>
Writes present@2x.png (Classic), present.modern@2x.webp (Modern): the box at
HEIGHT px in-game (2x file) over a soft drop shadow, plus golden-present.png
(140x140 popup picture, as the golden turkey's) and present-icon.png (an @2x
hint icon). Prints each present's `base` (box bottom as a fraction of height).
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

HEIGHT = 28  # in-game px of the box
SCALE = 2


def bbox_crop(im):
    return im.crop(im.getchannel("A").getbbox())


def with_shadow(full):
    box = bbox_crop(full.convert("RGBA"))
    h = HEIGHT * SCALE
    w = round(box.width * h / box.height)
    box = box.resize((w, h), Image.LANCZOS)
    pad = 6 * SCALE
    sw, sh = round(w * 1.05), round(w * 0.42)
    cw, ch = max(w, sw) + 2 * pad, h + sh // 2 + pad
    cw += cw % 2
    ch += ch % 2
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    shadow = Image.new("L", (cw, ch), 0)
    bottom = h + pad // 2  # where the box's lowest point lands
    cx = cw // 2
    ImageDraw.Draw(shadow).ellipse((cx - sw // 2 + 4, bottom - sh // 2, cx + sw // 2 + 4, bottom + sh // 2), fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(3 * SCALE))
    canvas.paste((0, 0, 0, 255), (0, 0), shadow)
    canvas.alpha_composite(box, (cx - w // 2, bottom - h))
    return canvas, (bottom - 2 * SCALE) / ch


def main():
    classic, modern, golden, out = sys.argv[1:5]
    c, cb = with_shadow(Image.open(classic))
    c.save(f"{out}/present@2x.png", optimize=True)
    m, mb = with_shadow(Image.open(modern))
    m.save(f"{out}/present.modern@2x.webp", quality=92, method=6)
    print(f"classic {c.size} base {cb:.3f}; modern {m.size} base {mb:.3f}")
    g = bbox_crop(Image.open(golden).convert("RGBA"))
    side = 120
    g.thumbnail((side, side), Image.LANCZOS)
    pop = Image.new("RGBA", (140, 140), (0, 0, 0, 0))
    pop.alpha_composite(g, ((140 - g.width) // 2, (140 - g.height) // 2))
    pop.save(f"{out}/golden-present.png", optimize=True)
    icon = bbox_crop(Image.open(classic).convert("RGBA"))
    icon.thumbnail((50, 44), Image.LANCZOS)
    icon.save(f"{out}/present-icon.png", optimize=True)
    print("golden", pop.size, "icon", icon.size)


main()
