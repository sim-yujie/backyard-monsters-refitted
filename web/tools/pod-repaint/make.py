"""make.py <look> <variant> : set up one Codex painting of the Inferno's Resource Pod (run.sh runs it).

look = 1 (Flash's one look, all ten levels), 1d (its damaged look), 1x (its destroyed look). variant = any short name
(A, B, ...); run.sh <look> <variant> paints into art-samples/pod/runs/L<look>-<variant>/.
Writes there: frames.png (the Flash look blown up on grey: design, camera, footprint, size), style.png (the Modern
Inferno buildings already in the game: the painted Under Hall and the 3D Bone Cruncher and Magma Tower, the finish the
Pod must share), for damaged/destroyed base.png (the new whole Pod it breaks, BASE=1-A by default), prompt.txt and
inputs.txt. NOTE="..." adds a correction.
"""
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT, flash_rgba, on, parse  # noqa: E402

look, variant = sys.argv[1], sys.argv[2]
level, state = parse(look)
out = OUT / "runs" / f"L{look}-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)

# frames.png: the Flash look, cropped, smooth blow-up on grey, base near the bottom
im = flash_rgba(level, state)
im = im.crop(im.getbbox())
W, H = (1024, 1536) if im.height / im.width > 1.2 else (1024, 1024)
k = min(W * 0.6 / im.width, H * 0.6 / im.height)
big = on(GREY, im).resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.86) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

# style.png: the Modern Inferno buildings in the game: the painted Under Hall (levels 1 and 3-6), the 3D Bone Cruncher
# (levels 7-10) and the 3D Magma Tower (top tier), so the Pod sits with them in one yard.
B = ASSETS / "buildings"
st = [Image.open(B / f).convert("RGBA") for f in ("itownhall/top.c1@2x.webp", "itownhall/top.c3@2x.webp",
                                                    "iboneharvester/body.3d7@2x.webp", "imagmatower/top.t3@2x.webp")]
sp = Image.new("RGBA", (sum(s.width for s in st) + 20 * (len(st) + 1), max(s.height for s in st) + 40), GREY + (255,))
x = 20
for s in st:
    sp.alpha_composite(s, (x, 20 + sp.height - 40 - s.height)); x += s.width + 20
sp = sp.convert("RGB")
sp.resize((sp.width * 2, sp.height * 2), Image.LANCZOS).save(out / "style.png")
inputs.append("style.png")

RUNS = OUT / "runs"
if state:
    base = os.environ.get("BASE", f"{level}-A")
    Image.open(RUNS / f"L{base}" / "sample-new.png").convert("RGB").save(out / "base.png")
    inputs.append("base.png")
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

WHAT = ("the RESOURCE POD, the storage building of the Inferno (the monsters' underground lava world in Backyard "
        "Monsters), where the yard keeps its bones, coal, sulfur and magma. Its Flash design (keep it): THREE tall DARK "
        "GREY ROCK SPIRES, like gnarled, lumpy, twisted stalagmites or volcanic stone horns, wide at the bottom and "
        "tapering to a sharp point, their surface rippled with smooth dark folds: one at the LEFT front, one at the BACK "
        "(the tallest, just left of centre), one at the RIGHT front (its tip leaning a little out to the right). Stretched "
        "between the three spires at about two thirds of their height, a THIN FLAT CURVED METAL SHEET of dull dusky "
        "copper / mauve-brown, shaped like a wide triangular blade or a stretched hide, sagging a little in the middle "
        "and curling up at its ends, pierced by the spires and resting on them, with a few small dark slots. In the "
        "middle, standing on the ground between the spires and rising up THROUGH the sheet, the POD itself: a squat "
        "lumpy COLUMN of smooth, semi-translucent AMBER-BROWN resin (like hardened honey or molten bronze), studded all "
        "over with round bulging GLOWING ORANGE BLOBS (the stored lava), a few bigger blobs at the foot like feet, and "
        "above the sheet a smaller knot of glowing blobs ending in a curled tip like a drip curling upward")
CAMERA = ("CAMERA: the isometric 3/4 view of frames.png, seen from the front and above at about 30 degrees, NOT a straight "
          "side view and NOT a symmetric picture. Put every part where frames.png has it (left spire, back spire, right "
          "spire, the sheet's angle, the column in the middle), not mirrored and not rearranged.")
FINISH = ("FINISH: the finish of style.png (the Modern Inferno buildings of the same game: the painted Under Hall, the 3D "
          "Bone Cruncher and the 3D Magma Tower): crisp, clean, polished, almost rendered stylised 3D, smooth shading, "
          "small bevels catching the light, soft light from the upper left, ambient occlusion in the gaps, clean sharp "
          "edges, no thick black outline, no cel shading, no pixel art, no painterly brush mess. COLOURS DEEPER AND MORE "
          "MUTED than the Under Hall in style.png (it is a little too bright and saturated): the rock spires a dark "
          "charcoal grey with cool blue-grey highlights on their folds, like the Magma Tower's dark stone; the sheet a dull "
          "dusky copper-mauve with a soft sheen, not bright orange; the column's resin a deep amber-brown; the glowing "
          "blobs warm orange with hot yellow centres, like the Bone Cruncher's lava, glowing but not neon, their light "
          "just warming the resin and the sheet's underside. Right-hand faces in medium shade, readable, not black.")

if not state:
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {WHAT}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera, the same camera, angle and orientation as frames.png (not mirrored).

{CAMERA}

Input 1, frames.png: the OLD Flash Resource Pod, blown up, on grey ({W}x{H}): its design, camera angle, ground footprint and size. The new picture stands on the same footprint, centred on the same spot, base on the same ground line, about the same height, and is not wider at the base. Read the small details from it.
Input 2, style.png: the Modern look of the other Inferno buildings from the same game. See FINISH below.

THE FLASH DESIGN, REFRESHED (most important): keep the Flash silhouette, proportions, colour scheme and every signature part in the same place, so a player of the old game instantly recognises it, with richer materials, crisper detail, better lighting and sharper edges. NOT a new design and NOT a plain copy.

{FINISH}

It must read clearly at small game size (about 90 pixels wide, 110 tall): bold clean shapes; the three dark spires, the copper sheet and the glowing amber pod easy to tell apart.
Output: ONE image, {W}x{H}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00, also between the spires and the pod and under the sheet. No ground, no lava pool, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
else:
    how = ("DAMAGED (hit in a battle, still standing): the same Pod, battered, as frames.png shows it: the BACK spire "
           "still standing tall and whole; the LEFT spire broken off at about half its height (a jagged stump); the "
           "RIGHT spire snapped off low, a short jagged stump with broken rock chunks on the ground at its foot; the "
           "amber pod column has SLUMPED and half melted into a wider, lower bulging mass, cracked, with glowing orange "
           "lava oozing out and yellow drips running down its front; the copper sheet has COLLAPSED down onto the pod "
           "and is crumpled and bent around its top like a torn collar. Dark scorch marks. Same footprint, same camera. "
           "Follow frames.png for how badly it is broken and where the broken parts are"
           if state == "damaged" else
           "DESTROYED: what is left after it was blown up: a low wreck, the amber pod burst open into a puddle-like heap "
           "of cracked resin with glowing orange lava blobs and yellow lava dripping over its front edge, the copper "
           "sheet crumpled and torn standing up at the back like a broken fin, the spires smashed into stumps and "
           "chunks of dark grey rock scattered around the edge, smoke-blackened. Follow frames.png for the shape and "
           "size of the wreck")
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint the {"DAMAGED" if state == "damaged" else "DESTROYED"} look of the RESOURCE POD (the Inferno's storage building), for the isometric strategy game Backyard Monsters, seen from the game's fixed isometric camera, the same camera, angle and orientation as frames.png (not mirrored).

{CAMERA}

Input 1, frames.png: the OLD Flash {"damaged" if state == "damaged" else "destroyed"} Pod, blown up, on grey ({W}x{H}): how broken it is, its camera angle, footprint and size.
Input 2, style.png: the Modern look of the other Inferno buildings from the same game (the finish).
Input 3, base.png: the NEW whole Resource Pod, already approved. This is the building that is {"damaged" if state == "damaged" else "destroyed"}: same parts, same materials, same colours, same finish.

{how}.

{FINISH}

Output: ONE image, {W}x{H}, alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no lava pool, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The picture itself must contain no bright pure green.
"""
if os.environ.get("NOTE"):
    prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
