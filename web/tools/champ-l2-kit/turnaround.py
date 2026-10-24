"""turnaround.py <sheet> : set up the Codex call that paints the four level 2 key views (right, front, left, back idle) of one champion.
Writes <level dir>/full/turn/: frames.png (old idle at columns 14, 2, 6, 10 blown up on grey, 2x2), sample.png (the approved front
sample, idle and walk), l1.png (the approved level 1 turnaround, if any), portrait.png, prompt.txt.  Env NOTE is appended."""
import os
import shutil
import sys
from common import *

name = sys.argv[1]
S = SHEETS[name]
out = S["full"] / "turn"
out.mkdir(parents=True, exist_ok=True)
im = sheet(name)
x0, y0, x1, y1 = union_box(name, [(c, 0) for c in (14, 2, 6, 10)], pad=6 if name != "krallen_1" else 24, im=im)
w, h = x1 - x0, y1 - y0
k = 768 // w
grid = Image.new("RGB", (2 * w * k, 2 * h * k), (128, 128, 128))
for i, c in enumerate((14, 2, 6, 10)):
    grid.paste(on((128, 128, 128), old_cell(name, c, 0, im).crop((x0, y0, x1, y1))).resize((w * k, h * k), Image.NEAREST),
               ((i % 2) * w * k, (i // 2) * h * k))
grid.save(out / "frames.png")
key = S["key"]
strip(sample_cells(name), key).save(out / "sample.png")
inputs = ["frames.png", "sample.png"]
l1 = ART / S["champ"] / "new-heading0.png"
if name != "krallen_1" and l1.exists():
    strip([tight(Image.open(ART / S["champ"] / f"new-heading{i}.png").convert("RGBA")) for i in range(4)], key).save(out / "l1.png")
    inputs.append("l1.png")
shutil.copy(S["level_dir"] / "portrait.png", out / "portrait.png")
inputs.append("portrait.png")
CH = S["champ"].capitalize()
lvl = "look 1" if name == "krallen_1" else "level 2"
n = 3
txt = [f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

This is the champion monster {CH}, {lvl}, for an isometric game seen from slightly above. We need four views of its idle pose that match the APPROVED painting exactly.

Input 1, frames.png: a 2x2 grid of 4 low-resolution sprites of the OLD {CH} {lvl}, blown up, on grey ({grid.width}x{grid.height}). Cell 1 (top-left) faces screen RIGHT (side view, head right, tail left), cell 2 (top-right) faces the viewer, cell 3 (bottom-left) faces screen LEFT (side view, head left, tail right), cell 4 (bottom-right) is seen from BEHIND. Use it ONLY for facing, position, size, pose and which parts are visible from each side. Ignore its blurry pixels, washed-out colours and drop shadow.

Input 2, sample.png: the APPROVED painting of this exact {CH} {lvl} (idle facing the viewer, and a walk frame). Cell 2 of the output must be this same idle, and every other cell the SAME creature turned: copy its design, every part, proportions, colours, painting style and level of detail exactly."""]
if "l1.png" in inputs:
    txt.append(f"""Input {n}, l1.png: the approved level 1 {CH} from the same four sides (right, front, left, back). Use it ONLY to see how this creature's body looks turned to each side; the level 2 design, size, parts and colours come from sample.png and frames.png, not from level 1.""")
    n += 1
txt.append(f"""Input {n}, portrait.png: the official painting of {CH} {lvl}; design reference only.

Output: ONE image, same 2x2 layout and canvas proportions as frames.png, each {CH} at the same position, size and facing as in its cell (about the size of the old sprite, at most 1.15x), the SAME creature in all 4 cells. Each creature, tail tip included, stays fully inside its own cell with a clear gap to the cell edges.
PART CHECKLIST, every part visible in each view where the facing allows: {PARTS[name]}
Style: hand-painted digital illustration exactly like sample.png, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: {KEYNAME[key]}. No shadows, no ground, no grid lines, no text, no labels.
""" + os.environ.get("NOTE", ""))
(out / "prompt.txt").write_text("\n\n".join(txt), encoding="utf-8")
(out / "inputs.txt").write_text(" ".join(inputs))
print(out)
