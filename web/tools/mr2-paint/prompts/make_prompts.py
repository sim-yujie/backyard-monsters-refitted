#!/usr/bin/env python3
"""Writes the Codex prompts for the Map Room 2 painted-landscape art batch (plan section 6).

One family per Codex call. The first line of each prompt file names the mock-up B crops that
`run.sh` attaches with `-i` (made by `crop_refs.py` into the git-ignored `work/refs/`).

  python web/tools/mr2-paint/prompts/make_prompts.py
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent

HEADER = (
    "The attached pictures are crops of a concept painting of a cartoon strategy game world map. "
    "MATCH ITS ART STYLE EXACTLY: bright, painted, toy-like cartoon, saturated yellow-greens and warm "
    "sandy yellows, crisp small painted details, warm sunlight from the top-left. Not photo-real. No text, "
    "no logos, no watermark, no hex lines, no grid lines, no borders, no buildings, no monsters, no number "
    "badges, no frames or labels around the pictures. Ignore the pale hex lines, buildings, monsters and "
    "badges in the attached crops: copy only the ground painting."
)
TEXTURES = (
    "Each square is a SEAMLESS TILEABLE TEXTURE seen from STRAIGHT ABOVE (top-down, only soft painted "
    "shading, no horizon, no perspective, no big single objects, no long cast shadows): its left edge "
    "continues into its right edge and its top edge into its bottom edge, so copies laid side by side show "
    "no seam. The detail is even all over the square (no vignette, no darker or lighter corners, no centre "
    "spot), small and dense, at the scale of the attached crops (a small flower is about 6-10 px in a "
    "square). The four squares touch edge to edge with NO gaps, NO gutters and NO frames between them."
)
GEN = "Use your image generation tool (one call) to create ONE new"
SAVE = "and save it as sheet.png in the current folder. Do not write code, do not draw with scripts."
SQUARE = f"{GEN} SQUARE image (1:1, as large as the tool allows) {SAVE}"
WIDE = f"{GEN} image, landscape 3:2 (as large as the tool allows), {SAVE}"
MAGENTA = "on a FLAT PURE MAGENTA background (#FF00FF) everywhere else"
GRID4 = "THE PICTURE: a 2 x 2 grid of four equal square {what} for the game's painted {where}."

JOBS: dict[str, tuple[list[str], str, list[str]]] = {
    "ground-a": (
        ["meadow2", "hills", "beach", "rocks"],
        SQUARE,
        [
            GRID4.format(what="ground textures", where="landscape"),
            TEXTURES,
            "- Top-left: MEADOW WITH TINY FLOWERS: bright saturated yellow-green cartoon grass with soft lighter "
            "and darker patches and small brush-stroke tufts, sprinkled with tiny white, pink and pale-violet "
            "flowers in small loose clusters, exactly like the meadow in the attached crops.",
            "- Top-right: LUSH MEADOW: the same grass a little deeper and richer green (still bright and "
            "cheerful), denser short tufts, fewer flowers (a very few yellow ones).",
            "- Bottom-left: SAND: warm golden beach sand like the attached beach crop, soft ripples and a few "
            "tiny pebbles and specks, painted, not photo-real.",
            "- Bottom-right: ROCKY GROUND: grey-brown scree and small flat stones packed together with a few "
            "bits of grass and moss between them, like the ground round the foot of the cliff in the attached "
            "crops (no big boulders).",
        ],
    ),
    "ground-b": (
        ["marsh", "forest", "meadow2"],
        SQUARE,
        [
            GRID4.format(what="ground textures", where="landscape"),
            TEXTURES,
            "- Top-left: MARSH MUD: dark olive-brown wet mud with glossy wet highlights, small puddles of dark "
            "water, a few tiny green moss specks and short sprouts, like the ground of the goo marsh in the "
            "attached crop (no reeds, no goo pools, those are separate).",
            "- Top-right: FOREST FLOOR: shaded dark green moss and fallen leaves, little ferns and twigs, soft "
            "dappled light, the ground you would see in a small clearing under the trees of the attached "
            "forest crop (no tree trunks, no treetops).",
            "- Bottom-left: SNOW: bright white snow with soft blue-grey shading and a few small grey rock tips "
            "poking through, cartoon painted.",
            "- Bottom-right: PLAIN MEADOW: the same bright yellow-green cartoon grass as the attached meadow "
            "crop, with soft light and dark patches and small tufts, but NO flowers.",
        ],
    ),
    "sea": (
        ["sea", "beach"],
        SQUARE,
        [
            GRID4.format(what="water textures", where="sea"),
            TEXTURES,
            "- Top-left: TURQUOISE SHALLOWS: clear light turquoise water over pale sand, soft lighter ripple "
            "lines and small sparkles, like the shallow band next to the beach in the attached crops.",
            "- Top-right: DEEP SEA: deep saturated blue water with soft darker and lighter swirls and small "
            "painted wave crests, like the open sea in the attached crop.",
            "- Bottom-left: WET SAND: damp darker golden sand at the water's edge with tiny shells and a few "
            "thin water streaks.",
            "- Bottom-right: SEA FOAM: white lacy surf foam in curving bands and bubbles over the deep blue "
            "water (the foam covers about half of the square, the blue shows between).",
        ],
    ),
    "decals": (
        ["meadow2", "hills", "rocks"],
        SQUARE,
        [
            "THE PICTURE: a sheet of 9 small ground decorations for the painted meadow, in a 3 x 3 grid, each "
            f"one centred in its own cell with plenty of empty space round it, {MAGENTA}. No shadows on the "
            "magenta except a soft small contact shadow right under each piece. Seen from a tilted top-down "
            "camera, at the scale of the attached crops.",
            "- Row 1: three FLOWER PATCHES: a loose cluster of tiny white and pink meadow flowers with a few "
            "grass blades; a cluster of tiny pale-violet and yellow flowers; a small ring of white daisies.",
            "- Row 2: three GRASS TUFTS: a tuft of tall bright yellow-green grass blades; a darker green clump "
            "of grass; a little bush of grass with a few seed heads.",
            "- Row 3: three PEBBLE GROUPS: three small grey rounded pebbles half sunk in grass; a pair of flat "
            "sandy stones; a small mossy grey rock with a tuft beside it.",
        ],
    ),
    "sea-rocks": (
        ["sea", "beach"],
        WIDE,
        [
            "THE PICTURE: a sheet of 8 sea rocks and tiny islets in a 4 x 2 grid, each one centred in its own "
            f"cell with plenty of empty space round it, {MAGENTA}. Seen from a tilted top-down camera like the "
            "attached crops. Each rock stands in the sea: paint a thin ring of white foam and a little "
            "turquoise water hugging its foot, which fades out into the magenta.",
            "- Row 1: a single tall grey sea rock; a pair of rounded grey rocks; a low flat rock shelf; a small "
            "sharp rock.",
            "- Row 2: a tiny rocky islet with a tuft of grass on top; a tiny islet with one small pine tree; a "
            "cluster of three small rocks; a mossy boulder.",
        ],
    ),
    "cliff": (
        ["cliff", "hills", "rocks"],
        WIDE,
        [
            f"THE PICTURE: pieces for painting rocky cliffs into the landscape, {MAGENTA}, seen from a tilted "
            "top-down camera like the attached cliff crop.",
            "- Top half: THREE long horizontal CLIFF FACE STRIPS, one above the other, each running the FULL "
            "WIDTH of the picture (edge to edge, so the strip can repeat sideways with no seam): a grey-brown "
            "rocky cliff face of vertical cracked rock columns, like the cliff in the attached crop, with a "
            "band of bright green grass overhanging its top edge and a few small stones at its foot. Strip 1 "
            "tall and steep, strip 2 lower and more broken, strip 3 mossier with small bushes. Leave a band of "
            "magenta between the strips.",
            "- Bottom half, in a row: two SCREE PATCHES (a spread of grey stones and pebbles thinning out at "
            "the edges, fading into a few grass tufts), and three small ROCKY PEAK pieces (a pointed grey rock "
            "outcrop with a little snow on its tip; a jagged two-point outcrop; a low rounded rock knoll with "
            "grass on its sides), each with magenta round it.",
        ],
    ),
    "canopy": (
        ["forest", "cliff"],
        SQUARE,
        [
            "THE PICTURE: ONE single SEAMLESS TILEABLE TEXTURE filling the whole square: a dense FOREST CANOPY "
            "seen from above at the game's tilted camera, ONE SOLID MASS of rounded cartoon treetops packed "
            "tightly together with no ground showing between them, mixed light yellow-green and deeper greens, "
            "soft shading where crowns meet so the canopy bulges like the attached forest crop, with a few "
            "darker pine tips poking up here and there. Its left edge continues into its right edge and its top "
            "edge into its bottom edge, so copies laid side by side show no seam. Even detail all over (no "
            "vignette, no darker corners, no clearing in the middle). Each rounded crown is about one twelfth "
            "of the square wide.",
        ],
    ),
    "forest-bits": (
        ["forest", "hills"],
        WIDE,
        [
            f"THE PICTURE: forest edge pieces {MAGENTA}, seen from the tilted top-down camera of the attached "
            "crops.",
            "- Top band: ONE long horizontal CANOPY EDGE STRIP running the FULL WIDTH of the picture (edge to "
            "edge, so it can repeat sideways with no seam): the soft rounded outer edge of a dense forest "
            "canopy, the treetops packed solid along its top, its lower edge a bumpy line of rounded crowns "
            "with small soft shadows on the magenta.",
            "- Below it, in two rows of four, 8 single trees, each centred in its own cell with magenta round "
            "it: four round leafy cartoon trees of different sizes and greens, and four pines (two tall, two "
            "small), each with a small soft contact shadow at its foot.",
        ],
    ),
    "marsh-rocks": (
        ["marsh", "rocks"],
        WIDE,
        [
            "THE PICTURE: a sheet of 12 pieces in a 4 x 3 grid, each centred in its own cell with plenty of "
            f"empty space round it, {MAGENTA}, seen from the tilted top-down camera of the attached crops, "
            "each with a small soft contact shadow.",
            "- Row 1: four grey BOULDERS of different sizes and shapes (one big rounded, one cracked flat, a "
            "pair, a mossy one), like the rocks in the attached crops.",
            "- Row 2: four bright toxic-green GOO POOLS lying flat on dark wet mud (irregular blob shapes with "
            "glossy highlights and a dark muddy rim fading out), like the attached marsh crop.",
            "- Row 3: four REED CLUMPS: tall cattail reeds with brown heads, a short reed tuft, a clump of "
            "reeds with a lily pad, a fallen mossy log.",
        ],
    ),
}

if __name__ == "__main__":
    for job, (refs, first, body) in JOBS.items():
        text = "\n".join([f"# refs: {' '.join(refs)}", first, "", HEADER, "", *body]) + "\n"
        (HERE / f"{job}.txt").write_text(text, encoding="utf-8")
        print(job)
