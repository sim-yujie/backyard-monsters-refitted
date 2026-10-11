import sys,os
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-brain/server/public/assets/monsters/brain-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*136,0,n*136+136,96))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((544,384),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
os.makedirs(f'h{n}',exist_ok=True)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
def facing_text(n):
    if n<=5: return 'seen from the front-right: the orange skull face is at the lower right of the brain dome and looks toward screen-right and the viewer, the green clawed forelegs reach out to the lower right, the dome and blue legs extend to the left'
    if n<=9: return 'seen head-on from the front: the orange skull face with two glowing yellow eyes is in the centre of the front of the dome, looking straight at the viewer, a green clawed foreleg on each side of it, the blue spider legs splayed to both sides'
    if n<=11: return 'seen from the front, turned slightly to screen-left: the orange skull face looks at the viewer and a little to the left, a green clawed foreleg on each side of it, the blue spider legs splayed'
    if n<=18: return 'turned toward screen-left: the orange skull face is at the left edge of the dome and looks screen-left, the green clawed forelegs reach out to the left, the dome and blue legs extend to the right'
    if n<=22: return 'seen from behind-left: the face is turned away and NOT visible (no skull, no eyes), the purple brain dome fills the view, blue spider legs around it, a few green claw tips at the left'
    if n<=26: return 'seen from behind: NO face at all (no skull, no eyes), a symmetrical purple brain dome with a small red patch low on its back and blue spider legs on both sides'
    return 'seen from behind-right: the face is almost hidden, at most a tiny orange sliver of it at the far right edge of the dome, the purple brain dome, blue spider legs, green claw tips poking out at the right'
FT=facing_text(n)
BACKS=set(range(19,27))
STRICT=f"FACING RULE (most important): at heading {deg} degrees (number {n} of 30) this Brain is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the dome, the face and the legs point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: one purple brain-fold dome with grey-green nodules, the same number of blue segmented spider legs as ref.png shows (count them in ref.png and keep that count in every cell: no leg added, dropped or merged), the same number of green clawed forelegs as ref.png shows (usually two, count them in ref.png), and where ref.png shows the face: one orange skull face with two glowing yellow eyes and a dripping mouth.\n"
BACK=("The Brain is seen from BEHIND at this heading: NO face, NO skull, NO eyes in ANY cell, attack cells included. Attack = the dome rears back and lunges away from the viewer, seen from behind, with no face detail.\n" if n in BACKS else "")
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Brain, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference only; ref.png wins on pose, size and part count).
Camera is a 3/4 isometric view from above. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is the Brain: a big purple brain-shaped dome with grey-green nodules, carried on blue segmented spider legs, with an orange skull face with glowing yellow eyes and two green clawed forelegs at the front, as ref.png and portrait.png show. Exactly one creature, exactly the parts ref.png shows, same colours, nothing added. Keep the legs folded compactly close to the body, as in ref.png.
{BACK}Cells 1-6 are a spider WALK: the Brain skitters in the facing direction, the blue spider legs stepping in alternating groups (one set lifts and reaches forward while the other set pushes back), the dome bobbing slightly, the green forelegs swinging. The creature stays horizontally centred in its cell, the lowest leg tips on the same horizontal ground line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact: front legs reaching forward; 2 passing: legs gathering under the dome, dome a little lower; 3 push: opposite legs reaching, dome a little higher; 4 contact on the other leg set; 5 passing; 6 push. Make the leg stepping clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the dome crouches low, legs bent, the body drawn back; 8 wind-up: the body rears up and back, the green clawed forelegs raised wide; 9 strike: the body lunges forward in the facing direction and the green claws slash forward; 10 follow-through: at full extension, furthest forward; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, dirt, smoke, sparks or splashes. Do not crop any part at the cell edges and keep clear magenta between the cells. A children's-game creature illustration.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
