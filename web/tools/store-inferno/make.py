"""make.py <variant> : set up one Codex painting of the Inferno General Store (run.sh runs it).

Writes art-samples/store-inferno/runs/<variant>/: frames.png (the surface Modern store blown up on grey: design,
camera, size), style.png (the Modern Inferno buildings already in the game), prompt.txt and inputs.txt.
NOTE="..." adds a correction.
"""
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT, on, surface_rgba  # noqa: E402
from texts import CAMERA, FINISH, STORE, VARIANTS  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / variant
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
W = H = 1024

src = surface_rgba()
src = src.crop(src.getbbox())
k = min(W * 0.8 / src.width, H * 0.8 / src.height)
big = on(GREY, src).resize((round(src.width * k), round(src.height * k)), Image.LANCZOS)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.9) - big.height))
fr.save(out / "frames.png")

BB = ASSETS / "buildings"
st = [Image.open(BB / f).convert("RGBA") for f in ("itownhall/top.c3@2x.webp", "istoragesilo/top.c1@2x.webp",
                                                    "iboneharvester/body.3d7@2x.webp", "imagmatower/top.t3@2x.webp",
                                                    "ihousingbunker/top.c1@2x.webp")]
sp = Image.new("RGBA", (sum(s.width for s in st) + 20 * (len(st) + 1), max(s.height for s in st) + 40), GREY + (255,))
x = 20
for s in st:
    sp.alpha_composite(s, (x, 20 + sp.height - 40 - s.height))
    x += s.width + 20
sp.convert("RGB").resize((sp.width * 2, sp.height * 2), Image.LANCZOS).save(out / "style.png")
(out / "inputs.txt").write_text("frames.png style.png\n")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {STORE}.

It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world). This copy stands in the INFERNO, the monsters' underground world of dark volcanic rock, bone and glowing lava, so only its COLOURS and MATERIALS change, to belong there beside the Inferno's own buildings.

{CAMERA}

Input 1, frames.png: the store as it is now on the surface (Modern look), blown up, on grey ({W}x{H}): design, camera, footprint and size. The new picture has the same silhouette, the same parts in the same places, and the same proportions. Read the small details from it.
Input 2, style.png: the Modern look of the Inferno's own buildings in the same game (the Under Hall, the Resource Pod, the Bone Cruncher, the Magma Tower, the Housing Bunker): their materials and colours.

THE SAME STORE, INFERNO COLOURS (most important): a player must instantly see it is the same General Store as input 1, recoloured and re-materialed for the Inferno. NOT a new design, nothing added or left out.

COLOURS AND MATERIALS: {VARIANTS[variant]}

{FINISH}

Output: ONE image, {W}x{H}, the store alone, complete and fully inside the image with margin, about the size it has in input 1.
Background everywhere: flat pure green #00FF00, also in every gap between the legs and parts. No ground plane, no lava pool, no grass, no tile, no cast shadow on the ground, no grid lines, no extra text or labels besides MATCH BOOK on the front. The store itself must contain no bright pure green.
"""
if os.environ.get("NOTE"):
    prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
