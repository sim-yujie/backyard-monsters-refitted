"""photo_sheet.py <landmark> <out.png> <photo>... : the multi-angle photo sheet given to Codex (3 x 2 on 1536 x 1024,
each photo numbered in its corner), from refs/<landmark>/."""
import os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
name, out, photos = sys.argv[1], sys.argv[2], sys.argv[3:]
CW, CH = 512, 512
s = Image.new("RGB", (3 * CW, 2 * CH), (20, 20, 20)); d = ImageDraw.Draw(s)
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
for k, p in enumerate(photos[:6]):
    im = Image.open(os.path.join(HERE, "refs", name, p + ".jpg")).convert("RGB")
    im.thumbnail((CW - 8, CH - 8))
    x, y = (k % 3) * CW, (k // 3) * CH
    s.paste(im, (x + (CW - im.width) // 2, y + (CH - im.height) // 2))
    d.text((x + 10, y + 8), str(k + 1), font=f, fill=(255, 255, 0), stroke_width=3, stroke_fill=(0, 0, 0))
s.save(out)
