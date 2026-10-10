"""
make_batch.py <A|B> <col> <batch dir> [<painted idle cell png>...] : set up one Codex call for one Drull (G2_1, dragon_1.png) heading.
Sheet: 64x41 cells, 16 columns (2 = front, 6 = left, 10 = back, 15 = right; NOT mirror symmetric, every column is painted), row 0 idle, rows 1-7 walk, rows 8-14 attack.
A = idle + walk 1-7, B = idle + attack 1-7, each as a 4x2 grid (cell 1 idle). Extra args are already painted views (neighbour / idle of this heading).
Writes frames.png (old frames blown up on grey), style.png, portrait.png, prompt.txt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "dragon_1.png"
KIT = Path("D:/Coding/BYMR/art-trials/champions/drull")
W, H, S = 64, 41, 6
mode, col, out = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
extra = sys.argv[4:]
out.mkdir(parents=True, exist_ok=True)
rows = [0] + (list(range(1, 8)) if mode == "A" else list(range(8, 15)))
sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (4 * W * S, 2 * H * S), (128, 128, 128))
for i, r in enumerate(rows):
    cell = sheet.crop((col * W, r * H, (col + 1) * W, (r + 1) * H)).resize((W * S, H * S), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 4) * W * S, (i // 4) * H * S))
grid.save(out / "frames.png")
shutil.copy(KIT / "portrait-crop.png", out / "portrait.png")


def tight(im):
    a = np.asarray(im.convert("RGBA")).astype(int)
    bg = ((a[..., 0] > 200) & (a[..., 1] < 90) & (a[..., 2] > 200)) | (a[..., 3] < 20)
    ys, xs = np.where(~bg)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def flat(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 0, 255, 255))
    bg.alpha_composite(im)
    return tight(bg.convert("RGB"))


SAMPLES = {15: "right", 2: "front", 6: "left", 10: "back"}   # sample file indices: new-heading0..3 = right, front, left, back
names = {15: "facing screen RIGHT", 2: "facing the viewer", 6: "facing screen LEFT", 10: "back to the viewer"}
idx = {15: 0, 2: 1, 6: 2, 10: 3}
near = sorted(idx, key=lambda c: min((col - c) % 16, (c - col) % 16))[:2]
views, used = [], []
for p in extra:
    views.append(flat(p)); used.append("an already painted view of this Drull (use it for the exact design, size and colours)")
for c in near:
    views.append(flat(KIT / f"new-heading{idx[c]}.png")); used.append(f"approved sample, {names[c]}")
Hh = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), Hh + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + Hh - v.height)); x += v.width + 40
strip.save(out / "style.png")

what = "WALK cycle frames 1-7" if mode == "A" else "ATTACK frames 1-7 (the dragon rears its two heads back and lunges forward, jaws open, then settles)"
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 4x2 grid (1536x492) of 8 low-resolution isometric game sprites of the old Drull dragon at ONE heading (heading column {col} of 16 in the sheet: column 2 faces the viewer, 6 faces screen left, 10 shows the back, 15 faces screen right; columns in between turn smoothly). Cell 1 (top-left) is the idle pose; cells 2-4 top row and 5-8 bottom row are the {what}, in time order. Ignore its colours, rough shapes, extra legs and drop shadows. Use it ONLY for the facing, position, size and the POSE of each frame (which legs are forward or back, how high the body is, how far the heads are raised or thrust forward, body bob and lunge).

Input 2, style.png: approved painted views of this same Drull on magenta ({"; ".join(used)}). It is NOT the output layout. Copy its design, colours and painting style exactly; same creature in all 8 cells, turned to the heading of frames.png (never mirrored to face the wrong way; for in-between headings turn it smoothly between the views).

Input 3, portrait.png: the official painting of Drull, design reference.

Output: ONE image, same 4x2 layout and canvas proportions as frames.png (1536x492 or a multiple), the same 8 frames in the same cells and order. Every cell shows the identical painted Drull, same size in all 8 cells (about the size of the old sprite, at most 1.15x), the feet of the idle and walking frames on the same ground line as in frames.png, body proportions never changing between frames, only the pose. Every pose must be clearly visible at game size: show the legs and heads moving as in the old frames.
PART CHECKLIST, all visible in every cell as seen from that heading (a part hidden by the turn of the body is the only excuse): plump dark red-brown dragon body, TWO heads side by side (one larger, one smaller) each with a spiky yellow crest and glowing yellow eyes, white teeth/horns, FOUR big stubby clawed legs (exactly four, no more), a row of white spikes down the back, a thick tail with small spikes.
Style: hand-painted digital illustration like the approved views, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, mode, col)
