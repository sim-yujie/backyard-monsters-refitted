"""Codex prompt for the Rizal figure fix (owner 26 Nov 2026: "The figures are supposed to be one on each side. The
current one has 3 on one side."). An EDIT of the current game picture: only the right-hand bronze group changes.
    python3 prompts.py <job> <classic|modern> <A|Bface>"""
import os, sys
job, look, lay = sys.argv[1:4]
RIGHT = {
 "A": "ONE seated BOY (about 12 years old, short hair, plain shirt and short trousers) sitting on the pedestal top against "
      "the obelisk's RIGHT-HAND face, bent forward over an OPEN BOOK held on his lap, reading. Just the one boy: no second "
      "child, no leaves, no pot, nothing else on that side.",
 "Bface": "the TWO seated BOYS reading ONE open book together (photo 5), sitting shoulder to shoulder on the pedestal top "
          "against the obelisk's RIGHT-HAND face, heads bent close over the book held between them, so the pair reads as "
          "ONE compact group, no wider than the mother's group on the left. No leaves, no pot, nothing else on that side.",
}
STYLE = {
 "classic": "the 2009 Flash look of the picture you are given: soft grain, muted dusty stone, near-black shade, no outline",
 "modern": "the crisp clean Modern look of the picture you are given: bevel highlights, clean warm-grey stone, no outline",
}
r = f"""Generate an image using your image generation tool (one image only, do not make variations or extra files).

This is a small EDIT of an existing game picture, not a new drawing. The picture is a yard decoration of THE RIZAL
MONUMENT (Rizal Park / Luneta, Manila; Jose Rizal is the Philippine national hero) in our game Backyard Monsters.
Most of our players are Filipino: the sculpture must be correct and respectful.

Attached images:
1. guide-{look}-{lay}.png: THE IMAGE TO EDIT (1024x1024, flat magenta background). It is the current picture with the
   old right-hand figures cut out: where they were, the stone is a blurry smear and new rough dark-brown CLAY LUMPS
   show where the new figure goes.
2. current-{look}.png: the same picture BEFORE the cut, untouched (for the exact style, colours and detail of the
   stone and the bronze figures that stay).
3. photos-rizal-monument.png: six real photos (numbered). Photo 4 = the mother's side, photo 5 = the boys' side,
   photo 6 = Rizal from the front. Use them for what the figures look like only; never copy a photo's angle.

WHAT TO CHANGE (only this):
- Paint the clay lumps as {RIGHT[lay]}
  Same dark brown-black bronze, the same size scale and the same level of detail as the mother and Rizal.
  Keep the figure inside roughly the space of the lumps: sitting on the pedestal top, to the right of the obelisk.
- Repaint the blurry smear as clean stone that matches its surroundings exactly: the obelisk's shaded right face
  continuing straight down to the pedestal top, the pedestal's flat top surface, and its edges and moulding.
- Behind and right of the obelisk where there is no stone, flat magenta (#FF00FF).

KEEP EXACTLY AS IN IMAGE 1 (do not redraw, move, resize or restyle): JOSE RIZAL standing at the front centre in his
overcoat with a book; the seated MOTHER holding her child on the left; the obelisk, its pyramid tip and the THREE gold
stars; the pedestal, the tapering block base, the blank bronze plaque, the plinth and the steps; the camera angle,
the framing, the outline of the whole object, the lighting from the upper left and the colours. Every pixel outside
the edited area should stay the same.

The result must read as ONE figure group on each side of Rizal: the mother on the left, the {"boy" if lay == "A" else "two boys as one group"} on the right.
Style: {STYLE[look]}. Faces simple at this size, never cartoonish. No text or lettering, no ground, no shadow on the
magenta, no extra objects. Output one 1024x1024 image with the object at exactly the same place and size as image 1.
Save the final PNG as rizal-{look}-{lay}.png in the current working directory.
"""
os.makedirs(job, exist_ok=True)
open(f"{job}/prompt.txt", "w").write(r)
