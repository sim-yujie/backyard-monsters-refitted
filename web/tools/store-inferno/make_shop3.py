"""make_shop3.py <variant> : round 3 of the original Inferno shop, at the game's own camera (owner on the desk,
20 Nov 2026: "Angle seems wrong compared to the rest of the buildings").

The game's camera is a 2:1 isometric one (`YardGrid.toIso`: ground lines at a slope of 0.5), every square footprint a
diamond twice as wide as it is tall, its front corner straight below its middle, so a box building shows its left and
right walls equally wide. Round 2's shops were turned (shop C's front corner sat at 66% of its width, its right base
edge at a slope of 0.84; angle.py). Round 3 gives Codex:
- guide.png: the camera as a drawing: the base diamond (2:1) and a box standing on it, front corner in the middle;
- angle.png: the Inferno's Housing Bunker (a ring on the ground, exactly 2:1, front corner in the middle: angle.py
  measures it at 49% / slopes +0.51 -0.50) and the Strongbox, with the same 2:1 diamond drawn under each;
- style.png: the Modern Inferno buildings (materials and finish).
Writes art-samples/store-inferno/runs/shop3-<variant>/; run_shop.sh 3 <variant> paints and fits it.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT  # noqa: E402
from shop_texts import FINISH, SHOP, VARIANTS  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / f"shop3-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)
W = H = 1024
BB = ASSETS / "buildings"

# guide.png: base diamond 600 x 300, front corner at (512, 900); a box 330 px tall on it (light grey lines on green)
g = Image.new("RGB", (W, H), (0, 255, 0))
d = ImageDraw.Draw(g)
cx, by, hw, hh, tall = 512, 900, 300, 150, 330
front, left, back, right = (cx, by), (cx - hw, by - hh), (cx, by - 2 * hh), (cx + hw, by - hh)
d.polygon([front, left, back, right], outline=(255, 255, 255), width=5)
for p in (front, left, right):
    d.line([p, (p[0], p[1] - tall)], fill=(40, 40, 40), width=4)
up = lambda p: (p[0], p[1] - tall)  # noqa: E731
d.line([up(left), up(front), up(right), up(back), up(left)], fill=(40, 40, 40), width=4)
g.save(out / "guide.png")


def with_diamond(path):
    """A real building on grey at 1.5x its @2x size, with the 2:1 diamond its base sits on drawn under it: as wide as
    the picture, its bottom corner at the picture's lowest opaque point."""
    import numpy as np
    im = Image.open(path).convert("RGBA")
    k = 1.5
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    al = np.asarray(im)[..., 3] > 128
    ys, xs = np.where(al)
    bottom = ys.max()
    fx = xs[ys >= bottom - 2].mean()
    hw_ = (xs.max() - xs.min()) / 2
    c = Image.new("RGBA", (im.width + 80, im.height + 80), GREY + (255,))
    dd = ImageDraw.Draw(c)
    ox, oy = 40 + fx, 40 + bottom
    dd.polygon([(ox, oy), (ox - hw_, oy - hw_ / 2), (ox, oy - hw_), (ox + hw_, oy - hw_ / 2)], outline=(255, 255, 255),
               width=3)
    c.alpha_composite(im, (40, 40))
    return c


refs = [with_diamond(BB / "ihousingbunker/top.c1@2x.webp"), with_diamond(BB / "imonsterlab/top.3d1@2x.webp")]
a = Image.new("RGBA", (sum(r.width for r in refs) + 40, max(r.height for r in refs)), GREY + (255,))
x = 0
for r in refs:
    a.alpha_composite(r, (x, a.height - r.height))
    x += r.width + 40
a.convert("RGB").save(out / "angle.png")

st = [Image.open(BB / f).convert("RGBA") for f in ("itownhall/top.c3@2x.webp", "istoragesilo/top.c1@2x.webp",
                                                    "iboneharvester/body.3d7@2x.webp", "imagmatower/top.t3@2x.webp")]
sp = Image.new("RGBA", (sum(s.width for s in st) + 20 * (len(st) + 1), max(s.height for s in st) + 40), GREY + (255,))
x = 20
for s in st:
    sp.alpha_composite(s, (x, 20 + sp.height - 40 - s.height))
    x += s.width + 20
sp.convert("RGB").resize((sp.width * 2, sp.height * 2), Image.LANCZOS).save(out / "style.png")
(out / "inputs.txt").write_text("guide.png angle.png style.png\n")

prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code.

Paint {SHOP}.

The design: {VARIANTS[variant]}

It is for our isometric strategy game (cartoony, colourful monster world).

CAMERA (most important, an earlier attempt got it wrong): the game's fixed 2:1 isometric camera, exactly as guide.png draws it. The building stands on a SQUARE footprint seen as a diamond twice as wide as it is tall (the white diamond in guide.png). Its FRONT CORNER points straight at the viewer, in the middle of the picture, so its LEFT wall (facing the lower left) and its RIGHT wall (facing the lower right) show EQUALLY wide, each going up and back at the same 2:1 slope as the diamond's edges, and the vertical corners stand straight up. NOT turned, NOT a front view, NOT a three-quarter view with one wall wider.
Input 1, guide.png ({W}x{H}): the camera drawn as lines: the base diamond and a box standing on it. Paint the shop IN THE SAME PLACE AND SIZE: its base fills the white diamond, its walls rise along the dark vertical lines, its roof may rise higher. Signs, lanterns and small props may stick out a little. Do NOT draw the guide lines.
Input 2, angle.png: two of our Inferno buildings at this same camera, the same white 2:1 diamond drawn under each: the ring of horns sits exactly on its diamond, the round Strongbox's base is the same 2:1 ellipse. Match this viewpoint.
Input 3, style.png: the Modern look of our Inferno buildings: match their materials, colours, level of detail and finish, so the shop looks made by the same artist.

{FINISH}

Output: ONE image, {W}x{H}, the building alone where guide.png puts it, complete and fully inside the image.
Background everywhere: flat pure green #00FF00, also in every gap between the parts. No guide lines, no diamond, no ground plane, no lava pool, no grass, no tile, no cast shadow on the ground, no grid lines, no text, no letters, no labels. The building itself must contain no bright pure green.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
