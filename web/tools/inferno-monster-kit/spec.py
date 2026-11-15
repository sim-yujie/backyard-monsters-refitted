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
    # IC2 round 2 (15 Nov): round 1 drifted into a fat glossy golden grub with a smiling face (the concept
    # portrait and the words pulled it there). Round 2 drops the portrait and describes the Flash sprite as it
    # is (colours picked from the Flash body pixels: median body #8b7317 olive-mustard, lit #ffe75c, shade
    # #452e00, limbs #5c2e17 / #732e2e with #8b452e lights, crest #2e452e / #2e4545 with #5c7345 tips).
    "IC2": dict(
        name="Zagnoid",
        out="zagnoid",
        flash="zagnoid.png",
        cell=(64, 46),                   # cut size, 1x (the Flash cell is 64.4 px wide: see flash_w)
        flash_w=64.4,                    # 1933 px / 30: column c starts at round(c * 64.4) (common.flash_x)
        flash_drift=0.247,               # ... but the art was laid out 64.65 apart: the body creeps right 0.25 px a column
        still_pad=6,                     # still cell 76 px wide: the body touches the Flash cell's left edge at some headings
        ref_body_only=True,              # reference cells without the long cast shadow, centred (still_batch.py)
        ref_smooth=True,                 # blow the reference cells up smoothly (bicubic): Codex read the blocky head as a thin beak
        portrait=False,                  # no concept painting in the prompts: the Flash sprite is the only reference
        # per-part, per-channel colour match to the Flash sprite (common.grade; crest left as painted), from
        # art-work colstats over the 30 still views at 1x. Before grading: body mean R154.0 G113.8 B14.7, spread
        # 65.4 64.7 21.9 (Flash 143.1 112.3 26.5 / 70.2 68.4 30.2); limbs 122.2 44.9 22.4 / 49.3 23.1 20.7
        # (Flash 126.2 51.1 31.4 / 54.0 27.9 23.8)
        grade=dict(body=((1.073, -22.2), (1.057, -8.0), (1.379, 6.2)), limbs=((1.095, -16.0), (1.208, -3.1), (1.0, 4.0)),
                   # limbs: the stats fit made the legs salmon at 1x (blue over green 0.76 vs Flash 0.61): R and B cut back.
                   # crest (dark pixels only): painted 65/79/53 vs Flash 76/101/55, a near-black crest at 1x -> lifted grey-green
                   crest=((1.0, 11.0), (1.0, 22.0), (1.0, 2.0))),
        anim_colour_lock=True,           # build_anim: each animated frame's colours matched to its heading's still view
        gamma=1.0,                       # no brightness lift in build_anim: the grade already matches Flash
        open_holes=True,                 # see-through gaps between the bent arms and the body (common.key_cell)
        anchor=(26, 28),
        flash_columns=30,
        flash_step=12.0,
        directions=30,
        painted=list(range(30)),
        area=1.15,                       # 1.05 read about 8% small beside Flash (Flash head and neck look bigger)
        drop=0.0,
        shadow="flash",                  # the Flash cast shadow's own shape (long, to the lower right), not an ellipse
        # no despill: the crest is dark grey-teal (blue close to green); key_cell's magenta test does the keying
        anim_pad=(6, 10, 2),
        walk_lift=(0, 0, 0, 0, 0, 0),    # it crawls, no hop
        loops=(0, 8, 22),                # compare.py loop videos: side, front, back
        # No face from behind only for the true back views: the snout on its long neck still shows at
        # 216 and 324 degrees in the Flash sheet (Spurtz hides its face from 213.75 to 326.25).
        back_range=(234.0, 306.0),
        face="bill",
        features="silhouette, thick neck, big duck-billed head, dark teal crest spikes, thin dark-red arms and legs, tail and dirty olive-yellow colouring",
        face_marks="the big duck-billed head (broad upper bill, red open mouth under it, small dark eye) and the dark teal crest spikes",
        style=(
            "a FAITHFUL repaint of the old sprite at higher detail, like a remaster: the same creature, the same "
            "silhouette and proportions, the same colours and the same dirty, mottled look, only sharper and cleaner. "
            "Hand-painted digital game illustration, soft painted shading with crisp edges, a thin dark rim where the "
            "old sprite has dark edges, NO thick black outline, no pixel art, not glossy, not shiny plastic, not cute, "
            "readable at a small size"
        ),
        light=(
            "light from the upper LEFT of the screen in every cell, the same screen-fixed light for every heading "
            "as in the old sprites (bright lemon highlights on the screen-left side of the creature, deep olive-brown "
            "shade on the right and underneath); no cast shadow on the ground"
        ),
        texture="matte, dirty, mottled olive-mustard skin with small darker blotches, lemon-yellow highlights and deep olive-brown shade",
        no_fx="No slime, drips, puddles, sparks, smoke, motion streaks or loose bits: every part stays attached to the body",
        creature=(
            "Zagnoid, a little dinosaur-like Inferno monster with a duck bill (NOT a fat grub, NOT a slug, NOT a worm). "
            "Its lower body is a pear-shaped bulb sitting on the ground; from it rises a THICK upright neck (about half "
            "as wide as the bulb, as tall as the bulb) that bends forward at the top into a BIG BLUNT DUCK-BILLED head, "
            "like a hadrosaur or a duck: a broad, flat, rounded upper bill as wide as the neck juts forward in the facing "
            "direction (the head is chunky, NOT a thin pointed bird beak); under the bill the mouth hangs open, dark red "
            "inside, with a few small dark bristly teeth / whiskers poking forward from it; one small dark eye on the side "
            "of the head behind the bill. On top and back of the head stands a crest of THREE or FOUR thin, stiff, dark slate "
            "teal-green spikes (#2e452e to #2e4545, grey-green #5c7345 tips), some forked, sticking up and back. Behind, a "
            "LONG cone-shaped tail sticks straight out backwards from the bottom of the bulb, tapering to a point that "
            "turns up at the tip (like a teapot spout); the tail points the opposite way to the bill. Seen from behind (and only from "
            "behind), a raised band coils once round the body from the neck down to the bulb; from the side and front there "
            "is NO collar, ring or band. From the chest reach TWO thin, spindly, insect-like arms in DULL dark maroon / "
            "brick red (#5c2e17 to #732e2e, lit #8b452e; matte, not bright red, not shiny), bent at the elbow and held forward, each ending in a small pincer claw of two or three "
            "thin fingers. Round the base, six to eight SHORT, thin, jointed, spider-like legs in the "
            "same dull brick red splay out flat on the ground, mostly hidden under the bulb (only their lower halves show). Colours: the body is a dirty olive-mustard yellow (mid tone #8b7317, lit #b98b2e to #ffe75c lemon "
            "yellow on the light side, shade #5c4517 to #452e00 dark olive-brown), matte and mottled with small darker "
            "blotches, not glossy and not orange-gold."
        ),
        parts=(
            " 1. Body: ONE pear-shaped olive-mustard bulb sitting on the ground (no ribs, no rings, no segments).\n"
            " 2. Neck: ONE THICK upright neck (half the bulb's width), bending forward at the top.\n"
            " 3. Head: ONE BIG BLUNT duck-billed head: broad flat upper bill toward the facing direction, red open mouth under it with small dark bristly teeth, one small dark eye on the side; no thin pointed bird beak, no smile. In front views the bill points at the viewer and the mouth is hidden under it: NO grin, NO smiling mouth line across the face.\n"
            " 4. Crest: THREE or FOUR thin stiff dark slate teal-green spikes on top of and behind the head.\n"
            " 5. Arms: TWO thin spindly DULL dark maroon / brick-red insect arms bent at the elbow, small pincer claws, held forward (the far one partly hidden in side views).\n"
            " 6. Legs: six to eight SHORT thin jointed spider-like dull brick-red legs splayed flat round the base, mostly under the bulb, each leg a thin stick with a knee bend tapering to a point (not sausage-shaped, not segmented tubes, not long spikes, not bright red).\n"
            " 7. Tail: ONE long cone tail sticking straight out backwards from the bulb, tip turned up, opposite the bill.\n"
            " 8. From behind only: one smooth raised band coiling round the body from neck to bulb (no collar or ring in side or front views).\n"
            " 9. No eye stalks, no wings, no horns, no hair, no slime, no ribs or rings, no cheeks or smile."
        ),
        back_note=(
            "BACK VIEW: the creature faces away from the viewer: the bill and eye are NOT visible; the viewer sees "
            "the back of the long neck with the teal crest spikes on top, the smooth spiral band coiling round the back "
            "of the body, the two thin arms sticking out to the sides, and the cone tail toward the viewer at the bottom"
        ),
        walk=(
            "Cells 1-6 are a WALK. The old game slid this monster along in one pose, so the walk must stay very close "
            "to ref.png: the body, neck, head, tail and silhouette do NOT change shape or size, they stay rigid. Only "
            "the thin spider legs step in a ripple (in cells 1 and 4 the legs on one side lifted a little, in cells 2 "
            "and 5 the legs on the other side lifted, in cells 3 and 6 the legs flat), the arms sway a little and the "
            "tail tip swings a little. Same size as ref.png, centred in its cell, bottom of the body on the same "
            "horizontal line in every cell."
        ),
        attack=(
            "Cells 7-11 are an ATTACK (bill bite and claw slash), still the same creature as ref.png with the same "
            "body shape: 7 anticipation: neck pulled back away from the facing direction, both thin arms raised; "
            "8 wind-up: neck drawn back further, mouth wide open under the bill, claws high; 9 strike: neck and bill thrust forward "
            "in the facing direction, both claws slashing down in front; 10 follow-through: bill furthest forward, "
            "snapping shut, claws down; 11 recovery: back to the resting pose of ref.png. The bulb body and tail stay "
            "where they are. Cell 12 stays empty magenta."
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
