"""work/view.py <level> <x0> <y0> <x1> <y1> <px per flash px> <out> [render png] : Flash | 3D of one area (Flash
coords around the origin), on the grass green, Flash enlarged smoothly. 3D from work/fit-L<level>.png."""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref
lv, a, b, c, d, k = (int(x) for x in sys.argv[1:7])
out = sys.argv[7]
src = sys.argv[8] if len(sys.argv) > 8 else str(Path(__file__).resolve().parent / f"fit-L{lv}.png")
X0, Y0, X1, Y1 = fref.FRAME
fl = fref.flash_rgba(lv).crop((a - X0, b - Y0, c - X0, d - Y0)).resize(((c - a) * k, (d - b) * k), Image.BICUBIC)
im = Image.open(src).convert("RGBA")
s = im.width / (X1 - X0)
td = im.crop((int((a - X0) * s), int((b - Y0) * s), int((c - X0) * s), int((d - Y0) * s))).resize(((c - a) * k, (d - b) * k), Image.LANCZOS)
W, H = fl.size
row = Image.new("RGBA", (2 * W + 10, H), (96, 142, 58, 255))
row.alpha_composite(fl, (0, 0))
row.alpha_composite(td, (W + 10, 0))
row.convert("RGB").save(out)
