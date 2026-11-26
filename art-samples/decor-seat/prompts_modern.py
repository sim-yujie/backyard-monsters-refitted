"""Writes the Modern redraw prompts (sheets g-j): each new Classic wonder redrawn in the Modern look at exactly
the same place, angle and size."""
import os
ITEMS = {
 "paoay-church": "PAOAY CHURCH: ochre-brown coral stone and red-brown brick with a few moss patches, the stepped triangular front gable with pilasters, small pointed finials and a small arched door on the lit left-facing wall, the red-brown tiled roof, the huge stepped buttresses along the shaded right wall, the square bell tower with arched openings and a small terracotta dome behind on the right; low grey stone slab.",
 "fort-santiago": "FORT SANTIAGO GATE: grey-brown weathered stone gateway with a round arch and dark wooden doors with iron straps, the carved relief of a rearing horse, a small coat of arms, a curved pediment with stone balls, thick fortress walls with pointed stone ornaments; low grey stone slab.",
 "magellans-cross": "MAGELLAN'S CROSS: open octagonal off-white stone pavilion with arched openings, red clay-tiled eight-sided roof with a small cupola, a tall dark wooden cross inside, two low square stone steps; low grey stone slab.",
 "pyramids": "THE GREAT PYRAMID AND THE SPHINX: sandy beige limestone pyramid in stepped courses, the Sphinx (lion body, human head with striped headdress) lying in front on the left; low base of pale sand-coloured stone.",
 "chocolate-hills": "CHOCOLATE HILLS: seven smooth round dome-shaped hills of dry chocolate-brown grass, green grass between them with a few small round trees; the base stays as LOW as in the Classic version: grass right down to the edge, only a thin dark earth rim.",
 "banaue-terraces": "BANAUE RICE TERRACES: a small rounded mountain of narrow stepped terraces with low grey stone and earth walls, glossy green rice strips with a little shiny blue-grey water, a tiny wooden Ifugao hut on posts with a steep golden thatched roof near the top; the base stays as LOW as in the Classic version: only a thin dark earth rim.",
 "mayon-volcano": "MAYON VOLCANO: a near-perfect symmetrical cone, lower slopes deep green forest, upper slopes grey-brown ash with dark gullies, a small crater with a soft grey-white wisp of steam; the base stays as LOW as in the Classic version: forest right down to the edge, only a thin dark earth rim.",
 "rizal-monument": "RIZAL MONUMENT: tall slender grey granite obelisk with three small gold stars near the top on a big square stepped granite base, a dark bronze statue of a man in a long overcoat holding a book in front of it, smaller dark bronze figures (a seated mother with a child, a boy reading) at the foot of the base.",
}
SHEETS = {"g": ["paoay-church", "fort-santiago"], "h": ["magellans-cross", "pyramids"],
          "i": ["chocolate-hills", "banaue-terraces"], "j": ["mayon-volcano", "rizal-monument"]}
HEAD = """Generate an image using your image generation tool (one image only, do not make variations or extra files).

The attached images:
- classic-new-{k}.png: two new "wonder" yard decorations (miniature landmarks) of our game in its OLD (Classic, Flash-style) look, on a 1536x1024 magenta sheet of 2 columns (768x1024 cells). They are at exactly the right camera, angle, position and size.
- ref-modern-wonders.png: the REAL "Modern look" decorations of our game (Backyard Monsters Revamped): Statue of Liberty, Eiffel Tower, Big Ben, Tea Garden, Zen Garden. ref-modern-all.png: the REAL Modern yard buildings. All are clean stylised 3D renders.
NOTE: the three Modern wonders are gold; take from them only the rendering, camera and plinth. The new wonders keep the REAL colours of their Classic versions (stone, brick, sand, grass), NOT gold.

Job: redraw EACH of the two in classic-new-{k}.png in the MODERN look, at EXACTLY the same position, size and angle on the sheet (trace it: the same outline of the square base, the same front, left, right and back corners, the same walls in the same directions, the same heights). Each must be clearly the SAME object: same parts, same shape and proportions, same colours of each part, same facing; only the rendering style changes.

THE ANGLE must stay exactly as in classic-new-{k}.png: a true 2:1 isometric game camera; every square base edge runs 2 pixels across for every 1 pixel up; the base's front corner points straight down in the middle of its cell and its left and right corners are at the same height; vertical things exactly vertical. Do not turn anything towards the camera.

The Modern look (follow every point):
1. Clean, modern, stylised 3D renders like the attached Modern decorations, not paintings and not the soft, grainy, dusty Classic look. Smooth, slightly bevelled shapes, crisp clean silhouettes, clean simple materials with little surface noise. No cel shading, no brush strokes, no flat colour fills.
2. No outline at all. Crisp anti-aliased edges; small bevels catch the light as thin bright lines.
3. LIGHTING: like a Blender Cycles scene with ONE warm sun lamp from the upper left and only a dim cool fill: tops and left-facing sides bright, right-facing sides clearly in deep shade (about 25-35% as bright as the lit side, still readable); strong ambient occlusion where parts meet and a dark contact line where the base meets the ground.
4. Colour: the Modern decorations' rich but slightly DEEP tones, not candy-bright. No neon, no glow.
5. No ground, grass, cast shadow or anything outside the base beyond what the Classic version has.

The two:
- Column 1: {a}
- Column 2: {b}

The whole sheet on flat solid magenta (#FF00FF), no grid lines, no text, no labels, no frame, no drop shadows.
Save the final PNG as wonders-modern-{k}.png in the current working directory.
"""
for k, (a, b) in SHEETS.items():
    os.makedirs(f"m{k}", exist_ok=True)
    open(f"m{k}/prompt.txt", "w").write(HEAD.format(k=k, a=ITEMS[a], b=ITEMS[b]))
