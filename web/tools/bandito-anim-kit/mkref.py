import sys
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/bandito-repaint@4x.png').convert('RGBA')
c=S.crop((n*116,0,n*116+116,112)).resize((464,448),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
prev=(f"\nSecond reference prev.png: the finished pose sheet of the NEIGHBOURING heading ({(n-1)*12} degrees), same layout. This heading is turned 12 degrees from it: keep the identical pose in each numbered cell (same stride phase, same attack phase, same proportions, same scale and painting), only rotate the creature 12 degrees to match ref.png.\n" if n>0 else "")
P=f"""Use the reference image ref.png (the exact creature: painted game sprite of the Bandito, shown at heading {deg} degrees; match its facing exactly) and portrait.png (the concept painting, style reference).{prev}
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. Cells 1-6 are a WALK CYCLE, walking in place with the creature staying horizontally centred in its cell: 1 right foot far forward, left foot far back (wide stride, both feet on ground); 2 down: weight on the forward foot, body at its lowest; 3 passing: left foot lifted clearly off the ground swinging forward, body at its highest; 4 left foot far forward, right foot far back (mirror of 1); 5 down on the left foot; 6 passing: right foot lifted clearly off the ground swinging forward. Make the legs and feet movement big and obvious, the arms swing opposite to the legs, the tail sways, the body bobs. Cells 7-11 are an ATTACK: 7 anticipation, crouching lower; 8 wind-up, rearing up tall with the clawed arms raised high and the head pulled back; 9 strike, lunging toward the facing direction with claws swinging and mouth open; 10 follow-through at full extension; 11 recovery returning to the standing stance. Cell 12 stays empty magenta.
In EVERY cell it must be the identical character as ref.png: green scaly muscular cyclops, pale belly, ONE yellow eye, two cream tusks, claws, a row of purple spikes along the back and tail, same colours and painted style (soft shading, glossy highlights, no outline, not cute). Same camera angle and the same body size as ref.png in every cell (about 70 percent of the cell height when standing), feet on the same ground line in every walk cell. Keep the same heading in all cells. Do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
