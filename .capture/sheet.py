# Crop sheet: one row per tower type, its tiers 1|2|3 (one crop each), labelled. python3 sheet.py <shotdir> <out> [inf]
import json, sys, re, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
inf = len(sys.argv) > 3
pre = "inf-" if inf else ""
towers = json.load(open(f"{d}/{pre}towers.json"))
NAMES = {20: "Cannon" if not inf else "Blast Tower", 21: "Sniper" if not inf else "Sharpshooter", 22: "Bunker", 23: "Laser", 25: "Tesla", 115: "Aerial Def.", 118: "Railgun", 130: "Blast Tower", 132: "Magma", 129: "Quake", 136: "Spurtz", 137: "Black Spurtz"}
SPLITS = {22: (1, 3, 5), 132: (1, 3, 5)}
def tier(t, l):
    s = SPLITS.get(t, (1, 4, 7)); return 3 if l >= s[2] else 2 if l >= s[1] else 1
rows = {}
for b in towers:
    t = b["type"]; k = tier(t, b["level"]) if t not in (129, 136, 137) else 1
    rows.setdefault(t, {}).setdefault(k, b)
cw, ch = 300, 360
order = sorted(rows)
sheet = Image.new("RGB", (cw * 3 + 140, ch * len(order)), (30, 26, 22))
dr = ImageDraw.Draw(sheet)
for r, t in enumerate(order):
    dr.text((8, r * ch + ch // 2), NAMES.get(t, str(t)), fill=(240, 220, 170))
    for k in (1, 2, 3):
        b = rows[t].get(k)
        if not b: continue
        f = f"{d}/{pre}crop-{t}-L{b['level']}-{b['id']}.png"
        if not os.path.exists(f): continue
        im = Image.open(f).convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (140 + (k - 1) * cw, r * ch))
        dr.text((140 + (k - 1) * cw + 6, r * ch + 4), f"tier {k} (L{b['level']})", fill=(255, 255, 255))
sheet.save(out)
print(out, sheet.size)
