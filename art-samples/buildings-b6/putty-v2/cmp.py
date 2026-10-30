"""cmp.py <level> [render] : Flash | 3D at 8x with a 5 px grid in origin coords -> work/cmp-L<level>.png (for fitting)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
import fref
HERE = Path(__file__).resolve().parent
lv = int(sys.argv[1])
src = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / f"work/fit-L{lv}.png"
k = 6
x0, y0, x1, y1 = fref.FRAME
box = (-36 - x0, -42 - y0, 42 - x0, 58 - y0)
W, H = (x1 - x0) * k, (y1 - y0) * k
G = (96, 140, 60, 255)
ims = []
for im in (fref.flash_rgba(lv), Image.open(src).convert("RGBA")):
    bg = Image.new("RGBA", (W, H), G)
    bg.alpha_composite(im.resize((W, H), Image.BICUBIC))
    d = ImageDraw.Draw(bg)
    for x in range(x0, x1):
        if x % 5 == 0:
            d.line(((x - x0) * k, 0, (x - x0) * k, H), fill=(255, 0, 0, 255) if x == 0 else (255, 255, 255, 70))
    for y in range(y0, y1):
        if y % 5 == 0:
            d.line((0, (y - y0) * k, W, (y - y0) * k), fill=(255, 0, 0, 255) if y == 0 else (255, 255, 255, 70))
    ims.append(bg.crop(tuple(b * k for b in box)))
out = Image.new("RGB", (ims[0].width * 2 + 8, ims[0].height))
out.paste(ims[0].convert("RGB"), (0, 0))
out.paste(ims[1].convert("RGB"), (ims[0].width + 8, 0))
out.save(HERE / f"work/cmp-L{lv}.png")
print(out.size)
