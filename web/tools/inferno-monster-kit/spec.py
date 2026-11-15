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
    ),    "IC2": dict(
        name="Zagnoid",
        out="zagnoid",
        flash="zagnoid.png",
        cell=(64, 46),                   # cut size, 1x (the Flash cell is 64.4 px wide: see flash_w)
        flash_w=64.4,                    # 1933 px / 30: column c starts at round(c * 64.4) (common.flash_x)
        flash_drift=0.247,               # ... but the art was laid out 64.65 apart: the body creeps right 0.25 px a column
        still_pad=6,                     # still cell 76 px wide: the body touches the Flash cell's left edge at some headings
        ref_body_only=True,              # reference cells without the long cast shadow, centred (still_batch.py)
        anchor=(26, 28),
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(30)),
        area=1.2,
        drop=0.0,
        shadow="flash",                  # the Flash cast shadow's own shape (long, to the lower right), not an ellipse
        despill="fire",                  # yellow, red and dark green only: blue above green is magenta bleeding into an edge
        anim_pad=(6, 10, 2),
        walk_lift=(0, 0, 0, 0, 0, 0),    # it crawls, no hop
        loops=(0, 8, 22),                # compare.py loop videos: side, front, back
        # No face from behind only for the true back views: the snout on its long neck still shows at
        # 216 and 324 degrees in the Flash sheet (Spurtz hides its face from 213.75 to 326.25).
        back_range=(234.0, 306.0),
        face="snout",
        features="head, snout, green head spines, red claws, stubby legs and tail",
        face_marks="the head with its snout (open red mouth) and the dark green head spines",
        portrait_note=(
            "for painting style, glossy slimy skin and colours only. Do NOT copy its eye stalks, hair, dripping slime "
            "or proportions: the old sprite has dark green spines on the head and no eye stalks"
        ),
        light=(
            "soft light from the upper LEFT of the screen in every cell, the same screen-fixed light for every heading "
            "as in the old sprites (brighter on the screen-left side of the creature); no cast shadow on the ground"
        ),
        texture="glossy, slimy golden-yellow skin with olive-brown shading and soft wet highlights",
        no_fx="No slime drips, puddles, sparks, smoke, motion streaks or loose bits: every part stays attached to the body",
        creature=(
            "Zagnoid, a squat slug-like lab mutant: a fat, lumpy golden-yellow body that sits low on the ground, wide "
            "at the base, with darker olive-brown bands winding round it like a coil. From the front of the body rises "
            "a thick upright neck that bends forward into a blunt, duck-like head; the snout points in the facing "
            "direction and its open mouth is red inside. On top of the head stand THREE or FOUR thin dark green spines. "
            "From the chest reach TWO red-orange arms, each ending in a three-fingered claw, held forward on either side "
            "of the neck. Round the bottom of the body, many short red-orange stubby legs poke out (like a caterpillar's). "
            "Behind, a thick yellow cone-shaped tail curls up to a point; the tail always points the opposite way to the snout."
        ),
        parts=(
            " 1. Body: ONE fat lumpy golden-yellow slug body sitting low, darker olive bands winding round it.\n"
            " 2. Neck and head: ONE thick upright neck bending forward into a blunt duck-like head; the snout points in the facing direction, red open mouth.\n"
            " 3. Head spines: THREE or FOUR thin dark green spines on top of the head.\n"
            " 4. Arms: TWO red-orange arms with three-fingered claws, held forward on either side of the neck (the far one partly hidden in side views).\n"
            " 5. Legs: many short red-orange stubby legs round the bottom of the body.\n"
            " 6. Tail: ONE thick yellow cone-shaped tail curling up to a point, on the side opposite the snout.\n"
            " 7. No eye stalks, no wings, no horns, no hair, no slime drips."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the snout and mouth are NOT visible; the viewer sees "
            "the back of the neck and head with its green spines, the olive bands coiling round the back of the body, "
            "the two claws sticking out to the sides, and the tail toward the viewer at the bottom"
        ),
        walk=(
            "Cells 1-6 are a WALK: Zagnoid crawls like a caterpillar-slug: its many stubby legs patter in a ripple "
            "that runs from the tail to the front, and the body heaves a little with it: 1 body bunched up (a little "
            "shorter, a little taller), legs under the back half lifted; 2 the front reaches forward in the facing "
            "direction, neck leaning forward; 3 body stretched out long and low, legs under the front half lifted; "
            "4 like 1; 5 like 2; 6 like 3. Claws sway a little and the tail swings a little side to side. The changes "
            "are small: same overall size as ref.png, centred in its cell, bottom of the body on the same horizontal "
            "line in every cell."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (claw slash and bite): 7 anticipation: rears back away from the facing direction, "
            "neck pulled back, both claws raised; 8 wind-up: rears up taller, claws spread wide and high, mouth wide "
            "open; 9 strike: lunges forward in the facing direction, neck and snout thrust forward, both claws slashing "
            "down in front; 10 follow-through: furthest forward, body low and stretched toward the target, mouth "
            "snapping shut, claws down; 11 recovery: settling back to the resting pose of ref.png. Cell 12 stays empty magenta."
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
