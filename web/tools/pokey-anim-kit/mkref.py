import sys
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/pokey-repaint@4x.png').convert('RGBA')
import numpy as np
c=np.array(S.crop((n*96,0,n*96+96,84))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((384,336),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
prev=(f"\nSecond reference prev.png: the finished pose sheet of the NEIGHBOURING heading ({(n-1)*12} degrees), same layout. This heading is turned 12 degrees from it: keep the identical pose in each numbered cell (same stride phase, same attack phase, same proportions, same scale and painting), only rotate the creature 12 degrees to match ref.png.\n" if n>0 else "")
P=f"""Use the reference image ref.png (the exact creature: the painted game sprite of the Pokey, shown at heading {deg} degrees; match its facing and face placement exactly) and portrait.png (the concept painting, style reference).{prev}
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is ONE round spiky ball: exactly one body, NO legs, NO arms, NO tail, NO wings. It hovers and bounces. It must keep its pink-red skin and ALL the same long purple conical spikes all round (about 20, same length and colour as ref.png), and the same face (two blue eyes with an angry brow, fanged grin) only where ref.png shows the face; at back-facing headings there is no face, exactly like ref.png.
Cells 1-6 are a BOUNCING ROLL walk cycle, travelling in the facing direction, the ball staying horizontally centred in its cell, the lowest point of the ball on the same horizontal line in every cell: 1 squash: ball pressed low and wide, spikes splayed sideways; 2 launch: ball stretched tall and narrow along the vertical; 3 roll: round, the whole spiky shell turned a clear 60 degrees (the spikes rotated round the ball as if rolling toward the facing direction, the face tilted slightly down toward the facing direction); 4 squash again, mirror lean; 5 stretched tall again; 6 round, spikes rolled a further 60 degrees. Make the squash and stretch big and obvious (squash about 75 percent height and 125 percent width; stretch about 125 percent height and 80 percent width), the ball keeps about the same overall volume as ref.png.
Cells 7-11 are an ATTACK: 7 anticipation: crouching lower and wider, pulled slightly backwards away from the facing direction; 8 wind-up: pulled right back and inflated about 20 percent bigger, spikes flared longer and bristling, the face scowling; 9 strike: shot forward in the facing direction, stretched along that direction, spikes pointing forward like a mace, mouth open wide with fangs bared; 10 follow-through at full extension, furthest forward, motion-stretched; 11 recovery: bouncing back to the round resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline, not cute), same camera angle and the same ball size as ref.png in the walk cells. Keep the same heading in all cells. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
