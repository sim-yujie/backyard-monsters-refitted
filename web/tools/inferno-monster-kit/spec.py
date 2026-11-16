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
        # Codex painted the armour more golden and saturated than the card (hue 42 vs 48 degrees, saturation 0.77 vs
        # 0.60) and the fur pinker: "body" (the olive armour) moves toward the portrait's greener olive, "limbs" (the
        # pixels red well above green: belly, fur, pink stripes) a little less red, so the fur reads violet
        grade=dict(body=((0.94, 0.0), (1.06, 0.0), (1.2, 0.0)), limbs=((0.9, 0.0), (1.0, 0.0), (1.1, 0.0))),
        grade_chroma=True,               # tusks, fangs and drool stay as painted
        # Lead vetting (16 Nov): the armour read yellow-green and the fur bright violet beside the card. `tone` (common.tone,
        # after the grade) moves them to the card's numbers (armour hue 48, sat 0.60, value 0.34; fur hue 307, sat 0.52,
        # value 0.25, measured on IC3.webp); the belly, claws, stripes and tusks fall outside both hue windows
        tone=dict(
            armour=dict(hue=(42, 80), soft=5, min_sat=0.25, chroma=0.85, value=0.84, gains=(0.97, 1.0, 1.0)),
            fur=dict(hue=(275, 335), soft=8, min_sat=0.15, chroma=0.72, value=0.7, gains=(1.0, 1.0, 0.97), hi=170),
        ),
        demagenta=True,                  # hot pink drool-gap specks (h18) take their neighbours' colour
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
    # IC4 Valgos (16 Nov): painted from the PORTRAIT (web/public/portraits/IC4.webp), as Zagnoid round 3 and Malphus.
    # Colours picked from it: salmon-pink fleshy head (lit #e0a68a, mid #b17653), dark red throat (#6c1f19), ivory
    # fangs (#e6dcb4), orange eye balls (#f37b33), teal-blue spines and patches (lit #79b9c9, mid #488290, shade
    # #2b617b), golden-tan scaly body (lit #e6c27e, mid #d79951, shade #9a6a35), plum-maroon claws (#733a43, lit
    # #d299a1). Flash sheet: 30 x 1 whole-pixel cells of 55 x 32, one pose (it glides). The shadow tips of columns
    # 13-19 reach 1-4 px into the next cell, so `flash_w` = 55.0 switches on the own-art-run cut (common.flash_cell).
    # Symmetric, but Flash's columns are drawn 6 degrees early (column c faces 12c - 6): the best mirror partner of
    # column c is 16 - c in 29 of 30 columns (body silhouettes centred, XOR / union: 0.16 mean mismatch, Spurtz 0.17 by the same measure), while the
    # usual 15 - c gives 0.28, as much as one 12-degree step changes a column (0.28). So columns 8 and 23 are the
    # straight front and back views. Codex paints the pose of the Flash column it is shown, so the repaint keeps
    # Flash's turn: headings 8-23 are painted (8 and 23 are their own mirror) and h <-> 16 - h mirrored
    # (`mirror_axis`). The portrait creature is symmetric (eyes and eye pits on both sides of the maw, spines on the
    # middle of the back), lit from above. Drift: the body centre creeps right 0.425 px a column (art laid out ~55.4
    # apart; linear + one sine fit, 0.36 px rms), 12 px over the turn, then jumps back between columns 29 and 0.
    "IC4": dict(
        name="Valgos",
        out="valgos",
        flash="valgos.png",
        cell=(55, 32),
        flash_w=55.0,                    # whole pixels, but keep only each column's own art run (shadow tips spill over)
        still_pad=6,                     # the tail tip touches the cell's left edge (h0-1), the head its right edge (h14-17)
        ref_body_only=True,              # reference cells without the cast shadow, centred
        ref_smooth=True,
        portrait=True,
        design="portrait",
        anim_colour_lock=True,
        gamma=1.0,
        # Codex paints it brighter and more saturated than the card (gold body hue 33 / sat 0.56 / value 0.90 vs the card's
        # 35 / 0.48 / 0.74; pink flesh value 0.82 vs 0.71; teal sat 0.55 vs 0.49; claws a hot pink, hue 345 / value 0.51 vs
        # plum 351 / 0.31). No per-channel grade (identity, so `tone` runs); `tone` moves each part toward the card,
        # measured with art-work/IC4/colours.py: gold 32 / 0.52 / 0.77, flesh 14 / 0.51 / 0.70, teal 195 / 0.49 / 0.57,
        # claws 348 / 0.61 / 0.40 (kept a step lighter than the card so they read at game size). `max_sat` keeps the
        # orange eye balls (sat ~0.8) out of the gold and flesh windows.
        # Recheck by head region (h8 / h12 heads vs the card's head, no saturation cap): flesh hue 14-17 / sat 0.52 /
        # value 0.64 vs 16 / 0.50 / 0.66; the `throat` window takes the dark red throat from hue 3 to 6 (card 10).
        grade=dict(body=((1.0, 0.0), (1.0, 0.0), (1.0, 0.0)), limbs=((1.0, 0.0), (1.0, 0.0), (1.0, 0.0))),
        grade_chroma=True,               # fangs and eye glints stay as painted
        tone=dict(
            gold=dict(hue=(28, 60), soft=5, min_sat=0.25, max_sat=0.72, chroma=0.88, value=0.84, hi=210),
            flesh=dict(hue=(0, 26), soft=4, min_sat=0.2, max_sat=0.7, chroma=0.9, value=0.86, gains=(0.97, 1.06, 1.0), hi=210),
            throat=dict(hue=(0, 12), soft=4, min_sat=0.65, chroma=1.0, value=0.92, gains=(1.0, 1.15, 1.0)),
            teal=dict(hue=(170, 220), soft=8, min_sat=0.2, chroma=0.88, value=1.06, gains=(1.0, 1.01, 0.98)),
            claws=dict(hue=(300, 356), soft=6, min_sat=0.25, chroma=0.95, value=0.72, gains=(1.04, 1.0, 0.94), hi=170),
        ),
        open_holes="core",               # gaps between the legs and the body
        mirror_walk_roll=3,              # four-legged diagonal gait: a mirrored heading plays walk frame k+3
        anchor=(11, 15),
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(8, 24)),      # Flash's front (column 8) -> left -> back (column 23)
        mirror_axis=16,                  # heading h <-> 16 - h mirrored (see above)
        flash_drift=0.425,               # the body creeps right 0.425 px a column (see above)
        area=1.15,
        drop=0.0,
        shadow="flash",
        anim_pad=(6, 10, 2),
        walk_lift=(0, 0, 0, 0, 0, 0),
        loops=(0, 8, 23),
        face="gaping maw",
        back_range=(246, 294),           # the big head shows in profile past the body up to 240 degrees (Flash column 20)
        pose_parts="four clawed feet and the tail",
        frames_note=(
            "their pink blob with red dots is the big fleshy head with its gaping round maw and orange eye balls, the blue "
            "teeth along the top are the teal back spines, the long yellow cone behind the head is the golden scaly body "
            "tapering to the short pointed tail, the small brown bits at the sides are the four clawed feet"
        ),
        features="huge gaping round maw with three ivory fangs, orange eye balls on short stalks, teal-blue back spines, golden scaly body with teal patches and four clawed feet",
        face_marks="the head (the gaping round maw with its fangs, the orange eye balls round its rim) and the teal back spines",
        portrait_note=(
            "THE DESIGN of Valgos (its official portrait, seen from the front-left, the maw turned toward the viewer): paint "
            "exactly this creature: its huge fleshy salmon-pink head that is one big gaping round maw (dark red throat, three "
            "big curved ivory fangs, small teeth), the glossy orange eye balls on short dark stalks round the top and sides "
            "of the head, the small pits of tiny black eyes on the sides, the crest of teal-blue spines down its back, the "
            "golden-tan scaly body with teal patches, four short thick legs with long curved plum-maroon claws, and the short "
            "pointed tail, in its colours and its painting style"
        ),
        style=(
            "hand-painted digital game illustration in the style of portrait.png: wrinkled fleshy pink head with soft "
            "highlights, glossy orange eye balls, golden scaly skin, rich colour, soft painted shading with crisp edges, NO "
            "thick black outline, no pixel art; the maw, fangs, orange eye balls and teal spines drawn bold and a little "
            "exaggerated so they read at a small size"
        ),
        light=(
            "soft light from ABOVE, the same on the left and right halves of the creature (highlights on the top "
            "surfaces, darker underneath); no cast shadow on the ground"
        ),
        texture="wrinkled ridged salmon-pink flesh round the maw, glossy orange eye balls, golden-tan scales mottled with teal-blue patches, teal-blue spines",
        no_fx=(
            "No falling drops, puddles, splashes, sparks, smoke, dust, motion streaks, glow halos or loose bits. No part of "
            "the creature is pure magenta: the head is a salmon pink, the throat a dark red and the claws a plum maroon, all "
            "clearly different from the magenta background"
        ),
        creature=(
            "Valgos, the burrowing maw beast of portrait.png (NOT a frog, NOT a crocodile, NOT a fish). Its HEAD is huge, as "
            "wide as the body, and is almost all one GAPING ROUND MAW, open like a tunnel mouth: the rim is thick wrinkled "
            "salmon-pink flesh in ridged folds banded with pale golden-tan, inside is a deep dark red throat; THREE big curved "
            "IVORY FANGS stick out of the rim (one hanging down from the top, two pointing up from the bottom) and small "
            "ivory teeth line the inside. Round the top and down both sides of the head stand EIGHT glossy ORANGE EYE BALLS on "
            "short dark stalks (four down each side, the top pair near the crown), and on each side of the head, beside them, "
            "sit three round pits each holding a cluster of tiny black beady eyes. Behind the head a crest of jagged TEAL-BLUE SPINES runs from the top of the head down the "
            "middle of the back to the tail. The BODY is low, stocky and rounded, golden-tan with fine scales, mottled with "
            "teal-blue patches, and ends in a SHORT POINTED TAIL. FOUR short thick legs (two at the front under the head, "
            "two at the back) stand splayed, each foot with four or five long curved PLUM-MAROON claws; a plum-maroon spur "
            "points back from each hind leg. Colours: salmon-pink head flesh (lit #e0a68a, mid #b17653), dark red throat "
            "(#6c1f19), ivory fangs, orange eye balls (#f37b33 with a white glint), teal-blue spines and patches (lit #79b9c9, "
            "mid #488290, shade #2b617b), golden-tan body (lit #e6c27e, mid #d79951, shade #9a6a35), plum-maroon claws "
            "(#733a43, lit #d299a1)."
        ),
        parts=(
            " 1. Head: ONE huge fleshy salmon-pink head at the front, almost all gaping round maw (wrinkled ridged rim, dark red throat inside); from behind only the back of the head shows.\n"
            " 2. Fangs: THREE big curved ivory fangs on the maw's rim (one down from the top, two up from the bottom) and small ivory teeth inside. A gaping open maw: NOT a smile, NOT a grin, no lips, no tongue sticking out.\n"
            " 3. Eyes: EIGHT glossy orange eye balls on short dark stalks, four down each side of the head (the top pair near the crown), plus three pits of tiny black eyes on each side.\n"
            " 4. Spines: a crest of jagged teal-blue spines from the top of the head down the middle of the back to the tail.\n"
            " 5. Body: low, stocky, golden-tan and scaly with teal-blue patches, behind the head.\n"
            " 6. Legs: FOUR short thick splayed legs (two front, two back), each foot with four or five long curved plum-maroon claws; a plum-maroon spur on each hind leg.\n"
            " 7. Tail: ONE short pointed tail at the back, opposite the head.\n"
            " 8. No wings, no horns on the head, no arms, no extra legs (exactly four), no lips, no nose, no green skin."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the maw, throat and fangs are NOT visible; the viewer sees "
            "the back of the big round salmon-pink head with the orange eye balls on stalks sticking up round its top and "
            "sides, the crest of teal-blue spines running down the middle of the back toward the viewer, the golden-tan scaly "
            "back with teal patches, the four splayed clawed legs at the sides and the short pointed tail toward the viewer"
        ),
        walk=(
            "Cells 1-6 are ONE WALK CYCLE (six different steps, then it loops back to cell 1): Valgos plods on its four short "
            "legs, diagonal pairs moving together (pair A = its own front-left and back-right legs, pair B = front-right and "
            "back-left): 1 pair A reaches forward, pair B pushes back; 2 pair A sets down, pair B lifts; 3 pair B swings "
            "forward; 4 pair B reaches forward, pair A pushes back (the opposite of cell 1); 5 pair B sets down, pair A lifts; "
            "6 pair A swings forward. The body sways a little side to side, the heavy head bobs a little, the maw stays open. "
            "Same size as ref.png, centred in its cell, the feet on the same horizontal ground line in every cell."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (a crunching bite with the huge maw), the same creature as ref.png: 7 anticipation: the "
            "head pulls back and up away from the facing direction, the maw half closed; 8 wind-up: the head raised a little "
            "higher (never higher than one head's height above the body), the maw stretched open as wide as it goes, fangs "
            "bared; 9 strike: lunges forward in the facing direction, the head driving down onto the target, maw wide; 10 "
            "follow-through: furthest forward and low, the jaws clamped nearly shut in a crunching bite; 11 recovery: back to "
            "the resting pose of ref.png. The four feet stay planted where they are. Cell 12 stays empty magenta."
        ),
    ),
    # IC5 Balthazar (16 Nov): painted from the PORTRAIT (web/public/portraits/IC5.webp). Colours picked from it: bone-tan
    # skull (lit #c9a170, mid #a0774c, shade #6a4526), glossy black eyes, ivory horns, fangs and claws (#d4c3a9), dark
    # maroon throat (#260b05, mouth flesh #41170c), red-brown leathery wings (membrane #854f40 / #73372a, arm bones
    # #673729), red-brown head flesh (#915f49), golden-tan clawed feet (#ab7c58).
    # Flash sheet: 30 x 7 whole-pixel cells of 56 x 37, anchor (33, 18.5), a FLYER (no shadow in the sheet: the game
    # draws flyingshadow.png on the ground). The game plays rows 1-6 (the wing beat, 8 ticks a frame) and never row 0.
    # The art spills past the 56 px cell (-4 to +66 px) and creeps right 0.80 px a column (rows 1-6, alpha-weighted
    # centroid, linear + one sine fit, 0.39 px rms), then jumps back between columns 29 and 0; de-drifted, the body
    # orbits the anchor (x 28-38) and all art lies within x 4-63 of the Flash cell. So the kit reads a window 80 px wide
    # starting 7 px left of each Flash cell (`flash_x0`, `cell`), keeps only the column's own art run (`flash_w`), drops
    # the rows' leaks (`flash_specks`: the rows touch, a wing tip of the row below pokes into the last lines), and the
    # anim cell trims 6 px each side of that window (anim_pad -6): 68 px wide, Flash x -1 to 67, so 30 x 4 x 68 = 8160
    # px fits the 8192 px texture limit. Half its art is soft-edged (alpha < 235): body_alpha 128.
    # Symmetric: silhouette XOR / union of the main art piece against the mirror column 15 - c is 0.24-0.28 (front
    # half 0.24) vs 0.34-0.39 for one 12-degree step; columns 7 and 8 are both straight front views, 22 and 23 back views
    # (column c faces 12c). The portrait creature is symmetric but for its uneven crown of horns. So headings 8-22 are
    # painted, lit from above, the rest mirrored (h <-> 15 - h).
    "IC5": dict(
        name="Balthazar",
        out="balthazar",
        flash="balthazar.png",
        cell=(80, 37),                   # the read window: Flash cell x -7 to 73 (see above)
        flash_x0=-7,
        flash_w=56.0,                    # whole pixels; switches on the own-art-run cut
        flash_specks=True,
        flash_row=1,                     # the first frame of the wing beat (the game never draws row 0)
        body_alpha=128,
        flash_drift=0.8,
        ref_smooth=True,
        portrait=True,
        design="portrait",
        anim_colour_lock=True,
        gamma=1.0,
        # Codex paints the wings redder, more saturated and brighter than the card (hue 9 / sat 0.74 / value 0.52 vs the
        # card's 13 / 0.62 / 0.44) and the skull brighter (26 / 0.59 / 0.70 vs 27 / 0.47 / 0.56); measured with
        # art-work/IC5/tools/colours.py. Identity `grade` (so `tone` runs); `tone` moves wings and flesh (two hue windows
        # round 0) and the bone toward the card: wings 11 / 0.67 / 0.45, bone 26 / 0.50 / 0.57. `max_sat` keeps the dark
        # maroon throat (sat ~0.84) as painted.
        grade=dict(body=((1.0, 0.0), (1.0, 0.0), (1.0, 0.0)), limbs=((1.0, 0.0), (1.0, 0.0), (1.0, 0.0))),
        grade_chroma=True,
        tone=dict(
            wing=dict(hue=(0, 19), soft=3, min_sat=0.35, max_sat=0.82, chroma=0.85, value=0.86, gains=(0.98, 1.05, 1.0), hi=200),
            wing2=dict(hue=(338, 360), soft=3, min_sat=0.35, max_sat=0.82, chroma=0.85, value=0.86, gains=(0.98, 1.05, 1.0), hi=200),
            bone=dict(hue=(23, 45), soft=3, min_sat=0.3, chroma=0.82, value=0.82, hi=215),
        ),
        open_holes="core",               # gaps between the wings, the body and the feet
        flyer=True,                      # build_anim: one scale and Codex's own placement for the wing beat
        anchor=(40, 18.5),               # Flash's (33, 18.5) in the read window
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(8, 23)),      # front (96 degrees) -> left -> back (264 degrees); the rest mirrored
        area=1.1,
        drop=0.0,
        shadow="none",
        anim_pad=(-6, 20, 8),            # 68 x 65 anim cells, anchor (34, 38.5)
        still_top=20,                    # the still may use the anim cell's top pad for raised wings
        walk_lift=(0, 0, 0, 0, 0, 0),
        loops=(8, 15, 22),
        face="skull face",
        back_range=(246, 294),           # 216-240 degrees: three-quarter back, the skull face in profile at the left
        pose_parts="two wings, the skull face and the clawed feet",
        frames_note=(
            "their bright orange bat shape is Balthazar seen from above: the two big wings spread out to the sides, the "
            "pale blob between them is the skull face with its dark open mouth, the small pale bits under it are the "
            "clawed feet; the old sprites are much brighter and more orange than the real creature"
        ),
        features="bone-tan skull face with big glossy black eyes and a gaping fanged mouth, crown of ivory horns, red-brown bat wings with ivory claws, clawed feet",
        face_marks="the skull face (the big black eyes and the gaping fanged mouth) and the two wings",
        portrait_note=(
            "THE DESIGN of Balthazar (its official portrait, a flying demon seen from the front, a little to the left): "
            "paint exactly this creature: a big bone-tan SKULL for a head with two huge round glossy black eyes in deep "
            "sockets, a nose hole, a gaping mouth ringed with long curved ivory fangs and a dark maroon throat; a crown of "
            "uneven ivory horns along the top of the head; a small red-brown fleshy body hanging under the skull; two big "
            "red-brown leathery BAT WINGS from the top of the head, each with an ivory claw at the wrist and long hooked "
            "ivory talons hanging from the lower wing fingers; two small golden-tan clawed feet under the jaw; in its "
            "colours and its painting style"
        ),
        style=(
            "hand-painted digital game illustration in the style of portrait.png: bone-tan skull with soft highlights, "
            "glossy black eyes with a white glint, leathery red-brown wings with darker veins, rich but earthy colour, soft "
            "painted shading with crisp edges, NO thick black outline, no pixel art; the skull, black eyes, fangs and wings "
            "drawn bold and a little exaggerated so they read at a small size"
        ),
        light=(
            "soft light from ABOVE, the same on the left and right halves of the creature (highlights on the top "
            "surfaces, darker underneath); no cast shadow on the ground"
        ),
        texture="bone-tan skull, glossy black eyes, ivory horns, fangs and claws, leathery red-brown wing membranes with darker veins, red-brown flesh",
        no_fx=(
            "No falling drops, splashes, sparks, smoke, fire, dust, motion streaks, glow halos or loose bits. No part of "
            "the creature is pink or magenta: the wings and flesh are a dark brownish red, clearly different from the "
            "magenta background"
        ),
        creature=(
            "Balthazar, the flying skull demon of portrait.png (NOT a dragon, NOT a bird, NOT a plain bat). Its HEAD is a "
            "big rounded bone-tan SKULL: two HUGE round glossy BLACK EYES in deep sockets, a small nose hole, cheek bones, "
            "and a GAPING MOUTH ringed with long curved ivory FANGS (longest at the corners), a dark maroon throat inside. "
            "Along the top of the skull stands a CROWN of five or six uneven ivory HORNS. Behind and under the skull hangs a "
            "small red-brown fleshy BODY. Two big red-brown leathery BAT WINGS grow from the top of the back of the head: "
            "each has a bony arm with an ivory claw at the wrist and long fingers with the membrane between them, darker "
            "veins, and long hooked ivory TALONS hanging from the lower fingertips. Two small golden-tan FEET with ivory "
            "claws hang under the jaw. No arms, no tail, no legs to stand on. Colours: bone-tan skull (lit #c9a170, mid "
            "#a0774c, shade #6a4526), glossy black eyes, ivory horns, fangs and claws (#d4c3a9), dark maroon throat "
            "(#260b05), red-brown wings (#854f40, darker #73372a, bones #673729), golden-tan feet (#ab7c58)."
        ),
        parts=(
            " 1. Skull head: ONE big bone-tan skull with TWO huge round glossy black eyes and a nose hole; from behind only the back of the skull shows.\n"
            " 2. Mouth: a gaping open mouth ringed with long curved ivory fangs, dark maroon inside. NOT a smile, NOT a grin, no lips, no tongue.\n"
            " 3. Horns: a crown of five or six uneven ivory horns along the top of the skull.\n"
            " 4. Wings: TWO big red-brown leathery bat wings from the top of the back of the head, an ivory claw at each wrist, hooked ivory talons on the lower fingertips.\n"
            " 5. Body: a small red-brown fleshy body hanging under and behind the skull.\n"
            " 6. Feet: TWO small golden-tan clawed feet hanging under the jaw.\n"
            " 7. No arms, no tail, no legs to stand on, no feathers, no extra wings (exactly two), no green or blue anywhere."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the eyes, mouth and fangs are NOT visible; the viewer sees "
            "the round bone-tan back of the skull with the crown of ivory horns along its top, the red-brown fleshy back "
            "and the two big leathery wings spread out from it, seen from behind (the bony arms and veins on their backs)"
        ),
        walk=(
            "Cells 1-6 are ONE WING BEAT while flying (six different steps, then it loops back to cell 1): cell 1 is EXACTLY "
            "ref.png's pose, wings spread out level; 2 the wings rise; 3 the wings are raised high above the head; 4 the "
            "wings sweep down, half way; 5 the wings are swept low, below the skull, tips forward; 6 the wings rise back "
            "toward level. The skull, the body and the feet stay at EXACTLY the same place and the same size in every cell "
            "(only the wings move; the feet sway a little). Same size as ref.png, centred in its cell, nothing cut at the "
            "cell edges (leave room above for the raised wings and below for the lowered wings)."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (a swooping bite with the skull's fanged mouth), the same creature as ref.png, still "
            "flying: 7 anticipation: the skull pulls back and up away from the facing direction, the wings raised, the mouth "
            "half closed; 8 wind-up: the wings high, the mouth stretched open as wide as it goes, fangs bared; 9 strike: it "
            "lunges forward and down in the facing direction, the wings swept back, the mouth wide; 10 follow-through: "
            "furthest forward and low, the jaws snapped nearly shut in a crunching bite; 11 recovery: back to the resting pose "
            "of ref.png. The skull never turns toward the viewer. Cell 12 stays empty magenta."
        ),
    ),
}


def heading_deg(spec, h):
    return h * 360.0 / spec["directions"]


def flash_column(spec, h):
    """The Flash column that faces closest to game heading h."""
    return round(heading_deg(spec, h) / spec["flash_step"]) % spec["flash_columns"]


def mirror_of(spec, h):
    """The heading whose left-right mirror image heading h is: d/2 - h, or spec `mirror_axis` - h (Valgos IC4:
    16 - h, since its Flash columns are drawn 6 degrees early, so the front and back views are columns 8 and 23)."""
    d = spec["directions"]
    return (spec.get("mirror_axis", d // 2) - h) % d


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
