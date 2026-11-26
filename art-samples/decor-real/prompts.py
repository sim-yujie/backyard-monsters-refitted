"""Codex prompts (decor-real): paint one exact block-out render per call, closer to the REAL place (owner 24 Nov:
"Some don't really look similar though"). The real photo goes in as a guide for shapes, colours and carvings
only; the style comes from the real game art.
    python prompts.py <job> <name> <classic|modern>"""
import sys, os
job, name, look = sys.argv[1:4]
PHOTO = {"fort-santiago": "Fort_Santiago.jpg", "paoay-church": "Paoay_Church.jpg",
         "magellans-cross": "Magellans_Cross.jpg", "rizal-monument": "Rizal_Monument.jpg", "windpump": None}
DESC = {
 "paoay-church": "PAOAY CHURCH (Ilocos Norte, a UNESCO baroque church). Its whole body is weathered GREY-WHITE coral stone (pale grey with darker grey weathering streaks and patches; NOT tan, NOT ochre, NOT orange). "
   "The famous HUGE BUTTRESSES running along the nave's side: each a massive curved, scroll-ended stone wedge, as tall as the wall at the top, sweeping down and outward to the ground, with a small pointed stone pinnacle on top; they repeat like a row of giant stone fins. "
   "The long gable roof is RED (deep brick red with a slight rose tint, plain smooth metal-sheet red, not orange clay tiles). "
   "The ornate pale facade: wider than the nave, divided by flat pilasters, a horizontal band, a round-arched dark wooden door, small arched windows, a triangular stepped gable edged with many small pointed pinnacles, and a tiny arched belfry niche at its apex. "
   "The SEPARATE bell tower stands apart on the church's left with open ground between them: white-grey coral stone, three square storeys getting smaller, arched openings, small pointed pinnacles on the corners, a small white dome on top. "
   "The slab around them is paved with worn grey stone flags.",
 "fort-santiago": "FORT SANTIAGO MAIN GATE (Intramuros, Manila). The ornate carved stone GATE FRONT is the hero: weathered GREY stone (grey with darker grey-green weathering, moss in the cracks; not tan). "
   "Lower tier: a round-arched gateway (dark passage), on each side paired carved pilasters and carved stone figures/trophies in shallow niches, a carved stone coat of arms right above the arch, a heavy moulded cornice. "
   "Upper tier: narrower, the big framed carved RELIEF of Saint James (Santiago) on a rearing horse with a raised sword, between pilasters, with large carved stone SCROLLS (volutes) curling down either side onto the lower cornice, and pointed stone pinnacles on the cornice ends. "
   "On top a triangular pediment with a carved centre and a pointed finial. The fort walls either side are only short, plain, dark grey stone stubs with a low parapet, lower than the gate. The slab is paved with worn stone flags.",
 "magellans-cross": "MAGELLAN'S CROSS KIOSK (Cebu City): a squat OCTAGONAL chapel with SOLID whitewashed walls (white with faint grey weathering), one big round-arched opening in each wall closed by a black wrought-iron grille, a moulded white cornice. "
   "The steep eight-sided roof of DARK MAROON-BROWN clay tiles (old weathered terracotta, dark red-brown, rows of curved tiles), with wide eaves, and a small black iron cross on the apex. "
   "Inside, seen through the grilles, the tall dark WOODEN CROSS on a low white pedestal. A low grey stone step runs round the kiosk; the slab is paved with grey stone.",
 "rizal-monument": "THE RIZAL MONUMENT (Luneta Park, Manila): a tall SLIM GREY GRANITE OBELISK with a small pyramid tip and three small gold stars near its top; it stands on a tapering stepped granite base (many low courses) on a wide low stepped platform. "
   "On top of the base, at the obelisk's foot, the DARK BRONZE sculpture group: Jose Rizal standing in front in a long overcoat holding a book, with bronze figures either side of him (on one side a mother holding a child, on the other a father with a boy reading). A small bronze plaque on the base. All stone is grey granite; the slab is grey stone.",
 "windpump": "A GARDEN WINDPUMP TOWER (only its still parts): a splayed four-leg wooden tower of planks with X braces and horizontal rails, iron shoes at the feet and iron corner plates with rivets, a square wooden platform on top, a small iron gearbox on it, a short round wooden hub shaft pointing to the lower left (it ENDS BARE: draw NO wheel, NO blades, NO fan; a wheel is added later), and at the back a thin iron rod to a flat red sheet-metal tail vane.",
}
STYLE = {
 "classic": """THE LOOK: the 2009 Flash game Backyard Monsters (see the REAL decorations in ref-flash-wonders-3x.png and ref-flash-all-3x.png): a small PRE-RENDERED 3D MODEL (late-2000s CG, like a 3ds Max render): soft grain, weathered real-looking materials, no flat fills, no glossy airbrushing, no cel shading, no outline. One soft key light from the upper left: the right-hand faces fall into DEEP shadow (darkest parts near-black), gentle ambient occlusion in creases. Natural, muted, dusty palette; white and grey-white stone stays a soft dusty grey-white in light and mid grey in shade, never pure white; no candy colours, no glow.""",
 "modern": """THE LOOK: the "Modern" look of our game Backyard Monsters Revamped (see ref-modern-wonders.png and ref-modern-all.png, REAL Modern art): a crisp, clean, stylised 3D render with bevelled highlights on edges, readable shading, richer but not candy colours (saturation like the Modern buildings), light from the upper left, right-hand faces clearly shaded but not black, no outline, no glow. White stone reads as clean warm-grey white with soft blue-grey shade, never blown out.""",
}
photo = PHOTO[name]
ph = (f"\n{photo} is a PHOTO of the real place. Use it ONLY to get the parts, their colours and the carvings right, so players recognise it. Its camera angle is different and irrelevant; never copy its angle, perspective or framing, and never paste or trace photo texture: everything is painted in the game look below.\n"
      if photo else "\nwindpump-old.png shows our earlier drawing of the same windpump in this look, ONLY for its materials and colours. Its angle is WRONG (its platform is turned); never copy its angle or outline; the render decides those.\n")
r = f"""Generate an image using your image generation tool (one image only, do not make variations or extra files).

This is an EDIT job, not a new drawing. The first attached image, blockout-{name}.png (1024x1024, magenta background), is an exact 3D render of a yard decoration at our game's fixed camera: a parallel (orthographic) view, no perspective, turned 45 degrees and looking down from 30 degrees above the ground. It is plain clay with rough colours. Repaint it as the finished game picture.

KEEP THE GEOMETRY EXACTLY (this is the whole point of the job):
- Every wall, edge, corner, roof line, step, arch, buttress, pinnacle and ornament stays EXACTLY where it is in blockout-{name}.png: same position, same size, same angle, same outline. Trace over it. Do not move, turn, re-proportion, enlarge, simplify or re-imagine anything, do not add perspective, do not turn any face toward the viewer.
- Horizontal edges keep running at the render's angles (2 pixels across for 1 up, like the slab's edges); vertical edges stay vertical; parallel edges stay parallel.
- {"The square slab at the bottom keeps its exact outline." if name != "windpump" else "The four feet stay exactly where they are."}
- Only STATUES, FIGURES and RELIEFS are rough lumps in the render: sculpt them properly as the real ones, in the same place, at the same size, staying inside roughly the same space.
- Keep the magenta (#FF00FF) background flat and clean around the object; no cast shadow on it, no ground, no grass outside the object.

WHAT TO ADD: real surface materials and small surface detail painted ONTO the existing shapes (stone blocks, mortar, carvings, tiles, wood grain, rivets, moss, weathering), and the lighting of the look below.
The object: {DESC[name]}
{ph}
{STYLE[look]}

No text, no labels, no frame, no outline. Output one 1024x1024 image: the repainted object exactly over the render's footprint on flat magenta.
Save the final PNG as {name}-{look}.png in the current working directory.
"""
os.makedirs(job, exist_ok=True)
open(f"{job}/prompt.txt", "w").write(r)
