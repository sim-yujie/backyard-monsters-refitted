"""grid_cmp.py <dir> [width] : cmp.png = old frames.png above the new frames-new.png, scaled to one width (for checking)."""
import sys
from PIL import Image
d = sys.argv[1]; W = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
a = Image.open(f"{d}/frames.png").convert("RGB"); b = Image.open(f"{d}/frames-new.png").convert("RGB")
a = a.resize((W, round(a.height * W / a.width))); b = b.resize((W, round(b.height * W / b.width)))
g = Image.new("RGB", (W, a.height + b.height)); g.paste(a, (0, 0)); g.paste(b, (0, a.height)); g.save(f"{d}/cmp.png")
