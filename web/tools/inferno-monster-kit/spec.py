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
