"""all-levels.png: Flash (top) and new (bottom) Korath idle, levels 1-6, all at the same game scale, cropped."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, str(Path(__file__).parent))
from kparts import KIT, KL, cell
S = 3  # display scale vs game 1x
BG = (118, 124, 104)
font = ImageFont.truetype("arial.ttf", 22)
cols = []
for l in range(1, 7):
    fw, fh = KL[l][:2]
    old = cell(l, 2, 0).resize((fw * 4, fh * 4), Image.LANCZOS)
    new = Image.open(KIT.parent / "korath" / f"L{l}" / "idle-4x.png")
    bb = [old.getbbox(), new.getbbox()]
    win = (max(0, min(b[0] for b in bb) - 16), max(0, min(b[1] for b in bb) - 16), min(fw * 4, max(b[2] for b in bb) + 16), min(fh * 4, max(b[3] for b in bb) + 16))
    t = []
    for im in (old, new):
        c = Image.new("RGBA", im.size, BG + (255,)); c.alpha_composite(im); c = c.crop(win)
        t.append(c.resize((c.width * S // 4, c.height * S // 4), Image.LANCZOS).convert("RGB"))
    cols.append((l, t))
G = 12
W = sum(t[0].width for _, t in cols) + G * 7 + 90
H = max(t[0].height for _, t in cols)
img = Image.new("RGB", (W, 2 * H + 3 * G + 34), (34, 34, 38))
d = ImageDraw.Draw(img)
d.text((G, 34 + G + H // 2 - 12), "Flash", fill=(235, 235, 235), font=font)
d.text((G, 34 + 2 * G + H + H // 2 - 12), "New", fill=(235, 235, 235), font=font)
x = 90
for l, t in cols:
    d.text((x, 8), f"Level {l}", fill=(235, 235, 235), font=font)
    for j, im in enumerate(t):
        img.paste(im, (x, 34 + G + j * (H + G) + H - im.height))
    x += t[0].width + G
img.save(sys.argv[1]); print(img.size)
