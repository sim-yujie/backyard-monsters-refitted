import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/wt-anim-ichi/server/public/assets/monsters/ichi-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*108,0,n*108+108,104))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((540,520),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
def facing_text(n):
    if n<=5: return 'in side view, the head and mouth pointing to screen-left (slightly toward the viewer)'
    if n==6: return 'in three-quarter view, the head turned toward the viewer and a little to screen-left'
    if n<=9: return 'FACING THE VIEWER head-on (the face looks straight at the viewer, symmetric, not turned to either side)'
    if n<=13: return 'in three-quarter view, the head turned toward the viewer and to screen-right'
    if n<=18: return 'in side view, the head pointing to screen-right and away from the viewer (we see mostly its flank and back)'
    if n<=25: return 'FACING AWAY from the viewer (seen from behind)'
    return 'seen from behind in three-quarter view, the head pointing to screen-left and away from the viewer'
FT=facing_text(n)
BACKS=set(range(19,26))   # back view in the still: no face
EDGE=set([16,17,18])   # only teeth/part of the mouth at the rim
STRICT=f"FACING RULE (most important): at heading {n} of 30 this Ichi is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the head, the body and the legs point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the same number of taloned legs as ref.png shows (count them in ref.png and keep that count in every cell), exactly one furry body-head with the same horns and spikes, exactly one red leaf-shaped fin on the back, and exactly the eyes and mouth ref.png shows (nothing added, nothing dropped, no extra limbs, no arms).\n"
if n in BACKS:
    BACK="The Ichi is seen from BEHIND at this heading: show NO face, NO eyes and NO mouth in ANY cell, attack cells included; only the furry brown back, the red fin, the horns and the legs as ref.png shows. Attack = the body lunges away from the viewer, seen from behind, with no face.\n"
elif n in EDGE:
    BACK="At this heading only a few teeth and a sliver of the mouth show at the rim of the head, exactly as ref.png shows; keep it that way in every cell (do NOT turn the face into view).\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Ichi, shown at heading {n} of 30; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the face, where the fin and legs sit) must be kept in EVERY cell, walk cells included; do not turn the creature unless ref.png says so.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is the Ichi: a low, hunched, furry brown-gold beast whose body is also its head, with a huge red mouth full of cream tusks and teeth, glowing amber eyes, cream horns and spikes along its head and back, a red leaf-shaped fin on the back, and short orange scaly legs ending in big grey talons (as ref.png and portrait.png). Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Ichi plods along in the facing direction on its short taloned legs: diagonal leg pairs alternate (one pair planted while the other swings forward and lifts), the heavy furry body rocks and bobs slightly, the red fin sways. The creature stays horizontally centred in its cell, the talon tips' ground line on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact (leg pair A forward); 2 passing (body low); 3 contact (leg pair B forward); 4 mirror of 1; 5 passing; 6 mirror of 3. Make the plodding steps clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the whole creature crouches low, legs bent, the head drawn back; 8 wind-up: the body rears up and back, mouth wide open showing its tusks, head raised; 9 strike: the body lunges forward in the facing direction with the jaws snapping wide; 10 follow-through: at full extension, furthest forward; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
