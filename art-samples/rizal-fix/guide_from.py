"""guide_from.py <look> <other look's final @2x> <out>: a guide that puts the OTHER look's new group (and the stone it
replaced) into this look's current picture at the exact same place, for a Codex repaint in this look. Used when one
look's Codex edit put the group a few px off the other (Modern B, 26 Nov: boys ~10 px at @2x left of Classic's)."""
import json, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter
look, other, dst = sys.argv[1:4]
A = "../../server/public/assets/buildings/decorations/wonders/"
G = {"classic": "before/rizal-monument@2x.png", "modern": "before/rizal-monument.modern@2x.webp"}   # the 24 Nov pictures (the game files change)
GONE = {"classic": [[(92, 104), (112, 104), (113, 124), (110, 138), (96, 140), (90, 134), (91, 118)],
                    [(114, 74), (127, 74), (128, 121), (114, 121)]],
        "modern": [[(91, 104), (113, 104), (115, 124), (112, 139), (96, 140), (89, 134), (90, 118)],
                   [(114, 74), (127, 74), (128, 121), (114, 121)]]}
cur = Image.open(G[look]).convert("RGBA"); W, H = cur.size
oth = Image.open(other).convert("RGBA")
assert oth.width == W
dy = H - oth.height            # both stand on the same bottom line
o2 = Image.new("RGBA", (W, H), (0, 0, 0, 0)); o2.alpha_composite(oth, (0, dy))
fig = Image.open(other.replace(".png", "-figmask.png")).convert("L")
f2 = Image.new("L", (W, H), 0); f2.paste(fig, (0, dy))
m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
for p in GONE[look]: d.polygon(p, fill=255)
d.rectangle((104, 94, 138, 140), fill=255)
m = ImageChops.lighter(m, f2.filter(ImageFilter.MaxFilter(5)))
out = Image.composite(o2, cur, m)
meta = json.load(open(f"guide/{look}.json")); F = meta["F"]
big = out.resize((W * F, H * F), Image.LANCZOS)
fl = Image.new("RGBA", big.size, (255, 0, 255, 255)); fl.alpha_composite(big)
c = Image.new("RGB", (1024, 1024), (255, 0, 255)); c.paste(fl.convert("RGB"), (meta["ox"], meta["oy"])); c.save(dst)
