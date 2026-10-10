"""
make_batch.py <batch dir> <c1> <c2> <c3> <c4> : set up one Codex call for four Ichi headings.
Writes frames.png (the old frames blown up 8x on grey), copies the approved test (style.png) and the portrait,
and writes prompt.txt. Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of ichi.png (30 x 27x26 cells, 12 degrees apart, 0 = east, clockwise).
"""
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "ichi.png"
KIT = Path("D:/Coding/BYMR/art-trials/ichi")
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * 27, 0, c * 27 + 27, 26)).resize((243, 234), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 38, (i // 2) * 256 + 10))
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


# style.png: one row of single views on magenta, left to right: [the last heading of the previous batch], then the two
# approved views (left 0, viewer 90, right 180, away 270 degrees) that bracket this batch's headings
APPROVED = KIT / "codex" / "frames-new-v3.png"
lo = (cols[0] * 12) // 90 % 4
views = [quadrant(APPROVED, lo), quadrant(APPROVED, (lo + 1) % 4)]
# approved grid order is left (top-left), viewer (top-right), right (bottom-left), away (bottom-right)
names = ["facing left (heading 0)", "facing the viewer (90)", "facing right (180)", "back to the viewer, facing away (270)"]
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

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of Ichi, blown up 9x (OLD design; ignore its colours and details). Use it ONLY for facing, position, overall size and the wedge SHAPE. Heading in degrees: 0 = facing the screen's LEFT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's RIGHT, 270 = facing away from the viewer showing its back (up); the camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces and match that exactly.

Input 2, style.png: a row of single APPROVED views of Ichi on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style, proportions and WEDGE SHAPE for every new cell: furry brown body with moss, pale horns, glowing orange eyes, big fanged mouth with red tongue, four orange armoured legs with grey claws, small dark red wing fold on the tall back. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

THE SHAPE (most important, in EVERY cell): Ichi is ONE solid wedge-shaped body like a doorstop. NO separate head, NO neck, nothing sticks out in front. The front is low, the top rises steadily to a tall back above the hind legs. The whole sloped front surface IS the face (eyes, horns, mouth) and it runs back along the slope toward the hind legs. In a side or three-quarter view the silhouette is a clean wedge: low pointed front, tall back. From the back (270) only the tall furry back with the red wing fold and horns peeking over the top is visible, no face. Eyes must be large and bright where the face is visible.

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png. Make each monster FILL its cell about as much as the old one does (body, legs together about the old sprite's size, no bigger than about 1.2x). Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich fur texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
import os
prompt += chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
