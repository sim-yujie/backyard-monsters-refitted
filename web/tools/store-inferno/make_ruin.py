"""make_ruin.py <variant> : the damaged and destroyed looks of the wired Inferno shop (round 3 shop C), in ONE Codex
picture, damaged on the left, destroyed on the right (lead, 20 Nov 2026: as the other Modern Inferno buildings do
theirs: the painted Resource Pod and Housing Bunker each have a damaged look, still standing, and a destroyed one, a
low wreck on the same spot).

Writes art-samples/store-inferno/runs/ruin-<variant>/: base.png (the shop as it stands, our own painting, on grey),
guide.png (the game camera twice: the same 2:1 base diamond as round 3's guide in each half), ref.png (the Resource
Pod and the Housing Bunker whole, damaged and destroyed, from the game), prompt.txt, inputs.txt.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT  # noqa: E402
from shop_texts import FINISH  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / f"ruin-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
W, H = 1536, 1024
FRONT = ((384, 900), (1152, 900))
HW = 300

cut = Image.open(OUT / "runs" / "shop3-C" / "sample-cut.png").convert("RGBA")
cut = cut.crop(cut.getbbox())
b = Image.new("RGBA", (cut.width + 120, cut.height + 120), GREY + (255,))
b.alpha_composite(cut, (60, 60))
b.convert("RGB").save(out / "base.png")

g = Image.new("RGB", (W, H), (0, 255, 0))
d = ImageDraw.Draw(g)
for fx, fy in FRONT:
    d.polygon([(fx, fy), (fx - HW, fy - HW // 2), (fx, fy - HW), (fx + HW, fy - HW // 2)], outline=(255, 255, 255), width=5)
g.save(out / "guide.png")

BB = ASSETS / "buildings"
rows = [[BB / f"istoragesilo/top.c1{s}@2x.webp" for s in ("", ".damaged", ".destroyed")],
        [BB / f"ihousingbunker/top.c1{s}@2x.webp" for s in ("", ".damaged", ".destroyed")]]
ims = [[Image.open(f).convert("RGBA") for f in row] for row in rows]
cw = max(i.width for row in ims for i in row) + 40
rh = [max(i.height for i in row) + 40 for row in ims]
r = Image.new("RGBA", (cw * 3, sum(rh)), GREY + (255,))
y = 0
for row, h in zip(ims, rh):
    for j, i in enumerate(row):
        r.alpha_composite(i, (j * cw + (cw - i.width) // 2, y + h - 20 - i.height))
    y += h
r.convert("RGB").save(out / "ref.png")
(out / "inputs.txt").write_text("base.png guide.png ref.png\n")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint TWO pictures side by side in ONE image ({W}x{H}) of the same building of our isometric strategy game (cartoony, colourful monster world): our Inferno SHOP, a lava forge shop, as base.png shows it whole (our own painting): a squat shopfront of dark stone blocks with glowing lava cracks, copper trim, a copper roof of ribbed plates with a horned ember knob on top, a stone chimney at the back right with a glowing top, a little copper awning over a stone counter with gold bars and a bowl of gold coins on the left wall, a round window glowing molten orange on the right wall, and a round copper coin sign hanging from a bracket at the left.
- In the LEFT half: the shop DAMAGED (hit in a battle, still standing): the same building, same parts in the same places, but the roof plates dented, bent and partly torn off showing dark beams, a few stones knocked out of the walls and cracked, the awning hanging crooked, the round window cracked, the coin sign hanging from one chain, the chimney cracked and its top broken, dark scorch marks and a little soot, the lava cracks still glowing.
- In the RIGHT half: the shop DESTROYED: a LOW wreck on the same base: the walls collapsed into a heap of broken dark stone blocks with glowing lava cracks, the copper roof crumpled flat on top of the rubble, the chimney fallen into broken pieces, the counter smashed, the coin sign lying in the rubble, a few gold coins scattered, charred beams sticking out; much lower than the whole building (about a third of its height), spread over its own base.
Input 1, base.png: the shop whole: its parts, materials, colours and finish. Both pictures are this building.
Input 2, guide.png: the game's fixed 2:1 isometric camera: a white diamond in each half is the building's square base, seen with its FRONT CORNER pointing straight at the viewer, both side walls equally wide. Paint each picture standing on its diamond, at the same size as base.png's building would stand on it: the damaged one about as tall as the whole shop, the destroyed one low. Do NOT draw the diamonds.
Input 3, ref.png: other buildings of our Inferno, whole, damaged and destroyed (left to right): how far our damaged and destroyed looks go.

{FINISH}

Background everywhere: flat pure green #00FF00, also in every gap. No diamonds, no guide lines, no ground plane, no lava pool, no grass, no tile, no cast shadow on the ground, no text, no labels. The building itself must contain no bright pure green. Each picture complete inside its own half of the image, nothing crossing the middle.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
