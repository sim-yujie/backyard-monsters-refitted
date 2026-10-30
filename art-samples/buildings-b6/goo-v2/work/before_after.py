"""work/before_after.py <before dir> : work/sheet/goo-v2-before-after.png, per level a column of Flash, 3D before
(<before dir>/before-L<level>.png, the previous work/sheet/model-L<level>.png) and 3D now (work/sheet/model-L<level>.png),
each labelled."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE = Path(__file__).resolve().parent
SH = HERE / "sheet"
before = Path(sys.argv[1])
try:
    fnt = ImageFont.truetype("arialbd.ttf", 30)
    big = ImageFont.truetype("arialbd.ttf", 38)
except OSError:
    fnt = big = ImageFont.load_default()
cols = []
for lv in (1, 3, 6, 10):
    cells = [(f"Level {lv}  Flash", Image.open(SH / f"flash-L{lv}.png")),
             (f"Level {lv}  3D before", Image.open(before / f"before-L{lv}.png")),
             (f"Level {lv}  3D now", Image.open(SH / f"model-L{lv}.png"))]
    w = cells[0][1].width
    col = Image.new("RGB", (w, sum(c.height + 50 for _, c in cells)), (24, 24, 28))
    y = 0
    d = ImageDraw.Draw(col)
    for label, im in cells:
        d.text((10, y + 8), label, font=fnt, fill=(240, 240, 240))
        bg = Image.new("RGBA", im.size, (96, 140, 60, 255))
        bg.alpha_composite(im.convert("RGBA"))
        col.paste(bg.convert("RGB"), (0, y + 50))
        y += im.height + 50
    cols.append(col)
W = sum(c.width for c in cols) + 10 * (len(cols) - 1)
out = Image.new("RGB", (W, cols[0].height + 60), (24, 24, 28))
ImageDraw.Draw(out).text((12, 10), "Goo Factory 3D: Flash, 3D before this pass, 3D now", font=big, fill=(255, 255, 255))
x = 0
for c in cols:
    out.paste(c, (x, 60))
    x += c.width + 10
out.save(SH / "goo-v2-before-after.png")
print(out.size)
