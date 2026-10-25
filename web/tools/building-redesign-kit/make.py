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
from common import ASSETS, REPO, TOWERS, old_rgba, on  # noqa: E402

b, combo = sys.argv[1], sys.argv[2]
TIER = combo in ("T1", "T2")                 # tiers 1-2 of R2-A, painted to match the R2A picture
MAT = combo in ("GOLD", "BLACK")             # tower tiers 2-3 as wall-block materials (owner, 25 Oct evening): gold, black diamond
# owner feedback on the material tiers: PLAIN = the black-diamond top tier in plain black (no gold), to compare;
# TALL2 / TALL3 = cannon tiers 2 (gold) and 3 (black diamond) standing taller, as range grows with level
EXTRA = combo in ("PLAIN", "TALL2", "TALL3")
R2 = combo.startswith("R2") or TIER or MAT or EXTRA   # round 2: keep the Flash design, refresh it; no theme
style, theme = ("A", None) if TIER or MAT or EXTRA else (combo[-1], None) if R2 else (combo[0], combo[1])
# the Flash picture each sample is painted from: the Town Hall has its own picture per level (tier 1 = level 2, tier 2 = level 5)
FK = {("townhall", "T1"): "townhall2", ("townhall", "T2"): "townhall5", ("townhall", "GOLD"): "townhall5"}.get((b, combo), b)
OUT = REPO / "art-samples" / "redesign"
out = OUT / b / combo
out.mkdir(parents=True, exist_ok=True)
GREY, GREEN = (128, 128, 128), (0, 255, 0)

# frames.png: the old building, whole-number blow-up on a grey canvas, base near the bottom
im, _, _ = old_rgba(FK)
im = im.crop(im.getbbox())
W, H = (1024, 1536) if im.height / im.width > 1.25 or combo in ("TALL2", "TALL3") else (1024, 1024)   # TALL: room above
k = max(1, int(min(W * 0.62 / im.width, H * 0.62 / im.height)))   # room above for a taller top tier
big = on(GREY, im).resize((im.width * k, im.height * k), Image.NEAREST)
fr = Image.new("RGB", (W, H), GREY)
fr.paste(big, ((W - big.width) // 2, round(H * 0.88) - big.height))
fr.save(out / "frames.png")
inputs = ["frames.png"]

if R2:
    # ref.png: the Flash build button (a sharper render of the same design) blown up
    BUTTON = {"cannon": "20", "townhall": "14.10", "townhall2": "14.2", "townhall5": "14.5"}.get(FK, str(TOWERS[FK]["button"]))   # Town Hall: that level's button
    bt = Image.open(ASSETS / "buildingbuttons" / f"{BUTTON}.jpg").convert("RGB")
    bt.resize((bt.width * 5, bt.height * 5), Image.LANCZOS).save(out / "ref.png")
    inputs.append("ref.png")
    if b == "cannon" and not (TIER or MAT or EXTRA) and not os.environ.get("NOFAITHFUL"):   # NOFAITHFUL=1: leave it out (Codex copied it too closely)
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
# tier 1 of the material tiers: an existing R2-A picture (cannon: the clean steel tier painted as T2; others: R2A)
# Town Hall (owner: one picture per level; test): GOLD = level 5 (T2) with gold added, BLACK = level 10 (R2A) in black diamond
MAT_TIER1 = {"cannon": "T2", ("townhall", "GOLD"): "T2"}
# owner, 25 Oct night: every defensive tower gets taller tiers. Cannon and Tesla already have gold / black-diamond pictures
# (TALL2/TALL3 only raise them); the others are recoloured AND raised in one call: TALL2 from R2A, TALL3 from their TALL2.
HAS_MAT = b in ("cannon", "tesla")
RECOLOUR = combo in ("TALL2", "TALL3") and not HAS_MAT
if EXTRA:
    # base.png: the picture this one changes (PLAIN: the black-and-gold top tier; TALL2/TALL3: the gold / black-diamond tower,
    # or for RECOLOUR the R2-A tier 1 / the taller gold tier 2)
    BASE = ({"TALL2": "R2A", "TALL3": "TALL2"} if RECOLOUR else {"PLAIN": "BLACK", "TALL2": "GOLD", "TALL3": "BLACK"})[combo]
    Image.open(OUT / b / BASE / "sample-new.png").convert("RGB").save(out / "base.png")
    inputs.append("base.png")
    if RECOLOUR:
        blk = Image.open(ASSETS / "buildings" / "walls" / {"TALL2": "top.4.v2.png", "TALL3": "top.5.png"}[combo]).convert("RGBA")
        on(GREY, blk).resize((blk.width * 10, blk.height * 10), Image.LANCZOS).save(out / "block.png")
        inputs.append("block.png")
if MAT:
    Image.open(OUT / b / MAT_TIER1.get((b, combo), MAT_TIER1.get(b, "R2A")) / "sample-new.png").convert("RGB").save(out / "tier1.png")
    blk = Image.open(ASSETS / "buildings" / "walls" / {"GOLD": "top.4.v2.png", "BLACK": "top.5.png"}[combo]).convert("RGBA")
    on(GREY, blk).resize((blk.width * 10, blk.height * 10), Image.LANCZOS).save(out / "block.png")
    inputs += ["tier1.png", "block.png"]
(out / "inputs.txt").write_text(" ".join(inputs) + "\n")

WHAT = {
    "cannon": ("the CANNON TOWER, a defence tower that fires heavy cannonballs at attacking monsters. Its gun must be able to TURN to "
               "aim: a stout cannon barrel on a round swivel mount on top of the tower, shown pointing toward the viewer's lower LEFT "
               "(three-quarter view, muzzle visible), tilted slightly up"),
    "townhall": ("the TOWN HALL, the main and most important building of the monster yard (where the player's resources and command "
                 "live). Keep its recognisable idea from frames.png: a round domed hall with a big funnel/antenna on top, a round "
                 "porthole window on the front and pipes around it, but redesign it freely in the theme below"),
}.get(b, "")
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
}.get(b) or (TOWERS[b]["what"] + ". That is its Flash design: keep it, with every part in the same place. Keep any gun, turret or lens aimed exactly the same way as in frames.png")   # the other towers: words from the tower kit
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
MAT_WHAT = {
    ("cannon", "GOLD"): ("the tan ring, its curved prongs and the three feet become POLISHED GOLD; the steel barrel gets broad gold "
                         "bands, a gold collar and a gold muzzle ring; the drum keeps its RED-AND-WHITE STRIPES but with thick gold "
                         "bands round its top and bottom and gold rivets"),
    ("cannon", "BLACK"): ("the tan ring, its prongs and the three feet become glossy BLACK faceted armour (like black diamond) with "
                          "polished GOLD edges and trim; the barrel becomes black gunmetal with gold bands and a gold muzzle ring; "
                          "the drum keeps its STRIPES but they become BLACK AND GOLD, with gold bands round its top and bottom"),
    ("townhall", "GOLD"): ("the vertical straps on the ribbed body, the collar under the funnel, the rims of the blue portholes "
                           "and the round disc feet become POLISHED GOLD; add thick gold bands round the top and bottom of the ribbed "
                           "body, gold rivets on the dome and gold fittings on the red pipes and railings. The dark riveted dome, the "
                           "silver ribbed body, the blue portholes, the silver funnel and the red pipes stay, so it is clearly still "
                           "the level 5 Town Hall"),
    ("townhall", "BLACK"): ("the dark riveted dome becomes glossy BLACK faceted armour (like black diamond) with polished GOLD "
                            "seams and rivets between its plates; the light grey base ring with its round holes becomes black "
                            "armour with a gold rim; the silver funnel becomes black chrome with a gold rim. The golden frame, arms, "
                            "clawed feet and horned crest stay gold (they are the gold trim), the blue porthole and blue studs stay "
                            "blue and the red pipes stay red, so it is clearly still the level 10 Town Hall"),
    ("tesla", "GOLD"): ("the tan box and its tan base become POLISHED GOLD plating with gold rivets; the striped corner poles keep "
                        "their RED-AND-WHITE STRIPES but get gold caps and gold bands; the copper coil glows; the silver mushroom "
                        "dome stays silver with a gold rim"),
    ("tesla", "BLACK"): ("the box and its base become glossy BLACK faceted armour (like black diamond) with polished GOLD edges "
                         "and trim; the corner poles become BLACK AND GOLD striped with gold caps; the copper coil glows; the "
                         "mushroom dome becomes dark black chrome with a gold rim and a faint blue electric glow"),
    # the other towers (taller tiers, owner 25 Oct night): GOLD changes the R2-A tier 1, BLACK changes the gold tier 2
    ("sniper", "GOLD"): ("the tan panels of the octagonal body and the rim of the top deck become POLISHED GOLD plating with gold "
                         "rivets; the striped corners keep their RED-AND-WHITE STRIPES with gold bands; the iron ball feet get gold "
                         "bands; the silver domed turret stays silver with a gold rim and a gold muzzle ring on the barrel"),
    ("sniper", "BLACK"): ("the gold body panels and top deck become glossy BLACK faceted armour (like black diamond) with polished "
                          "GOLD edges and rivets; the striped corners become BLACK AND GOLD stripes; the ball feet become black with "
                          "gold bands; the domed turret becomes black chrome with a gold rim and gold muzzle ring; the red and blue "
                          "wires and the small red lamp stay"),
    ("laser", "GOLD"): ("the grey-green metal box becomes POLISHED GOLD plating with gold rivets (the yellow hazard triangle stays); "
                        "the cage bars and the laser head's housing become gold; the striped base keeps its RED-AND-WHITE STRIPES "
                        "with gold bands; the black rubber bumpers stay black; the blue lens keeps glowing"),
    ("laser", "BLACK"): ("the gold box becomes glossy BLACK faceted armour (like black diamond) with polished GOLD edges and "
                         "rivets, the hazard triangle gold on black; the cage bars and the laser head's housing become black with "
                         "gold joints; the base stripes become BLACK AND GOLD; the black bumpers stay; the blue lens keeps glowing"),
    ("aerial", "GOLD"): ("the tan armoured turret becomes POLISHED GOLD armour plates with gold rivets; the platform's frame and the "
                         "rims of the grated panels become gold; the sloping sides keep their RED-AND-WHITE STRIPES with gold bands; "
                         "the twin barrels stay steel with gold muzzle rings and gold bands"),
    ("aerial", "BLACK"): ("the gold turret becomes glossy BLACK faceted armour (like black diamond) with polished GOLD edges and "
                          "rivets; the platform becomes black armour with gold trim (the grated panels dark with gold rims); the "
                          "sloping sides become BLACK AND GOLD stripes; the twin barrels become black gunmetal with gold rings"),
    ("railgun", "GOLD"): ("the red turret housing becomes POLISHED GOLD plating with a few red accents; the steel corner brackets of "
                          "the base become gold; the pyramid base keeps its RED-AND-WHITE STRIPES with gold bands; the twin rails "
                          "stay steel with gold bands; the gold coil capacitors stay and the blue core keeps glowing"),
    ("railgun", "BLACK"): ("the gold turret housing becomes glossy BLACK faceted armour (like black diamond) with polished GOLD "
                           "edges; the corner brackets become black with gold bolts; the base stripes become BLACK AND GOLD; the "
                           "rails become black gunmetal with gold bands; the gold coil capacitors stay and the blue core keeps "
                           "glowing"),
    ("bunker", "GOLD"): ("the curved steel armour plates become POLISHED GOLD with gold rivets; the grated vent box on top gets a "
                         "gold frame; the sloping roof panels keep their RED-AND-WHITE STRIPES with gold trim; the wooden log beams "
                         "get gold end caps; the round door gets a gold ring"),
    ("bunker", "BLACK"): ("the gold armour plates become glossy BLACK faceted armour (like black diamond) with polished GOLD seams "
                          "and rivets; the roof stripes become BLACK AND GOLD; the vent box becomes black with a gold frame; the log "
                          "beams become dark wood with gold end caps; the round door becomes black with a gold ring, its small "
                          "orange lights stay"),
}
# how each tower stands taller (owner, 25 Oct night): an extra section of its own body or base that suits it, not a stretch.
# (tier 2 extra, tier 3 extra), and what keeps its size
TALL_HOW = {
    "cannon": ({"TALL2": "ONE extra drum section under the striped drum (a second striped red-and-white drum band with a gold band "
                         "between them)",
                "TALL3": "TWO extra drum sections under the striped drum (stacked black-and-gold striped drum bands with gold "
                         "bands between them)"},
               "The three feet, the ring with its prongs and the barrel keep their size and shape (the feet stay on the ground "
               "and the ring and barrel ride on top of the taller drum)"),
    "tesla": ({"TALL2": "ONE extra storey to the box (a second box section stacked under the top one, with a gold band between "
                        "them), the four striped corner poles growing taller with it",
               "TALL3": "TWO extra storeys to the box (three stacked box sections with gold bands between them), the four striped "
                        "corner poles growing taller with it"},
              "The stepped base, the copper coil and the mushroom dome keep their size and shape (the base stays on the ground and "
              "the coil and dome ride on top of the taller box)"),
    "sniper": ({"TALL2": "ONE extra storey to the octagonal body (a second octagonal section stacked on it, with a riveted band "
                         "between them, the striped corners running up both)",
                "TALL3": "TWO extra storeys to the octagonal body (three stacked octagonal sections with riveted bands between "
                         "them, the striped corners running up all of them)"},
               "The four short legs with their ball feet, the top deck and the domed gun turret keep their size and shape (the "
               "legs stay short and on the ground, the turret rides on top of the taller body)"),
    "laser": ({"TALL2": "ONE extra section to the metal box body (a second box section stacked under the one with the hazard "
                        "triangle, with a riveted band between them)",
               "TALL3": "TWO extra sections to the metal box body (three stacked box sections with riveted bands between them)"},
              "The striped base with its rubber bumpers, the cage and the laser head with its blue lens keep their size and shape "
              "(the base stays on the ground, the cage and head ride on top of the taller box)"),
    "aerial": ({"TALL2": "ONE extra stepped platform tier (a second, slightly narrower striped-and-grated platform stacked on the "
                         "first, like a stepped plinth)",
                "TALL3": "TWO extra stepped platform tiers (three stacked striped-and-grated platforms, each a little narrower, "
                         "like a stepped pyramid)"},
               "The bottom platform keeps its size, and the armoured turret with its twin barrels keeps its size and shape and "
               "rides on the top platform"),
    "railgun": ({"TALL2": "ONE extra tier to the striped pyramid base (a stepped pyramid: a second striped section stacked on the "
                          "first, with corner brackets on both)",
                 "TALL3": "TWO extra tiers to the striped pyramid base (three stacked striped sections, a stepped pyramid, with "
                          "corner brackets on each)"},
                "The bottom of the base keeps its size, and the turret with its coil capacitors and twin rails keeps its size and "
                "shape and rides on top of the taller base"),
    "bunker": ({"TALL2": "ONE extra row of curved armour plates to its walls (the armoured walls are one plate-row higher, with a "
                         "riveted band between the rows)",
                "TALL3": "TWO extra rows of curved armour plates to its walls (three plate-rows with riveted bands between them)"},
               "The round door stays at the bottom at the same size; the striped roof, the grated vent box and the log beams keep "
               "their size and shape and ride on top of the taller walls"),
}
NAME = {b: TOWERS[b]["what"].split(":")[0][4:].lower()} if b in TOWERS else {}   # e.g. "sniper tower"
if EXTRA:
    noun = "building" if b == "townhall" else "tower"
    if combo == "PLAIN":
        task = (f"Repaint base.png in PLAIN BLACK: every part that is GOLD in base.png (gold edges, seams, trims, rims, bands, "
                f"stripes, bolts{', and the golden frame, arms, clawed feet and horned crest' if b == 'townhall' else ''}) becomes the "
                f"same glossy BLACK faceted armour as the rest (like black diamond), with crisp cool white-grey highlights. NO gold "
                f"and NO yellow anywhere. Keep everything else exactly as in base.png: the same shapes, parts, pose, aim, camera, "
                f"size and painting finish; parts that are not gold keep their colour"
                f"{' (the blue porthole and blue studs stay blue, the red pipes stay red)' if b == 'townhall' else ''}"
                f"{' (the copper coil and the blue electric glow stay)' if b == 'tesla' else ''}. The owner wants to compare "
                f"black-and-gold (base.png) with plain black, so this must be the same picture with the gold turned black.")
    elif not RECOLOUR:
        how, keep = TALL_HOW[b]
        task = ("Make the tower in base.png STAND TALLER, keeping everything else the same: it is tier "
                f"{'2 of 3 (gold)' if combo == 'TALL2' else '3 of 3 (black diamond)'}, and the higher tiers fire further, so they "
                f"stand taller. Raise it by adding {how[combo]}, so the whole tower is about "
                f"{'30' if combo == 'TALL2' else '60'}% taller than base.png. {keep}; the FOOTPRINT on the ground stays exactly "
                "the same, NOT wider. Same materials, colours, pose, aim (any barrel points the same way), camera and painting "
                f"finish as base.png. It must stay clearly the same Flash {NAME[b]}, just taller.")
    else:
        how, keep = TALL_HOW[b]
        task = (f"Paint TIER {combo[-1]} of 3 of the {NAME[b]}. The tower's 3 tiers follow the game's wall blocks: tier 1 is the "
                "normal tower, tier 2 the GOLD version (like the Gold Blocks), tier 3 the BLACK DIAMOND version (black armour with "
                "gold edges, like the Black Diamond Blocks). The higher tiers also fire further, so they STAND TALLER on the same "
                "footprint. base.png is "
                + ("TIER 1, already painted and approved. Make TWO changes to it, keeping everything else the same.\n\n"
                   f"(1) Gold: {MAT_WHAT[(b, 'GOLD')]}. The gold must be rich, warm and shiny like block.png, clearly much more "
                   "gold than base.png.\n\n(2) Taller: raise it by adding "
                   if combo == "TALL2" else
                   "TIER 2 (gold, already standing taller). Make TWO changes to it, keeping everything else the same.\n\n"
                   f"(1) Black diamond: {MAT_WHAT[(b, 'BLACK')]}. The black must be deep and glossy with crisp faceted highlights "
                   "like block.png, the gold only on edges, trims, rims and bolts.\n\n(2) Taller again: raise it by adding ")
                + how[combo] + (", so the whole tower is about 30% taller than base.png" if combo == "TALL2" else
                                " (one MORE section than base.png has), so the whole tower is about 25% taller than base.png")
                + f". {keep}; the FOOTPRINT on the ground stays exactly the same, NOT wider.\n\nSame shapes, parts, pose, aim "
                "(any barrel or lens points the same way), camera and painting finish as base.png. It must stay clearly the same "
                f"Flash {NAME[b]}.")
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

{task}

It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).

Input 1, frames.png: the OLD Flash {noun}, blown up, on grey ({fr.width}x{fr.height}): its design, camera angle and ground footprint.
Input 2, ref.png: the old build-menu picture of the same {noun}.
Input 3, style.png: see style below.
Input 4, base.png: the approved new picture this one is made from (see above).{'''
Input 5, block.png: the game's ''' + ('Gold Blocks' if combo == 'TALL2' else 'Black Diamond Blocks') + ''' wall block. Use it ONLY as the colour and material reference for the new material (not its shape).''' if RECOLOUR else ''}

{STYLE}

Output: ONE image, {fr.width}x{fr.height}, the {noun} alone, complete and fully inside the image with margin{' (it is taller, so leave room above)' if combo != 'PLAIN' else ''}.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The {noun} itself must contain no bright pure green.
"""
    if os.environ.get("NOTE"):
        prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
    (out / "prompt.txt").write_text(prompt, encoding="utf-8")
    print("ready", out.as_posix())
    sys.exit(0)
if MAT:
    tier, block = ("2", "Gold Blocks") if combo == "GOLD" else ("3", "Black Diamond Blocks")
    TH = b == "townhall"
    lvl = "5" if combo == "GOLD" else "10"
    subject = (f"the TOWN HALL, the main building of the monster yard, at LEVEL {lvl}, in its "
               f"{'GOLD' if combo == 'GOLD' else 'BLACK DIAMOND'} version" if TH else f"TIER {tier} of 3 of {TOWERS[b]['what']}")
    tiers = ("The Town Hall has its own picture for every level (from the old Flash game). Its higher levels follow the game's wall "
             "blocks: the middle levels get GOLD elements (like the Gold Blocks), the top levels BLACK DIAMOND elements (black "
             "armour with gold edges, like the Black Diamond Blocks). The SAME building, the SAME silhouette, proportions, parts "
             "and colours as this level's Flash picture: only the MATERIAL of some parts changes, so it reads apart at a glance "
             "even at small game size." if TH else
             "The tower's 3 tiers follow the game's wall blocks: tier 1 is the normal tower, tier 2 is the GOLD version (like the "
             "Gold Blocks), tier 3 is the BLACK DIAMOND version (black armour with gold edges, like the Black Diamond Blocks). The "
             "SAME tower, the SAME silhouette, proportions, parts and pose at every tier: only the MATERIAL changes, so the tiers "
             "read apart at a glance even at small game size.")
    base = (f"the level {lvl} Town Hall already painted in the new style (approved)" if TH else
            "TIER 1 of this tower, already painted and approved")
    noun = "building" if TH else "tower"
    look = ("gold must be rich, warm and shiny like block.png, clearly much more gold than tier1.png" if combo == "GOLD" else
            "black must be deep and glossy with crisp faceted highlights like block.png, the gold only on edges, trims, rims and bolts")
    prompt = f"""Use your image generation tool (one call) to create a new image and save it as sample-new.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.

Paint {subject}. It is for the isometric strategy game Backyard Monsters (cartoony, colourful monster world), seen from the game's fixed isometric camera (from the front, looking down at about 30 degrees, the ground diamond's corners pointing left, right, up and down).

{tiers}

Input 1, frames.png: the OLD Flash {noun}, blown up, on grey ({fr.width}x{fr.height}): its design, camera angle, ground footprint and size.
Input 2, ref.png: the old build-menu picture of the same {noun} (a sharper render of the same design).
Input 3, style.png: see style below.
Input 4, tier1.png: {base}. Paint EXACTLY the same {noun}: same shapes, same parts in the same places, same pose and aim (any barrel points the same way), same camera, same size and the same painting finish and lighting. Only the materials change as described below.
Input 5, block.png: the game's {block} wall block. Use it ONLY as the colour and material reference for the new material (not its shape).

New materials: {MAT_WHAT[(b, combo)]}. The {look}. It must stay clearly the same Flash {noun}.

{STYLE}

Output: ONE image, {fr.width}x{fr.height}, the {noun} alone, complete and fully inside the image with margin.
Background everywhere: flat pure green #00FF00. No ground, no grass, no tile, no shadow on the ground, no grid lines, no text, no labels. The {noun} itself must contain no bright pure green.
"""
    if os.environ.get("NOTE"):
        prompt += "\nIMPORTANT CORRECTION (an earlier attempt got this wrong): " + os.environ["NOTE"] + "\n"
    (out / "prompt.txt").write_text(prompt, encoding="utf-8")
    print("ready", out.as_posix())
    sys.exit(0)
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
