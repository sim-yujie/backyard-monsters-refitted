"""
make_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four Wormzer (C13) headings.
Writes frames.png (the old frames blown up on grey), style.png (approved views, plus the previous batch's last heading), portrait.png and prompt.txt.
Headings are columns of 13.png (40x27 cells, 12 degrees apart; 0 = facing screen RIGHT, 8 = facing the viewer, 15 = LEFT, 23 = back).
approved.png (prep_approved.py) is the approved Codex sample with its two side views mirrored so heading 0 faces right.
Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "13.png"
KIT = Path("D:/Coding/BYMR/art-trials/wormzer-c13")
CW, CH = 40, 27
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * CW, 0, c * CW + CW, CH)).resize((CW * 7, CH * 7), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 20, (i // 2) * 256 + 30))
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
back = ""
if cols[0] >= 16 and not os.environ.get("NOBACK"):
    back = "\nBACK-VIEW NOTE: from about 192 degrees onward the monster turns its back to the viewer: the FACE, mouth, teeth, tongue and eyes must NOT be visible (only the top horn, the two side horns, the ribbed segmented purple back and the curled tail end are seen, plus the cream bone plates along the shoulders). Do not show the mouth in these cells.\n"
CHECK = """PART CHECKLIST: these parts MUST ALL be visible in EVERY cell, as seen from that cell's angle (a part hidden by the turn of the body is the only excuse). Never drop, merge, shorten or add any:
 1. Head: a big wide, wrinkled, brow-ridged purple head forming the front of the grub, with FOUR big golden cone horns: ONE tall one on top of the head, ONE on each side of the head low down (pointing out sideways/forward), and ONE under the chin pointing down/forward. In side views you see the top horn plus the near side horn and the chin horn (and the far side horn peeks out); from the front all four; from behind the top horn and both side horns.
 2. Eyes: TWO small glowing orange eyes deep in the wrinkled brow above the mouth. In side views the near eye is fully seen and the far eye is a small glow at the edge of the brow; never lose the eyes in a side view. Hidden only from behind.
 3. Mouth/teeth: a HUGE gaping mouth: a row of about 8 long cream fangs along the top, a row of about 8-10 shorter fangs along the bottom, a big pink-red tongue, dark red throat, blood-red gums. Hidden only from behind.
 4. Body: fat, glossy, ribbed purple grub body of 5-6 swollen segments behind the head, tapering; a collar of purple beads around the base of the head; cream bone-plate spikes along the shoulders from behind.
 5. Tail: the segments taper to a small curled/spiral tip at the rear (seen as the spiral end from behind).
 6. No arms, no legs, no wings, no hair.
 Colours: purple / pinkish-violet body, gold horns, cream teeth, pink tongue, orange eyes."""
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the Wormzer, blown up (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces (the little white dots are its teeth/horn tips) and match that exactly. The head/mouth is where the white teeth marks are; the grub body trails away from it.

Input 2, style.png: a row of single APPROVED views of the Wormzer on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every new cell: the Wormzer, a fat purple segmented grub with a huge fanged mouth, glowing orange eyes and golden cone horns. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

{CHECK}

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one (no bigger than about 1.3x). Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += back + chr(10) + f"TURN NOTE: each cell is turned only 12 degrees further than the one before (these four are {', '.join(h)}); the turn goes the same way in every batch: facing screen RIGHT (0) -> toward the viewer (90) -> screen LEFT (180) -> away, back to the viewer (270) -> screen RIGHT again. Do not turn faster or slower than the old frames show, and never turn the opposite way. Big body, fill the frame." + chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
