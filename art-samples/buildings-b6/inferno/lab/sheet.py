"""sheet.py <out.png> <picture>... : the pictures side by side on the Inferno's ground colour (for looking at fits)."""
import sys
from PIL import Image
ims = [Image.open(p).convert("RGBA") for p in sys.argv[2:]]
S = Image.new("RGBA", (sum(i.width for i in ims), max(i.height for i in ims)), (74, 42, 36, 255))
x = 0
for i in ims:
    S.alpha_composite(i, (x, 0))
    x += i.width
S.convert("RGB").save(sys.argv[1])
