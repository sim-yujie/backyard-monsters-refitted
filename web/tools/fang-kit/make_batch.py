"""
make_batch.py <batch dir> <c1> <c2> <c3> <c4> : set up one Codex call for four Fang headings.
Writes frames.png (the old frames blown up 8x on grey), copies the approved test (style.png) and the portrait,
and writes prompt.txt. Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of fang.png (30 x 34x31 cells, 12 degrees apart, 0 = east, clockwise).
"""
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "fang.png"
KIT = Path("D:/Coding/BYMR/art-trials/fang")
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * 34, 0, c * 34 + 34, 31)).resize((272, 248), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 24, (i // 2) * 256 + 4))
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
APPROVED = KIT / "codex" / "frames-new-v2.png"
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

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Fang, blown up 8x (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's LEFT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's RIGHT, 270 = facing away from the viewer showing its back (up); the camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces and match that.

Input 2, style.png: a row of single APPROVED views of this monster on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every new cell: a round red fanged body with a big head, TWO big white bulging eyes on the front, an orange segmented scorpion tail curling up from the back and ending in a small claw, and long thin curved SILVER BLADE LEGS (about 6 to 8, three or four per side, curving out and down to sharp points). ALL of these signature parts must be visible in every cell: both eyes, the silver blade legs on BOTH sides of the body (in side views the near-side legs fully and the far-side legs partly behind the body), the fangs and the orange tail. Never drop the legs. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings, turn it smoothly between the approved views; do not copy the approved poses blindly, and never mirror to face the wrong way).

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, redesigned as in style.png. Make each monster FILL its cell about as much as the old one does (the body, legs and tail together should be about the old sprite's size, no bigger than about 1.1x). Keep the same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
import os
prompt += chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
