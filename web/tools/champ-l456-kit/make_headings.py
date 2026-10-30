"""make_headings.py <sheet> : set up the Codex call that paints the approved sample in the 4 main headings
(right, front, left, back), the design anchor for every per-column call. Writes <sample>/full/H/: frames.png (old idle at
columns 14, 2, 6, 10 as a 2x2 grid, blown up on grey), style.png (approved sample, keyed), portrait.png, prompt.txt."""
import shutil
import sys
from PIL import Image
from spec import SPECS, sheet, cell, on, strip, sample_views, parts, COLOUR

name = sys.argv[1]
s = SPECS[name]
out = s["sample"] / "full" / "H"
out.mkdir(parents=True, exist_ok=True)
sh = sheet(name)
S = 768 // s["w"]
W, H = s["w"] * S, s["h"] * S
grid = Image.new("RGB", (2 * W, 2 * H), (128, 128, 128))
for i, c in enumerate((14, 2, 6, 10)):
    grid.paste(on((128, 128, 128), cell(sh, name, c, 0)).resize((W, H), Image.NEAREST), ((i % 2) * W, (i // 2) * H))
grid.save(out / "frames.png")
strip(sample_views(name)).save(out / "style.png")
shutil.copy(s["sample"] / "portrait.png", out / "portrait.png")
champ = s["champ"]
idle = "the standing pose with the wings folded up behind the head" if s["fam"] == "fly" else (
    "the first frame of its run cycle" if name.startswith("krallen") else "the idle pose")
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

This is level {s['level']} of the champion monster {champ} (a sprite for an isometric game, seen from slightly above).

Input 1, frames.png: a 2x2 grid ({2 * W}x{2 * H}) of 4 low-resolution sprites of the OLD {champ}, blown up on grey, all in {idle}: cell 1 (top-left) faces screen RIGHT (side view, head on the right, tail on the left), cell 2 (top-right) faces the viewer, cell 3 (bottom-left) faces screen LEFT (head on the left, tail on the right), cell 4 (bottom-right) is seen from BEHIND (back and tail toward the viewer). Use it ONLY for facing, position, size, pose and body shape in each cell. Ignore its blurry pixels, its drop shadow and its washed-out colours.

Input 2, style.png: the APPROVED new painting of this level {s['level']} {champ} on magenta, facing the viewer (left: {idle}; right: a walk/flight frame). This is the design to keep EXACTLY: same creature, same colours ({COLOUR[s['fam']] or 'golden-yellow fur with dark brown leopard spots'}), same parts, same painting style and detail. Only turn it to each cell's facing.

Input 3, portrait.png: the official level {s['level']} painting of {champ}; design reference only.

Output: ONE image, same 2x2 layout and canvas proportions as frames.png ({2 * W}x{2 * H} or a multiple), each cell showing the approved {champ} from input 2 turned to that cell's facing, at the same position, pose and size as the old sprite in that cell (fill about the same area, at most 1.1x), the SAME creature in all 4 cells, never mirrored to face the wrong way.
PART CHECKLIST, every part visible in every cell where the facing allows: {parts(name)}
Style: hand-painted digital illustration like style.png, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out)
