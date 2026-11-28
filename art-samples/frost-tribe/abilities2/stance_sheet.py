"""Before/after stance sheet (desk frost-abil2): idle (row 0), a stride (walk), the attack's blow frame, per look.

  python stance_sheet.py <dir of the sheets before 28 Nov stance fix> server/public/assets/monsters <out.png> <level>
`old` holds the frame sizes before the fix (commit 1593ac543)."""
import json, sys
from PIL import Image, ImageDraw, ImageFont
B, A, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
lvl = int(sys.argv[4]) if len(sys.argv) > 4 else 6
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
old = {"1": (66, 62), "2": (80, 74), "3": (94, 88), "4": (108, 102), "5": (122, 110), "6": (138, 122)}
new = json.load(open("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/tools/frost-kit/krampus-frames.json"))
cols = (2, 3, 4, 5, 6)
# before: idle row 0, stride row 0 (same), blow row 9; after: idle row 0, stride row 1, blow row 9
kinds = [("idle (standing)", 0, 0), ("walk stride", 0, 1), ("attack blow", 9, 9)]
Z = 2
def frames(path, fw, fh, s, row):
    im = Image.open(path).convert("RGBA")
    return [im.crop((c * fw * s, row * fh * s, (c + 1) * fw * s, (row + 1) * fh * s)) for c in cols]
tiles = []
for look, fname, s in (("Modern", f"krampus_{lvl}-anim@2x.png", 2), ("Classic", f"krampus_{lvl}.png", 1)):
    for label, rb, ra in kinds:
        ob = frames(f"{B}/{fname}", *old[str(lvl)], s, rb)
        n = new[str(lvl)]
        oa = frames(f"{A}/{fname}", n["frameWidth"], n["frameHeight"], s, ra)
        tiles.append((f"L{lvl} {look}: {label}", ob, oa, s))
cw = 140 * Z; ch = 126 * Z
W = 40 + 2 * (5 * cw + 30); H = len(tiles) * (ch + 40) + 60
sheet = Image.new("RGB", (W, H), (92, 140, 70))
d = ImageDraw.Draw(sheet)
d.text((40, 15), "BEFORE", font=F, fill="white"); d.text((40 + 5 * cw + 30, 15), "AFTER", font=F, fill="white")
y = 50
for label, ob, oa, s in tiles:
    d.text((40, y), label, font=F, fill=(255, 255, 210))
    for side, fr in ((0, ob), (1, oa)):
        for i, f in enumerate(fr):
            f = f.resize((f.width * Z * 2 // s // 1, f.height * Z * 2 // s // 1), Image.LANCZOS) if s == 1 else f.resize((f.width * Z, f.height * Z), Image.LANCZOS)
            f = f.resize((f.width // 2, f.height // 2), Image.LANCZOS)
            x0 = 40 + side * (5 * cw + 30) + i * cw + (cw - f.width) // 2
            sheet.paste(f, (x0, y + 28 + (ch - f.height)), f)
    y += ch + 40
sheet.save(OUT)
print(OUT, sheet.size)
