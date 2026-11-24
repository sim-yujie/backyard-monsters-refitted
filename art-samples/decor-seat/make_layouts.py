"""The new Classic cut-outs laid out on 2-per-sheet grids (the slab positions of make_guides.py), as the
angle-and-content guide for the Modern redraw. python make_layouts.py <cut-outs dir> <out prefix>"""
import sys
from PIL import Image
SHEETS = {"g": ["paoay-church", "fort-santiago"], "h": ["magellans-cross", "pyramids"],
          "i": ["chocolate-hills", "banaue-terraces"], "j": ["mayon-volcano", "rizal-monument"]}
A = {"mayon-volcano": 270, "rizal-monument": 230, "magellans-cross": 250}
src, prefix = sys.argv[1], sys.argv[2]
for k, names in SHEETS.items():
    sheet = Image.new("RGBA", (1536, 1024), (255, 0, 255, 255))
    for i, n in enumerate(names):
        a = A.get(n, 260)
        im = Image.open(f"{src}/{n}.full.png").convert("RGBA")
        s = 2 * a / im.width
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        sheet.alpha_composite(im, (round(384 + 768 * i - im.width / 2), 990 - im.height))
    sheet.convert("RGB").save(f"{prefix}{k}.png")
