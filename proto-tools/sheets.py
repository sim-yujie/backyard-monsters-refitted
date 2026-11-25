"""Contact sheets: python3 sheets.py <shotdir> <outdir>. One sheet per question per size/look: A|B|C columns."""
import sys, os, glob, re
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
rows = {"q1": ["few", "busy"], "q2": ["taken", "attack"], "q3": ["down", "live"]}
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34) if os.path.exists("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") else ImageFont.load_default()
tags = sorted({re.sub(r"^q\d-[ABC]-\w+-", "", os.path.basename(p))[:-4] for p in glob.glob(f"{src}/q*-*.png")})
for tag in tags:
    for q, names in rows.items():
        cells = [[f"{src}/{q}-{o}-{n}-{tag}.png" for o in "ABC"] for n in names]
        if not all(os.path.exists(p) for r in cells for p in r):
            continue
        first = Image.open(cells[0][0])
        w, h = first.size
        scale = min(1.0, 900 / w)
        cw, ch = int(w * scale), int(h * scale)
        pad = 50
        sheet = Image.new("RGB", (cw * 3 + 20 * 2, (ch + pad) * len(names)), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        for ri, r in enumerate(cells):
            for ci, p in enumerate(r):
                im = Image.open(p).convert("RGB").resize((cw, ch))
                x, y = ci * (cw + 20), ri * (ch + pad)
                d.text((x + 8, y + 6), f"{q.upper()} option {'ABC'[ci]} - {names[ri]}", fill=(255, 220, 120), font=font)
                sheet.paste(im, (x, y + pad))
        sheet.save(f"{out}/{q}-{tag}.png")
        print("sheet", q, tag)
