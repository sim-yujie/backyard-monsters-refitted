"""
make_batch.py <batch dir> <c1> [<c2> <c3>] [--prev <prev frames-new.png> <its row of the last heading>] : set up one Codex call for up to
three Teratorn headings, each painted in the 3 wing-flap poses (a 3 x N grid: columns = wing up / middle / down,
one row per heading). Writes frames.png (the old frames blown up 8x on grey), style.png, portrait.png, prompt.txt.
Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of 14.v1.png (32 headings of 11.25 degrees, 0 = east, clockwise; 3 flap rows; 28x28 cells).
Set NOTE in the environment to append a line to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "14.v1.png"
KIT = Path("D:/Coding/BYMR/art-trials/teratorn")
CELL = 28
args = sys.argv[1:]
out = Path(args[0])
prev = None
if "--prev" in args:
    i = args.index("--prev")
    prev = (args[i + 1], int(args[i + 2]))
    args = args[:i]
cols = [int(c) for c in args[1:]]
out.mkdir(parents=True, exist_ok=True)
n = len(cols)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (768, 256 * n), (128, 128, 128))
for r, c in enumerate(cols):
    for f in range(3):
        cell = sheet.crop((c * CELL, f * CELL, (c + 1) * CELL, (f + 1) * CELL)).resize((224, 224), Image.NEAREST)
        bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
        bg.alpha_composite(cell)
        grid.paste(bg.convert("RGB"), (f * 256 + 16, r * 256 + 16))
grid.save(out / "frames.png")
shutil.copy(KIT / "codex" / "portrait.png", out / "portrait.png")


def tight(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    bg = (a[..., 0] > 200) & (a[..., 1] < 90) & (a[..., 2] > 200)
    ys, xs = np.where(~bg)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def quadrant(path, q):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return tight(im.crop(((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)))


def row_middle(path, r, rows):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return tight(im.crop((w // 3, r * h // rows, 2 * w // 3, (r + 1) * h // rows)))


# approved single views (middle wing pose): east 0 (top-left), south 90 (top-right), west 180 (bottom-left), north 270
APPROVED = KIT / "codex" / "frames-new.png"
lo = int(cols[0] * 11.25) // 90 % 4
names = ["east (heading 0)", "south, facing the viewer (90)", "west (180)", "north, back to the viewer (270)"]
views, used = [], []
if prev:
    views.append(row_middle(prev[0], prev[1], 3))
    used.append(f"the previous batch's last heading ({(cols[0] - 1) * 11.25:g} degrees, middle wing pose, already painted and approved)")
for q in (lo, (lo + 1) % 4):
    views.append(quadrant(APPROVED, q))
    used.append(names[q])
H = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), H + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + H - v.height))
    x += v.width + 40
strip.save(out / "style.png")

hs = ", ".join(f"row {i + 1}: {c * 11.25:g} degrees" for i, c in enumerate(cols))
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a grid of low-resolution isometric game sprites of the Teratorn, blown up 8x, {n} rows of 3 columns (768 px wide, 256 px per row). OLD design: ignore its colours and shapes. Use it ONLY for facing, position, overall size and wing position. Each ROW is one heading of the same monster, {hs}. Heading is measured on the ground from the screen's right (east) turning clockwise as seen from above: 0 = facing right, 90 = facing toward the viewer (down), 180 = facing left, 270 = facing away (up); the camera is a 3/4 isometric view. The 3 COLUMNS are the 3 frames of its wing-flap animation: left column wings raised high, middle column wings half way, right column wings swept low. Match each cell's facing exactly (which way the front points).

Input 2, style.png: a row of single APPROVED views of this monster on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every cell: a feathered green and teal bird body, a golden hooked beak and a WIDE toothy open maw full of fire, two big translucent veined wings, and orange bird legs with claws. ALL of these signature parts (feathered body, fiery maw, veined wings, orange legs) must be visible in every cell (from behind show the feathered back with no face, wings and legs still visible). Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings, turn it smoothly between the approved views; never mirror to face the wrong way).

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same grid layout and canvas proportions as frames.png (768 x {256 * n}, or a 2x multiple), each monster at the same position, overall size, facing and wing position as the matching cell of frames.png, redesigned as in style.png. Within a ROW the body, head, fire and legs are IDENTICAL in the 3 cells (same pose, same position, same size) and ONLY THE WINGS MOVE (raised, half way, swept low), so the flap animates when the 3 cells play in turn. The wings must be big and clearly visible. Make each monster FILL its cell: about as big as the old sprite and never smaller; the front-facing and back-facing rows must be as big as the side-facing ones.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
