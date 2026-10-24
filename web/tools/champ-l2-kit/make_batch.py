"""make_batch.py <sheet> <A|B> <col> [<painted cutout png>...] : set up one Codex call for one heading of one level 2 champion sheet.
A = idle + walk frames, B = idle + attack frames, laid out as a grid (GRID below; cell 1 is always the idle / first walk frame, which
fixes the scale of the grid). Extra args are already painted views (a neighbour heading's idle) used as design references.
Writes <level dir>/full/<A|B><col>/: frames.png (old frames blown up on grey), style.png, portrait.png, prompt.txt, inputs.txt.
"""
import os
import shutil
import sys
from common import *

name, mode, col = sys.argv[1], sys.argv[2], int(sys.argv[3])
extra = sys.argv[4:]
S = SHEETS[name]
out = S["full"] / f"{mode}{col}"
out.mkdir(parents=True, exist_ok=True)
w, h = S["cell"]


rows, gc, gr = grid_rows(name, mode)
im = sheet(name)
x0, y0, x1, y1 = union_box(name, [(col, r) for r in rows], pad=16 if name == "krallen_1" else 6, im=im)
w, h = x1 - x0, y1 - y0
k = max(1, 1536 // (gc * w))
grid = Image.new("RGB", (gc * w * k, gr * h * k), (128, 128, 128))
for i, r in enumerate(rows):
    grid.paste(on((128, 128, 128), old_cell(name, col, r, im).crop((x0, y0, x1, y1))).resize((w * k, h * k), Image.NEAREST),
               ((i % gc) * w * k, (i // gc) * h * k))
grid.save(out / "frames.png")
shutil.copy(S["level_dir"] / "portrait.png", out / "portrait.png")

key = S["key"]
CH = S["champ"].capitalize()
near = sorted(TURN, key=lambda c: (min((col - c) % 16, (c - col) % 16), c))[:2]
views, used = [], []
for p in extra:
    views.append(tight(Image.open(p).convert("RGBA"))); used.append(f"an already painted level 2 view of this {CH} (use it for the exact design, size and colours)")
for c in near:
    views.append(tight(Image.open(S["full"] / "turn" / f"new-heading{TURN[c]}.png").convert("RGBA"))); used.append(f"approved view, {TURN_NAME[c]}")
strip(views, key).save(out / "style.png")
(out / "inputs.txt").write_text("frames.png style.png portrait.png")

ATTACK = {
    "ape_2": "a lunging bite: the Gorgo crouches, rears up and springs forward with the mouth open and the claws out, then settles",
    "dragon_2": "the dragon rears its two heads back and lunges forward, jaws open, then settles",
    "krallen_1": "the big cat rears up a little, then lunges down and forward with the jaws opened wide in a roaring bite, then recovers",
}
AWAY = {c: f" It faces AWAY from the viewer: we see its back, rump and tail; the face, eyes and mouth are NOT visible (only the back of the head and the ears or crest, pointing {d} away from the viewer). Never turn it toward the viewer."
        for c, d in ((8, "up-left"), (9, "up and a little left"), (10, "straight up"), (11, "up and a little right"), (12, "up-right"))}
n = len(rows)
cells_txt = {
    ("A", False): f"Cell 1 (top-left) is the idle pose; the other cells, left to right and top to bottom, are the WALK cycle frames 1-{n - 1} in time order.",
    ("B", False): f"Cell 1 (top-left) is the idle pose; the other cells, left to right and top to bottom, are the ATTACK frames 1-{n - 1} in time order ({ATTACK.get(name, '')}).",
    ("A", True): f"The {n} cells, left to right and top to bottom, are the WALK (run) cycle frames 1-{n} in time order; cell 1 is also its standing pose.",
    ("B", True): f"Cell 1 (top-left) is the first walk frame (standing pose, for the size); cells 2-7 are the ATTACK frames 1-6 in time order ({ATTACK.get(name, '')}); cell 8 repeats cell 1.",
}[(mode, name == "krallen_1")]
lvl = "look 1" if name == "krallen_1" else "level 2"
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a {gc}x{gr} grid ({grid.width}x{grid.height}) of {n} low-resolution isometric game sprites of the OLD {CH} {lvl} at ONE heading (heading column {col} of 16). In this heading the creature is: {FACING[col]}. {cells_txt} Ignore its colours, rough shapes and drop shadows. Use it ONLY for the facing, position, size and the POSE of each frame (which legs and arms are forward or back, how high the body is, how open the mouth is, body bob, sway and lunge).

Input 2, style.png: approved painted views of this same {CH} {lvl} ({"; ".join(used)}). It is NOT the output layout. Copy its design, every part, colours and painting style exactly; the same creature in all {n} cells, turned to the heading described above (never mirrored to the wrong side; for in-between headings turn it smoothly between the views).

Input 3, portrait.png: the official painting of {CH} {lvl}, design reference.

Output: ONE image, same {gc}x{gr} layout and canvas proportions as frames.png, the same {n} frames in the same cells and order. Every cell shows the identical painted {CH}, same size in all cells (about the size of the old sprite, at most 1.15x), each creature fully inside its own cell, the feet on the same ground line as in frames.png, body proportions never changing between frames, only the pose. Every pose must be clearly visible at game size: show the legs, head and mouth moving as in the old frames.
Facing in EVERY cell: {FACING[col]}.{AWAY.get(col, "")}
PART CHECKLIST, all visible in every cell as seen from that heading (a part hidden by the turn of the body is the only excuse): {PARTS[name]}
Style: hand-painted digital illustration like the approved views, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: {KEYNAME[key]}. No shadows, no ground, no grid lines, no text, no labels.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print(out)
