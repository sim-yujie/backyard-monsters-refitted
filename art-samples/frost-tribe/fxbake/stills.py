"""3-up still sheet: today / astra / neon at the same frame of the same fight, cropped and enlarged 2x, labelled.

python3 stills.py <out.png> <take prefix e.g. a-modern> <frame> <x0,y0,x1,y1> [title]   (frames from film.mjs in $FRAMES)
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FRAMES = os.environ.get(
    "FRAMES", "/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/8693e50e-0911-4064-befe-7adf899be621/scratchpad/kfx/frames")
out, take, frame, box = sys.argv[1], sys.argv[2], int(sys.argv[3]), tuple(int(v) for v in sys.argv[4].split(","))
title = sys.argv[5] if len(sys.argv) > 5 else ""
LABEL = {"current": "Today's version", "astra": "astra (Codex gpt-6-astra)", "neon": "neon (Antigravity Gemini 4 Neon)"}
B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
tiles = []
for fx in ("current", "astra", "neon"):
    im = Image.open(f"{FRAMES}/{take}-{fx}/f{frame:05d}.jpg").convert("RGB").crop(box)
    tiles.append((LABEL[fx], im.resize((im.width * 2, im.height * 2), Image.LANCZOS)))
w, h = tiles[0][1].size
head = 60 if title else 0
sheet = Image.new("RGB", (3 * w + 4 * 16, h + 70 + head), (20, 40, 60))
d = ImageDraw.Draw(sheet)
if title:
    d.text((16, 12), title, font=B, fill=(223, 244, 255))
for i, (label, im) in enumerate(tiles):
    x = 16 + i * (w + 16)
    d.text((x, head + 14), label, font=B, fill="white")
    sheet.paste(im, (x, head + 60))
sheet.save(out)
print(out, sheet.size)
