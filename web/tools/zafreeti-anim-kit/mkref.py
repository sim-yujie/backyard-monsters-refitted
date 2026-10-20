import sys,os,math
import numpy as np
from PIL import Image
n=int(sys.argv[1])
S=Image.open('D:/Coding/BYMR/worktrees/anim-zafreeti/server/public/assets/monsters/zafreeti-repaint@4x.png').convert('RGBA')
c=np.array(S.crop((n*224,0,n*224+224,280))); c[...,3]=np.where(c[...,3]>200,255,0)
c=Image.fromarray(c,'RGBA').resize((448,560),Image.LANCZOS)
bg=Image.new('RGBA',c.size,(255,0,255,255)); bg.alpha_composite(c)
os.makedirs(f'h{n}',exist_ok=True)
bg.convert('RGB').save(f'h{n}/ref.png')

def facing_text(n):
    if n<=6: return 'seen from the front-right: the purple tentacle face is at the lower right of the body and looks toward the viewer and screen-right, the curled leathery shell and the long crystal horn curve up and away to the left'
    if n<=8: return 'seen head-on from the front: the purple tentacle face is in the centre, looking straight at the viewer, with one cyan orb on each side of the body and the crystal horn running down the middle'
    if n<=15: return 'turned toward screen-left: the purple tentacle face is at the left edge of the body and looks toward the viewer and screen-left, the curled leathery shell, the near cyan orb and the crystal horn sit to the right of it'
    if n<=19: return 'seen from the left side: the purple tentacle face is at the far left edge of the body, looking screen-left, the big near cyan orb in the middle and the curled shell and crystal horn arcing over to the right'
    if n<=22: return 'seen from behind-left: the face is turned away and NOT visible (no tentacles, no eyes), the leathery spiked back with the crystal horn on top, one big cyan orb on the right side and a hint of the other on the left'
    if n<=24: return 'seen from straight behind: NO face at all (no tentacles, no eyes visible), a symmetrical spiked leathery back with the crystal horn running down the middle, one cyan orb on each side'
    if n<=28: return 'seen from behind-right: the face is turned away and NOT visible (no tentacles, no eyes), the leathery spiked back with the crystal horn running diagonally, one big cyan orb on the right side'
    if n==29: return 'seen from behind-right, the face almost hidden: only the tips of the purple tentacles just peek out at the far right edge, the leathery spiked back with the crystal horn arcing over, one big cyan orb on the right'
    return 'seen from the front-right: the purple tentacle face is at the right edge of the body, looking screen-right, the big near cyan orb in the middle and the curled shell and crystal horn arcing over to the left'
FT=facing_text(n)
BACKS=set(range(20,29))
STRICT=f"FACING RULE (most important): at heading {n} of 32 this Zafreeti is {FT}, exactly as ref.png shows. In EVERY cell, walk cells AND attack cells (the crouch, the wind-up, the strike, the follow-through), the body, face and horn point this same way as ref.png and the viewer sees the same side of the creature as in ref.png. The wind-up must NOT turn to face the viewer and must NOT turn sideways unless ref.png does so; the creature keeps ref.png's orientation. Keep exactly the parts ref.png shows in every cell: one fat curled leathery spiked shell-body with bronze horn spikes along it (keep the spike count of ref.png), one long blue crystal horn arching over the body and ending in a crystal point below, the same number of big glowing cyan orbs as ref.png shows, the same number of beaded brown tassel-legs hanging down as ref.png shows (count them in ref.png and keep that count in every cell: nothing added, nothing dropped), and where ref.png shows the face: one purple tentacle-bearded face with two small orange glowing eyes and a red collar. No wings, no arms, no feet, and it never touches the ground: it hovers.\n"
if n in BACKS:
    BACK="The Zafreeti is seen from BEHIND at this heading: NO face, NO tentacles, NO eyes in ANY cell, attack cells included. Attack = the body rears back and lunges away from the viewer, seen from behind, with no face detail.\n"
else: BACK=""
P=f"""{STRICT}Use the reference image ref.png (the exact creature: the painted game sprite of the Zafreeti, shown at heading {n} of 32; match its facing and part placement exactly) and portrait.png (the concept painting, style reference only: ignore its pose and its thin dangling legs, ref.png wins).
Camera is a 3/4 isometric view from above. Copy ref.png's facing direction exactly in every cell; never mirror. The exact viewing angle of ref.png must be kept in EVERY cell, walk cells included.

Create ONE image: an animation pose sheet of this same creature on flat pure magenta #FF00FF, no shadows, no ground, no text, no grid lines. Layout: EXACTLY 4 columns x 3 rows of equal cells (12 cells, never a 4th row), poses in reading order: row 1 = cells 1-4 (walk 1-4), row 2 = cells 5-8 (walk 5, walk 6, anticipation, wind-up), row 3 = cells 9-12 (strike, follow-through, recovery, empty). Exactly 6 walk poses, no more. The creature is the Zafreeti: a floating armoured shell-creature with a curled leathery spiked back, a long blue crystal horn arching over it, two big glowing cyan orbs, a purple tentacle-bearded face with orange eyes above a red collar, and beaded tassel-legs hanging beneath, as ref.png and portrait.png show. Exactly one creature, exactly the parts ref.png shows, same colours, nothing added.
{BACK}Cells 1-6 are a HOVER-FLOAT walk: the Zafreeti drifts through the air without touching anything. The whole body bobs gently up and down and sways a few degrees side to side, the beaded tassels and the crystal tail point swing softly the opposite way, the face tentacles wave slowly, and the crystal horn flexes a little. Keep the body the same overall size as ref.png, centred horizontally in its cell, and keep the view angle of ref.png. Cycle: 1 neutral; 2 drifting up, leaning a little forward in the facing direction; 3 at the top, tassels trailing; 4 neutral; 5 drifting down, leaning back; 6 at the bottom, tassels swinging forward. Keep the motion gentle but visible and every part attached.
Cells 7-11 are an ATTACK: 7 anticipation: the creature dips low and draws its body and face back, tassels gathering; 8 wind-up: it rears up and back, shell raised, tentacles flaring wide; 9 strike: the body lunges forward in the facing direction, face tentacles lashing out ahead; 10 follow-through: at full extension, furthest forward, tentacles fully spread; 11 recovery: settling back to the resting shape of ref.png. Cell 12 stays empty magenta.
In EVERY cell it must be the identical creature as ref.png in the same painted style (soft shading, glossy highlights, no outline), same camera angle and the same size as ref.png in the walk cells. Keep the same heading in all cells. No motion-streak arcs, speed lines, dirt, smoke, sparks or splashes flying off. Do not crop any part at the cell edges and keep clear magenta between the cells. A children's-game creature illustration.
Use your image generation tool (one call) and save the result as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the inputs.
"""
open(f'h{n}/prompt.txt','w').write(P)
