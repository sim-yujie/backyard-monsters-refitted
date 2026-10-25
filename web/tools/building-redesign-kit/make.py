"""make.py <building> <combo> : set up one Codex call for a building-redesign sample (brief: agent-handoffs/brief-building-redesign.md).

building = cannon | townhall (top tier).  combo = A1 | A2 | B1 | B2 (round 1) or R2A | R2B (round 2, "Flash design, refreshed")
or T1 | T2 (tiers 1 and 2 of the owner's pick R2-A; tier 3 is R2A itself):
  style A = hand-painted like the approved monster/champion repaints, style B = chunky 3D-render (Clash of Clans / Boom Beach look);
  theme 1 = home-made backyard junk that gets sturdier/fancier at higher tiers, theme 2 = proper military/tech from tier 1.
Writes art-samples/redesign/<building>/<combo>/: frames.png (the old Flash building blown up on grey: camera angle, footprint, size),
style.png (style A only: approved champion repaints), prompt.txt, inputs.txt.
"""
import os
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
from common import ASSETS, REPO, old_rgba, on  # noqa: E402

b, combo = sys.argv[1], sys.argv[2]
TIER = combo in ("T1", "T2")                 # tiers 1-2 of R2-A, painted to match the R2A picture
R2 = combo.startswith("R2") or TIER          # round 2: keep the Flash design, refresh it; no theme
style, theme = ("A", None) if TIER else (combo[-1], None) if R2 else (combo[0], combo[1])
# the Flash picture each sample is painted from: the Town Hall has its own picture per level (tier 1 = level 2, tier 2 = level 5)
FK = {("townhall", "T1"): "townhall2", ("townhall", "T2"): "townhall5"}.get((b, combo), b)
OUT = REPO / "art-samples" / "redesign"
out = OUT / b / combo
out.mkdir(parents=True, exist_ok=True)
GREY, GREEN = (128, 128, 128), (0, 255, 0)

# frames.png: the old building, whole-number blow-up on a grey canvas, base near the bottom
im, _, _ = old_rgba(FK)
im = im.crop(im.getbbox())
W, H = (1024, 1536) if im.height / im.width > 1.25 else (1024, 1024)
k = max(1, int(min(W * 0.62 / im.width, H * 0.62 / im.height)))   # room above for a taller top tier
big = on(GREY, im).resize((im.width * k, im.height * k), Image.NEAREST)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.88) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

if R2:
    # ref.png: the Flash build button (a sharper render of the same design) blown up
    BUTTON = {"cannon": "20", "townhall": "14.10", "townhall2": "14.2", "townhall5": "14.5"}[FK]   # Town Hall: that level's button
    bt = Image.open(ASSETS / "buildingbuttons" / f"{BUTTON}.jpg").convert("RGB")
    bt.resize((bt.width * 5, bt.height * 5), Image.LANCZOS).save(out / "ref.png")
    inputs.append("ref.png")
    if b == "cannon" and not TIER and not os.environ.get("NOFAITHFUL"):   # NOFAITHFUL=1: leave it out (Codex copied it too closely)
        # faithful.png: the "sharp Flash" repaint from the tower samples, the lower bound
        Image.open(REPO / "art-samples" / "towers" / "cannon" / "sample-new.png").convert("RGB").save(out / "faithful.png")
        inputs.append("faithful.png")

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
if TIER:
    # tier3.png: the approved top tier (R2-A) on green, so the tiers read as one building in one finish
    Image.open(OUT / b / "R2A" / "sample-new.png").convert("RGB").save(out / "tier3.png")
    inputs.append("tier3.png")
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

WHAT = {
    "cannon": ("the CANNON TOWER, a defence tower that fires heavy cannonballs at attacking monsters. Its gun must be able to TURN to "
               "aim: a stout cannon barrel on a round swivel mount on top of the tower, shown pointing toward the viewer's lower LEFT "
               "(three-quarter view, muzzle visible), tilted slightly up"),
    "townhall": ("the TOWN HALL, the main and most important building of the monster yard (where the player's resources and command "
                 "live). Keep its recognisable idea from frames.png: a round domed hall with a big funnel/antenna on top, a round "
                 "porthole window on the front and pipes around it, but redesign it freely in the theme below"),
}[b]
WHAT_R2 = {
    "cannon": ("the CANNON TOWER, a defence tower that fires heavy cannonballs. Its Flash design (keep it): a RED-AND-WHITE STRIPED "
               "DRUM base standing on three chunky TAN stone feet, a TAN RING frame around the top with curved TAN PRONGS sticking up "
               "out of it, and a wide GREY STEEL cannon tube in the middle. One change: the steel cannon tube must now be able to TURN "
               "to aim, so it sits in a round swivel mount inside the tan ring and is shown TILTED so that its MUZZLE POINTS TOWARD THE "
               "BOTTOM-LEFT CORNER OF THE IMAGE (towards the viewer and to the left, angled up a little, the open muzzle visible). "
               "The muzzle must NOT point up, up-left, right or away from the viewer"),
    "townhall": ("the TOWN HALL, the main building of the monster yard. Its Flash design at level 10 (keep it): a DARK RIVETED DOME "
                 "(dark grey-brown metal plates with rows of rivets) with a round BLUE GLOWING PORTHOLE on the front, held inside a "
                 "GOLDEN FRAME of four thick golden pipe pillars with curved golden arms reaching over the dome, small blue gem "
                 "studs on the gold and clawed golden feet; a golden horned crest with a silver funnel and a thin golden antenna on "
                 "top; red pipes and golden coils around the waist; a light grey base ring with a row of round black holes"),
}[b]
REFRESH = ("THE FLASH DESIGN, REFRESHED (most important). frames.png and ref.png show the building's ORIGINAL design from the old "
           "Flash game. Keep that design: the same silhouette and proportions, the same colour scheme and the same signature parts "
           "in the same places, so a player of the old game instantly recognises it. Refresh it: richer materials (worn painted "
           "metal, polished brass, steel with scratches), crisper detail (bolts, rivets, seams, panel lines), better lighting "
           "(soft light from the upper left, clear highlights, ambient occlusion in the gaps) and sharper edges. As the TOP TIER it "
           "may ADD a few parts on top of the Flash design (extra riveted trim plates, small glowing lights, a polished cap, "
           "a little banner or lamp), but nothing that changes the silhouette or replaces a Flash part. This is NOT a new design "
           "(an earlier redesign was rejected for being too far from the original) and NOT a plain copy either."
           + (" Input 3, faithful.png: an earlier faithful repaint of the same tower. Treat it as the LOWER BOUND: keep this "
              "design, but go further in material, detail and lighting quality (and turn the barrel as described)."
              if "faithful.png" in inputs else ""))
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
}.get(theme, "")
TIER_WHAT = {
    ("cannon", "T1"): ("TIER 1 of 3 (levels 1-3), the plainest, scrappiest version. Exactly the Flash design and nothing more: the "
                       "striped drum, the three tan feet, the tan ring with its prongs and a plain grey steel tube on a simple swivel "
                       "mount. Make it look cheap and a bit battered: chipped, faded red paint on the stripes, scuffed and cracked tan "
                       "stone, a dull dented steel tube with a few plain iron bolts, one patched plate bolted on. NO brass, NO gold, NO "
                       "lamps or glowing lights, NO extra trim plates or bands. The same size as the Flash tower, not taller"),
    ("cannon", "T2"): ("TIER 2 of 3 (levels 4-6), halfway between tier 1 and tier3.png: the Flash design in good repair, with clean "
                       "bright paint on the stripes, solid tan stone, a polished steel tube with a riveted STEEL collar round its "
                       "middle, plain riveted steel bands round the top and bottom of the drum and steel caps on the three feet. "
                       "Still NO glowing lamps and NO brass or gold (those are kept for tier 3). At most about 10% taller than Flash"),
    ("townhall", "T1"): ("TIER 1 of 3 (levels 1-3). Paint it from the Flash game's own LEVEL 2 Town Hall shown in frames.png and "
                         "ref.png, keeping that design (it is a smaller, simpler building than tier3.png): a ribbed silver TIN-CAN "
                         "body (corrugated steel bands) standing on a ring of thin metal legs with small golden gear-shaped feet and "
                         "golden bolts; a dark brown riveted sheet-metal HOOD roof with flared corners sitting on the can, with two "
                         "round BLUE porthole windows in it and a round hinged porthole lid sticking out on the right; a red "
                         "horseshoe magnet on the front; a silver kitchen FUNNEL on top with a few bits of wire and junk round it. "
                         "Home-made and a bit scrappy. No golden frame, no round dome, no glowing lights"),
    ("townhall", "T2"): ("TIER 2 of 3 (levels 4-6). Paint it from the Flash game's own LEVEL 5 Town Hall shown in frames.png and "
                         "ref.png, keeping that design: a ribbed silver cylinder body with vertical golden straps; a DARK RIVETED "
                         "DOME on top with a ring of round BLUE porthole windows; a silver funnel with a golden collar on top of the "
                         "dome; RED bent pipes curling out around the base with small red railings; short legs with round golden "
                         "disc feet. Sturdier and shinier than tier 1, but NO golden frame or arms round the dome and NO horned "
                         "crest (those come at tier 3)"),
}
if TIER:
    what = WHAT_R2.split(". Its Flash design")[0] if b == "townhall" else WHAT_R2
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {what}. {TIER_WHAT[(b, combo)]}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).

The building has 3 looks (tiers) as it levels up. Tier 3, the top tier, is already painted and approved: input 4, tier3.png. THIS picture is a LOWER tier of the same building.

Input 1, frames.png: the OLD Flash building at this tier, blown up, on grey ({fr.width}x{fr.height}): its design, camera angle, ground footprint and size. The new picture stands on the same footprint, centred on the same spot, base on the same ground line, and is not wider at the base.
Input 2, ref.png: the old build-menu picture of the same building at this tier (a sharper render of the same design). Use it to read the small details.
Input 3, style.png: see style below.
Input 4, tier3.png: the approved top tier in the new style. Paint this tier in EXACTLY the same finish, lighting, camera angle, line quality and colour palette, so that the three tiers clearly read as one building growing up. Use the design described above for this tier, NOT tier3.png's extra top-tier parts.

THE FLASH DESIGN, REFRESHED: keep the Flash silhouette, proportions, colour scheme and signature parts in the same places, so a player of the old game instantly recognises it, with richer materials, crisper detail, better lighting (soft light from the upper left, clear highlights, ambient occlusion in the gaps) and sharper edges. NOT a new design and NOT a plain copy.

{STYLE}

Output: ONE image, {fr.width}x{fr.height}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
    if os.environ.get("NOTE"):
        prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
    (out / "prompt.txt").write_text(prompt, encoding="utf-8")
    print("ready", out.as_posix())
    sys.exit(0)
if R2:
    n_style = len(inputs)
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint a refreshed top-tier version of {WHAT_R2}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).

Input 1, frames.png: the OLD Flash building, blown up, on grey ({fr.width}x{fr.height}): its design, camera angle, ground footprint and size. The new picture stands on the same footprint, centred on the same spot, base on the same ground line, and may be up to about 15% taller above the footprint, but not wider at the base.
Input 2, ref.png: the old build-menu picture of the same building (a sharper render of the same design). Use it to read the small details.{"" if style == "B" else f"""
Input {n_style}, style.png: see style below."""}

{REFRESH}

{STYLE}

Output: ONE image, {fr.width}x{fr.height}, the building alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The building itself must contain no bright pure green.
"""
    if os.environ.get("NOTE"):                          # a correction for a repaint, e.g. NOTE="..." bash run.sh cannon R2A
        prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
    (out / "prompt.txt").write_text(prompt, encoding="utf-8")
    print("ready", out.as_posix())
    sys.exit(0)

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
