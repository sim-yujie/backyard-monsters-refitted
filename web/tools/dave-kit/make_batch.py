"""
make_codex_batch.py <batch dir> <c1> <c2> <c3> <c4> [<prev frames-new.png> <prev quadrant>] : set up one Codex call for four D.A.V.E. headings.
Writes frames.png (the old frames blown up 8x on grey), style.png (the approved Codex views, plus the previous batch's last
heading), portrait.png and prompt.txt. Then, from the batch dir:
    codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt
Headings are sheet columns of sprite.12.v2.png (30 x 53x46 cells (row 0, visible), 12 degrees apart; 0 = facing screen RIGHT, 8 = facing the
viewer, 15 = facing screen LEFT, 23 = back to the viewer). Env NOTE is appended to the prompt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "sprite.12.v2.png"
KIT = Path("D:/Coding/BYMR/art-trials/dave")
out = Path(sys.argv[1])
cols = [int(c) for c in sys.argv[2:6]]
out.mkdir(parents=True, exist_ok=True)

sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, c in enumerate(cols):
    cell = sheet.crop((c * 53, 0, c * 53 + 53, 46)).resize((265, 230), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + 27, (i // 2) * 256 + 13))
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
CHECK = """PART CHECKLIST: these parts MUST ALL be visible in EVERY cell, as seen from that cell's angle (a part hidden by the turn of the body is the only excuse). Never drop, merge, shorten or add any:
 1. Head: a big rounded rusty dome shell with ONE big tall curved grey steel shark-fin horn on top at the back-middle, and about 7-9 smaller grey cone spikes around the dome's rim and top.
 2. Eyes/visor: TWO steel goggle frames (riveted rims, joined by a bridge) each holding ONE glowing round red eye (2 red eyes in total) on the front of the dome. In side views the near goggle and its red eye must be seen IN PROFILE (a goggle rim sticking out of the side of the dome with the red eye visible); never lose the eye in a side view. From behind they are not visible.
 3. Mouth: under the goggles a dark mouth full of big pale steel fang/grille teeth (a jagged row of 6-7 large pale steel plate teeth, as a toothy grille across the front lower body), on the front of the body. Hidden only from behind.
 4. Body: rust-brown riveted, patched metal armour plates; small arched hatch doors/boxes low at the sides of the teeth. The back is a plain rusty riveted plate panel.
 5. Arms: TWO mechanical arms, one on each side of the body (a cylinder cannon/hydraulic piston arm with copper pipes), plus a small yellow-and-black hazard-striped box on the side. In the portrait the right-hand arm is the big cannon arm; keep both arms in the approved views' style. From the front both arms are seen at the sides; from behind both arms are seen at the sides.
 6. Legs: TWO tank tracks (one under each side), dark rubber tread with round wheels, rusty plate fenders over them. Not legs.
 7. No tail, no wings.
 Colours: rust brown and copper, steel grey spikes and teeth, glowing red eyes, yellow-and-black hazard stripe."""
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of the D.A.V.E., blown up 6x (OLD design; ignore its colours and shapes). Use it ONLY for facing, position and overall size. Heading in degrees: 0 = facing the screen's RIGHT, turning through 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer showing its back (up); camera is a 3/4 isometric view. Cell headings: top-left {h[0]}, top-right {h[1]}, bottom-left {h[2]}, bottom-right {h[3]}. Look closely at which way each old monster faces and match that exactly. In the old sprite the two red dots are the eyes, the dark block is the body and the two lighter cylinders at the sides are the arms; the dark base is the tank tracks.

Input 2, style.png: a row of single APPROVED views of the D.A.V.E. on magenta, left to right: {"; ".join(used)}. This row is NOT the layout of the output. Copy its exact design, colours, painting style and proportions for every new cell: the D.A.V.E., a rusty spiked tank-like robot with goggle red eyes, fang teeth and two track treads. Same creature in every cell, rotated to the cell's own heading from frames.png (for in-between headings turn it smoothly between the approved views; never mirror it to face the wrong way).

{CHECK}

Input 3, portrait.png: the official concept painting, for design and colour reference only.

Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each monster at the same position and facing as the matching cell of frames.png, same overall size as the old one (no bigger than about 1.3x). Same scale in all four cells.
Style: hand-painted digital illustration like the portrait, soft shading, rich texture, glossy highlights, NO thick cartoon outline, NOT cute, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels."""
prompt += chr(10) + f"TURN NOTE: each cell is turned only 12 degrees further than the one before (these four are {', '.join(h)}); the turn goes the same way in every batch: facing screen RIGHT (0) -> toward the viewer (90) -> screen LEFT (180) -> away, back to the viewer (270) -> screen RIGHT again. Do not turn faster or slower than the old frames show, and never turn the opposite way. Big body, fill the frame." + chr(10) + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, cols)
