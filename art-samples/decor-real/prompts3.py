"""Codex prompts, multi-photo pass (owner, Desk 8, 24 Nov 2026: "can you use more than 1 reference photo at different
angles so as to give a proper render? My concern with this is a wrong image leading to offending my players").
Each call paints one exact block-out render (bo3/, remodelled from several measured photos) and gets a sheet of six
verified photos from different angles (refs/sheets/photos-<name>.png) plus a MUST-BE-RIGHT list drawn from them.
    python prompts3.py <job> <name> <classic|modern>"""
import sys, os
job, name, look = sys.argv[1:4]
TITLE = {"paoay-church": "PAOAY CHURCH (San Agustin Church, Paoay, Ilocos Norte; a UNESCO World Heritage baroque church)",
         "fort-santiago": "THE MAIN GATE OF FORT SANTIAGO (Intramuros, Manila)",
         "magellans-cross": "THE KIOSK OF MAGELLAN'S CROSS (Cebu City)",
         "rizal-monument": "THE RIZAL MONUMENT (Rizal Park / Luneta, Manila; Jose Rizal is the Philippine national hero)"}
MUST = {
 "paoay-church": [
  "The BELL TOWER stands APART, on the facade's left (upper left in the render), level with the facade: square and stocky, three storeys each a little narrower than the one below with a ledge between them, one round-arched opening per face on the two upper storeys, a small arched door at the foot, a LOW ROUNDED DOME on top with small pointed finials on its four corners. NO cross on the tower.",
  "The FACADE is wide with a near-triangular outline: a lower tier divided by tall flat pilasters with the round-arched dark wooden door in the middle; a narrower second tier with three small arched windows; a broad triangular gable with small pointed stone finials stepping up both edges and a carved panel in its middle; at the apex a tiny square belfry with one arched opening and a small pyramid top. NO cross on the facade.",
  "HUGE SLOPING CORNER BUTTRESSES flank the facade on both sides, sweeping out to the ground, with a big carved SPIRAL (volute) near their foot.",
  "Along the nave's right side a ROW OF MASSIVE BUTTRESSES: each tall at the wall, sweeping down and outward to a rounded foot, a carved SPIRAL DISC on its side face and a small pointed finial on top (photos 4 and 6).",
  "The ROOF is long, plain, low-pitched, deep CRIMSON-RED sheet metal (not clay tiles, not orange), its ridge lower than the gable's apex.",
  "COLOUR: pale weathered GREY coral stone and lime (photos 1-4 and 6: light grey with darker grey and brown-grey weathering streaks, faint brick-red patches, a little green moss). NOT bright white, NOT tan, NOT orange. Photo 5 was taken just after a whitewash in 2021: use it for SHAPE only, not colour.",
 ],
 "fort-santiago": [
  "The LONG, DARK CURTAIN WALL runs out on both sides in the gate's own plane: big rough-hewn stone blocks, very dark grey-brown with green moss and stains, a sloping (battered) face, its top level with the gate's lower cornice, a low plain parapet on top (photos 1-4). It is much darker than the gate.",
  "The GATE itself is PALE weathered grey-beige carved stone with dark weathering in the recesses and a little moss.",
  "LOWER TIER: a round-arched passage with a moulded arch frame; paired carved pilasters each side; a tall strip of carved figures at each outer end; sloping (battered) flanks either side; a heavy moulded cornice on top.",
  "Over the arch the large CROWNED ROYAL COAT OF ARMS (a crowned shield quartered with castles and lions, photo 5), and a SMALLER crowned shield on each side of the arch. All carved in the same stone (no paint, no gold, no invented emblems).",
  "UPPER TIER: the big framed RELIEF of SAINT JAMES (Santiago) on a rearing horse with a raised sword (photo 6), between pilasters, with big carved scroll volutes and sloping wings down to the lower cornice, and tall pointed obelisk FINIALS on the lower cornice's two ends.",
  "On top a low triangular PEDIMENT with a carved centre, a pointed finial at its apex and small finials at its corners.",
 ],
 "magellans-cross": [
  "An OCTAGONAL kiosk built of COURSED CORAL-STONE BLOCKS: pale grey-cream with visible block joints and darker grey weathering (photos 1-3, 5). NOT smooth white plaster.",
  "Plain CORNER PILASTERS at every angle, a frieze band and a moulded cornice under the eaves, a low plinth.",
  "One big ROUND ARCH in every face. The side arches are closed by BLACK WROUGHT-IRON GATES: vertical bars, a solid dark lower panel, scrollwork and radiating bars filling the arch head (photo 5). The front arch (toward the viewer) stands open; a plain black plate hangs in its arch head: leave that plate BLANK, no letters.",
  "The ROOF: DARK RED-BROWN old clay tiles laid in curved rows (weathered terracotta with lighter and darker tiles), slightly flared eaves, a ridge line on each of the eight hips, and on the apex a small finial with a small UPRIGHT dark iron CROSS with ornamental (budded) ends.",
  "Inside, through the open front arch: the tall stepped octagonal PEDESTAL of the cross in pinkish-brown marble, the dark wooden cross rising from it (photo 6).",
 ],
 "rizal-monument": [
  "A slim GREY GRANITE OBELISK with a small pyramid tip. Near the top of its FRONT face (the face toward the lower left) EXACTLY THREE GOLD STARS arranged in a triangle: one above, two side by side below (photo 3). No other stars anywhere.",
  "Under the bronze group a plain grey granite UPPER PEDESTAL with a moulded cap. (On the real one the name is carved there: leave it BLANK, no letters.)",
  "The BASE: a tall, sloping (tapering) granite base of big rough-faced blocks in courses, a moulded ledge on top, a dark bronze PLAQUE on its front (BLANK, no letters), on a low plinth and two wide granite steps.",
  "The DARK BRONZE sculpture: JOSE RIZAL standing at the front centre facing out, in a long buttoned overcoat, holding a book at his side, upright and dignified (photo 6). At the front's LEFT corner a seated MOTHER holding her child (photo 4); against the obelisk's RIGHT-hand face TWO SEATED BOYS reading one book together as ONE compact group (photo 5); nothing behind the obelisk (owner 26 Nov: one figure group on each side of Rizal).",
  "Figures realistic and respectful in proportion; faces simple at this size, never cartoonish or exaggerated.",
  "Granite is a light warm grey; the bronze dark brown-black with soft highlights.",
 ],
}
STYLE = {
 "classic": """THE LOOK: the 2009 Flash game Backyard Monsters (see the REAL decorations in ref-flash-wonders-3x.png and ref-flash-all-3x.png): a small PRE-RENDERED 3D MODEL (late-2000s CG, like a 3ds Max render): soft grain, weathered real-looking materials, no flat fills, no glossy airbrushing, no cel shading, no outline. One soft key light from the upper left: the right-hand faces fall into DEEP shadow (darkest parts near-black), gentle ambient occlusion in creases. Natural, muted, dusty palette; pale stone stays a soft dusty grey in light and mid grey in shade, never pure white; no candy colours, no glow.""",
 "modern": """THE LOOK: the "Modern" look of our game Backyard Monsters Revamped (see ref-modern-wonders.png and ref-modern-all.png, REAL Modern art): a crisp, clean, stylised 3D render with bevelled highlights on edges, readable shading, richer but not candy colours (saturation like the Modern buildings), light from the upper left, right-hand faces clearly shaded but not black, no outline, no glow. Pale stone reads as clean warm grey with soft blue-grey shade, never blown out to white.""",
}
must = "\n".join(f"{i + 1}. {m}" for i, m in enumerate(MUST[name]))
r = f"""Generate an image using your image generation tool (one image only, do not make variations or extra files).

This is an EDIT job, not a new drawing. The first attached image, blockout-{name}.png (1024x1024, magenta background), is an exact 3D render of a yard decoration at our game's fixed camera: a parallel (orthographic) view, no perspective, turned 45 degrees and looking down from 30 degrees above the ground. It is plain clay with rough colours, modelled from measured photos of a REAL landmark. Repaint it as the finished game picture.

The landmark: {TITLE[name]}. Most of our players are Filipino and know it well: it must be recognisable and CORRECT. Never invent details, symbols, text or colours that the real place does not have, and never leave out the ones listed below.

KEEP THE GEOMETRY EXACTLY (this is the whole point of the job):
- Every wall, edge, corner, roof line, step, arch, buttress, pinnacle and ornament stays EXACTLY where it is in blockout-{name}.png: same position, same size, same angle, same outline. Trace over it. Do not move, turn, re-proportion, enlarge, simplify or re-imagine anything, do not add perspective, do not turn any face toward the viewer.
- Horizontal edges keep running at the render's angles (2 pixels across for 1 up, like the slab's edges); vertical edges stay vertical; parallel edges stay parallel.
- The square slab at the bottom keeps its exact outline.
- Only STATUES, FIGURES, RELIEFS and COATS OF ARMS are rough lumps in the render: sculpt them properly as the real ones, in the same place, at the same size, staying inside roughly the same space.
- Keep the magenta (#FF00FF) background flat and clean around the object; no cast shadow on it, no ground, no grass outside the object.

photos-{name}.png is a sheet of SIX real photos of this landmark from different angles (numbered 1-6). Use them to get the parts, materials, carvings and colours right. Their camera angles are different and irrelevant: never copy a photo's angle, perspective or framing, never paste or trace photo texture, and ignore the people, trees, lamps, signs and buildings around it. Everything is painted in the game look below, on the render's shapes.

MUST BE RIGHT (check each one before you finish):
{must}

WHAT TO ADD: real surface materials and small surface detail painted ONTO the existing shapes (stone blocks, mortar, carvings, tiles, metal, weathering, moss), and the lighting of the look below.

{STYLE[look]}

No text or lettering anywhere (plates and plaques stay blank), no labels, no frame, no outline, no flags, no people. Output one 1024x1024 image: the repainted object exactly over the render's footprint on flat magenta.
Save the final PNG as {name}-{look}.png in the current working directory.
"""
os.makedirs(job, exist_ok=True)
open(f"{job}/prompt.txt", "w").write(r)
