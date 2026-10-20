import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-dave/server/public/assets/monsters/dave-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*212,0,n*212+212,184))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((848,736),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n==0: return 'in side view facing screen-right: the cannon arm pointing to the right, the near goggle with its one red eye visible in profile, the toothed grille at the front right'
    if n<=5: return 'in three-quarter view facing the viewer and screen-right: both goggles with red eyes and the toothed grille turned toward the viewer and somewhat to screen-right, the cannon arm on the left'
    if n<=9: return 'FACING THE VIEWER nearly head-on (both goggles with red eyes and the toothed grille looking at the viewer, nearly symmetric, a slight turn as ref.png shows)'
    if n<=15: return 'in three-quarter view facing the viewer and screen-left: goggles with red eyes and toothed grille turned toward the viewer and to screen-left (as ref.png shows), cannon arm on the right'
    if n<=17: return 'in side view heading to screen-left and away from the viewer (we see mostly its flank, the riveted plate back and the cannon arm; at most a sliver of goggle at the rim)'
    return 'FACING AWAY from the viewer (seen from behind or behind-three-quarter, as ref.png shows): the plain riveted steel back plate toward the viewer, the two arm cannons at the sides'
FT=facing_text(n)
BACKS=set(range(18,30))
EDGE=set([16,17])
STRICT=f"FACING RULE (most important): at heading {n} of 30 this D.A.V.E. is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the body, the arms and the tracks point this same way as ref.png and the viewer sees the same side of the machine as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the machine keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: exactly one rusty spiked dome with one big shark-fin steel horn and the small cone spikes, exactly two mechanical cannon/piston arms with copper pipes (one each side) as ref.png shows, the yellow-black hazard box, exactly two tank tracks with wheels, and exactly the goggle frames, red eyes and toothed grille ref.png shows (nothing added, nothing dropped, no tail, no wings, no extra limbs).\n"
if n in BACKS:
    BACK="The D.A.V.E. is seen from BEHIND at this heading: show NO face, NO goggles, NO red eyes and NO teeth in ANY cell, attack cells included; only the riveted back plate, the horn, spikes, both arms and tracks as ref.png shows. Attack = the cannon arms swing and punch outward away from the viewer, seen from behind, with no face.\n"
elif n in EDGE:
    BACK="At this heading at most a sliver of goggle shows at the rim, exactly as ref.png shows; keep it that way in every cell (do NOT turn the face into view).\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact machine: the painted game sprite of the D.A.V.E., shown at heading {n} of 30; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same machine on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The machine is the D.A.V.E.: a squat rusty riveted steel robot tank with a domed spiked head carrying one big shark-fin steel horn and small cone spikes, two riveted steel goggle frames each with a glowing red eye, a jagged grille mouth of pale steel plate teeth, rust-brown riveted plates, small arched hatch boxes low at the sides, two mechanical cannon/piston arms with copper pipes (one each side) and a yellow-black hazard box, two tank tracks with wheels, no tail and no wings (as ref.png and portrait.png). Exactly one machine, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the D.A.V.E. is a big heavy mech and moves with heavy stomping steps: it rolls forward on its two tank tracks in the facing direction, the whole body rocking and thudding down with each beat (lurch forward and settle), the track wheels turning, the cannon arms swinging a little, the spikes and horn jolting. Keep the body the same overall size as ref.png, centred horizontally in its cell, the bottom of the tracks on the same horizontal line in every cell. Cycle: 1 contact (body lurched forward and down); 2 passing (body up a little, rocked back); 3 contact (lurched forward and down, other side); 4 like 1; 5 like 2; 6 like 3. Make the stomping rocking clearly visible but keep every part attached.
Cells 7-11 are an ATTACK: 7 anticipation: the machine hunkers low and leans back, arms drawn back; 8 wind-up: the dome rears up and back, both cannon arms raised and pulled back; 9 strike: the body lunges forward in the facing direction and the cannon arms punch/fire forward; 10 follow-through: at full extension, furthest forward, arms extended; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical machine as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
