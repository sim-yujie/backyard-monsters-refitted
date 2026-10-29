"""grid.py look col row [scale] : one painted cell with a 20 px coordinate grid (cell @4x pixels), for placing the rig by eye."""
import sys
from PIL import Image, ImageDraw, ImageFont
from peek import cells, HERE
look, col, row = map(int, sys.argv[1:4]); s = float(sys.argv[4]) if len(sys.argv) > 4 else 2
c = cells(look, col)[row]
bg = Image.new("RGBA", c.size, (200, 200, 200, 255)); bg.alpha_composite(c)
bg = bg.resize((int(c.width * s), int(c.height * s)), Image.LANCZOS)
d = ImageDraw.Draw(bg); f = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 14)
for x in range(0, c.width, 20):
    d.line([(x * s, 0), (x * s, bg.height)], fill=(0, 0, 255, 255) if x % 100 == 0 else (0, 0, 0, 60), width=1)
    if x % 100 == 0: d.text((x * s + 2, 2), str(x), fill=(0, 0, 255), font=f)
for y in range(0, c.height, 20):
    d.line([(0, y * s), (bg.width, y * s)], fill=(0, 0, 255, 255) if y % 100 == 0 else (0, 0, 0, 60), width=1)
    if y % 100 == 0: d.text((2, y * s + 2), str(y), fill=(0, 0, 255), font=f)
bg.save(HERE / f"_grid_{look}_{col}_{row}.png")
