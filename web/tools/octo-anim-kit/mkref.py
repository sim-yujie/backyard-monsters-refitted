import sys
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/octoooze-repaint@4x.png').convert('RGBA')
import numpy as np
c=np.array(S.crop((n*156,0,n*156+156,112))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((624,448),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
bg.convert('RGB').save(f'h{n}/ref.png')
deg=n*12
prev=(f"\nSecond reference prev.png: the finished pose sheet of the NEIGHBOURING heading ({(n-1)*12} degrees), same layout. This heading is turned 12 degrees from it: keep the identical pose in each numbered cell (same stride phase, same attack phase, same proportions, same scale and painting), only rotate the creature 12 degrees to match ref.png.\n" if n>0 else "")
P=f"""Use the reference image ref.png (the exact creature: the painted game sprite of the Octo-ooze, shown at heading {deg} degrees; match its facing and part placement exactly) and portrait.png (the concept painting, style reference).{prev}
Heading convention: measured on the ground from screen right (east) turning clockwise seen from above: 0 = facing right, 90 = facing the viewer, 180 = facing left, 270 = facing away. Camera is a 3/4 isometric view. Copy ref.png's facing direction exactly in every cell; never mirror.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: 4 columns x 3 rows of equal cells, poses in reading order. The creature is ONE teal-blue slimy blob body with a jagged toothy mouth along its top rim (only where ref.png shows the mouth), a thick wobbly neck/eye stalk rising from the body topped with two bulging orange-red slit-pupil eyes, and exactly SIX thick grey-tan curling tentacles with pale undersides spread around the base, exactly as ref.png and portrait.png. Keep the same teal body colour, same six tentacles, same two eyes and same mouth in every cell. At back-facing headings there is no mouth and the back of the blob is shown, exactly like ref.png.
Cells 1-6 are a TENTACLE-CRAWL walk cycle, travelling in the facing direction, the body staying horizontally centred in its cell, the lowest tentacle tips on the same horizontal line in every cell, the body bobbing only a little. The six tentacles move in two alternating groups of three: cell 1: group A reaches forward and plants, group B is pulled back; cell 2: body heaves forward, group A starts to pull back, group B lifts and curls; cell 3: group B reaches forward, group A pushed back; cells 4-6 are the same cycle with the groups swapped (cell 4 = group B planted forward and group A pulled back, cell 5 = body heaves, cell 6 = group A reaches forward, group B pushed back). The eye stalk sways and lags behind the body, leaning slightly against the direction of travel. Make the tentacle motion big and obvious, but the body keeps the same size and shape as ref.png.
Cells 7-11 are an ATTACK: 7 anticipation: body sinks low and wide, tentacles gathered in, eye stalk drawn back; 8 wind-up: body rears up and back, tentacles spread wide and curled upward, jaws opened wide with all the fangs bared; 9 strike: body lunges forward in the facing direction, jaws wide open, tentacles lashing forward; 10 follow-through at full extension, furthest forward and low, jaws snapping shut, tentacles trailing; 11 recovery: rising back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy wet highlights, no outline, not cute), same camera angle and the same body size as ref.png in the walk cells. Keep the same heading in all cells. Tentacles must not cross into a neighbouring cell: do not crop any part at the cell edges and keep clear magenta between the cells.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
