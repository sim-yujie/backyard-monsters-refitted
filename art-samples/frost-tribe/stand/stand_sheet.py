"""Before/after sheet for the painted stand (owner, 28 Nov 2026, desk Krampus: "Paint him a true standing pose").

  python stand_sheet.py <dir of the sheets before, with its krampus-frames.json> <out.png> [levels, e.g. 1,3,6]

Per level and look: his idle in all 8 headings, before (row 0, a walk pass) above after (row 0, the painted stand),
and at the last level the attack's blow (before row 9, after row 10: moved from the stand now). 2x, on grass,
each frame placed by its anchor (his feet) so the rows line up.
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

WT = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod"
BEFORE, OUT = sys.argv[1], sys.argv[2]
LEVELS = [int(v) for v in (sys.argv[3] if len(sys.argv) > 3 else "1,3,6").split(",")]
old = json.load(open(f"{BEFORE}/krampus-frames.json"))
new = json.load(open(f"{WT}/web/tools/frost-kit/krampus-frames.json"))
B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
Z = 2
HEAD = ["E", "SE", "S (front)", "SW", "W", "NW", "N (back)", "NE"]


def frame(path, r, s, row, col):
    """One frame at 2x (Modern sheets are 2x already, Classic 1x), and its anchor."""
    fw, fh = r["frameWidth"] * s, r["frameHeight"] * s
    f = Image.open(path).convert("RGBA").crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
    f = f.resize((r["frameWidth"] * Z, r["frameHeight"] * Z), Image.LANCZOS)
    return f, r["anchorX"] * Z, r["anchorY"] * Z


groups = []
for lv in LEVELS:
    for look, fname, s in (("Modern", f"krampus_{lv}-anim@2x.png", 2), ("Classic", f"krampus_{lv}.png", 1)):
        groups.append((f"L{lv} {look}: idle", lv, fname, s, 0, 0))
    if lv == LEVELS[-1]:
        for look, fname, s in (("Modern", f"krampus_{lv}-anim@2x.png", 2), ("Classic", f"krampus_{lv}.png", 1)):
            groups.append((f"L{lv} {look}: attack blow (moved from the idle)", lv, fname, s, 9, 10))

def box(lv):
    """Tile width, room above and below the feet, for one level (before or after, the larger)."""
    rs = (old[str(lv)], new[str(lv)])
    return (max(r["frameWidth"] for r in rs) * Z + 10, max(r["anchorY"] for r in rs) * Z,
            max(r["frameHeight"] - r["anchorY"] for r in rs) * Z)


W = 210 + 8 * max(box(lv)[0] for lv in LEVELS)
H = 50 + sum(72 + 2 * (box(g[1])[1] + box(g[1])[2] + 6) + 10 for g in groups)
sheet = Image.new("RGB", (W, H), (92, 140, 70))
d = ImageDraw.Draw(sheet)
y = 50
for label, lv, fname, s, rb, ra in groups:
    cw, up, down = box(lv)
    ch = up + down + 6
    d.text((20, y), label, font=B, fill=(255, 255, 210))
    for c, name in enumerate(HEAD):
        d.text((210 + c * cw + 4, y + 36), name, font=B, fill=(220, 235, 220))
    y += 72
    for side, (tag, folder, table, row) in enumerate((("before", BEFORE, old, rb), ("after", f"{WT}/server/public/assets/monsters", new, ra))):
        d.text((20, y + ch // 2 - 14), tag.upper(), font=B, fill="white")
        for col in range(8):
            f, ax, ay = frame(f"{folder}/{fname}", table[str(lv)], s, row, col)
            x0 = 210 + col * cw + cw // 2 - ax
            sheet.paste(f, (x0, y + up - ay), f)
        y += ch
    y += 10
sheet.save(OUT)
print(OUT, sheet.size)
