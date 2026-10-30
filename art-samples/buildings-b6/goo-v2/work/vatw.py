"""work/vatw.py : per Flash row, left/right x of the copper (orange) pixels in Flash and in work/fit-L1.png."""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref
x0, y0, x1, y1 = fref.FRAME
src = sys.argv[1] if len(sys.argv) > 1 else "work/fit-L1.png"
fit = Image.open(src).convert("RGBA").resize((x1 - x0, y1 - y0), Image.BOX)
fl = fref.flash_rgba(1)
def cu(c):
    r, g, b, a = c
    return a > 200 and r > 140 and 70 < g < r - 30 and b < g - 30
for y in range(-40, 30, 2):
    out = []
    for im in (fl, fit):
        xs = [x for x in range(-30, 20) if cu(im.getpixel((x - x0, y - y0)))]
        out.append((min(xs), max(xs), max(xs) - min(xs) + 1) if xs else None)
    print(y, out)
