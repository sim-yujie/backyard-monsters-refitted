"""make.py <tower> : set up one Codex call that paints the sample of one tower (one heading, base + turret together).

Writes art-samples/towers/<tower>/: frames.png (the old tower, nearest-neighbour blown up, on grey), ref.png (its Flash build
button, a sharper render of the same tower), style.png (approved level 3 champion repaints: the painting finish to copy),
prompt.txt and inputs.txt.  Env NOTE is appended to the prompt.
"""
import os
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT, TOWERS, old_rgba, on  # noqa: E402

t = sys.argv[1]
d = TOWERS[t]
out = OUT / t
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
GREEN = (0, 255, 0)

# frames.png: the old tower, whole-number blow-up, on a 1024x1024 or 1024x1536 grey canvas (tower ~70% of it)
im, _, _ = old_rgba(t)
bb = im.getbbox()
im = im.crop(bb)
W, H = (1024, 1536) if im.height / im.width > 1.25 else (1024, 1024)
k = max(1, int(min(W * 0.72 / im.width, H * 0.72 / im.height)))
big = on(GREY, im).resize((im.width * k, im.height * k), Image.NEAREST)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.86) - big.height))   # base near the bottom, like a building on its tile
fr.save(out / "frames.png")

# ref.png: the Flash build button (120x160) blown up
b = Image.open(ASSETS / "buildingbuttons" / f"{d['button']}.jpg").convert("RGB")
b.resize((b.width * 5, b.height * 5), Image.LANCZOS).save(out / "ref.png")

# style.png: approved level 3 repaints (Gorgo, Drull, Fomor), idle facing the viewer, on green
SH = {"ape_3": (103, 88), "dragon_3": (114, 85), "fly_3": (98, 81)}
st = []
for n, (fw, fh) in SH.items():
    s = Image.open(ASSETS / "monsters" / f"{n}-repaint@4x.png").convert("RGBA")
    st.append(on(GREEN, s.crop((2 * fw * 4, 0, 3 * fw * 4, fh * 4))))
Hs = max(s.height for s in st)
style = Image.new("RGB", (sum(s.width for s in st) + 40 * (len(st) + 1), Hs + 80), GREEN)
x = 40
for s in st:
    style.paste(s, (x, 40 + Hs - s.height)); x += s.width + 40
style.save(out / "style.png")
(out / "inputs.txt").write_text("frames.png ref.png style.png\n")

extra = {
    "cannon": ("\nCHANGE FOR THIS TOWER (owner decision): the cannon must now be able to TURN to aim. Keep the base exactly as in "
               "frames.png (red-and-white striped drum on three tan stone feet, the tan ring frame with its curved prongs). Only the "
               "upright grey tube in the middle changes: it becomes a short, wide steel CANNON BARREL (same grey steel with the pale "
               "blue rim) sitting in a round swivel mount inside the ring, tilted up at about 40 degrees and pointing toward the "
               "viewer's lower LEFT, so we see the barrel from the side and a little of its open muzzle: clearly a gun that can "
               "rotate on its mount. Keep it compact: the barrel stays inside the tower's outline and no taller than the old tube."),
}.get(t, "")
prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

This is {d['what']}, a defence building in the isometric strategy game Backyard Monsters, seen from the fixed isometric game camera (from the front-right, looking down at about 30 degrees).

Input 1, frames.png: the OLD low-resolution game sprite of this tower, blown up, on grey ({fr.width}x{fr.height}). Use it for: the camera angle, the exact SHAPE and silhouette, the parts and their places, the direction the gun/turret points, the colours of each part (red-and-white hazard stripes, metals, tan stone, wires, lights), its position and size in the image. Ignore its blurry pixels.

Input 2, ref.png: the old menu picture of the same tower (a sharper render, same design). Use it to read small details (bolts, panels, wires, lights). Its turret may point another way: follow frames.png for the turret direction.

Input 3, style.png: APPROVED hand-painted repaints of three champion monsters from the same game, on green. STYLE ONLY: copy their painting finish (crisp hand-painted digital illustration, soft shading, glossy highlights, rich saturated colours, clean readable shapes). Do not copy their shapes or colours.

Output: ONE image, {fr.width}x{fr.height}, the SAME tower painted new: same camera angle, same silhouette, same parts in the same places, same turret direction, same position and size as in frames.png (fill about the same area). Make it much MORE detailed and crisp than the old sprite: clean metal edges and rivets, panel lines, worn paint on the hazard stripes, glints on metal, glowing lights, readable at small game size. It must still be clearly the same Backyard Monsters tower, just repainted at high quality.{extra}
Style: hand-painted digital illustration like style.png, soft shading, glossy highlights, NO thick black cartoon outline, no cel shading, no pixel art, no photo-realism.
Background everywhere: flat pure green #00FF00. No shadow on the ground, no ground, no grass, no tile, no grid lines, no text, no labels. The tower itself must contain no bright pure green.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
