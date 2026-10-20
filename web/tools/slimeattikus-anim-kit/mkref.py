import sys,os
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-slimeattikus/server/public/assets/monsters/slimeattikus-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*192,0,n*192+192,124))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((576,372),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
os.makedirs(f'h{n}',exist_ok=True)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
def facing_text(n):
    if n==0: return 'seen in side profile facing screen-right: only ONE fanged mouth is visible, at the right edge of the blob, with one orange slit eye above it at the upper right; the second mouth and second eye are hidden round the far side; the blob trails to the left'
    if n<=3: return 'seen three-quarter from the front-right: both fanged mouths are on the right half of the blob (the left mouth partly foreshortened), two orange slit eyes high on the right, the lumpy body trailing left'
    if n<=5: return 'seen from the front, turned slightly to screen-right: two fanged mouths side by side just right of centre, two orange slit eyes above them'
    if n<=10: return 'seen head-on from the front: two big fanged mouths side by side in the middle of the front, two orange slit eyes above them, looking straight at the viewer'
    if n<=13: return 'seen from the front, turned slightly to screen-left: two fanged mouths just left of centre, two orange slit eyes above them'
    if n<=17: return 'seen three-quarter from the front-left: both fanged mouths are on the left half of the blob, two orange slit eyes high on the left, the lumpy body trailing right'
    if n<=22: return 'seen from the left side: the fanged mouths are at the far left edge (the nearer mouth full, the far one a sliver), one or two orange eyes at the upper left, the lumpy body trailing right'
    if n<=24: return 'seen from behind: NO mouths, NO eyes visible at all, only the bumpy lime back of the blob'
    if n<=27: return 'seen from behind-right: no eyes, no mouth, at most a tiny brown-pink sliver of one mouth at the far right edge; the bumpy lime back fills the view'
    return 'seen three-quarter from the front-right but low: the fanged mouths and orange eyes are on the right side, the lumpy body trailing left'
FT=facing_text(n)
BACKS=set(range(23,28))
STRICT=f"FACING RULE (most important): at heading {deg} degrees (number {n} of 30) this Slimeattikus is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the body, the mouths and the eyes point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: ONE glossy lime-green slime blob covered in round bumps, bubbles and a few thin hairs, a wide flat puddle skirt at its base, the same number of orange slit eyes as ref.png shows (count them in ref.png), the same number of big fanged mouths as ref.png shows (count them; each has 6-8 cream fangs, a dark brown throat and pink gums), and NO arms, NO legs, NO tentacles, NO tail.\n"
BACK=("Slimeattikus is seen from BEHIND at this heading: NO mouths, NO fangs and NO eyes in ANY cell, attack cells included (only a tiny sliver at the far right edge if ref.png shows one). Attack = the blob rears up and slams down away from the viewer, bumpy back only.\n" if n in BACKS else "")
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of Slimeattikus, shown at heading {deg} degrees; match its facing, colours, bumps and part placement exactly) and portrait.png (the concept painting, style reference only; ref.png wins on pose, size, colour and part count).
Camera is a 3/4 isometric view from above. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is Slimeattikus: a low glossy lime-green slime blob with round bumps and bubbles, orange slit eyes and big fanged mouths, sitting in a wide flat puddle, as ref.png and portrait.png show. Exactly one creature, exactly the parts ref.png shows, the same colours as ref.png (a fairly deep, slightly dark leaf-lime green with small bright lime highlights, NOT paler or yellower than ref.png), the same glossy highlights, and the same dense surface of many round glossy bumps and bubbles of mixed sizes over the whole body as ref.png (do not smooth the skin), nothing added. The puddle skirt stays flat and wide at the bottom.
{BACK}Cells 1-6 are an OOZE crawl: the whole blob oozes forward in the facing direction by squashing and stretching: 1 body low and wide, a bulge reaching forward; 2 body pulling together, rising a little; 3 body tall and narrower (up to about 12 percent taller), the puddle skirt dragging behind; 4 body low and wide again, bulge forward; 5 pulling together; 6 tall and narrow. The blob never leaves the ground and never grows limbs. The creature stays horizontally centred in its cell, the bottom of the puddle on the same horizontal ground line in every cell, the creature the same overall size as ref.png.
Cells 7-11 are an ATTACK: 7 anticipation: the blob squashes low and flat, drawing back, mouths gaping slightly; 8 wind-up: the blob rears up tall and leans back, mouths wide open; 9 strike: the blob lunges forward in the facing direction and slams down, mouths wide and snapping; 10 follow-through: flattened, spread wide and furthest forward; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, droplets, splashes, sparks or smoke; slime stays attached to the body. Do not crop any part at the cell edges and keep clear magenta between the cells. A children's-game creature illustration.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
