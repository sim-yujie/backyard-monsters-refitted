"""Writes the Classic redraw prompts for sheets c, d, e (two wonders per sheet, like sheet b)."""
import os
ITEMS = {
 "paoay-church": "PAOAY CHURCH: the wide, low, massive old church of weathered ochre-brown coral stone and red-brown brick with moss patches. Its huge stepped triangular front gable (pilasters, small pointed finials, a small dark arched door) is the church's LEFT-FRONT wall: it runs along the slab's front-left edge, so it is seen at an angle like Big Ben's left face, NOT facing the camera. Along the right-front wall (along the slab's front-right edge) the row of huge stepped buttresses like giant stairs; a red tiled roof behind the gable; the separate square three-storey bell tower with arched openings and a small dome stands at the slab's RIGHT corner, its walls parallel to the slab edges. On a low weathered grey stone slab.",
 "fort-santiago": "FORT SANTIAGO GATE: the tall grey-brown stone gateway with its round arch, heavy dark wooden doors, the carved relief of a rider on a rearing horse above the arch, a carved coat of arms, a curved pediment with stone balls on top and pointed stone ornaments on the wall corners. The gateway is the LEFT-FRONT wall: it runs along the slab's front-left edge, seen at an angle like Big Ben's left face, NOT facing the camera; a short thick fortress wall continues along the slab's front-right edge from the gate's right end (a corner of the fort). On a low weathered grey stone slab.",
 "magellans-cross": "MAGELLAN'S CROSS: the open octagonal off-white stone pavilion with arched openings, a red clay-tiled eight-sided roof and small cupola, a tall dark wooden cross inside; two low square stone steps all round, parallel to the slab edges. On a low weathered grey stone slab.",
 "pyramids": "THE GREAT PYRAMID AND THE SPHINX: the square-based sandy limestone pyramid with stepped courses; its four base edges exactly parallel to the slab edges and its tip straight above the slab's centre, so its left and right faces show equally. The Sphinx (lion body, human head with striped headdress, sandy tan) lies in front of the pyramid near the slab's LEFT corner, facing the lower left, and stays INSIDE the slab outline. The slab is pale desert sand and stone, LOW.",
 "chocolate-hills": "CHOCOLATE HILLS: about seven round dome-shaped hills of dry chocolate-brown grass with narrow green grass and two or three small round trees between them. The base is VERY LOW, as thin as the guide slab: the green grass comes right down to the slab's edge and rounds over it, with only a thin dark earth rim at the bottom, so the scene looks set into the ground, NOT a tall cut-out block of soil.",
 "banaue-terraces": "BANAUE RICE TERRACES: the small rounded mountain of narrow stepped terraces held by low stone-and-earth walls, bright green rice strips with a little shiny water, a tiny dark wooden Ifugao hut on posts with a steep golden thatched roof near the top, the mountain's peak above the slab's centre. The base is VERY LOW, as thin as the guide slab: the terraces and grass reach right down to the slab edge, only a thin dark earth rim at the bottom, NOT a tall cut-out block of soil.",
}
SHEETS = {"c": ["paoay-church", "fort-santiago"], "d": ["magellans-cross", "pyramids"], "e": ["chocolate-hills", "banaue-terraces"]}
HEAD = """Generate an image using your image generation tool (one image only, do not make variations or extra files).

We are REDRAWING two "wonder" yard decorations for the 2009 Flash game Backyard Monsters. The first versions were drawn at the WRONG ANGLE: turned off the game's grid and seen from too low, so in the game they look crooked and seem to float. This time the angle must be exactly right.

The attached images:
- classic-guide-{k}.png: THE LAYOUT AND ANGLE GUIDE. Canvas 1536x1024, 2 columns of 768x1024 cells, magenta background. In each cell a plain grey square slab: that slab is EXACTLY the square base each object must stand on, at exactly that position, size and angle. Keep every slab's outline exactly where it is (front, left, right and back corners) and build the object on top of it, painting the slab in the object's own base material.
- classic-old-{k}.png: the two objects as drawn before, in the same positions, scaled to the same base size. Keep their design, parts, materials, colours and how big each object is compared with its base. ONLY their angle was wrong (turned, seen from too low): do NOT copy their angle.
- ref-flash-wonders-3x.png and ref-flash-all-3x.png: the REAL Flash decorations (Statue of Liberty, Eiffel Tower, Big Ben...). Their rendering and camera are the target. The three wonders are gold; take from them only the rendering and camera, the new ones keep their own real colours.

THE ANGLE (most important, check it before you finish):
1. True 2:1 isometric game camera, about 30 degrees above the ground, exactly like the guide slabs and the Statue of Liberty's plinth: every edge of a square base runs 2 pixels across for every 1 pixel up (about 26.6 degrees from horizontal); the front corner points straight down in the middle of the cell; the left and right corners are at exactly the same height, so the left side and the right side of the base show EQUALLY.
2. Everything sits square on its base: walls, roof edges, steps and courses of stone run parallel to the base edges (the same two 26.6-degree directions); vertical things stay exactly vertical. Nothing is turned to face the camera.

What the Flash decorations have in common (follow every point):
- Small PRE-RENDERED 3D MODELS (late-2000s CG, like a 3ds Max render) shrunk to sprite size: soft grain, weathered stone, dull bronze, sand, grass, bare earth. No flat fills, no glossy airbrushing, no cel shading. No outline.
- One soft key light from the upper left; right-hand and lower faces in DEEP shadow (darkest parts near-black); gentle ambient occlusion in creases and a dark contact line where the base meets the ground.
- Natural, muted, dusty, fairly DARK palette. No candy or neon colours, no glow.
- No cast shadow, no loose ground or grass outside the base (the game adds its own shadow). No text, no faces on natural things.

The two:
- Column 1: {a}
- Column 2: {b}

Each object as big compared with its base as in classic-old-{k}.png, nothing touching or crossing a cell edge. The whole sheet on flat solid magenta (#FF00FF), no grid lines, no text, no labels, no frame, no drop shadows.
Save the final PNG as wonders-classic-{k}.png in the current working directory.
"""
for k, (a, b) in SHEETS.items():
    os.makedirs(f"c{k}", exist_ok=True)
    open(f"c{k}/prompt.txt", "w").write(HEAD.format(k=k, a=ITEMS[a], b=ITEMS[b]))
