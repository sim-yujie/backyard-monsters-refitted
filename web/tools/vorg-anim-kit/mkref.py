import sys,os
import numpy as np
from PIL import Image
from lib import *
n=int(sys.argv[1])
c=np.array(still_cell(n,1)); c[...,3]=np.where(c[...,3]>200,255,0)   # row 1 = half-open wings, the pose to start from
c=Image.fromarray(c,'RGBA').resize((480,480),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
os.makedirs(f'h{n}',exist_ok=True)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n<=6: return 'facing screen-right in a three-quarter view: the grey-blue skull face with two white eyes is at the right front of the body and looks toward screen-right and slightly toward the viewer; the spiky back, the tall yellow spike and the wings sweep back to the left'
    if n==7: return 'facing the viewer, turned slightly toward screen-right: the skull face is nearly head-on, a little right of centre, the spiky back with the tall yellow spike rises behind it, one pair of wings on each side'
    if n==8: return 'seen head-on from the front: the skull face with two white eyes and two tan horns is in the centre looking straight at the viewer, the tall yellow spike on top, wings spread to the left and right, two front legs and tusks below'
    if n==9: return 'seen from the front, turned slightly toward screen-left: the skull face is a little left of centre looking at the viewer and screen-left, the tall yellow spike on top, wings spread out on both sides'
    if n<=11: return 'facing the viewer and screen-left in a three-quarter view: the skull face with white eyes is at the lower left of the body, the spiky back and tall yellow spike behind it, wings sweeping back to the right'
    if n<=19: return 'facing screen-left in a left-side view: the skull face with white eyes and tusks is at the left front of the body looking screen-left, the spiky back, the yellow spikes and the wings sweep back to the right'
    if n<=23: return 'seen from behind-left, the head turned away: NO face is visible (no skull, no eyes, no tusks), the spiky grey and yellow back with yellow spikes, the wings on the right side and the black legs below'
    if n<=26: return 'seen from straight behind: NO face at all (no skull, no eyes, no tusks), a symmetrical yellow fuzzy abdomen with the tall yellow spike down the middle of the back, one pair of wings on each side, black legs below'
    if n<=29: return 'seen from behind-right, the head turned away: NO face is visible (no skull, no eyes, no tusks), the yellow fuzzy abdomen and spiky back, wings on both sides, black legs below'
    return 'facing screen-right in a three-quarter view from behind: the skull face with white eyes peeks out at the far right edge of the body, the spiky yellow back and wings sweep back to the left'
FT=facing_text(n)
BACKS=set(range(20,30))
STRICT=f"FACING RULE (most important): at heading {n} of 32 this Vorg is {FT}, exactly as ref.png shows. In EVERY cell (anticipation, wind-up, strike, follow-through, recovery) the body, face and spikes point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps the orientation of ref.png. Keep exactly the parts ref.png shows in every cell: one armoured fuzzy yellow body covered in grey-steel spikes with one tall yellow spike crest, four long thin black legs with green joint bands and black claw feet (count the legs ref.png shows and keep that count in every cell: nothing added, nothing dropped), on each side a pair of purple veined insect wings (a fore and a hind wing per side; keep the wing-blade count ref.png shows), and where ref.png shows the face: one grey-blue skull face with two white eyes, two tan horns and a row of tan tusks. Same colours as ref.png in every cell.\n"
BACK="The Vorg is seen from BEHIND at this heading: NO face, NO skull, NO eyes, NO tusks in ANY cell, attack cells included. Attack = the body rears back and lunges away from the viewer, seen from behind, with no face detail.\n" if n in BACKS else ""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Vorg, shown at heading {n} of 32 with its wings half open; match its facing and part placement exactly) and portrait.png (the concept painting, style reference only: ignore its pose, ref.png wins).
Camera is a 3/4 isometric view from above. Copy the facing direction of ref.png exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell.

Create ONE image: an attack animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 3 columns x 2 rows of equal cells (6 cells, never a 3rd row), poses in reading order: row 1 = cells 1, 2, 3 (left to right); row 2 = cells 4, 5, 6 (left to right). The Vorg is a flying armoured insect-beast: it hovers in the air with its wings beating, never touching the ground. Exactly one creature per cell, exactly the parts ref.png shows, same colours, nothing added.
{BACK}ATTACK poses, the Vorg stays in the air and its wings stay clearly visible and clearly posed in EVERY cell (never folded away, never missing, never blurred or doubled into a ghost wing): cell 1 anticipation: the creature dips low and draws its body and head back, wings half open as in ref.png. Cell 2 wind-up: it rears up and back, the wings raised high and spread wide up and back, front legs drawn in, tusks flared. Cell 3 strike: the body lunges forward in the facing direction, the wings swept down and back, the skull face and front legs thrust ahead to bite and slash. Cell 4 follow-through: at full extension, furthest forward, the wings half open and sweeping back, the front legs still reaching. Cell 5 recovery: settling back to the resting shape of ref.png with the wings half open exactly as in ref.png. Cell 6 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same body size as ref.png. Keep the same heading in all cells. No motion-streak arcs, speed lines, dirt, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells. A children's-game creature illustration.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
