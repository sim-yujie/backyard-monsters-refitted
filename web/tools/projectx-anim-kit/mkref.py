import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-projectx/server/public/assets/monsters/projectx-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*192,0,n*192+192,136))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((768,544),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n<=5: return 'seen from behind and from the right (back three-quarter): the eyeball is turned away, we see only its plain white back with NO iris and NO pupil, the tentacles splayed around the green body'
    if n==6: return 'turning toward the viewer at screen-right: at most the orange iris just showing at the right rim of the eyeball, as ref.png shows'
    if n<=9: return 'FACING THE VIEWER head-on: the orange eye with its black pupil looks straight at the viewer, as ref.png shows'
    if n<=14: return 'facing the viewer and turned toward screen-left: the orange eye with black pupil looks toward the viewer and to screen-left (iris partly at the left edge of the eyeball), as ref.png shows'
    return 'FACING AWAY from the viewer (seen from behind): the eyeball shows only its plain white back, NO iris and NO pupil, as ref.png shows'
FT=facing_text(n)
BACKS=set(range(0,6))|set(range(15,30))
STRICT=f"FACING RULE (most important): at heading {n} of 30 this Project X is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the eyeball, stalk, body and tentacles point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: exactly one big eyeball on top of one tall thorny green stalk with white spikes and green whisker-leaves (and the small pink lips under the eyeball where ref.png shows them), one green warty round body, and exactly the same number of purple ringed tentacles with yellow suckers as ref.png shows (count them in ref.png and keep that count in every cell: nothing added, nothing dropped, no extra eye, no wings, no legs).\n"
if n in BACKS:
    BACK="The Project X is seen from BEHIND at this heading: the eyeball shows only its plain white back in EVERY cell, attack cells included: NO iris, NO orange, NO pupil. Attack = the tentacles lash and the stalk lunges away from the viewer, seen from behind, with no eye detail.\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Project X, shown at heading {n} of 30; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).
Camera is a 3/4 isometric view from above. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is the Project X: one big eyeball (white, with a large orange iris and black pupil on the side that faces the viewer) on top of a tall thorny green stalk with white thorn spikes and green whisker leaves, a round green warty body with raised bumps and a cuff at the top where the stalk rises, and several thick purple ringed tentacles with yellow sucker undersides splayed around the body, as ref.png and portrait.png show. Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a WALK: the Project X crawls over the ground on its tentacles like an octopus: tentacles take turns reaching forward in the facing direction, planting and pulling (some tentacles forward and lifted, others planted and pushing), the green body glides and rocks a little, the eyeball on its stalk sways gently and lags behind. Keep the body the same overall size as ref.png, centred horizontally in its cell, the lowest tentacle tips and body bottom on the same horizontal line in every cell. Cycle: 1 reach (front tentacles forward); 2 pull (body shifts forward, tentacles gather); 3 push (other tentacles reach); 4 like 1; 5 like 2; 6 like 3. Make the crawl clearly visible but keep every part attached.
Cells 7-11 are an ATTACK: 7 anticipation: the creature crouches low, body sinking, tentacles drawn in, stalk bending back; 8 wind-up: the stalk rears up and back, several tentacles rise and coil high; 9 strike: the stalk and eyeball lunge forward in the facing direction and the front tentacles lash/whip forward; 10 follow-through: at full extension, furthest forward, tentacles stretched out; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
