"""ksample.py <level 1-6> : set up one Codex call that paints the Korath sample (front idle + one walk frame) of one level.
Writes art-trials/champions/korath/L<n>/: frames.png (the 2 old cells blown up), ref-old.png (old idle front/side/back),
style.png (approved Gorgo repaint of the same level, STYLE ONLY), portrait.png (this level's painting), prompt.txt.
Env NOTE is appended to the prompt. Same recipe as _kit/scripts/make_sample.py (Gorgo/Drull/Fomor/Krallen samples)."""
import os
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from kparts import KIT, KL, KPARTS, KCOLOUR, cell, on, gorgo_cell  # noqa: E402

lvl = int(sys.argv[1])
out = KIT.parent / "korath" / f"L{lvl}"
out.mkdir(parents=True, exist_ok=True)
fw, fh, wc, WALK = KL[lvl]
FRONT = 2
GREY = (128, 128, 128)
MAG = (255, 0, 255)


def pad_cell(im, bg, aspect=0.75):
    w, h = im.size
    H = max(h, round(w / aspect))
    W = max(w, round(H * aspect))
    c = Image.new("RGB", (W, H), bg)
    c.paste(on(bg, im), ((W - w) // 2, (H - h) // 2))
    return c


cells = [pad_cell(cell(lvl, FRONT, r), GREY) for r in (0, WALK)]
S = 768 / cells[0].width
cells = [c.resize((768, round(c.height * S)), Image.NEAREST) for c in cells]
fr = Image.new("RGB", (1536, cells[0].height), GREY)
fr.paste(cells[0], (0, 0)); fr.paste(cells[1], (768, 0))
fr.save(out / "frames.png")

refs = [on(GREY, cell(lvl, c, 0)) for c in (2, 6, 10)]
k = 3
ref = Image.new("RGB", (3 * fw * k + 40, fh * k), (60, 60, 60))
for i, r in enumerate(refs):
    ref.paste(r.resize((fw * k, fh * k), Image.LANCZOS), (i * (fw * k + 20), 0))
ref.save(out / "ref-old.png")

# style.png: the approved Gorgo repaint of the same level (front idle + walk), on magenta. Style reference only.
st = [on(MAG, gorgo_cell(lvl, FRONT, r)) for r in (0, 3)]
H = max(s.height for s in st)
style = Image.new("RGB", (sum(s.width for s in st) + 120, H + 80), MAG)
x = 40
for s in st:
    style.paste(s, (x, 40 + H - s.height)); x += s.width + 40
style.save(out / "style.png")

p = Image.open(KIT / "portraits" / f"G4-L{lvl}.png").convert("RGBA")
on((60, 60, 60), p).resize((p.width * 3, p.height * 3), Image.LANCZOS).save(out / "portrait.png")

walk_txt = ("a mid-crawl WALK frame (how the molten body stretches and flows forward)" if lvl == 1
            else "a mid-stride WALK frame (which arms and legs are forward or back, body bob)")
prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

This is level {lvl} of the champion monster Korath, a creature of molten lava and volcanic rock (a sprite for an isometric game, seen from slightly above).

Input 1, frames.png: two low-resolution sprites of the OLD level {lvl} Korath, blown up, on grey, side by side (1536 wide, two 768-wide cells). Left cell = idle pose facing the viewer; right cell = {walk_txt}, also facing the viewer. Use it for: facing, position in the cell, size, POSE, and the level {lvl} BODY SHAPE, proportions, armour and features (this is what makes level {lvl} different from the other levels, keep all of it). Ignore its blurry pixels, its drop shadow and its washed-out colours.

Input 2, ref-old.png: the same old level {lvl} Korath idle seen from the front, the side and the back (bigger), to read its shape, armour and features. Reference only.

Input 3, style.png: the APPROVED new painting of a DIFFERENT champion (Gorgo, a blue ape) at the same level, on magenta. STYLE ONLY: copy its hand-painted look, level of detail, crispness, soft shading and glossy highlights. Do NOT copy its shape, its blue colour, its armour or its face.

Input 4, portrait.png: the official level {lvl} painting of Korath; design reference for the level {lvl} features and colours.

Colours (from the Flash sprite and the portrait): {KCOLOUR}

Output: ONE image, 1536 wide, same two-cell layout and proportions as frames.png. Each cell shows the painted level {lvl} Korath at the same position, facing and size as the old sprite in that cell (fill about the same area, at most 1.1x), feet on the same ground line, the SAME creature in both cells, only the pose differs. Make it MORE detailed than the old sprite: clear rock plates, glowing cracks, eyes and mouth, armour edges and rivets where present, readable at small game size.
PART CHECKLIST, every part visible in both cells where the facing allows: {KPARTS[lvl]}
Style: hand-painted digital illustration like style.png, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels, no smoke or flames outside the body.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
