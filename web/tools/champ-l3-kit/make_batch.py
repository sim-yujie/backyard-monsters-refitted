"""make_batch.py <sheet> <mode> <col> [<painted view png>...] : set up one Codex call for one heading column of a level 3 batch sheet.
The call paints the rows SPECS[sheet]["calls"][mode] of that column as one grid (4x2, or 5x2 for 10 frames).
Writes <sample>/full/<mode><col>/: frames.png (old frames blown up on grey), style.png (extra views + the two nearest painted
headings from full/H), portrait.png, prompt.txt. Extra args are already painted views of this column (e.g. the A call's idle)."""
import shutil
import sys
import numpy as np
from PIL import Image
from spec import SPECS, HEADINGS, FACING, sheet, cell, on, strip, parts, COLOUR, key_cell, tight

name, mode, col = sys.argv[1], sys.argv[2], int(sys.argv[3])
extra = sys.argv[4:]
s = SPECS[name]
rows = s["calls"][mode]
gc = 4 if len(rows) <= 8 else 5
out = s["sample"] / "full" / f"{mode}{col}"
out.mkdir(parents=True, exist_ok=True)
sh = sheet(name)
CW = 1536 // gc
CHh = round(s["h"] * CW / s["w"])
grid = Image.new("RGB", (gc * CW, 2 * CHh), (128, 128, 128))
for i, r in enumerate(rows):
    grid.paste(on((128, 128, 128), cell(sh, name, col, r)).resize((CW, CHh), Image.NEAREST), ((i % gc) * CW, (i // gc) * CHh))
grid.save(out / "frames.png")
shutil.copy(s["sample"] / "portrait.png", out / "portrait.png")

H = s["sample"] / "full" / "H"
near = sorted(HEADINGS, key=lambda c: min((col - c) % 16, (c - col) % 16))[:2]
views, used = [], []
for p in extra:
    views.append(tight(Image.open(p).convert("RGBA"))); used.append(f"an already painted view of this {s['champ']} at THIS heading (keep its exact design, size and colours)")
for c in near:
    views.append(tight(Image.open(H / HEADINGS[c][0]).convert("RGBA"))); used.append(f"approved painting, {HEADINGS[c][1]}")
if name == "fly_3":     # the headings are all standing (wings folded): add the approved flight frame for the spread wings
    from spec import sample_views
    views.append(sample_views(name)[1]); used.append("approved painting IN FLIGHT with the wings spread, facing the viewer")
strip(views).save(out / "style.png")

n = len(rows)
cells_txt = (f"cells 1-{gc} top row and {gc + 1}-{2 * gc} bottom row in time order" if n == 2 * gc else
             f"cells 1-{gc} top row and {gc + 1}-{n} bottom row in time order, cell {2 * gc} empty")
FIRST = {"fly_3": {"A": "the STANDING pose on the ground (wings folded up behind the head)"},
         "krallen_2_rev_65": {"A": "the first run frame", "B": "a run frame, for size reference only"}}
first_txt = FIRST.get(name, {}).get(mode, "the idle pose")
champ = s["champ"]
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a {gc}x2 grid ({gc * CW}x{2 * CHh}) of {n} low-resolution isometric game sprites of the old level 3 {champ} at ONE heading (heading column {col} of 16). In this heading the creature is: {FACING[col]}. Cell 1 (top-left) is {first_txt}; the other cells are the {s['what'][mode]}; {cells_txt}. Ignore its colours, rough shapes, blurry pixels and drop shadows. Use it ONLY for the facing, position, size and the POSE of each frame (which legs, arms{', wings' if name == 'fly_3' else ''} and heads are where, how high the body is, body bob, lunge).

Input 2, style.png: approved paintings of this same level 3 {champ} on magenta ({"; ".join(used)}). It is NOT the output layout. Copy its design, parts, colours ({COLOUR[s['fam']] or 'golden-yellow fur with dark brown leopard spots'}) and painting style exactly; same creature in every cell, turned to the heading described above (never mirrored to the wrong side; turn it smoothly between the views).

Input 3, portrait.png: the official level 3 painting of {champ}, design reference.

Output: ONE image, same {gc}x2 layout and canvas proportions as frames.png ({gc * CW}x{2 * CHh} or a multiple), the same frames in the same cells and order{', the empty cell plain magenta' if n < 2 * gc else ''}. Every cell shows the identical painted {champ}, same size in every cell (about the size of the old sprite, at most 1.15x), at the same place in its cell as the old sprite, body proportions never changing between frames, only the pose. Every pose must be clearly visible at game size: show the legs, arms, heads{', wings' if name == 'fly_3' else ''} and mouth moving as in the old frames.
PART CHECKLIST, all visible in every cell as seen from that heading (a part hidden by the turn of the body is the only excuse): {parts(name)}
Style: hand-painted digital illustration like style.png, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print(out)
