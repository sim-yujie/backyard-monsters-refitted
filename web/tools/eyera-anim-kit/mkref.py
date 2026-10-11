import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/wt-anim-eyera/server/public/assets/monsters/eyera-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*104,0,n*104+104,92))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((520,460),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
def facing_text(d):
    r=math.radians(d); x=math.cos(r); y=math.sin(r)  # x>0 screen right, y>0 toward viewer
    h=('to screen-right' if x>0 else 'to screen-left'); v=('toward the viewer' if y>0 else 'away from the viewer')
    if abs(x)<0.2 and y>0: return 'FACING THE VIEWER head-on (the eyeball looks straight at the viewer, symmetric, not turned to either side)'
    if abs(x)<0.2: return 'FACING AWAY from the viewer (seen from behind)'
    if abs(y)<0.2: return 'in pure side view '+h
    return f'in three-quarter view, turned {h} and {v} (mostly {"sideways" if abs(x)>abs(y) else "toward the viewer" if y>0 else "away"})'
FT=facing_text(deg)
BACKS=set(range(17,25))   # no pupil visible in the still
EDGE=set([16,25,26])      # pupil only a sliver at the rim
STRICT=f"FACING RULE (most important): at heading {deg} degrees this Eye-ra is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the eyeball and the gore puddle point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; only the eyeball rears up and the puddle gathers while the creature keeps ref.png's orientation. Keep exactly one eyeball, one flesh collar and one gore puddle in every cell (nothing added, no legs, no arms, no extra eyes, no tentacles that ref.png does not show).\n"
if n in BACKS:
    BACK="The eyeball is seen from BEHIND at this heading: show NO pupil, NO orange iris and no face in ANY cell, attack cells included; only the smooth white veiny back of the eyeball, as ref.png shows. Attack = the eyeball lunges, seen from behind, with no pupil.\n"
elif n in EDGE:
    BACK="At this heading the pupil is at most a tiny sliver at the very rim of the eyeball, exactly as ref.png shows; keep it that way in every cell (do NOT turn the iris into view).\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Eye-ra, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the eyeball, where the iris sits on it) must be kept in EVERY cell, walk cells included; do not turn the creature unless ref.png says so.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is the Eye-ra: one huge glossy veiny white eyeball with an orange iris and black pupil, sitting in a collar of pink flesh on a spreading puddle of glossy dark-red slimy gore with ridged ripples (as ref.png and portrait.png). It has no legs and no arms. Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Eye-ra slithers along in the facing direction like a slug: the gore puddle stretches forward and gathers up behind in a rippling wave (the ridged ripples along its rim flow and pull forward in turn), while the eyeball in its flesh collar bobs up and down and leans slightly forward. The creature stays horizontally centred in its cell, the puddle's bottom edge (the ground line) on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 stretch: puddle extended long and low in the facing direction; 2 gather: puddle bunching up, eyeball a little higher; 3 high: puddle compact and tall, eyeball at its highest; 4 stretch again (ripples shifted); 5 gather; 6 high. Make the slither clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the whole creature squashes low and wide, the eyeball sinks into the collar; 8 wind-up: the eyeball rears up and back on a swollen stretched flesh collar, the gore puddle gathering under it; 9 strike: the eyeball lunges forward and down in the facing direction, the puddle stretching behind it in a long gory smear; 10 follow-through: at full extension, furthest forward; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
