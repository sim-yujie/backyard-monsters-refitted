import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/wt-anim-fang/server/public/assets/monsters/fang-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*136,0,n*136+136,124))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((680,620),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
def facing_text(d):
    r=math.radians(d); x=math.cos(r); y=math.sin(r)  # x>0 screen right, y>0 toward viewer
    h=('to screen-right' if x>0 else 'to screen-left'); v=('toward the viewer' if y>0 else 'away from the viewer')
    if abs(x)<0.2 and y>0: return 'FACING THE VIEWER head-on (the face looks straight at the viewer, symmetric, not turned to either side)'
    if abs(x)<0.2: return 'FACING AWAY from the viewer (seen from behind)'
    if abs(y)<0.2: return 'in pure side view '+h
    return f'in three-quarter view, turned {h} and {v} (mostly {"sideways" if abs(x)>abs(y) else "toward the viewer" if y>0 else "away"})'
FT=facing_text(deg)
BACKS=set(range(19,25))   # back view in the still: no face
EDGE=set([17,18,25,26])   # only part of one eye visible at the rim
STRICT=f"FACING RULE (most important): at heading {deg} degrees this Fang is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the head, the body, the tail and the legs point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the same number of metal blade legs as ref.png shows (count them in ref.png and keep that count in every cell), exactly one red body-head, exactly one segmented orange tail with its spiky tip, and exactly the eyes ref.png shows (nothing added, nothing dropped, no extra limbs, no arms).\n"
if n in BACKS:
    BACK="The Fang is seen from BEHIND at this heading: show NO face, NO eyes and NO mouth in ANY cell, attack cells included (at most the tiny sliver of an eye at the very rim of the body if ref.png itself shows one); only the spiky red back, the tail and the legs as ref.png shows. Attack = the body lunges and the tail stabs, seen from behind, with no face.\n"
elif n in EDGE:
    BACK="At this heading only part of one eye and a little of the mouth show at the rim of the body, exactly as ref.png shows; keep it that way in every cell (do NOT turn the face into view).\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Fang, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the face, where the tail and legs sit) must be kept in EVERY cell, walk cells included; do not turn the creature unless ref.png says so.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is the Fang: a spider-like monster with a glossy red spiky body that is also its head (bulging eyes with big pupils, a wide mouth with fangs), a long segmented orange scorpion-like tail curling up from its back and ending in a spiky tip, and a ring of curved silver metal blade legs (as ref.png and portrait.png). Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Fang scuttles along in the facing direction on its metal blade legs: the legs step in alternating groups (one group planted while the other swings forward and lifts), the red body bobs and rocks slightly, the orange tail sways up and down behind it. The creature stays horizontally centred in its cell, the leg tips' ground line on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact (leg group A forward); 2 passing (body low); 3 contact (leg group B forward); 4 mirror of 1 with tail swayed the other way; 5 passing; 6 mirror of 3. Make the scuttle clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the whole creature crouches low, legs bent, the tail drawn back; 8 wind-up: the body rears up and back, mouth wide open showing fangs, the tail arching high over the body; 9 strike: the body lunges forward in the facing direction with the mouth snapping and the tail whipping down and forward with its spiky tip stabbing; 10 follow-through: at full extension, furthest forward; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
