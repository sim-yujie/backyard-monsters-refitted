"""make.py <building> <combo> : set up one Codex call for a building-redesign sample (brief: agent-handoffs/brief-building-redesign.md).

building = cannon | townhall (top tier).  combo = A1 | A2 | B1 | B2:
  style A = hand-painted like the approved monster/champion repaints, style B = chunky 3D-render (Clash of Clans / Boom Beach look);
  theme 1 = home-made backyard junk that gets sturdier/fancier at higher tiers, theme 2 = proper military/tech from tier 1.
Writes art-samples/redesign/<building>/<combo>/: frames.png (the old Flash building blown up on grey: camera angle, footprint, size),
style.png (style A only: approved champion repaints), prompt.txt, inputs.txt.
"""
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
from common import ASSETS, REPO, old_rgba, on  # noqa: E402

b, combo = sys.argv[1], sys.argv[2]
style, theme = combo[0], combo[1]
OUT = REPO / "art-samples" / "redesign"
out = OUT / b / combo
out.mkdir(parents=True, exist_ok=True)
GREY, GREEN = (128, 128, 128), (0, 255, 0)

# frames.png: the old building, whole-number blow-up on a grey canvas, base near the bottom
im, _, _ = old_rgba(b)
im = im.crop(im.getbbox())
W, H = (1024, 1536) if im.height / im.width > 1.25 else (1024, 1024)
k = max(1, int(min(W * 0.62 / im.width, H * 0.62 / im.height)))   # room above for a taller top tier
big = on(GREY, im).resize((im.width * k, im.height * k), Image.NEAREST)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.88) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

if style == "A":
    SH = {"ape_3": (103, 88), "dragon_3": (114, 85), "fly_3": (98, 81)}
    st = []
    for n, (fw, fh) in SH.items():
        s = Image.open(ASSETS / "monsters" / f"{n}-repaint@4x.png").convert("RGBA")
        st.append(on(GREEN, s.crop((2 * fw * 4, 0, 3 * fw * 4, fh * 4))))
    Hs = max(s.height for s in st)
    sp = Image.new("RGB", (sum(s.width for s in st) + 40 * (len(st) + 1), Hs + 80), GREEN)
    x = 40
    for s in st:
        sp.paste(s, (x, 40 + Hs - s.height)); x += s.width + 40
    sp.save(out / "style.png")
    inputs.append("style.png")
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

WHAT = {
    "cannon": ("the CANNON TOWER, a defence tower that fires heavy cannonballs at attacking monsters. Its gun must be able to TURN to "
               "aim: a stout cannon barrel on a round swivel mount on top of the tower, shown pointing toward the viewer's lower LEFT "
               "(three-quarter view, muzzle visible), tilted slightly up"),
    "townhall": ("the TOWN HALL, the main and most important building of the monster yard (where the player's resources and command "
                 "live). Keep its recognisable idea from frames.png: a round domed hall with a big funnel/antenna on top, a round "
                 "porthole window on the front and pipes around it, but redesign it freely in the theme below"),
}[b]
STYLE = {
    "A": ("STYLE A, hand-painted: paint it exactly in the finish of style.png (approved hand-painted repaints of champion monsters "
          "from the same game): crisp hand-painted digital illustration, soft painterly shading, glossy highlights, rich saturated "
          "colours, visible brush texture on materials, no thick black outline, no cel shading, no pixel art. Copy only the "
          "painting finish from style.png, not its shapes or colours."),
    "B": ("STYLE B, chunky 3D render: like the buildings in Clash of Clans or Boom Beach. Bold, chunky, slightly exaggerated "
          "toy-like proportions, thick rounded/bevelled shapes, big readable forms with few small details, clean smooth materials, "
          "soft global illumination with gentle ambient occlusion, bright saturated colours, a crisp highlight rim on edges. "
          "It must look like a polished 3D-rendered mobile-game building, NOT a painting and NOT pixel art, no outline."),
}[style]
THEME = {
    "1": ("THEME 1, evolving backyard junk: the monsters built it themselves from BACKYARD JUNK (tin cans, a dustbin lid, wooden "
          "planks and crates, garden hose, bottle caps, bicycle and lawnmower parts, kitchen funnels, string and duct tape). This is "
          "the TOP TIER, so the junk has been upgraded to its sturdiest, fanciest version: reinforced with riveted metal plating, "
          "brass trim and bolts, little glowing lights and a glowing power part, but it must still clearly read as home-made from "
          "junk, cheerful and a bit ramshackle."),
    "2": ("THEME 2, military / tech: a properly engineered military-tech structure, NOT home-made: armoured steel plating, "
          "red-and-white hazard stripes, heavy bolts, vents, cables, small antennas, glowing energy cores and indicator lights. "
          "This is the TOP TIER, so it is the most advanced, heaviest-armoured, most high-tech version, with glowing parts."),
}[theme]
prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Design a NEW top-tier version of {WHAT}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).

Input 1, frames.png: the OLD building from the original game, blown up, on grey ({fr.width}x{fr.height}). Use it ONLY for the camera angle, the ground footprint (how wide the base is and where it stands) and the overall size. This is a REDESIGN, not a copy: new shapes and details are wanted. The new building stands on the same footprint, centred on the same spot, base on the same ground line, and may be up to about 20% taller or bulkier above the footprint, but not wider at the base.
{"Input 2, style.png: see style below." if style == "A" else ""}

{THEME}

{STYLE}

Make it look like the most impressive TOP level of this building: readable silhouette at small game size, clear focal point, a couple of glowing details.
Output: ONE image, {fr.width}x{fr.height}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
