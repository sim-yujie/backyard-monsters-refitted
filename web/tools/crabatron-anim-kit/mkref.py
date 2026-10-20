import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/wt-anim-crabatron/server/public/assets/monsters/crabatron-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*148,0,n*148+148,108))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((740,540),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n<=6: return 'in three-quarter view, facing the viewer and screen-right: the face (two blue eyes and red mouth tendrils) turned toward the viewer and a little to screen-right, the big claws reaching forward to the right'
    if n<=9: return 'FACING THE VIEWER head-on (the face looks straight at the viewer, symmetric, both big claws in front, not turned to either side)'
    if n<=12: return 'in three-quarter view, facing the viewer and screen-left: the face turned toward the viewer and a little to screen-left, the big claws reaching forward to the left'
    if n<=15: return 'in side view, facing screen-left (slightly toward the viewer), the claws reaching to the left, one side of the face visible'
    if n<=18: return 'in side view heading to screen-left and away from the viewer (we see mostly its flank and shell)'
    if n<=21: return 'FACING AWAY from the viewer (seen from behind, a little from the left), claws tucked at its sides'
    if n<=24: return 'FACING AWAY from the viewer (seen from directly behind), claws tucked at its sides'
    if n<=27: return 'seen from behind in three-quarter view, heading to screen-right and away from the viewer'
    return 'in three-quarter view, facing the viewer and screen-right: the face turned toward the viewer, the big claws reaching forward to the right'
FT=facing_text(n)
BACKS=set(range(19,28))   # back view in the still: no face
EDGE=set([16,17,18])      # only a sliver of mouth tendrils at the rim
STRICT=f"FACING RULE (most important): at heading {n} of 30 this Crabatron is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the body, the claws and the legs point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the same number of purple walking legs as ref.png shows (count the legs and the two big claws in ref.png and keep those counts in every cell), exactly one orange pitted shell, exactly two orange eyestalks each ending in a blue eye ball, and exactly the face eyes and mouth ref.png shows (nothing added, nothing dropped, no extra limbs).\n"
if n in BACKS:
    BACK="The Crabatron is seen from BEHIND at this heading: show NO face, NO face eyes and NO mouth in ANY cell, attack cells included; only the pitted orange shell, the two eyestalks with their blue eyes, the purple legs and the claws as ref.png shows. Attack = the claws snap outward and forward away from the viewer, seen from behind, with no face.\n"
elif n in EDGE:
    BACK="At this heading only a sliver of the red mouth tendrils shows at the rim of the shell, exactly as ref.png shows; keep it that way in every cell (do NOT turn the face into view).\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Crabatron, shown at heading {n} of 30; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the face, where the claws and legs sit) must be kept in EVERY cell, walk cells included; do not turn the creature unless ref.png says so.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is the Crabatron: a giant crab with a round pitted orange-gold shell, two orange eyestalks topped with glossy blue eye balls, a face under the front of the shell with two blue eyes and red tentacle-like mouth tendrils, eight purple spiky walking legs with pink-tipped points (four per side), and two huge purple pincer claws on armoured grey-olive arm segments (as ref.png and portrait.png). Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Crabatron scuttles along in the facing direction on its eight legs: the legs move in alternating groups (one group of four planted while the other group swings forward and lifts), the shell bobs and rocks slightly, the eyestalks sway, the claws are held forward and low and sway gently. The creature stays horizontally centred in its cell, the leg tips' ground line on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact (leg group A forward); 2 passing (body low); 3 contact (leg group B forward); 4 mirror of 1; 5 passing; 6 mirror of 3. Make the scuttling steps clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the whole creature crouches low, legs bent, claws drawn back; 8 wind-up: the shell rears up and back, both claws raised and spread wide open; 9 strike: the body lunges forward in the facing direction and the claws snap shut together; 10 follow-through: at full extension, furthest forward, claws closed; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
