"""Overlay true 2:1 lines from each picture's bottom-most point (white) to check the base: python overlay.py out.png pics..."""
import sys
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__file__))
from measure import measure
out, pics = sys.argv[1], sys.argv[2:]
ims = []
for p in pics:
    im = Image.open(p).convert("RGBA")
    k = 300 / im.width
    m = measure(p)
    bg = Image.new("RGBA", im.size, (112, 92, 48, 255)); bg.alpha_composite(im)
    d = ImageDraw.Draw(bg)
    bx, by = m["bx"], m["by"]
    d.line([(bx - im.width, by - im.width / 2), (bx, by), (bx + im.width, by - im.width / 2)], fill=(255, 255, 255, 255), width=2)
    d.line([(bx, by), (bx, 0)], fill=(0, 255, 255, 255), width=1)
    d.line([(im.width / 2, 0), (im.width / 2, im.height)], fill=(255, 0, 0, 255), width=1)
    ims.append(bg.resize((300, round(im.height * k))))
H = max(i.height for i in ims)
s = Image.new("RGBA", (305 * len(ims), H), (40, 40, 40, 255))
for i, im in enumerate(ims): s.paste(im, (305 * i, H - im.height))
s.save(out)
