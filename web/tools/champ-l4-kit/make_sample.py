"""make_sample.py <sheet e.g. ape_2> : set up one Codex call that paints the sample (front idle + one walk frame) of one champion level.
Writes art-trials/champions/<champ>/L<n>/: frames.png (the 2 old cells blown up), ref-old.png (old idle front/side/back),
style.png (the APPROVED level 3 repaint, same 2 frames), portrait.png (this level's painting), prompt.txt.  Env NOTE is appended to the prompt.
"""
import os
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from layout import KIT, L, OUT, cell, l3_sheet, on  # noqa: E402
from parts import PARTS, CHAMP, COLOUR  # noqa: E402

name = sys.argv[1]
fam, lvl = name.split("_")
champ = CHAMP[fam]
out = OUT / champ / f"L{lvl}"
out.mkdir(parents=True, exist_ok=True)
fw, fh, wf, wc = L[name]
WALK = wf + 2                       # a mid-stride walk row
FRONT = 2                           # column 2 faces the viewer on every champion sheet
GREY = (128, 128, 128)
MAG = (255, 0, 255)


def pad_cell(im, bg, aspect=0.75):
    """Pad a cell vertically (keeping it centred) so w:h = aspect; returns the padded cell and the top offset."""
    w, h = im.size
    H = max(h, round(w / aspect))
    W = max(w, round(H * aspect))
    c = Image.new("RGB", (W, H), bg)
    c.paste(on(bg, im), ((W - w) // 2, (H - h) // 2))
    return c


# frames.png: the two old cells, nearest-neighbour blown up, side by side, canvas 3:2
cells = [pad_cell(cell(name, FRONT, r), GREY) for r in (0, WALK)]
S = 768 / cells[0].width
cells = [c.resize((768, round(c.height * S)), Image.NEAREST) for c in cells]
fr = Image.new("RGB", (1536, cells[0].height), GREY)
fr.paste(cells[0], (0, 0)); fr.paste(cells[1], (768, 0))
fr.save(out / "frames.png")

# ref-old.png: the old idle at front, side (screen left) and back, blown up
refs = [on(GREY, cell(name, c, 0)) for c in (2, 6, 10)]
k = 3
ref = Image.new("RGB", (3 * fw * k + 40, fh * k), (60, 60, 60))
for i, r in enumerate(refs):
    ref.paste(r.resize((fw * k, fh * k), Image.LANCZOS), (i * (fw * k + 20), 0))
ref.save(out / "ref-old.png")

# style.png: approved level 3 repaint (4x sheet) idle front + same walk frame, on magenta
if fam != "krallen":
    f1w, f1h, w1, _ = L[f"{fam}_3"]
    sh = l3_sheet(fam)
    st = [on(MAG, sh.crop((FRONT * f1w * 4, r * f1h * 4, (FRONT + 1) * f1w * 4, (r + 1) * f1h * 4))) for r in (0, w1 + 2)]
else:   # no Krallen repaint: the level 1 repaints of the three others, style only
    st = []
    for f in ("ape", "dragon", "fly"):
        f1w, f1h, _, _ = L[f"{f}_1"]
        sh = Image.open(KIT / "sheets" / f"{f}_1-repaint@4x.png").convert("RGBA")
        st.append(on(MAG, sh.crop((FRONT * f1w * 4, 0, (FRONT + 1) * f1w * 4, f1h * 4))))
H = max(s.height for s in st)
style = Image.new("RGB", (sum(s.width for s in st) + 40 * (len(st) + 1), H + 80), MAG)
x = 40
for s in st:
    style.paste(s, (x, 40 + H - s.height)); x += s.width + 40
style.save(out / "style.png")

# portrait.png: this level's painting
pname = "G5.png" if fam == "krallen" else f"{ {'ape': 'G1', 'dragon': 'G2', 'fly': 'G3'}[fam] }-L{lvl}.png".replace(" ", "")
p = Image.open(KIT / "portraits" / pname).convert("RGBA")
on((60, 60, 60), p).resize((p.width * 3, p.height * 3), Image.LANCZOS).save(out / "portrait.png")

CH = champ.capitalize()
style_txt = (f"Input 3, style.png: the APPROVED level 3 repaint of {CH} on magenta (idle facing the viewer, and the same walk frame). "
             f"Copy its painting style, level of detail, shading and its exact COLOURS ({COLOUR[fam]}). The new level must look like the same "
             f"champion grown up: no colour jump from level 3 (same skin colour, same eye colour, same claw colour), and at least as detailed and crisp as level 3.") if fam != "krallen" else (
             "Input 3, style.png: approved level 1 repaints of three OTHER champions (Gorgo, Drull, Fomor), on magenta. STYLE ONLY: copy their "
             "hand-painted look, level of detail, soft shading and glossy highlights; do not copy their shapes or colours.")
walk_txt = ("the same creature in its flying WALK cycle (wings beating)" if fam == "fly" and int(lvl) >= 3
            else "a mid-stride WALK frame (which legs are forward or back, body bob)")
prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

This is level {lvl} of the champion monster {CH} (a sprite for an isometric game, seen from slightly above).

Input 1, frames.png: two low-resolution sprites of the OLD level {lvl} {CH}, blown up, on grey, side by side (1536 wide, two 768-wide cells). Left cell = idle pose facing the viewer; right cell = {walk_txt}, also facing the viewer. Use it for: facing, position in the cell, size, POSE, and the level {lvl} BODY SHAPE, proportions, armour and features (this is what makes level {lvl} different from the other levels, keep all of it). Ignore its blurry pixels, its drop shadow and its washed-out colours.

Input 2, ref-old.png: the same old level {lvl} {CH} idle seen from the front, the side and the back (bigger), to read its armour, spikes and features. Reference only.

{style_txt}

Input 4, portrait.png: the official level {lvl} painting of {CH}; design reference for the level {lvl} features and colours.

Output: ONE image, 1536 wide, same two-cell layout and proportions as frames.png. Each cell shows the painted level {lvl} {CH} at the same position, facing and size as the old sprite in that cell (fill about the same area, at most 1.1x), feet on the same ground line, the SAME creature in both cells, only the pose differs. Make it MORE detailed than the old sprite: clear eyes, teeth, claws, skin/fur texture, armour edges and rivets, readable at small game size.
PART CHECKLIST, every part visible in both cells where the facing allows: {PARTS[name]}
Style: hand-painted digital illustration like style.png, soft shading, glossy highlights, NO thick cartoon outline, no cel shading, no pixel art.
Background everywhere: flat pure magenta #FF00FF. No shadows, no ground, no grid lines, no text, no labels.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
