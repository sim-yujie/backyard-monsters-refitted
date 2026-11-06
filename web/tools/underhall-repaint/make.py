"""make.py <look> <variant> : set up one Codex painting of the Inferno's Under Hall (run.sh runs it).

look = 1..3 (Flash's three looks: level 1, level 2, levels 3-6), 1d..3d (their damaged looks), 1x..3x (their destroyed
looks; Flash has one per look). variant = any short name (A, B, ...); run.sh <look> <variant> paints into
art-samples/underhall/runs/L<look>-<variant>/.
Writes there: frames.png (the Flash look blown up on grey: design, camera, footprint, size), style.png (the approved
painted Modern Town Hall and Monster Locker: the finish every painted Modern building shares), for later looks
match.png (Modern Under Hall looks already chosen, MATCH="3-A 1-A"), for damaged/destroyed base.png (the Modern look it
breaks, BASE=2-A; default <level>-A), prompt.txt and inputs.txt. NOTE="..." adds a correction; FINISH=B picks the
alternative finish.
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

# style.png: the approved painted Modern Town Hall (levels 3, 4) and the painted Monster Locker (looks 2, 4)
B = ASSETS / "buildings"
st = [Image.open(B / "townhall" / f"top.new{n}@2x.webp").convert("RGBA") for n in (3, 4)]
st += [Image.open(B / "monsterlocker" / f"top.c{n}@2x.webp").convert("RGBA") for n in (2, 4)]
sp = Image.new("RGBA", (sum(s.width for s in st) + 20 * (len(st) + 1), max(s.height for s in st) + 40), GREY + (255,))
x = 20
for s in st:
    sp.alpha_composite(s, (x, 20 + sp.height - 40 - s.height)); x += s.width + 20
sp = sp.convert("RGB")
sp.resize((sp.width * 2, sp.height * 2), Image.LANCZOS).save(out / "style.png")
inputs.append("style.png")

RUNS = OUT / "runs"
match = os.environ.get("MATCH", "").split()
if match:
    pics = [Image.open(RUNS / f"L{m}" / "sample-new.png").convert("RGB") for m in match]
    mt = Image.new("RGB", (sum(p.width for p in pics), max(p.height for p in pics)), (0, 255, 0))
    x = 0
    for p in pics:
        mt.paste(p, (x, mt.height - p.height)); x += p.width
    mt.thumbnail((2048, 1024), Image.LANCZOS)
    mt.save(out / "match.png")
    inputs.append("match.png")
if state:
    base = os.environ.get("BASE", f"{level}-A")
    Image.open(RUNS / f"L{base}" / "sample-new.png").convert("RGB").save(out / "base.png")
    inputs.append("base.png")
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

COMMON = ("the UNDER HALL, the town hall of the Inferno (the monsters' underground lava world in Backyard Monsters), the "
          "centre building of every Inferno yard. Its Flash design (keep it): a round tower whose body is a CORE OF "
          "GLOWING MOLTEN LAVA ROCK, rounded bulging yellow-orange stones packed together like a honeycomb, glowing hot "
          "from inside like embers, with dark red-brown cracks between them, held in a CAGE OF DARK IRON STRAPS (upright "
          "bars and horizontal hoops). Over the core a wide EIGHT-SIDED CANOPY ROOF of rust-orange copper panels with "
          "darker ribs, like a bat-wing umbrella, its pointed corner tips curling a little, overhanging the core. On top of "
          "the roof, on a short dark iron neck, a big BRASS FUNNEL chimney: a wide flared horn, open at the top, dark inside. "
          "Curved IVORY BONE HORNS (like tusks, pale cream, pointed, curving up) rise from the base around the core. The "
          "base is grey stone with a slight green tint, with BLUE-TEAL metal parts (teal is more blue than green), and "
          "small round rivets")
WHAT = {
    1: (COMMON + ". LEVEL 1 (the smallest): a SHORT, squat core, about as tall as it is wide, the roof sitting low over it. "
        "The base is a CROSS-SHAPED platform of chunky grey stone blocks reaching out in four arms (left, right, front, "
        "back) round a low round stone plinth, each arm ending in a blocky foot, with a blue-teal metal block on the left "
        "arm and on the front and right arms. Two curved ivory bone horns rise from the platform, one at the front left and "
        "one at the right, curving up beside the core. A thin bone spike curls out from under the roof on the right"),
    2: (COMMON + ". LEVEL 2: the core is TALLER, about one and a half times as tall as it is wide, with two iron hoops. "
        "Two small spikes on the funnel's rim. The base: a round stone plinth with a blue-teal riveted metal band, on a "
        "platform of chunky grey stone blocks with blocky feet; a TALL UPRIGHT BLUE-TEAL STONE SLAB (like a standing "
        "tablet) on the front left and another one on the right; curved ivory bone horns rising beside the core at the "
        "front left, the front and the right"),
    3: (COMMON + ". LEVEL 3 (the top look, levels 3 to 6): the TALLEST core, about twice as tall as it is wide, with big "
        "bulging glowing lava stones and three iron hoops. Spikes on the funnel's rim. The base: a round stone plinth with a "
        "blue-teal riveted metal band, on a platform of chunky grey stone blocks with blocky feet; TALL UPRIGHT BLUE-TEAL "
        "STONE SLABS at the front left and at the right; an iron FORK (a rake-like claw with prongs pointing down) at the "
        "front left corner; a rusty ribbed CHAIN-like pipe curling along the front right of the base; curved ivory bone "
        "horns beside the core; a few THIN LONG BONE SPIKES (antennae) rising high beside the roof at the left and right"),
}[level]
CAMERA = ("CAMERA (an earlier attempt got this wrong): the ISOMETRIC 3/4 view of frames.png, NOT a straight-on front view "
          "and NOT a symmetric picture. The base platform is turned 45 degrees to the viewer like a diamond: its edges run "
          "diagonally, down to the lower left and down to the lower right (about 26 degrees from level), and its arms or "
          "corners point to the left, to the right, towards the viewer (bottom) and away (top). Put every part where "
          "frames.png has it (what is on the left, the right, the front), not mirrored and not rearranged.")
FINISH = {
    "A": ("FINISH: exactly the finish of style.png (the approved Modern Town Hall and Monster Locker of the same game): "
          "crisp, polished, almost rendered hand-painted digital art, smooth shading, glossy highlights, warm polished "
          "brass and copper with bright speculars, small rivets and seams, soft light from the upper left, ambient "
          "occlusion in the gaps, clean sharp edges, no thick black outline, no cel shading, no pixel art, no painterly "
          "brush mess. The lava core glows: bright yellow-orange in the middle of each stone, deeper orange at its edges, "
          "the glow lighting the inside of the iron cage and the underside of the roof."),
    "B": ("FINISH: the finish of style.png (the approved Modern Town Hall and Monster Locker of the same game), with "
          "richer trim: riveted dark iron bands with bolts, hammered copper roof panels with riveted seams, worn polished "
          "brass, crisp polished almost rendered hand-painted digital art, glossy highlights, the lava core glowing hot "
          "white-yellow at the centre of each stone and deep orange at the edges, its warm light spilling onto the iron "
          "cage, the roof's underside and the base, soft light from the upper left, ambient occlusion in the gaps, clean "
          "sharp edges, no thick black outline, no cel shading, no pixel art."),
}[os.environ.get("FINISH", "A")]

if not state:
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {WHAT}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees), the same camera, angle and orientation as frames.png (not mirrored).

{CAMERA}

Input 1, frames.png: the OLD Flash building at this level, blown up, on grey ({W}x{H}): its design, camera angle, ground footprint and size. The new picture stands on the same footprint, centred on the same spot, base on the same ground line, about the same height, and is not wider at the base. Read the small details from it.
Input 2, style.png: the approved Modern look of the Town Hall and the Monster Locker from the same game. See FINISH below.{'''
Input 3, match.png: the Under Hall at other levels, already painted in the new look. Paint this level in EXACTLY the same finish, lighting, materials and colours, so the levels clearly read as one building growing up; use the design described here for this level, not match.png's parts.''' if match else ''}

THE FLASH DESIGN, REFRESHED (most important): keep the Flash silhouette, proportions, colour scheme and every signature part in the same place, so a player of the old game instantly recognises it, with richer materials, crisper detail, better lighting and sharper edges. NOT a new design and NOT a plain copy.

{FINISH}

It must read clearly at small game size (about 100 to 120 pixels wide): bold clean shapes; the glowing core, the copper roof, the brass funnel, the bone horns and the teal slabs easy to tell apart.
Output: ONE image, {W}x{H}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00, also between the feet, horns and spikes. No ground, no lava, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
else:
    how = ("DAMAGED (hit in a battle, still standing): the same building, battered: a torn and dented copper roof with a "
           "panel ripped open, a bent and dented funnel, a broken bone horn, cracked glowing lava stones with a little lava "
           "oozing out, a bent iron strap, chipped stone blocks, dark scorch marks; the parts that fall off lie on the "
           "ground right next to it. Same size, same footprint, same camera. Follow frames.png for how badly it is broken "
           "and where the broken parts are"
           if state == "damaged" else
           "DESTROYED: what is left after it was blown up: the base and the lower part of the cracked lava core still "
           "glowing a little, the copper roof collapsed and torn down over it, the funnel knocked over on top, broken bone "
           "horns and teal slabs fallen over, scattered stone blocks; low to the ground, smoke-blackened. Follow frames.png "
           "for the shape and size of the wreck")
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint the {"DAMAGED" if state == "damaged" else "DESTROYED"} look of the UNDER HALL (the Inferno's town hall) at level {level}, for the isometric strategy game Backyard Monsters, seen from the game's fixed isometric camera, the same camera, angle and orientation as frames.png (not mirrored).

{CAMERA}

Input 1, frames.png: the OLD Flash {"damaged" if state == "damaged" else "destroyed"} look, blown up, on grey ({W}x{H}): how broken it is, its camera angle, footprint and size.
Input 2, style.png: the approved Modern look of the Town Hall and Monster Locker from the same game (the finish).
Input {3 + bool(match)}, base.png: the NEW whole Under Hall at level {level}, already approved. This is the building that is {"damaged" if state == "damaged" else "destroyed"}: same parts, same materials, same colours, same finish.{'''
Input 3, match.png: other new Under Hall pictures, for the finish.''' if match else ''}

{how}.

{FINISH}

Output: ONE image, {W}x{H}, alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no lava pool, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The picture itself must contain no bright pure green.
"""
if os.environ.get("NOTE"):
    prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
