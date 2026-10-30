"""big.py <level> <x0> <y0> <x1> <y1> [out] : Flash | work/fit-L<level>.png on grass, crop in Flash px, at the render's scale."""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref
lv, x0, y0, x1, y1 = map(int, sys.argv[1:6])
out = sys.argv[6] if len(sys.argv) > 6 else f"work/big-L{lv}.png"
m = Image.open(f"work/fit-L{lv}.png").convert("RGBA")
fx0, fy0, fx1, fy1 = fref.FRAME
k = m.width / (fx1 - fx0)
f = fref.flash_rgba(lv).resize(m.size, Image.BICUBIC)
box = tuple(int(v) for v in ((x0 - fx0) * k, (y0 - fy0) * k, (x1 - fx0) * k, (y1 - fy0) * k))
ims = []
for im in (f, m):
    g = Image.new("RGBA", m.size, (96, 140, 60, 255))
    g.alpha_composite(im)
    ims.append(g.crop(box))
o = Image.new("RGB", (ims[0].width * 2 + 6, ims[0].height))
o.paste(ims[0].convert("RGB"), (0, 0))
o.paste(ims[1].convert("RGB"), (ims[0].width + 6, 0))
o.save(out)
print(o.size)
