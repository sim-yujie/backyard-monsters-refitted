"""
make_codex_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four Brain headings.
Writes frames.png (the old frames blown up 8x on grey), style.png (the approved Codex views, plus the previous batch's last
heading), portrait.png and prompt.txt. Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of brain.v2.png (30 x 34x24 cells (row 0, visible), 12 degrees apart; 0 = facing screen RIGHT, 8 = facing the
viewer, 15 = facing screen LEFT, 23 = back to the viewer). Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "brain.v2.png"
KIT = Path("D:/Coding/BYMR/art-trials/brain")
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * 34, 0, c * 34 + 34, 24)).resize((238, 168), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 41, (i // 2) * 256 + 44))
grid.save(out / "frames.png")
shutil.copy(KIT / "codex" / "portrait.png", out / "portrait.png")


def tight(im):
    """Crop a painted cell to the monster (everything that is not the magenta ground)."""
    a = np.asarray(im.convert("RGB")).astype(int)
    bg = (a[..., 0] > 200) & (a[..., 1] < 90) & (a[..., 2] > 200)
    ys, xs = np.where(~bg)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def quadrant(path, q):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return tight(im.crop(((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)))


# approved grid order: facing right (0), toward the viewer (90), facing left (180), away (270)
APPROVED = KIT / "codex" / "frames-new.png"
names = ["facing screen RIGHT (heading 0)", "facing the viewer (90)", "facing screen LEFT (180)", "back to the viewer, facing away (270)"]
lo = (cols[0] * 12) // 90 % 4
views = [quadrant(APPROVED, lo), quadrant(APPROVED, (lo + 1) % 4)]
used = [names[lo], names[(lo + 1) % 4]]
prev = sys.argv[6:8]
if prev:
    views.insert(0, quadrant(prev[0], int(prev[1])))
    used.insert(0, f"the previous batch's last heading ({(cols[0] - 1) * 12} degrees, already painted and approved)")
H = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), H + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + H - v.height))
    x += v.width + 40
strip.save(out / "style.png")

h = [f"{c * 12} degrees" for c in cols]
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Brain, blown up 7x (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces and match that exactly. In the old sprite the purple dome is the brain, the green part below it is the forelegs and the two white eyes mark the face side.

Input 2, style.png: a row of single APPROVED views of the Brain on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every new cell: big wrinkled glossy purple brain dome, small orange-red skull face with fanged jaw and glowing yellow eyes under the front of the brain, two heavy green clawed forelegs reaching forward, four thin blue jointed spider legs. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

SIGNATURE FEATURES that MUST be clearly visible in EVERY cell, seen from that cell's angle: the large purple brain dome, the orange skull face (not in a back view, where a red hind patch shows instead), the green clawed forelegs, the thin blue spider legs. Do not drop or shorten any of them. The body is compact and LARGE.

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one (no bigger than about 1.3x). Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
