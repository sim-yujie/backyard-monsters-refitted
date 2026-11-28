"""Full-size sheet: Krampus's attack frames, Modern vs Classic, beside Korath's (Modern repaint and Flash).

Run from the worktree root:  python art-samples/frost-tribe/abilities2/attack_sheet.py
Writes art-samples/frost-tribe/abilities2/krampus-attack-frames.png (every frame at 2x, labelled).
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

M = Path("server/public/assets/monsters")
OUT = Path("art-samples/frost-tribe/abilities2/krampus-attack-frames.png")
K = json.load(open("web/tools/frost-kit/krampus-frames.json"))["6"]
BG = (92, 122, 70, 255)


def krampus(file, scale, col, first, count):
    im = Image.open(M / file).convert("RGBA")
    fw, fh = K["frameWidth"] * scale, K["frameHeight"] * scale
    out = [im.crop((col * fw, r * fh, (col + 1) * fw, (r + 1) * fh)) for r in range(first, first + count)]
    return [f.resize((f.width * 2 // scale, f.height * 2 // scale), Image.LANCZOS) for f in out]


def korath_flash(col):
    im = Image.open(M / "korath_6.png").convert("RGBA")
    fw, fh = 202, 167
    return [im.crop((col * fw, r * fh, (col + 1) * fw, (r + 1) * fh)).resize((fw * 2, fh * 2), Image.LANCZOS) for r in range(10, 20)]


def korath_modern(col):
    im = Image.open(M / "korath_6-repaint@2x.png").convert("RGBA")
    fw, fh = 404, 336
    out = []
    for r in range(10, 20):
        i = r * 16 + col
        x, y = (i % 20) * fw, (i // 20) * fh
        out.append(im.crop((x, y, x + fw, y + fh)))
    return out


rows = [
    ("Krampus L6 Modern: attack, left (frames 0-9, blow on 5)", krampus("krampus_6-anim@2x.png", 2, 4, 4, 10)),
    ("Krampus L6 Classic: attack, left", krampus("krampus_6.png", 1, 4, 4, 10)),
    ("Krampus L6 Modern: attack, front-left", krampus("krampus_6-anim@2x.png", 2, 3, 4, 10)),
    ("Krampus L6 Classic: attack, front-left", krampus("krampus_6.png", 1, 3, 4, 10)),
    ("Krampus L6 Modern: stomp, left (slam on 6)", krampus("krampus_6-anim@2x.png", 2, 4, 14, 9)),
    ("Korath L6 Modern (repaint): attack", korath_modern(6)),
    ("Korath L6 Classic (Flash): attack", korath_flash(6)),
]
cw = max(f.width for _, fr in rows for f in fr)
lab = 26
height = sum(max(f.height for f in fr) + lab for _, fr in rows)
sheet = Image.new("RGBA", (cw * 10, height), BG)
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except OSError:
    font = ImageFont.load_default()
y = 0
for label, frames in rows:
    draw.text((8, y + 4), label, fill=(255, 255, 255, 255), font=font)
    y += lab
    h = max(f.height for f in frames)
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * cw + (cw - f.width) // 2, y + h - f.height))
    y += h
sheet.convert("RGB").save(OUT, optimize=True)
print(OUT, sheet.size)
