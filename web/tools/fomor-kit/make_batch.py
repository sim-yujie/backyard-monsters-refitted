"""
make_batch.py <col> <batch dir> [<painted idle cell png>...] : set up one Codex call for one Fomor (G3_1, fly_1.png) heading.
Sheet: 53x40 cells, 16 columns (2 = front, 6 = left, 10 = back, 15 = right), row 0 idle, rows 1-7 walk, no attack rows.
One call = idle + walk 1-7 as a 4x2 grid (cell 1 idle). Extra args are already painted views (neighbour / idle of this heading).
Writes frames.png (old frames blown up on grey), style.png, portrait.png, prompt.txt.
"""
import os
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SHEET = REPO / "server" / "public" / "assets" / "monsters" / "fly_1.png"
KIT = Path("D:/Coding/BYMR/art-trials/champions/fomor")
W, H, S = 53, 40, 6
col, out = int(sys.argv[1]), Path(sys.argv[2])
extra = sys.argv[3:]
out.mkdir(parents=True, exist_ok=True)
sheet = Image.open(SHEET).convert("RGBA")
grid = Image.new("RGB", (4 * W * S, 2 * H * S), (128, 128, 128))
for r in range(8):
    cell = sheet.crop((col * W, r * H, (col + 1) * W, (r + 1) * H)).resize((W * S, H * S), Image.NEAREST)
    bg = Image.new("RGBA", cell.size, (128, 128, 128, 255))
    bg.alpha_composite(cell)
    grid.paste(bg.convert("RGB"), ((r % 4) * W * S, (r // 4) * H * S))
grid.save(out / "frames.png")
shutil.copy(KIT / "portrait-crop.png", out / "portrait.png")


def tight(im):
    a = np.asarray(im.convert("RGBA")).astype(int)
    bg = ((a[..., 0] > 200) & (a[..., 1] < 90) & (a[..., 2] > 200)) | (a[..., 3] < 20)
    ys, xs = np.where(~bg)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def flat(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 0, 255, 255))
    bg.alpha_composite(im)
    return tight(bg.convert("RGB"))


# heading of every column, turning from the front (col 2) through left (6), back (10), right (14)
FACING = {
    0: "three-quarter view, turned about 45 degrees to screen RIGHT of facing the viewer: mostly facing the viewer, head and snout pointing to the lower right",
    1: "facing the viewer but turned slightly (about 22 degrees) to screen RIGHT",
    2: "facing the viewer straight on (front view)",
    3: "facing the viewer but turned slightly (about 22 degrees) to screen LEFT",
    4: "three-quarter view, turned about 45 degrees to screen LEFT of facing the viewer, head pointing to the lower left",
    5: "turned about 67 degrees to screen LEFT: nearly a left profile, still showing a little of the front, head pointing left",
    6: "left side profile: head on the LEFT, tail on the RIGHT",
    7: "turned past the left profile (about 112 degrees from front): head pointing left and slightly away from the viewer, tail to the right and toward the viewer",
    8: "three-quarter back view, turned about 135 degrees from the front: head pointing up-left away from the viewer, rump toward the viewer's right",
    9: "mostly seen from behind, turned a little (about 157 degrees from front) to screen left",
    10: "seen straight from BEHIND: back and tail toward the viewer, head hidden",
    11: "mostly seen from behind, turned a little (about 157 degrees) toward screen right",
    12: "three-quarter back view, turned about 135 degrees toward screen RIGHT: head pointing up-right away from the viewer",
    13: "turned past the right profile (about 112 degrees from front toward the right): head pointing right and slightly away from the viewer, tail to the left",
    14: "right side profile: head on the RIGHT, tail on the LEFT",
    15: "nearly a right profile (about 67 degrees to screen RIGHT of front): head pointing right and slightly toward the viewer, tail to the left",
}
SAMPLES = {15: ("new-heading0.png", "facing screen RIGHT"), 2: ("new-heading1.png", "facing the viewer"),
           6: ("new-heading2.png", "facing screen LEFT"), 10: ("new-heading3.png", "seen from behind")}
near = sorted(SAMPLES, key=lambda c: min((col - c) % 16, (c - col) % 16))[:2]
views, used = [], []
for p in extra:
    views.append(flat(p)); used.append("an already painted view of this Fomor (use it for the exact design, size and colours)")
for c in near:
    views.append(flat(KIT / SAMPLES[c][0])); used.append(f"approved sample, {SAMPLES[c][1]}")
Hh = max(v.height for v in views)
strip = Image.new("RGB", (sum(v.width for v in views) + 40 * (len(views) + 1), Hh + 80), (255, 0, 255))
x = 40
for v in views:
    strip.paste(v, (x, 40 + Hh - v.height)); x += v.width + 40
strip.save(out / "style.png")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 4x2 grid (1272x480) of 8 low-resolution isometric game sprites of the old Fomor toad monster at ONE heading (heading column {col} of 16). In this heading the creature is: {FACING[col]}. Cell 1 (top-left) is the idle pose; cells 2-4 top row and 5-8 bottom row are the WALK cycle frames 1-7 in time order. Ignore its colours, rough shapes and drop shadows. Use it ONLY for the facing, position, size and the POSE of each frame (which legs are forward or back, how high the body is, body bob and sway).

Input 2, style.png: approved painted views of this same Fomor on magenta ({"; ".join(used)}). It is NOT the output layout. Copy its design, colours and painting style exactly; same creature in all 8 cells, turned to the heading described above (never mirrored to the wrong side; turn it smoothly between the views).

Input 3, portrait.png: the official painting of Fomor, design reference.

Output: ONE image, same 4x2 layout and canvas proportions as frames.png (1272x480 or a multiple), the same 8 frames in the same cells and order. Every cell shows the identical painted Fomor, same size in all 8 cells (about the size of the old sprite, at most 1.15x), the feet of every frame on the same ground line as in frames.png, body proportions never changing between frames, only the pose. Every walking pose must be clearly visible at game size: show the legs stepping as in the old frames.
Facing in EVERY cell: {FACING[col]}.
PART CHECKLIST, all visible in every cell as seen from that heading (a part hidden by the turn of the body is the only excuse): squat round dark-purple toad body, ONE wide head (exactly one head) with a scowling mouth with small teeth and glowing yellow eyes, glowing pale-blue bumps on the head and back, pale cream spikes along the back, exactly TWO clawed front limbs and exactly TWO clawed hind legs (four limbs in total, no more), body tapering to a pointed tail at the back.
Style: hand-painted digital illustration like the approved views, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out, col)
