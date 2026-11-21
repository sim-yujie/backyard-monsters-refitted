#!/usr/bin/env python3
"""sheet.py out.png [--crop x,y,w,h] [--scale f] [--label] a.png b.png ...  : pictures side by side."""
import sys
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]; out = args.pop(0); crop = None; scale = 1.0; labels = None
while args and args[0].startswith("--"):
    k = args.pop(0)
    if k == "--crop": crop = [int(v) for v in args.pop(0).split(",")]
    elif k == "--scale": scale = float(args.pop(0))
    elif k == "--labels": labels = args.pop(0).split("|")
ims = []
for p in args:
    im = Image.open(p).convert("RGB")
    if crop: im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    if scale != 1: im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    ims.append(im)
gap = 24; top = 90 if labels else 0
W = sum(i.width for i in ims) + gap * (len(ims) + 1); H = max(i.height for i in ims) + 2 * gap + top
sheet = Image.new("RGB", (W, H), (24, 24, 28)); x = gap; d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
except Exception: font = ImageFont.load_default()
for n, im in enumerate(ims):
    if labels: d.text((x, gap), labels[n], fill=(255, 220, 120), font=font)
    sheet.paste(im, (x, gap + top)); x += im.width + gap
sheet.save(out)
