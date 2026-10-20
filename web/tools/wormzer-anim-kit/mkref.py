import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-wormzer/server/public/assets/monsters/wormzer-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*160,0,n*160+160,108))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((640,432),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
os.makedirs(f'h{n}',exist_ok=True)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n<=5: return 'seen from the front-left: the huge toothy mouth is open and faces the viewer, the head is at the screen-right end and the long segmented body trails away to the left; the two small glowing yellow eyes and the gold collar spikes are visible'
    if n<=11: return 'facing the viewer almost head-on: the huge toothy mouth open toward the viewer, the head slightly right of centre, the segmented body trailing behind to the left; two small glowing yellow eyes visible'
    if n<=17: return 'facing the viewer and turned toward screen-left: the huge toothy mouth open toward the viewer and screen-left, the head at the left end, the long segmented body trailing away to the right'
    if n<=19: return 'seen from behind-left: the head is at the left end with its gold-studded collar and spikes but its mouth, teeth and eyes are NOT visible (the head is turned away), the long segmented body trails to the right'
    if n<=23: return 'seen from behind: the head (collar and gold spikes, no mouth, no teeth, no eyes visible) is at the upper end, the long segmented body trails away toward the lower right, toward the viewer'
    return 'seen from behind: the head (collar and gold spikes, no mouth, no teeth, no eyes visible) is at the upper-right end, the long segmented body trails to the lower left, toward the viewer'
FT=facing_text(n)
BACKS=set(range(18,30))
STRICT=f"FACING RULE (most important): at heading {n} of 30 this Wormzer is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the head, mouth and body point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: one fat purple-pink segmented worm body with a tail tip, one large head with a collar of purple folds, exactly the same number of big gold-bronze horn spikes as ref.png shows (count them in ref.png and keep that count in every cell: nothing added, nothing dropped), and where ref.png shows the face: one huge open mouth with cream-coloured fangs and a pink tongue and two small glowing yellow eyes. No legs, no arms, no wings.\n"
if n in BACKS:
    BACK="The Wormzer is seen from BEHIND at this heading: the head shows only its folded collar and gold spikes in EVERY cell, attack cells included: NO mouth, NO teeth, NO tongue, NO eyes. Attack = the body rears and lunges away from the viewer, seen from behind, with no face detail.\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Wormzer, shown at heading {n} of 30; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Camera is a 3/4 isometric view from above. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is the Wormzer: a fat purple-pink segmented worm with ribbed body rings and a curled tail tip, a big head with folded purple skin, a huge open mouth full of cream fangs with a pink tongue, two small glowing yellow eyes, and gold-bronze horn spikes around the head collar (one on top, others at the sides and front), as ref.png and portrait.png show. Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Wormzer crawls along the ground like a big caterpillar: a travelling wave of contraction runs along its ribbed body (the body bunches up, then stretches forward), the head leads in the facing direction and bobs, the tail drags and then catches up. Keep the body the same overall size as ref.png, centred horizontally in its cell, lowest body parts on the same horizontal line in every cell. Cycle: 1 stretched forward (head reaching ahead); 2 body bunching up (tail catches up, back humped); 3 re-extending; 4 like 1; 5 like 2; 6 like 3. Make the crawl clearly visible but keep every part attached.
Cells 7-11 are an ATTACK: 7 anticipation: the worm sinks low and coils back, head drawn back; 8 wind-up: the front of the body rears up and back, head high, mouth gaping widest; 9 strike: the head lunges forward in the facing direction, the body stretching after it; 10 follow-through: at full extension, furthest forward, jaws fully open; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, dirt, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
