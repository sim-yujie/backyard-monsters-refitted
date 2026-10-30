"""work/col.py <level> x [x..] : per Flash row, a class letter (C copper, G goo, W wood, S slate/steel, . none) in
Flash and in work/fit-L<level>.png, side by side."""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref
lv = int(sys.argv[1]); xs = [int(v) for v in sys.argv[2:]]
x0, y0, x1, y1 = fref.FRAME
fit = Image.open(f"work/fit-L{lv}.png").convert("RGBA").resize((x1 - x0, y1 - y0), Image.BOX)
fl = fref.flash_rgba(lv)
def k(c):
    r, g, b, a = c
    if a < 128: return "."
    if g > r + 8 and g > b + 8: return "G"
    if r > 140 and g < r - 30 and b < g - 30: return "C"
    if r > g + 10 and g >= b and r < 140: return "W"
    return "S"
for x in xs:
    print(x, "flash", "".join(k(fl.getpixel((x - x0, y - y0))) for y in range(-40, 50)))
    print(x, "3d   ", "".join(k(fit.getpixel((x - x0, y - y0))) for y in range(-40, 50)))
print("     y0=-40, each char 1 px")
