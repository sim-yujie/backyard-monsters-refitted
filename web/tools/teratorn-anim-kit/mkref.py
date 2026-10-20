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
    if n<=6: return 'facing screen-right in a three-quarter view: the golden beak, the big dark eye and the open fiery mouth are at the right front of the head and look toward screen-right; the green-teal feathered back, the long tail feathers and the wings sweep back to the left'
    if n==7: return 'facing the viewer, turned slightly toward screen-right: the head with the golden beak, big eye and open fiery mouth is nearly head-on, a little right of centre, the golden head spike on top, a wing on each side'
    if n==8: return 'seen head-on from the front: the round head with two big dark eyes, the small golden beak and the wide open fiery mouth full of teeth looks straight at the viewer, golden spike on top, a wing spread to the left and one to the right, two golden clawed legs below'
    if n==9: return 'seen from the front, turned slightly toward screen-left: the head with the golden beak, eye and open fiery mouth is a little left of centre, looking at the viewer and screen-left, wings spread on both sides'
    if n<=11: return 'facing the viewer and screen-left in a three-quarter view: the golden beak, eye and open fiery mouth are at the lower left of the body, the feathered back behind it, wings sweeping back to the right'
    if n<=20: return 'facing screen-left in a left-side view: the golden beak, big eye and open fiery mouth are at the left front of the head looking screen-left; the green-teal feathered back, the tail feathers and the wings sweep back to the right'
    if n<=22: return 'seen from behind-left, the head turned mostly away: the feathered teal back of the head dominates, only a sliver of the golden beak and the fiery mouth shows at the far left edge, wings on both sides, golden clawed legs below'
    if n<=25: return 'seen from behind: NO face at all (no beak, no eyes, no mouth, no flame), only the teal feathered back of the head with the small golden spike on top, the green feathered body and tail feathers, one wing on each side, two golden clawed legs below'
    if n<=27: return 'seen from behind-right, the head turned mostly away: the teal feathered back of the head dominates, only a sliver of the golden beak and fiery mouth shows at the right edge, wings on both sides, golden clawed legs below'
    return 'facing screen-right in a three-quarter view: the golden beak, big eye and open fiery mouth are at the right front of the head and look toward screen-right; the green-teal feathered back, tail feathers and wings sweep back to the left'
FT=facing_text(n)
BACKS=set(range(23,26))
STRICT=f"FACING RULE (most important): at heading {n} of 32 this Teratorn is {FT}, exactly as ref.png shows. In EVERY cell (anticipation, wind-up, strike, follow-through, recovery) the body, head and spike point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps the orientation of ref.png. Keep exactly the parts ref.png shows in every cell: one round feathered bird-like body (teal and green feathers, orange-gold belly bands) with one small golden head spike, a pair of purple-pink translucent insect wings (one wing on each side; keep the wing count and shape ref.png shows), exactly two golden clawed bird legs (count the legs ref.png shows and keep that count in every cell: nothing added, nothing dropped), and where ref.png shows the face: two big dark eyes, a small golden beak and a wide open mouth full of white teeth glowing orange-yellow with fire inside. Same colours as ref.png in every cell.\n"
BACK="The Teratorn is seen from BEHIND at this heading: NO face, NO beak, NO eyes, NO mouth, NO flame in ANY cell, attack cells included. Attack = the body rears back and lunges away from the viewer, seen from behind, with no face detail.\n" if n in BACKS else ""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Teratorn, shown at heading {n} of 32 with its wings half open; match its facing and part placement exactly) and portrait.png (the concept painting, style reference only: ignore its pose and ignore the big flame stream, ref.png wins).
Camera is a 3/4 isometric view from above. Copy the facing direction of ref.png exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell.

Create ONE image: an attack animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 3 columns x 2 rows of equal cells (6 cells, never a 3rd row), poses in reading order: row 1 = cells 1, 2, 3 (left to right); row 2 = cells 4, 5, 6 (left to right). The Teratorn is a small flying bird-beast: it hovers in the air with its wings beating, never touching the ground. Exactly one creature per cell, exactly the parts ref.png shows, same colours, nothing added.
{BACK}ATTACK poses, the Teratorn stays in the air and its wings stay clearly visible and clearly posed in EVERY cell (never folded away, never missing, never blurred or doubled into a ghost wing; exactly one wing per side): cell 1 anticipation: the creature dips low and draws its body and head back, wings half open as in ref.png. Cell 2 wind-up: it rears up and back, the wings raised high and spread wide up and back, legs drawn in, mouth gaping wide. Cell 3 strike: the body lunges forward in the facing direction, the wings swept down and back, the head and beak thrust ahead to bite and the clawed legs reaching forward to slash, the fire only glowing inside the open mouth. Cell 4 follow-through: at full extension, furthest forward, the wings half open and sweeping back, the legs still reaching. Cell 5 recovery: settling back to the resting shape of ref.png with the wings half open exactly as in ref.png. Cell 6 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same body size as ref.png. Keep the same heading in all cells. No motion-streak arcs, speed lines, flame streams, dirt, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells. A children's-game creature illustration.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
