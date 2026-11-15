"""
still_batch.py <IC id> <work dir> <h1> <h2> <h3> <h4>
Sets up ONE Codex call that paints four headings of the still sheet as a 2x2 grid on magenta.
Writes <work>/still/b-<h1>-<h2>-<h3>-<h4>/ with frames.png (the Flash cells blown up), style.png
(approved views, if <work>/approved.json exists), portrait.png and prompt.txt.
The first call (no approved.json yet) is the design sample; approve it with approve.py.
Env NOTE is appended to the prompt.
"""
import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import common
from spec import PORTRAITS, SPECS, flash_column, heading_deg, view_of

mid, work = sys.argv[1], Path(sys.argv[2])
hs = [int(x) for x in sys.argv[3:7]]
spec = SPECS[mid]
out = work / "still" / ("b-" + "-".join(map(str, hs)))
out.mkdir(parents=True, exist_ok=True)

cw, ch = spec["cell"]
z = min(7, 320 // cw, 256 // ch)  # blow-up that fits a 320x256 grid cell (IC1: 7, IC2: 5)
grid = Image.new("RGB", (640, 512), (128, 128, 128))
for i, h in enumerate(hs):
    cell = common.flash_cell(spec, flash_column(spec, h))
    if spec.get("ref_body_only"):
        # the body without its cast shadow, centred in the grid cell with clear margin (Zagnoid's shadow
        # reaches far to the lower right and its body sits at the cell's left edge)
        cell = common.flash_body_only(spec, flash_column(spec, h))
        cell = cell.crop(common.bbox(np.asarray(cell)[..., 3] > 0))
    big = cell.resize((cell.width * z, cell.height * z), Image.BICUBIC if spec.get("ref_smooth") else Image.NEAREST)
    bg = Image.new("RGBA", big.size, (128, 128, 128, 255))
    bg.alpha_composite(big)
    grid.paste(bg.convert("RGB"), ((i % 2) * 320 + (320 - big.width) // 2, (i // 2) * 256 + (256 - big.height) // 2))
grid.save(out / "frames.png")

use_portrait = spec.get("portrait", True)  # IC2 round 2: False, the Flash sprite is the only reference
if use_portrait:
    p = Image.open(PORTRAITS / f"{mid}.webp").convert("RGB")
    p.resize((p.width * 3, p.height * 3), Image.LANCZOS).save(out / "portrait.png")

inputs = ["frames.png"]
style_text = ""
appr = work / "approved.json"
if appr.exists():
    views = json.loads(appr.read_text())  # [{"heading": h, "file": path to a cut view}]
    near = sorted(views, key=lambda v: min(abs(v["heading"] - h) for h in hs))[:3]
    near.sort(key=lambda v: v["heading"])
    ims = [Image.open(v["file"]).convert("RGBA") for v in near]
    H = max(i.height for i in ims)
    strip = Image.new("RGBA", (sum(i.width for i in ims) + 40 * (len(ims) + 1), H + 80), (255, 0, 255, 255))
    x = 40
    for im in ims:
        strip.alpha_composite(im, (x, 40 + H - im.height))
        x += im.width + 40
    strip.convert("RGB").save(out / "style.png")
    inputs.append("style.png")
    names = "; ".join(f"heading {heading_deg(spec, v['heading']):g} degrees ({view_of(spec, v['heading'])[0]})" for v in near)
    style_text = (
        f"\nInput 2, style.png: a row of APPROVED painted views of {spec['name']} on magenta, left to right: {names}. "
        f"This row is NOT the layout of the output. Copy its exact design, colours, painting style, {spec['features']} and "
        "proportions for every new cell: same creature in every cell, turned to the cell's own heading.\n"
    )
if use_portrait:
    inputs.append("portrait.png")

cells = ["top-left", "top-right", "bottom-left", "bottom-right"]
lines = []
backs = []
for c, h in zip(cells, hs):
    words, back = view_of(spec, h)
    lines.append(f"  {c}: heading {heading_deg(spec, h):g} degrees, {words}")
    if back:
        backs.append(c)
back = f"\n{spec['back_note']} (cells: {', '.join(backs)})\n" if backs else ""
n_in = len(inputs)
if use_portrait:
    portrait_text = f"Input {n_in}, portrait.png: the official concept painting, {spec['portrait_note']}; the old sprite decides the shape and the features.\n"
    style_text2 = f"hand-painted digital game illustration like the portrait: {spec['texture']}, soft shading, bright highlights, NO thick black outline, no pixel art, readable at a small size."
else:
    portrait_text = (
        "frames.png is the ONLY design reference: trace each old sprite's silhouette (body, neck, head, beak, tail, "
        "limbs) and keep its proportions and colours; do not invent a new design, do not make it fatter, rounder, "
        "glossier or cuter.\n"
    )
    style_text2 = f"{spec['style']}; {spec['texture']}."
prompt = f"""Use your image generation tool (one call) to create a new image and save it as frames-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Input 1, frames.png: a 2x2 grid of 4 low-resolution isometric game sprites of {spec['name']}, blown up (OLD pixel art). Use it for the facing, shape, colours and overall size of each cell: the new art is the same creature, painted richer. Heading in degrees: 0 = facing the screen's RIGHT, 90 = facing toward the viewer (down), 180 = facing the screen's LEFT, 270 = facing away from the viewer (up); the camera is a 3/4 isometric view from above. Cells:
{chr(10).join(lines)}
Look closely at where {spec['face_marks']} sit on each old sprite and put the face exactly there.
{style_text}
The creature: {spec['creature']}

PART CHECKLIST (every cell, as seen from that cell's angle; never drop, merge or add parts):
{spec['parts']}
{back}
{portrait_text}
LIGHT: {spec['light']}.
Output: ONE image with the same 2x2 grid layout and canvas proportions as frames.png (640x512 or a 2x multiple), each creature at the same position and facing as the matching cell of frames.png and about the same size (no bigger than 1.3x). Same scale in all four cells.
Style: {style_text2}
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels. {spec['no_fx']}.
"""
if os.environ.get("NOTE"):
    prompt += os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
(out / "inputs.txt").write_text(" ".join(inputs))
print(out)
