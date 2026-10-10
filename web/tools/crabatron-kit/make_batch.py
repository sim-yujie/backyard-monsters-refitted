"""
make_codex_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four Crabatron headings.
Writes frames.png (the old frames blown up 8x on grey), style.png (the approved Codex views, plus the previous batch's last
heading), portrait.png and prompt.txt. Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of crabatron.png (30 x 37x27 cells (row 0, visible), 12 degrees apart; 0 = facing screen RIGHT, 8 = facing the
viewer, 15 = facing screen LEFT, 23 = back to the viewer). Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "crabatron.png"
KIT = Path("D:/Coding/BYMR/art-trials/crabatron")
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * 37, 0, c * 37 + 37, 27)).resize((259, 189), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 30, (i // 2) * 256 + 33))
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
CHECK = """PART CHECKLIST: these parts MUST ALL be visible in EVERY cell, as seen from that cell's angle (a part hidden by the turn of the body is the only excuse). Never drop, merge or shorten any:
 1. TWO thin curving orange eye stalks on top of the shell, each ending in a big glossy dark-blue eyeball (2 eyeballs).
 2. Orange pitted warty shell/carapace with three round holes at the front and bumpy edges (the main body, large).
 3. Small red-brown crab face under the front of the shell with two glowing blue eyes and a fringe of dangling red tendrils for a mouth (not visible from behind).
 4. TWO big glossy purple lobster-style pincers on armoured arms with grey-green plates at the joints, reaching forward (2 claws; from behind they are hidden or just show at the sides).
 5. SIX long purple jointed legs with pointed claw tips, three per side (6 legs). Keep them FOLDED CLOSE to the body, short and compact, not splayed wide, so the whole crab is a compact mass that fills the frame.
 6. No tail.
 Colours: orange shell, purple limbs, blue eyes, red-brown face."""
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Crabatron, blown up 7x (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces and match that exactly. In the old sprite the orange block is the shell, the purple knobs on top are the eye stalks and the purple parts at the front are the claws and legs; the face side is the side the claws point to.

Input 2, style.png: a row of single APPROVED views of the Crabatron on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every new cell: the Crabatron, an orange pitted crab with eye stalks, a red-brown face, two big purple pincers and six purple legs. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

{CHECK}

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one (no bigger than about 1.3x). Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += chr(10) + f"TURN NOTE: each cell is turned only 12 degrees further than the one before (these four are {', '.join(h)}); the turn goes the same way in every batch: facing screen RIGHT (0) -> toward the viewer (90) -> screen LEFT (180) -> away, back to the viewer (270) -> screen RIGHT again. Do not turn faster or slower than the old frames show, and never turn the opposite way. Compact folded legs, big body, fill the frame." + chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
