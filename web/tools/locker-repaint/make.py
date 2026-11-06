"""make.py <look> <variant> : set up one Codex painting of the Monster Locker (run.sh runs it).

look = 1..4 (Flash's four looks, levels 1-4), 1d..4d (their damaged looks) or x (the destroyed look, shared).
variant = any short name (A, B, ...); run.sh <look> <variant> paints into art-samples/locker/runs/L<look>-<variant>/.
Writes there: frames.png (the Flash look blown up on grey: design, camera, footprint, size), ref.png (Flash's build
button of that level, a sharper render), style.png (the approved painted Modern Town Hall), for later looks match.png
(the Modern Locker looks already chosen, MATCH="1-A 2-A"), for damaged/destroyed base.png (the Modern look it breaks,
BASE=2-A), prompt.txt and inputs.txt. NOTE="..." adds a correction; FINISH=B picks the alternative finish.
"""
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, OUT, flash_rgba, on  # noqa: E402

look, variant = sys.argv[1], sys.argv[2]
state = "destroyed" if look == "x" else "damaged" if look.endswith("d") else ""
level = 2 if look == "x" else int(look[0])
out = OUT / "runs" / f"L{look}-{variant}"
out.mkdir(parents=True, exist_ok=True)
GREY = (128, 128, 128)

# frames.png: the Flash look, cropped, smooth blow-up on grey, base near the bottom
im = flash_rgba(level, state)
im = im.crop(im.getbbox())
W, H = (1024, 1536) if im.height / im.width > 1.25 else (1024, 1024)
k = min(W * 0.6 / im.width, H * 0.6 / im.height)
big = on(GREY, im).resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.86) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

bt = Image.open(ASSETS / "buildingbuttons" / f"8.{level}.jpg").convert("RGB")
bt.resize((bt.width * 4, bt.height * 4), Image.LANCZOS).save(out / "ref.png")
inputs.append("ref.png")

# style.png: the approved painted Modern Town Hall (levels 3 and 4), the finish every Modern building shares
B = ASSETS / "buildings"
st = [Image.open(B / "townhall" / f"top.new{n}@2x.webp").convert("RGBA") for n in (3, 4)]
sp = Image.new("RGBA", (sum(s.width for s in st) + 60, max(s.height for s in st) + 40), GREY + (255,))
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

KEY_RULE = ("THE KEY AND THE COGS ARE INSIDE THE MACHINE (the owner rejected an earlier version for getting this wrong): "
            "the gold wind-up key is part of the clockwork. Its long shaft goes DOWN INTO the machine and ends in the middle "
            "of the gold cogs inside; only its handle (bow) sticks up out of the machine. The key is NOT stuck into the "
            "outside of the shell, NOT beside the opening, and NOT floating. The key's handle stands clear in the air "
            "above the machine, facing the viewer flat-on, and does not overlap any other part.")
EGG3 = ("The egg is seen from the same 3/4 angle as frames.png, from the front LEFT and above, and it LEANS BACK: its wide opening faces UP and to the LEFT, its rim running diagonally across the egg from the top right down to the lower left, so you look down INTO the clockwork; the closed back of the shell rises as a smooth curved hood on the right. It is NOT a symmetric front view and NOT an upright egg facing the viewer. ")
WHAT = {
    1: ("the MONSTER LOCKER at level 1, the machine that keeps the player's locked monsters. Its Flash design (keep it): "
        "a big polished SILVER CHROME BALL sitting on a short BLACK RUBBER BELLOWS (a ribbed concertina neck), which "
        "stands on a flat round BRASS DISC on the ground. On the ball's upper right a small square brass-framed hatch "
        "with a little round glass gauge. On the ball's upper left a dark KEYHOLE with a gold wind-up KEY in it: the key's "
        "shaft goes INTO the ball through the keyhole (to the clockwork inside), and its round gold RING handle sticks "
        "out up and to the left, standing clear in the air beside the ball, facing the viewer flat-on"),
    2: ("the MONSTER LOCKER at level 2, the machine that keeps the player's locked monsters. Its Flash design (keep it): "
        "a big polished SILVER CHROME BALL on a short BLACK RUBBER BELLOWS, standing on a round brass-rimmed wooden disc "
        "held by THREE thin steel SPIKE LEGS with ball heads (one at the left, one at the right, one at the front). "
        "The ball has a large rounded OPENING cut in its upper front, through which you look INSIDE the machine and see "
        "EXACTLY THREE GOLD COGS (gear wheels with chunky square teeth) meshing together. A gold wind-up KEY stands in the "
        "opening: its shaft goes down INTO the machine to the middle of the three cogs, and its big round gold RING handle "
        "stands straight up above the ball. Around the ball: square brass-framed steel plates with a round dark socket in "
        "each (one on the left, one on the front left, one on the front right), and a small square brass box with a glass "
        "gauge on the upper right"),
    3: ("the MONSTER LOCKER at level 3, the machine that keeps the player's locked monsters. Its Flash design (keep it): "
        "an EGG-SHAPED silver steel shell whose upper front is cut wide OPEN. "
        + EGG3 + "Inside it, filling the opening, the "
        "GOLD CLOCKWORK: a row of several gold COG WHEELS side by side on one axle, like the tumblers of a combination lock, "
        "each with chunky rectangular gold teeth, and one more round gold cog standing up behind them at the top. An "
        "ornate gold KEY stands at the top left: its handle (bow) is a thin curly gold WIRE drawn in the outline of a little "
        "monster head (horns, round eye), like filigree; its shaft goes down INTO the cogs. A "
        "square steel CHIMNEY pipe with a black-and-gold striped neck rises at the back right, with a square white cap and "
        "a round dark opening. Two square brass-framed steel plates with round sockets on the front of the shell. Under "
        "the egg a black rubber bellows and a dark steel base ring with FOUR big hex-bolt feet"),
    4: ("the MONSTER LOCKER at level 4, the top level, the machine that keeps the player's locked monsters. Its Flash design "
        "(keep it): an EGG-SHAPED silver steel shell whose upper front is cut wide OPEN. " + EGG3 + "Inside it, filling the "
        "opening, the GOLD CLOCKWORK: a row of several big gold COG WHEELS side by side on one axle, like the tumblers of a "
        "combination lock, each with chunky rectangular gold teeth, and one more round gold cog standing up behind them. "
        "An ornate gold KEY stands at the top left: its handle (bow) is a THICK solid polished gold MEDALLION shaped like a "
        "little monster head, with two round eye holes and a notch for a mouth; its shaft goes down INTO the cogs. A square "
        "steel CHIMNEY pipe with a black-and-gold striped neck rises at the back right, with a square white cap, a round "
        "dark opening and two gold handle loops on top. Two square steel vents with black-and-gold bars on the front of "
        "the shell. Under the egg a black rubber bellows on a dark steel base, FOUR tall steel pillars round it, all on a "
        "round wooden disc on the ground"),
}[level]
FINISH = {
    "A": ("FINISH: exactly the finish of style.png (the approved Modern Town Hall of the same game): crisp, polished, "
          "almost rendered hand-painted digital art, smooth shading, glossy highlights, mirror-like chrome with soft "
          "reflections, warm polished gold and brass with bright speculars, small rivets and seams, soft light from the "
          "upper left, ambient occlusion in the gaps, clean sharp edges, no thick black outline, no cel shading, no "
          "pixel art, no painterly brush mess."),
    "B": ("FINISH: the finish of style.png (the approved Modern Town Hall of the same game), with its trim: riveted "
          "brass bands and copper-brown riveted plates where the design has trim, bolts and seams, crisp polished "
          "almost rendered hand-painted digital art, glossy highlights, mirror-like chrome, warm gold with bright "
          "speculars, the gold cogs lit by a soft warm glow from inside the machine, soft light from the upper left, "
          "ambient occlusion in the gaps, clean sharp edges, no thick black outline, no cel shading, no pixel art."),
}[os.environ.get("FINISH", "A")]

if not state:
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {WHAT}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees), the same camera, angle and orientation as frames.png (not mirrored).

Input 1, frames.png: the OLD Flash building at this level, blown up, on grey ({W}x{H}): its design, camera angle, ground footprint and size. The new picture stands on the same footprint, centred on the same spot, base on the same ground line, about the same height, and is not wider at the base.
Input 2, ref.png: the old build-menu picture of the same building at this level (a sharper render of the same design). Use it to read the small details.
Input 3, style.png: the approved Modern look of the Town Hall from the same game. See FINISH below.{'''
Input 4, match.png: the Monster Locker at other levels, already painted in the new look. Paint this level in EXACTLY the same finish, lighting, materials and colours, so the levels clearly read as one building growing up; use the design described here for this level, not match.png's parts.''' if match else ''}

THE FLASH DESIGN, REFRESHED (most important): keep the Flash silhouette, proportions, colour scheme and every signature part in the same place, so a player of the old game instantly recognises it, with richer materials, crisper detail, better lighting and sharper edges. NOT a new design and NOT a plain copy.

{KEY_RULE}

{FINISH}

It must read clearly at small game size (about 60 to 90 pixels wide): bold clean shapes, the chrome, the gold cogs and the key easy to tell apart.
Output: ONE image, {W}x{H}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00, also inside the key's ring and between the legs. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
else:
    how = ("DAMAGED (hit in a battle, still standing): the same building, battered: dents and scorch marks on the shell, "
           "a cracked or bent plate, a few loose bolts, a little dark smoke-stain, a cog knocked askew, the key bent over "
           "a little; the parts that fall off lie on the ground right next to it. Same size, same footprint, same camera. "
           "Follow frames.png for how badly it is broken and where the broken parts are"
           if state == "damaged" else
           "DESTROYED: what is left after it was blown up: the bellows and the base on the ground with a broken, collapsed "
           "lower half of the shell, torn chrome shards, scattered gold cogs and bolts, the bent key lying on the ground; "
           "low to the ground, smoke-blackened. Follow frames.png for the shape and size of the wreck")
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint the {"DAMAGED" if state == "damaged" else "DESTROYED"} look of the MONSTER LOCKER{f" at level {level}" if state == "damaged" else ""}, for the isometric strategy game Backyard Monsters, seen from the game's fixed isometric camera, the same camera, angle and orientation as frames.png (not mirrored).

Input 1, frames.png: the OLD Flash {"damaged" if state == "damaged" else "destroyed"} look, blown up, on grey ({W}x{H}): how broken it is, its camera angle, footprint and size.
Input 2, ref.png: the old build-menu picture of the whole building (for its parts).
Input 3, style.png: the approved Modern look of the Town Hall from the same game (the finish).
Input {4 + bool(match)}, base.png: the NEW whole Monster Locker{f" at level {level}" if state == "damaged" else ""}, already approved. This is the building that is {"damaged" if state == "damaged" else "destroyed"}: same parts, same materials, same colours, same finish.{'''
Input 4, match.png: other new Locker pictures, for the finish.''' if match else ''}

{how}.

{FINISH}

Output: ONE image, {W}x{H}, alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The picture itself must contain no bright pure green.
"""
if os.environ.get("NOTE"):
    prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
