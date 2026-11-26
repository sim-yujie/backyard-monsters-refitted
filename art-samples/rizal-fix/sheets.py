"""sheets.py: desk sheets, before | A | B on yard grass, per look, at 1x (in-game size), 2x and 4x (whole picture),
with labels. -> sheets/<look>-<scale>.png"""
import os
from PIL import Image, ImageDraw, ImageFont
A = "../../server/public/assets/buildings/decorations/wonders/"
SRC = {"classic": ["before/rizal-monument@2x.png", "final/classic-A.png", "final/classic-B.png"],
       "modern": ["before/rizal-monument.modern@2x.webp", "final/modern-A.png", "final/modern-B.png"]}
LAB = ["Now", "A: one boy", "B: two boys, one group"]
os.makedirs("sheets", exist_ok=True)
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
for look, fs in SRC.items():
    for sc in (1, 2, 4):
        ims = []
        for p in fs:
            g = Image.open(p).convert("RGBA"); W, H = 196, 250
            o = Image.new("RGBA", (W, H), (96, 140, 70, 255)); o.alpha_composite(g, (0, H - g.height))
            k = sc / 2
            ims.append(o.resize((int(W * k), int(H * k)), Image.LANCZOS if sc == 1 else Image.NEAREST if sc == 4 else Image.LANCZOS))
        w, h = ims[0].size; pad = 12; top = 30
        s = Image.new("RGB", (3 * w + 4 * pad, h + top + pad), (245, 245, 240)); d = ImageDraw.Draw(s)
        for k, (i, l) in enumerate(zip(ims, LAB)):
            x = pad + k * (w + pad); s.paste(i.convert("RGB"), (x, top))
            d.text((x, 6), l if sc > 1 else l.split(":")[0], font=f if sc > 1 else ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 12), fill=(30, 30, 30))
        s.save(f"sheets/{look}-{sc}x.png")
