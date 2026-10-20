import sys
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/bolt-repaint@4x.png').convert('RGBA')
import numpy as np
c=np.array(S.crop((n*120,0,n*120+120,112))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((480,448),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
PN=int(__import__('os').environ.get('PREVN',n-1))
prev=(f"\nSecond reference prev.png: the finished pose sheet of the NEIGHBOURING heading ({PN*12} degrees), same layout. This heading is turned 12 degrees from it: keep the identical pose in each numbered cell (same stride phase, same attack phase, same proportions, same scale and painting), only rotate the creature 12 degrees to match ref.png.\n" if n>0 else "")
back=(19<=n<=26)
BACK="The head is seen from BEHIND at this heading: show NO open mouth, no teeth and no face in ANY cell, attack cells included; only what ref.png shows (the banded head seen from behind with the two purple eyes at its sides, at most the glimpse of red tongue where ref.png has it). Attack = the neck rears and lunges, with the mouth hidden.\n" if back else ""
P=f"""Use the reference image ref.png (the exact creature: the painted game sprite of the Bolt, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).{prev}
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png (how much of the body and which side of the head is visible) must be kept in EVERY cell, walk cells included; do not turn the worm into a side profile unless ref.png is one. If prev.png is seen from a different angle than ref.png, ref.png decides.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is ONE giant worm: a fleshy pink segmented neck and head raised up at the front, with a wide toothy mouth full of long white fangs, a thin red tongue, and a copper banded head with a purple glossy eye on each side; behind it a fat armoured black abdomen with bone-coloured spikes along its back and a row of red legs along its underside. Exactly one worm, exactly the parts that ref.png shows (same two purple eyes, same pink neck, same black spiky abdomen, same red legs, same colours), nothing added: no arms, no wings, no extra eyes, no tail whip.
{BACK}Cells 1-6 are a WALK: the worm crawls caterpillar-style in the facing direction, the creature staying horizontally centred in its cell and the body ground line (the lowest point of the black belly and the red legs) on the same horizontal line in every cell, the creature the same overall size as ref.png. Cycle: 1 contact: the body a little longer along its length, front legs reaching forward, but still seen from exactly the same angle as ref.png; 2 gather: the abdomen humps up into an arch as the rear legs slide forward, neck dipping slightly; 3 peak: the high hump, the neck and head lifted a little; 4 stretch: the front pushes forward again with the other set of legs reaching, the head swaying to the other side; 5 gather as 2 but with the opposite legs; 6 peak as 3. Make the body wave and the leg stepping clearly visible while the head bobs gently.
Cells 7-11 are an ATTACK: 7 anticipation: the neck lowers and coils back, the body pressed lower; 8 wind-up: the neck rears up high and back, the mouth gaping wide, fangs bared, the tongue lashing, the abdomen braced; 9 strike: the neck whips forward and down in the facing direction, mouth wide open biting; 10 follow-through: at full extension, furthest forward, the neck stretched long; 11 recovery: pulling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
