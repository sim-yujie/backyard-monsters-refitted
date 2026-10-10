"""
make_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four Rezghul (C19) headings.
Writes frames.png (the old frames blown up on grey), style.png (approved views, plus the previous batch's last heading), portrait.png and prompt.txt.
Headings are columns of rezghul.png (48x43 cells, 30 used columns, row 1 = idle pose, 12 degrees apart; 0 = facing screen RIGHT, 8 = facing the viewer, 16 = LEFT, 24 = back).
approved.png is the approved 2x2 Codex sample (right, front, left, back). Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "rezghul.png"
KIT = Path("D:/Coding/BYMR/art-trials/rezghul-c19")
CW, CH = 48, 43
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 580), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * CW, CH, c * CW + CW, 2 * CH)).resize((CW * 6, CH * 6), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 16, (i // 2) * 290 + 16))
grid.save(out / "frames.png")
shutil.copy(KIT / "portrait-big.png", out / "portrait.png")


def tight(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    bg = (a[..., 0] > 200) & (a[..., 1] < 90) & (a[..., 2] > 200)
    ys, xs = np.where(~bg)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def quadrant(path, q):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return tight(im.crop(((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)))


APPROVED = KIT / "approved.png"
names = ["facing screen RIGHT (heading 0)", "facing the viewer (90)", "facing screen LEFT (180)", "back to the viewer, facing away (270)"]
lo = int(cols[0] * 12 // 90) % 4
views = [quadrant(APPROVED, lo), quadrant(APPROVED, (lo + 1) % 4)]
used = [names[lo], names[(lo + 1) % 4]]
prev = sys.argv[6:8]
if prev:
    views.insert(0, quadrant(prev[0], int(prev[1])))
    used.insert(0, f"the previous batch's last heading ({(cols[0] - 1) * 12:g} degrees, already painted and approved)")
H = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), H + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + H - v.height))
    x += v.width + 40
strip.save(out / "style.png")

h = [f"{c * 12:g} degrees" for c in cols]
back = ""
if cols[0] >= 18 and not os.environ.get("NOBACK"):
    back = chr(10) + "BACK-VIEW NOTE: from about 216 degrees to 324 degrees the monster has its back to the viewer: the horned FACE and fanged mouth must NOT be visible in the cells where the back is toward the viewer (the back of the head with horns, the back of the shoulders, both arms, the vortex seen from behind and the long tail hanging down below are seen)." + chr(10)
CHECK = """PART CHECKLIST: these parts MUST ALL be visible in EVERY cell, as seen from that cell's angle (a part hidden by the turn of the body is the only excuse). Never drop, merge, shorten or add any:
 1. HEAD: a red-brown horned demon head with spiky bony horns on top and a HUGE fanged mouth (hidden only when the back is toward the viewer).
 2. BODY: a red-brown muscular upper torso and shoulders, spiky back ridge.
 3. ARMS: TWO long thin clawed red-brown arms with big claw hands (3-4 curved claws each), stretched out to the sides/forward, as long as the torso is tall; both arms in every view (the far one partly behind the body in side views).
 4. VORTEX: a swirling black hole ringed with a glowing green vortex and crackling green lightning forms the lower body/chest area that the arms grip; the torso rises out of it.
 5. TAIL: a LONG tapering green-teal tail with ragged tendrils below/behind the vortex, ending in a curl; about as long as the torso is tall. NEVER omit or shorten it, in side views it curls out to the back, in the front view it hangs below, in the back view it hangs straight down.
 6. No legs, no wings, no weapons.
  Colours: red-brown demon skin, cream-white horns/claws/fangs, glowing green and teal vortex and tail, black hole centre."""
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Rezghul, blown up (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces (the face is at the FRONT) and match that exactly.

Input 2, style.png: a row of single APPROVED views of the Rezghul on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its design, colours and painting style for every new cell: same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

{CHECK}

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x580 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one (no bigger than about 1.3x); the whole figure, wings and legs included, must fit inside its cell with a margin. Same scale in all four cells. Same arm pose in all four cells (arms stretched wide).
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += back + chr(10) + f"TURN NOTE: each cell is turned only 12 degrees further than the one before (these four are {', '.join(h)}); the turn goes the same way in every batch: facing screen RIGHT (0) -> toward the viewer (90) -> screen LEFT (180) -> away, back to the viewer (270) -> screen RIGHT again. Do not turn faster or slower than the old frames show, and never turn the opposite way. Big body, fill the frame." + chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
