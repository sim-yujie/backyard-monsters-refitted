"""
anim_ref.py <IC id> <work dir> <heading> [<heading> ...]
Sets up one Codex call per painted heading for the animated sheet: <work>/anim/h<N>/ref.png (the painted still
of that heading, on magenta), portrait.png and prompt.txt (12 cells: walk 1-6, attack 7-11, cell 12 empty).
Run build_still.py first (it writes still/cuts/). Env EXTRA is appended to the prompt (for a redo).
"""
import os
import sys
from pathlib import Path

from PIL import Image

from spec import PORTRAITS, SPECS, heading_deg, view_of

mid, work = sys.argv[1], Path(sys.argv[2])
spec = SPECS[mid]
for h in [int(x) for x in sys.argv[3:]]:
    out = work / "anim" / f"h{h}"
    out.mkdir(parents=True, exist_ok=True)
    cut = Image.open(work / "still" / "cuts" / f"h{h}.png").convert("RGBA")
    s = 420 / max(cut.size)
    cut = cut.resize((round(cut.width * s), round(cut.height * s)), Image.LANCZOS)
    ref = Image.new("RGBA", (560, 560), (255, 0, 255, 255))
    ref.alpha_composite(cut, ((560 - cut.width) // 2, (560 - cut.height) // 2))
    ref.convert("RGB").save(out / "ref.png")
    p = Image.open(PORTRAITS / f"{mid}.webp").convert("RGB")
    p.resize((p.width * 3, p.height * 3), Image.LANCZOS).save(out / "portrait.png")
    (out / "inputs.txt").write_text("ref.png portrait.png")
    deg = heading_deg(spec, h)
    words, back = view_of(spec, h)
    backnote = (spec["back_note"] + " This holds in EVERY cell, attack cells included: the attack is seen from behind.\n") if back else ""
    prompt = f"""FACING RULE (most important): at heading {deg:g} degrees (0 = facing screen right, 90 = toward the viewer, 180 = screen left, 270 = away) {spec['name']} is {words}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells, the creature faces this same way and the viewer sees the same side of it as in ref.png: the face (where ref.png shows it) stays in the same place on the body. Never turn it toward the viewer, never mirror it.
Use the reference image ref.png (the exact creature: the painted game sprite of {spec['name']} at this heading; match its colours, flame crown and face exactly) and portrait.png (the concept painting, painting style only; do NOT copy its red shell, nose or proportions).
The creature: {spec['creature']}
Parts, in every cell as ref.png shows them:
{spec['parts']}
{backnote}
Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses.
{spec['walk']}
{spec['attack']}
In EVERY cell: the identical creature as ref.png in the same painted style (rich glowing fire texture, no black outline), the same camera angle (3/4 isometric from above), the same size as ref.png in the walk cells, the same heading. LIGHT: it glows evenly from within, no light from one side. No sparks, embers, smoke, motion streaks or fire spray off the body: every flame stays attached to the body. One creature per cell, centred in it, not cut at the cell edges, with clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
    if os.environ.get("EXTRA"):
        prompt += os.environ["EXTRA"] + "\n"
    (out / "prompt.txt").write_text(prompt, encoding="utf-8")
    print(out)
