"""turretchk.py T out.png h...: painted turret cells above, 3D below, aligned on the pivot, 3x. Not a deliverable."""
import sys
from PIL import Image
T = int(sys.argv[1]); out = sys.argv[2]; hs = [int(h) for h in sys.argv[3:]]
P = 'D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/snipertower/'
CELL = {1: (106, 72, 54, 66), 2: (104, 70, 52, 66), 3: (106, 70, 54, 64)}[T]
st = Image.open(P + f'turret.t{T}@2x.webp').convert('RGBA')
cw, ch, px, py = CELL
W, H = 140, 110    # per heading, pivot at (70, 80)
g = Image.new('RGBA', (W * len(hs), H * 2), (90, 140, 70, 255))
for i, k in enumerate(hs):
    c = st.crop((k * cw, 0, (k + 1) * cw, ch))
    g.alpha_composite(c, (i * W + 70 - px, 80 - py))
    m = Image.open(f'render/t{T}/turret-4x/h{k:02d}.png').convert('RGBA')
    m = m.resize((m.width // 2, m.height // 2), Image.LANCZOS)    # pivot (160,210) -> (80,105)
    g.alpha_composite(m, (i * W + 70 - 80, H + 80 - 105)) if False else None
    tmp = Image.new('RGBA', g.size, (0, 0, 0, 0)); tmp.paste(m, (i * W + 70 - 80, H + 80 - 105))
    g.alpha_composite(tmp)
for i in range(len(hs)):
    for y in range(0, 2 * H):
        pass
g.resize((g.width * 3, g.height * 3), Image.LANCZOS).save(out)
