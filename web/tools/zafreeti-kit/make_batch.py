"""
make_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four Zafreeti (C15) headings.
Writes frames.png (the old frames blown up on grey), style.png (approved views, plus the previous batch's last heading), portrait.png and prompt.txt.
Headings are columns of zafreeti.v2.png (56x70 cells, 32 columns, 11.25 degrees apart; 0 = facing screen RIGHT, 8 = facing the viewer, 16 = LEFT, 24 = back).
approved.png is the approved 2x2 Codex sample (right, front, left, back). Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "zafreeti.v2.png"
KIT = Path("D:/Coding/BYMR/art-trials/zafreeti-c15")
CW, CH = 56, 70
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 640), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * CW, 0, c * CW + CW, CH)).resize((CW * 4, CH * 4), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 48, (i // 2) * 320 + 20))
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
lo = int(cols[0] * 11.25 // 90) % 4
views = [quadrant(APPROVED, lo), quadrant(APPROVED, (lo + 1) % 4)]
used = [names[lo], names[(lo + 1) % 4]]
prev = sys.argv[6:8]
if prev:
    views.insert(0, quadrant(prev[0], int(prev[1])))
    used.insert(0, f"the previous batch's last heading ({(cols[0] - 1) * 11.25:g} degrees, already painted and approved)")
H = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), H + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + H - v.height))
    x += v.width + 40
strip.save(out / "style.png")

h = [f"{c * 11.25:g} degrees" for c in cols]
back = ""
if cols[0] >= 18 and not os.environ.get("NOBACK"):
    back = "\nBACK-VIEW NOTE: from about 200 degrees onward the monster turns its back to the viewer: the purple tentacled FACE must NOT be visible in the cells where the back is toward the viewer (only the crystal horn spine along the back, the spiked leather back, the two cyan orbs at the sides and the dangling tassels are seen).\n"
CHECK = """PART CHECKLIST: these parts MUST ALL be visible in EVERY cell, as seen from that cell's angle (a part hidden by the turn of the body is the only excuse). Never drop, merge, shorten or add any:
 1. Body: a brown leather-armoured, rounded body with riveted ridges and a row of cone spikes along its back; red-brown collar/plates around the front.
 2. Crystal horn: ONE huge curved translucent blue crystal horn arcing over the top of the body from front to back (a segmented glassy spine seen from above in the front/back views).
 3. Orbs: TWO big glowing cyan glass orbs set in the front of the body, one each side (in side views the near orb is large, the far one a sliver at the edge; from the front both; from behind both at the sides).
 4. Face: a purple octopus-like tentacled face with two small glowing orange eyes at the bottom front, under the orbs. Hidden only when the back is toward the viewer.
 5. LEGS: FOUR long, thin, dark brown-black legs hanging straight down well below the body, each about as long as the body is tall, each with small blue/white bead bands and ending in a pointed tassel tip (portrait: they hang from under the shell on both sides of the face). In side views the near legs are clear and the far ones partly hidden behind; from the front/back all four spread in a row. NOT short stubs, NOT short orange tassels.
 6. CRYSTAL TAIL: the blue crystal strip runs over the top of the shell AND continues down past the face as a long faceted translucent blue crystal TAIL hanging below the body (portrait: bottom centre, longer than the face is tall, pointed end). It must be visible below the body in every cell where it is not hidden by the turn (from behind it hangs below the back/underside).
 7. No wings, no hands.
  Colours: brown leather, cyan orbs, light blue crystal horn, purple tentacles, orange eyes."""
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Zafreeti, blown up (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces (the dangling tentacle face is at the FRONT, the coil of the body trails behind) and match that exactly.

Input 2, style.png: a row of single APPROVED views of the Zafreeti on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its design of the shell, orbs, face, colours and painting style for every new cell, BUT its legs are far too short and its crystal tail is missing: draw the long legs and long crystal tail as in portrait.png and the checklist: same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

{CHECK}

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x640 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one including its long dangling legs (no bigger than about 1.3x); the whole figure, legs and crystal tail included, must fit inside its cell with a margin. Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += back + chr(10) + f"TURN NOTE: each cell is turned only 11.25 degrees further than the one before (these four are {', '.join(h)}); the turn goes the same way in every batch: facing screen RIGHT (0) -> toward the viewer (90) -> screen LEFT (180) -> away, back to the viewer (270) -> screen RIGHT again. Do not turn faster or slower than the old frames show, and never turn the opposite way. Big body, fill the frame." + chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
