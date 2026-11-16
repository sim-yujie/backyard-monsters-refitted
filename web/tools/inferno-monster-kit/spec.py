"""Per-monster settings for the Inferno monster repaints (IC1-IC8). See README.md.

Each entry says where the Flash sheet is, its cell and how its columns turn, how the
repainted sheets are laid out, and the words the Codex prompts use for the creature.
To do the next monster, add its entry here (copy IC1's and change the words and numbers).
"""
from pathlib import Path

KIT = Path(__file__).resolve().parent
REPO = KIT.parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
PORTRAITS = REPO / "web" / "public" / "portraits"

SPECS = {
    "IC1": dict(
        name="Spurtz",
        out="spurtz",                    # spurtz-repaint@4x.png, spurtz-anim@4x.png
        flash="spurtz.png",
        cell=(24, 28),                   # Flash cell, 1x
        anchor=(12, 14),
        flash_columns=30,                # columns the Flash art really has ...
        flash_step=12.0,                 # ... drawn this many degrees apart (0 = facing screen right, clockwise)
        directions=32,                   # headings the game reads (11.25 degrees each)
        # Painted headings; the rest are the left-right mirror (heading h <-> (directions/2 - h) mod directions).
        # Spurtz is symmetric and glows from within, so only front -> left -> back is painted.
        painted=list(range(8, 25)),
        area=1.2,                        # painted silhouette area / Flash silhouette area
        despill="fire",                  # no blue/purple in the creature: strip magenta from thin flame tips
        drop=1.0,                        # stand this many 1x px below the Flash body bottom (into its shadow, as Flash does)
        # animated sheet: the cell grows by (left/right, top, bottom) 1x pixels
        anim_pad=(6, 12, 2),
        walk_lift=(0, 1, 3, 0, 1, 3),    # 1x pixels each walk frame is lifted off the ground (the hop)
        # prompt words that are this monster's own (the scripts hold only the generic parts)
        features="flame crown and face",
        face_marks="the yellow face marks (eyes and grin)",
        portrait_note="for painting style and fire texture only. Do NOT copy its red lower shell, nose or proportions",
        light="the fireball glows evenly from within; no light from one side, no cast shadow on the body, so the left and right halves are lit the same",
        texture="rich glowing fire texture",
        no_fx="No sparks, embers, smoke, motion streaks or fire spray off the body: every flame stays attached to the body",
        creature=(
            "Spurtz, a small living fireball: an upright egg / rounded teardrop of glowing molten fire, wider and "
            "rounder at the bottom. Its body is bright yellow at the top, blending through orange to a deep red-orange "
            "at the bottom. From the top of its head rises a crown of FIVE short flame tongues (the middle one tallest), "
            "yellow with pale yellow tips, flickering upward. On the front of the body is its face, as if carved into "
            "the fire and glowing from inside like a jack-o'-lantern: TWO slanted, angry, glowing yellow eye slits and, "
            "below them, ONE wide glowing yellow grin (a crescent smile with a few jagged teeth)."
        ),
        parts=(
            " 1. Body: ONE egg-shaped fireball, round bottom, yellow top to deep red-orange bottom, glowing evenly from within.\n"
            " 2. Flame crown: FIVE short upward flame tongues on top of the head, the middle one tallest; always on top, always pointing up.\n"
            " 3. Eyes: TWO slanted angry glowing yellow eye slits (hidden only from behind; in side views the near eye shows at the body's edge).\n"
            " 4. Grin: ONE wide glowing yellow crescent grin under the eyes (hidden only from behind; seen at the body's edge in side views).\n"
            " 5. No arms, no legs, no horns, no nose, no red shell, no wings, no tail, no sparks or embers floating off the body."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: NO eyes and NO grin are visible, only the plain glowing "
            "orange back of the fireball with its flame crown on top."
        ),
        walk=(
            "Cells 1-6 are a WALK: Spurtz has no legs; it travels in small bouncy hops, like a jelly ball: "
            "1 squashed on landing (wider and lower); 2 stretching up to take off (taller and narrower, leaning a little "
            "in the facing direction); 3 round in the air, flames streaming back; 4 like 1; 5 like 2; 6 like 3. "
            "Same overall size as ref.png, centred in its cell, bottom of the body on the same horizontal line in every cell "
            "(the game lifts the hop itself)."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (a fiery head-butt): 7 anticipation: squashes down low and leans back away from the "
            "facing direction, eyes narrowed; 8 wind-up: swells up a little bigger, flame crown flaring tall, grin open "
            "wide; 9 strike: lunges forward in the facing direction, body stretched toward the target, flames streaming "
            "back; 10 follow-through: furthest forward, squashed against the target, grin wide open, flames flared; "
            "11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta."
        ),
    ),
    # IC2 round 3 (15 Nov): the owner's design target is the PORTRAIT (web/public/portraits/IC2.webp, the
    # Hatchery / Locker card), not the Flash battle sprite (round 2, commits 3fb735eb4 + b743f5e3e, whose words
    # are in git history) and not round 1's ribbed grub. Words below are written from the portrait (colours
    # picked from it: gold #926a25 / #af8631 / #c49f42, red #7a3113 / #934526 / #b65f43). The Flash cells are a
    # pose / angle guide only (design="portrait"). The creature is left-right symmetric, lit from above, so
    # front -> left -> back (headings 8-22) are painted and the rest are their mirror images.
    "IC2": dict(
        name="Zagnoid",
        out="zagnoid",
        flash="zagnoid.png",
        cell=(64, 46),                   # cut size, 1x (the Flash cell is 64.4 px wide: see flash_w)
        flash_w=64.4,                    # 1933 px / 30: column c starts at round(c * 64.4) (common.flash_x)
        flash_drift=0.247,               # ... but the art was laid out 64.65 apart: the body creeps right 0.25 px a column
        still_pad=6,                     # still cell 76 px wide: the body touches the Flash cell's left edge at some headings
        ref_body_only=True,              # reference cells without the long cast shadow, centred (still_batch.py)
        ref_smooth=True,                 # blow the reference cells up smoothly (bicubic)
        portrait=True,                   # the portrait goes into every call ...
        design="portrait",               # ... as THE design; the Flash cells only give facing, pose and size
        anim_colour_lock=True,           # build_anim: each animated frame's colours matched to its heading's still view
        gamma=1.0,                       # no brightness lift in build_anim
        # toward the portrait (body mean 215/152/45 vs portrait 183/153/98, limbs 164/65/22 vs 126/54/28): Codex
        # paints it more orange and saturated than the card; this gives a paler, greener gold and coral limbs
        grade=dict(body=((0.86, 6.0), (0.97, 10.0), (1.5, 14.0)), limbs=((0.8, 12.0), (0.88, 8.0), (1.2, 8.0))),
        grade_chroma=True,               # grey / white pixels (fangs, drool, glints, crevices) are left as painted
        view_match=True,                 # build_still: every painted view colour-matched to the median view (batches vary)
        open_holes=True,                 # see-through gaps between the claws / arms and the body (common.key_cell)
        # still_batch.py, design="portrait": what the crude Flash cells' blobs are
        frames_note="their dark spikes on the head are the red eye stalks, their beak-like head is the mane and fanged mouth",
        anchor=(26, 28),
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(8, 23)),      # 96 -> 264 degrees; heading h <-> 15 - h mirrored
        area=1.15,
        drop=0.0,
        shadow="flash",                  # the Flash cast shadow's own shape (long, to the lower right), not an ellipse
        anim_pad=(6, 10, 2),
        walk_lift=(0, 0, 0, 0, 0, 0),    # it glides, no hop
        loops=(0, 8, 22),                # compare.py loop videos: side, front, back
        back_range=(234.0, 306.0),       # the head sits high on the neck: the face shows in profile at 216 and 324 degrees
        face="fanged face under the mane",
        features="eye stalks with glowing tips, shaggy yellow mane, fanged drooling mouth, big red crab claws, glossy golden slime body, curled tail",
        face_marks="the head (red eye stalks on top, shaggy yellow mane, fanged mouth) and the curled tail",
        portrait_note=(
            "THE DESIGN of Zagnoid (its official portrait, seen from the side): paint exactly this creature: its "
            "glossy golden slug body, red eye stalks with glowing yellow tips, shaggy yellow mane, fanged mouth "
            "dripping drool, big red crab claws, small red leg nubs and curled tail, in its colours and its wet, "
            "slimy painting style"
        ),
        style=(
            "hand-painted digital game illustration in the style of portrait.png: glossy, wet, slimy golden skin "
            "with bright white specular glints, rich colour, soft painted shading with crisp edges, NO thick black "
            "outline, no pixel art; the eye stalks, claws and mane drawn bold and a little exaggerated so they read "
            "at a small size"
        ),
        light=(
            "soft light from ABOVE, the same on the left and right halves of the creature (wet highlights on the top "
            "surfaces, deeper gold underneath); no cast shadow on the ground"
        ),
        texture="glossy wet golden-yellow slime skin with white glints and pale slime streaks, bumpy coral-red arms, stalks and nubs",
        no_fx=(
            "No falling drops, puddles, splashes, sparks, smoke, motion streaks, glow halos or loose bits: every drool "
            "string and slime streak stays attached to the body, and the eye tips are solid bright yellow balls with no halo"
        ),
        creature=(
            "Zagnoid, the slimy golden slug monster of portrait.png (NOT a duck-billed dinosaur, NOT a ribbed grub). "
            "A low, glossy, wet slug body sits on the ground, wide and lumpy at the base with soft sagging folds; at the "
            "front it rises into a THICK upright neck that carries the head, leaning a little forward in the facing "
            "direction; at the back the body narrows into a slug tail that curls UP at its tip, with a few small red "
            "nubs on it. HEAD: a shaggy mop of straw-yellow hair (a mane) hangs forward over the face like a fringe; "
            "under it a wide open mouth full of long pale curved FANGS, with strands of pale slime drool hanging from "
            "the mouth down onto the chest. On top of the head stand FOUR or FIVE red EYE STALKS: thick coral-red "
            "stalks, each ending in a round glowing yellow eyeball, standing up and a little outward like a crown. A "
            "row of small red spikes runs down the back of the neck. ARMS: TWO big coral-red crab / lobster arms "
            "(segmented, bumpy) reach forward from the chest, each ending in a BIG hooked claw of three curved talons "
            "with dark tips. Round the base, several short red tentacle-like leg nubs poke out from under the body. "
            "Colours: the body is golden yellow (lit #e8c65a to lemon, mid #af8631, shade #926a25 to #5c3f10), glossy "
            "and wet with white glints and pale slime streaks; the arms, stalks, nubs and legs are coral to brick red "
            "(lit #b65f43, mid #934526, shade #7a3113); the eye tips glow yellow; the mane is straw yellow."
        ),
        parts=(
            " 1. Body: ONE glossy wet golden slug body, low and wide at the base, rising at the front into a thick upright neck; soft folds, no ribs, no rings, no bands.\n"
            " 2. Head: on top of the neck, toward the facing direction, with a shaggy straw-yellow mane hanging forward over the face.\n"
            " 3. Mouth: wide open under the mane, long pale curved fangs, a few strands of pale drool hanging from it (attached, no falling drops). Fanged and snarling: NOT a smile, NOT a grin, NO duck bill, NO beak.\n"
            " 4. Eye stalks: FOUR or FIVE thick red stalks on top of the head, each tipped with a round glowing yellow eyeball; always on top, pointing up.\n"
            " 5. Arms: TWO big coral-red crab arms reaching forward from the chest, each with a big hooked three-talon claw (the far one partly hidden in side views).\n"
            " 6. Neck spikes: a row of small red spikes down the back of the neck.\n"
            " 7. Tail: ONE slug tail at the back, opposite the head, curling up at its tip, with a couple of small red nubs.\n"
            " 8. Legs: several short red tentacle nubs round the base, mostly under the body.\n"
            " 9. No duck bill, no beak, no green or teal spikes, no thin spider legs, no wings, no horns, no smile."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the face, mouth and fangs are NOT visible; the viewer sees "
            "the back of the thick neck with its row of small red spikes, the back of the shaggy yellow mane, the red eye "
            "stalks with glowing yellow tips standing on top of the head, the two red claws sticking out on either side, and "
            "the curled slug tail toward the viewer at the bottom"
        ),
        walk=(
            "Cells 1-6 are a WALK: Zagnoid glides like a slug, with small changes only, the creature always looking like "
            "ref.png: in cells 1 and 4 the base squashes a little lower and wider and the neck leans forward; in cells 2 and "
            "5 a ripple bulge runs back along the body; in cells 3 and 6 the neck pulls up tall again. The leg nubs paddle, "
            "the claws swing a little, the eye stalks sway. Same size as ref.png, centred in its cell, bottom of the body on "
            "the same horizontal line in every cell."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (a claw strike with a bite), the same creature as ref.png: 7 anticipation: the neck "
            "leans back away from the facing direction, both claws raised to the sides, mouth opening; 8 wind-up: leans back "
            "further, both claws raised high (never above the eye stalk tips), fanged mouth wide open; 9 strike: lunges "
            "forward in the facing direction, both claws slashing down in front; 10 follow-through: furthest forward, claws "
            "snapped shut, fangs bared; 11 recovery: back to the resting pose of ref.png. The base of the body and the tail "
            "stay where they are. The mouth is fanged and snarling in every cell, never a smile. Cell 12 stays empty magenta."
        ),
    ),
    # IC3 Malphus (16 Nov): painted from the PORTRAIT (web/public/portraits/IC3.webp) from the start, as Zagnoid
    # round 3. Colours picked from it: olive green armour (shade #231f05, mid #585127, lit #a19659), orange belly
    # (mid #9c6a2e, lit #c28c45), purple fur (mid #2f1934, lit #5d4160), pink-magenta stripes and leg webs (#ae6c7d),
    # red eyes, ivory tusks. The Flash sheet is 30 x 9 cells of 51 x 35 (whole pixels): row 0 is a standing pose
    # the game never draws (and its columns turn the other way: column c there faces 360 - 12c degrees); rows 1-8 are
    # the walk the game plays, so the pose / facing guide is row 1 (`flash_row`). Symmetric: the Flash silhouette
    # matches its mirror column (15 - c) at half a walk cycle later with 0.27 mismatch (silhouette XOR / union, mean
    # over 30 columns), less than two neighbouring columns differ (0.32) or the walk changes one column (0.36); the
    # portrait creature is symmetric but for its drool. So headings 8-22 are painted, lit from above, the rest mirrored.
    "IC3": dict(
        name="Malphus",
        out="malphus",
        flash="malphus.png",
        cell=(51, 35),
        flash_row=1,                     # the first walk frame: the game never draws row 0
        still_pad=6,                     # room for spread legs at the cell edge
        ref_body_only=True,              # reference cells without the long cast shadow (it reads as more legs)
        ref_smooth=True,
        portrait=True,
        design="portrait",
        anim_colour_lock=True,
        gamma=1.0,
        # view_match left out: it matches each view's whole-body mean, and Malphus's front views carry the orange
        # belly and ivory tusks that its back views hide (switch on only if the batches really drift)
        open_holes="core",               # see-through gaps between the legs, arms and body (not the lilac fur highlights)
        mirror_walk_roll=3,              # build_anim: a mirrored heading plays walk frame k+3 (Flash's own mirror match is half a cycle on)
        anchor=(25, 17),
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(8, 23)),      # 96 -> 264 degrees; heading h <-> 15 - h mirrored
        area=1.15,
        drop=0.0,
        shadow="flash",                  # the Flash cast shadow's own spider shape, to the lower right
        anim_pad=(6, 10, 2),
        walk_lift=(0, 0, 0, 0, 0, 0),    # scuttles on four legs, no hop
        loops=(0, 8, 22),
        face="tusked face",
        back_range=(246, 294),           # Flash shows the tusked head in profile at the left up to 240 degrees
        pose_parts="clawed arms, the four legs and the round belly",
        frames_note=(
            "their two pink-magenta blobs on the shoulders are the shaggy PURPLE fur, the small pink marks on the head are "
            "its pink stripes, the white specks are the ivory tusks and the hooked talons, the orange ball low between the "
            "legs is the orange segmented belly"
        ),
        features="pink-striped tusked head with red eyes, purple fur, clawed arms, orange segmented belly and four armoured spider legs",
        face_marks="the head (pink stripes, red eyes, two big ivory tusks) and the orange belly",
        portrait_note=(
            "THE DESIGN of Malphus (its official portrait, seen from the front, the head turned a little): paint exactly "
            "this creature: its olive-green armoured body, the head with dusty rose-pink stripes, red eyes, small ivory horns, "
            "a mouth full of fangs and two big curved ivory tusks, the shaggy purple fur on its shoulders, chest and "
            "forearms, two arms with long orange hooked talons, the orange segmented belly and four thick armoured spider "
            "legs with orange claw tips and dusty rose-pink skin webs, in its colours and its painting style"
        ),
        style=(
            "hand-painted digital game illustration in the style of portrait.png: olive-green armour plates with soft "
            "highlights, shaggy purple fur, rich colour, soft painted shading with crisp edges, NO thick black outline, "
            "no pixel art; the tusks, the rose-pink head stripes, the purple fur and the orange belly drawn bold and a little "
            "exaggerated so they read at a small size"
        ),
        light=(
            "soft light from ABOVE, the same on the left and right halves of the creature (highlights on the top "
            "surfaces, darker olive underneath); no cast shadow on the ground"
        ),
        texture="olive-green armoured hide in plates and ridges, shaggy dark purple fur, glossy orange belly segments",
        no_fx=(
            "No falling drops, puddles, splashes, sparks, smoke, motion streaks, glow halos or loose bits: every drool "
            "string stays attached to the mouth. No part of the creature is pure magenta: the pink is a dusty rose and "
            "the fur a dark violet, both clearly different from the magenta background"
        ),
        creature=(
            "Malphus, the armoured tusked spider-demon of portrait.png (NOT a frog, NOT a crab). It stands on FOUR thick "
            "armoured spider legs spread wide around it (two at the front, two at the back), each bending up at a knee and "
            "down to the ground, ending in a big curved ORANGE claw tip; dusty rose-pink skin webs stretch under the upper legs. "
            "Low between the legs hangs a big egg-shaped ORANGE BELLY (taller than wide) made of 5 or 6 stacked overlapping HORIZONTAL plates, each plate a separate rounded ridge like a pill bug's or beetle's abdomen, mottled amber with darker brown spots; NOT a smooth ball, NO vertical seams. Above it "
            "rises a muscular upright olive-green torso with armour plates, and TWO strong arms bent at the elbow, each hand "
            "with THREE long hooked ORANGE talons hanging down. SHAGGY DARK PURPLE FUR covers the shoulders, runs down the "
            "chest to the belly and rings both forearms. HEAD: sits low and forward between the shoulders; olive-green "
            "armour with bold DUSTY ROSE-PINK stripes over the brow and crown, two big bulging eyes on top and two or three "
            "small RED eyes below them, small pale ivory horns round the crown, a wide mouth full of sharp ivory fangs, and "
            "TWO BIG CURVED IVORY TUSKS hanging down from the upper jaw like a walrus's, past the chin; a little pale drool. "
            "Colours: olive-green armour (lit #a19659, mid #585127, shade #231f05), orange belly and claw tips (lit #c28c45, "
            "mid #9c6a2e), dark purple fur (lit #5d4160, mid #2f1934), dusty rose-pink head stripes and leg webs (#ae6c7d, never pure magenta), "
            "red eyes, ivory tusks, horns and fangs."
        ),
        parts=(
            " 1. Legs: FOUR thick armoured olive-green spider legs spread wide (two front, two back), each with a big curved orange claw tip on the ground and a dusty rose-pink skin web under it.\n"
            " 2. Belly: ONE big egg-shaped orange belly of 5-6 stacked horizontal plates (mottled amber, no vertical seams, not a smooth ball) hanging low between the legs (seen from the front and sides; from behind only its lower edge).\n"
            " 3. Torso: an upright muscular olive-green armoured torso on top of the belly.\n"
            " 4. Fur: shaggy dark purple fur on both shoulders, down the chest and round both forearms.\n"
            " 5. Arms: TWO bent arms, each hand with THREE long hooked orange talons hanging down.\n"
            " 6. Head: low between the shoulders, olive green with dusty rose-pink stripes, red eyes, small ivory horns round the crown.\n"
            " 7. Mouth and tusks: a wide fanged mouth and TWO big curved ivory tusks hanging down from the upper jaw. Snarling: NOT a smile, NOT a grin.\n"
            " 8. No tail, no wings, no crab pincers, no extra legs (exactly four), no frog shape, no yellow-gold skin."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the face, eyes, mouth and tusks are NOT visible; the viewer "
            "sees the back of the olive-green armoured head with its dusty rose-pink stripes and small ivory horns, the shaggy "
            "purple fur on the shoulders and upper back, the armoured back of the torso, the two arms at the sides, the four "
            "spider legs spread round it and only the lower edge of the orange belly between the back legs"
        ),
        walk=(
            "Cells 1-6 are ONE WALK CYCLE (six different steps, then it loops back to cell 1): Malphus scuttles on its four "
            "spider legs, diagonal pairs moving together (pair A = its own front-left and back-right legs, pair B = front-right "
            "and back-left): 1 pair A reaches forward, pair B pushes back; 2 pair A sets down, pair B lifts; 3 pair B swings "
            "forward past the body; 4 pair B reaches forward, pair A pushes back (the opposite of cell 1); 5 pair B sets down, "
            "pair A lifts; 6 pair A swings forward past the body. The torso stays upright and "
            "bobs only a little, the arms swing a little, the belly sways. Same size as ref.png, centred in its cell, the "
            "feet on the same horizontal ground line in every cell."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (a claw slash with a tusk gore), the same creature as ref.png: 7 anticipation: the "
            "torso leans back away from the facing direction, both arms raised to the sides, talons spread; 8 wind-up: leans "
            "back further, both arms raised high (never above the top of the head by more than a head's height), fanged mouth "
            "wide open; 9 strike: lunges forward in the facing direction, both talons slashing down in front, head driving "
            "the tusks forward; 10 follow-through: furthest forward, talons down, tusks low; 11 recovery: back to the resting "
            "pose of ref.png. The four legs stay planted where they are. The mouth snarls in every cell, never a smile. "
            "Cell 12 stays empty magenta."
        ),
    ),
}


def heading_deg(spec, h):
    return h * 360.0 / spec["directions"]


def flash_column(spec, h):
    """The Flash column that faces closest to game heading h."""
    return round(heading_deg(spec, h) / spec["flash_step"]) % spec["flash_columns"]


def mirror_of(spec, h):
    d = spec["directions"]
    return (d // 2 - h) % d


def view_of(spec, h):
    """Rough view words for heading h (0 = facing screen right, 90 = toward the viewer, clockwise)."""
    a = heading_deg(spec, h) % 360
    f = spec.get("face", "face")
    b0, b1 = spec.get("back_range", (213.75, 326.25))  # headings where no face shows (back_note)
    back = b0 <= a < b1
    if a < 22.5 or a >= 337.5:
        return f"facing screen RIGHT (side view, the {f} at the right edge of the body)", back
    if a < 67.5:
        return f"facing toward the viewer and screen-right (three-quarter front view, the {f} turned to the right)", back
    if a < 112.5:
        return f"facing the viewer (front view, the whole {f} seen head-on)", back
    if a < 157.5:
        return f"facing toward the viewer and screen-left (three-quarter front view, the {f} turned to the left)", back
    if a < 202.5:
        return f"facing screen LEFT (side view, the {f} at the left edge of the body)", back
    profile = "back_range" in spec and not back  # a snout on a long neck still shows in profile here
    if a < 247.5:
        if profile:
            return f"facing away from the viewer and screen-left (three-quarter back view: the back of the body toward the viewer, the head turned to the left so the {f} shows in profile at the left)", back
        return f"facing away from the viewer and screen-left (three-quarter back view: only the very left edge of the {f} may show)", back
    if a < 292.5:
        return f"facing away from the viewer (back view: NO {f} visible)", back
    if profile:
        return f"facing away from the viewer and screen-right (three-quarter back view: the back of the body toward the viewer, the head turned to the right so the {f} shows in profile at the right)", back
    return f"facing away from the viewer and screen-right (three-quarter back view: only the very right edge of the {f} may show)", back
