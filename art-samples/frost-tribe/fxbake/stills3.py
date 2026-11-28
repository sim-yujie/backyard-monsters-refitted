"""Side-by-side still sheet from any takes at one frame each, cropped and enlarged 2x, labelled (round 3).

python3 stills3.py <out.jpg> <x0,y0,x1,y1> "<title>" <label>=<frames folder>:<frame> [...]
  e.g. stills3.py aura.jpg 0,0,800,450 "Frost aura, Modern" "Today (no aura)=$F/b0-modern-current:120" ...
"""
import sys

from PIL import Image, ImageDraw, ImageFont

out, box, title = sys.argv[1], tuple(int(v) for v in sys.argv[2].split(",")), sys.argv[3]
B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
tiles = []
for arg in sys.argv[4:]:
    label, where = arg.split("=", 1)
    folder, frame = where.rsplit(":", 1)
    im = Image.open(f"{folder}/f{int(frame):05d}.jpg").convert("RGB").crop(box)
    tiles.append((label, im.resize((im.width * 2, im.height * 2), Image.LANCZOS)))
w, h = tiles[0][1].size
head = 60 if title else 0
sheet = Image.new("RGB", (len(tiles) * w + (len(tiles) + 1) * 16, h + 70 + head), (20, 40, 60))
d = ImageDraw.Draw(sheet)
if title:
    d.text((16, 12), title, font=B, fill=(223, 244, 255))
for i, (label, im) in enumerate(tiles):
    x = 16 + i * (w + 16)
    d.text((x, head + 14), label, font=B, fill="white")
    sheet.paste(im, (x, head + 60))
sheet.save(out, quality=90)
print(out, sheet.size)
