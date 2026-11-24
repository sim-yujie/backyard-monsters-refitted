"""Codex prompts: paint one exact block-out render per call (prompt.txt in job folder <job>)
    python prompts.py <job> <wonder> <classic|modern>"""
import sys, os
job, name, look = sys.argv[1:4]
DESC = {
 "fort-santiago": "FORT SANTIAGO GATE (Manila) (the slab top INSIDE the two walls, the courtyard behind the gate, is paved with the same worn stone flags as the rest of the slab, never left plain): weathered grey-brown and ochre stone blocks with moss in the cracks. The gatehouse: a round-arched gateway with heavy dark-brown wooden double doors set back in the arch, carved pilasters, above the arch a carved stone relief of a rider on a rearing horse and below it a small carved coat of arms, the curved pediment on top with stone balls. The fortress walls left and right: big rough stone blocks, flat walkway on top, pointed stone finials on their square bases.",
 "paoay-church": "PAOAY CHURCH (Ilocos): massive old church of weathered ochre-brown coral stone and red-brown brick with moss patches. The huge stepped gable facade with pilasters, pointed finials and a small dark arched door; a red clay-tiled roof; the huge stepped buttresses along its side like giant stairs; the separate square bell tower of three storeys with arched openings (a bell visible in one), and a small red-brown dome.",
 "magellans-cross": "MAGELLAN'S CROSS (Cebu): the open octagonal off-white stone pavilion with round arches, a red clay-tiled eight-sided roof with a small cupola and a ball on top, a tall dark wooden cross inside on a round stone pedestal; two square grey stone steps all round.",
 "pyramids": "THE GREAT PYRAMID AND THE SPHINX: the sandy limestone pyramid made of stepped courses of stone blocks with a slightly worn tip; the Sphinx lying in front (lion body with paws forward, human head with a striped headdress, sandy tan stone, no bright colours); pale desert sand and stone ground slab.",
 "taj-mahal": "THE TAJ MAHAL: white marble with a faint warm cream tint: a square plinth, the main hall with chamfered corners and a big pointed-arch recess (iwan) on each face with smaller pointed arches beside it, a central onion dome on a drum with a gold finial, four small domed kiosks on the roof corners, four slim minarets with balconies and small domes on the plinth corners.",
 "rizal-monument": "THE RIZAL MONUMENT (Manila): a tall grey granite obelisk with a small pyramid tip and three small gold stars near the top, on a granite pedestal and three square granite steps; a dark bronze statue of Jose Rizal standing in a long overcoat holding a book in front of the obelisk; dark bronze seated figures on the steps (a mother holding a child on the left, a boy reading a book on the right).",
}
STYLE = {
 "classic": """THE LOOK: the 2009 Flash game Backyard Monsters (see ref-flash-wonders-3x.png and ref-flash-all-3x.png, the REAL decorations): a small PRE-RENDERED 3D MODEL (late-2000s CG, like a 3ds Max render): soft grain, weathered real-looking materials, no flat fills, no glossy airbrushing, no cel shading, no outline. One soft key light from the upper left: the right-hand faces fall into DEEP shadow (darkest parts near-black), gentle ambient occlusion in creases. Natural, muted, dusty, fairly DARK palette; no candy colours, no glow.""",
 "modern": """THE LOOK: the "Modern" look of our game Backyard Monsters Revamped (see ref-modern-wonders.png and ref-modern-all.png, REAL Modern art): a crisp, clean, stylised 3D render with bevelled highlights on edges, readable shading, richer but not candy colours (saturation like the Modern buildings), light from the upper left, right-hand faces clearly shaded but not black, no outline, no glow.""",
}
r = f"""Generate an image using your image generation tool (one image only, do not make variations or extra files).

This is an EDIT job, not a new drawing. The first attached image, blockout-{name}.png (1024x1024, magenta background), is an exact 3D render of a yard decoration at our game's fixed camera: a parallel (orthographic) view, no perspective, turned 45 degrees and looking down from 30 degrees above the ground. It is plain clay. Repaint it as the finished game picture.

KEEP THE GEOMETRY EXACTLY (this is the whole point of the job):
- Every wall, edge, corner, roof line, step, arch and ornament stays EXACTLY where it is in blockout-{name}.png: same position, same size, same angle, same outline. Trace over it. Do not move, turn, re-proportion, enlarge, simplify or re-imagine anything, do not add perspective, do not turn any face toward the viewer.
- Horizontal edges keep running at the render's angles (2 pixels across for 1 up, like the slab's edges); vertical edges stay vertical; parallel edges stay parallel.
- The square slab at the bottom keeps its exact outline, painted in the object's own base material.
- Only the STATUES and FIGURES (people, the Sphinx, the bronze figures) are rough lumps in the render: sculpt them properly as the real figures, in the same place, at the same size and facing the same way, staying inside roughly the same space.
- Keep the magenta (#FF00FF) background flat and clean around the object; no cast shadow on it, no ground, no grass outside the slab.

WHAT TO ADD: real surface materials and small surface detail painted ONTO the existing shapes (stone blocks, mortar, carvings, tiles, wood grain, moss, weathering), and the lighting of the look below.
The object: {DESC[name]}
design-{name}.png shows the same object as we drew it before, ONLY for its materials, colours and carved details. Its angle and shape are WRONG; never copy its angle, outline or proportions; the render decides those.

{STYLE[look]}

No text, no labels, no frame, no outline. Output one 1024x1024 image: the repainted object exactly over the render's footprint on flat magenta.
Save the final PNG as {name}-{look}.png in the current working directory.
"""
os.makedirs(job, exist_ok=True)
open(f"{job}/prompt.txt", "w").write(r)
