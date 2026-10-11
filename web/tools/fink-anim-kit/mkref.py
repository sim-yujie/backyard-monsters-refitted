import sys
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/wt-anim-fink/server/public/assets/monsters/fink-repaint@4x.png').convert('RGBA')
import numpy as np
c=np.array(S.crop((n*136,0,n*136+136,128))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((544,512),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
PN=int(__import__('os').environ.get('PREVN',n-1))
prev=(f"\nSecond reference prev.png: the finished pose sheet of the NEIGHBOURING heading ({PN*12} degrees), same layout. This heading is turned 12 degrees from it: keep the identical pose in each numbered cell (same stride phase, same attack phase, same proportions, same scale and painting), only rotate the creature 12 degrees to match ref.png.\n" if n>0 else "")
back=(n in (23,24))
BACK="The head is seen from BEHIND at this heading: show NO face, no eyes-and-mouth side and no pink mouth tentacles in ANY cell, attack cells included; only what ref.png shows (the back of the gold head and neck, at most the tiny pink hint where ref.png has it). Attack = the neck lunges, with the face hidden.\n" if back else ""
P=f"""Use the reference image ref.png (the exact creature: the painted game sprite of the Fink, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).{prev}
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the body and which side of the head is visible) must be kept in EVERY cell, walk cells included; do not turn the creature unless ref.png says so. If prev.png is seen from a different angle than ref.png, ref.png decides.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is the Fink: a flat spiky golden-yellow armoured shell body like a turtle/crab carapace covered in small gold spikes; a thick gold neck rising from the middle of the shell, topped by a gold wrinkled head with three glossy purple eyes and a pink fleshy mouth with pink tentacles; a ring of segmented green armoured legs ending in pale bone-coloured claws around the rim of the shell (count and place them exactly as ref.png shows), and two big curved teal-blue scythe claws at the front/shoulder (as ref.png shows, hidden behind the shell where ref.png hides them). Exactly one creature, exactly the parts that ref.png shows (same number of legs, same eyes, same blue claws, same colours), nothing added.
{BACK}Cells 1-6 are a WALK: the Fink scuttles like a crab/spider in the facing direction, legs stepping in alternating groups (one set of legs lifts and reaches forward while the other set pushes back), the shell bobbing slightly and the neck and head swaying gently. The creature stays horizontally centred in its cell, the body ground line (the lowest claw tips) on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact: front legs reaching forward; 2 passing: legs gathering under the shell, shell a little lower; 3 push: opposite legs reaching, shell a little higher; 4 contact on the other leg set; 5 passing; 6 push. Make the leg stepping clearly visible.
Cells 7-11 are an ATTACK: 7 anticipation: the shell crouches low, the legs bent, the neck pulled back; 8 wind-up: the neck rears up and back, the pink mouth tentacles spread and the two blue scythe claws raised wide; 9 strike: the neck whips forward and down in the facing direction and the blue claws slash forward; 10 follow-through: at full extension, furthest forward; 11 recovery: pulling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
