"""make_shop.py <variant> : set up one Codex painting of an ORIGINAL Inferno shop (round 2, owner 20 Nov 2026).

Writes art-samples/store-inferno/runs/shop-<variant>/: style.png (the Modern Inferno buildings already in the game),
prompt.txt and inputs.txt. run_shop.sh paints it and finish.py fits it onto the surface store's box.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT  # noqa: E402
from shop_texts import FINISH, SHOP, VARIANTS  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / f"shop-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
W = H = 1024

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
(out / "inputs.txt").write_text("style.png\n")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code.

Paint {SHOP}.

The design: {VARIANTS[variant]}

It is for our isometric strategy game (cartoony, colourful monster world). The input, style.png, shows the Modern look of the Inferno buildings already in our game (an Under Hall, a Resource Pod, a Bone Cruncher, a Magma Tower, a Housing Bunker): match their materials, colours, level of detail and finish, so the shop looks made by the same artist.

CAMERA: the game's isometric 3/4 view, seen from the front and above at about 35 degrees, the building turned about 45 degrees so two faces show (one toward the lower left, one toward the lower right), as the buildings in style.png.

{FINISH}

Output: ONE image, {W}x{H}, the building alone, complete and fully inside the image with margin, filling about 80% of the image height.
Background everywhere: flat pure green #00FF00, also in every gap between the parts. No ground plane, no lava pool, no grass, no tile, no cast shadow on the ground, no grid lines, no text, no letters, no labels. The building itself must contain no bright pure green.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
