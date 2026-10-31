"""post.py : after the full renders: 3D-only frames per look for loop_diff, and the shared-part check (L1 vs L3 base
render, L3 moved back by Flash's look shift) on the drum and the bowl's front."""
import sys; from pathlib import Path
import numpy as np; from PIL import Image
sys.path.insert(0, '.')
import ipost
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
W = Path('bone/work/v4')
for lv, n in ((1, 47), (3, 50)):
    d = W / f'f3d-L{lv}'; d.mkdir(exist_ok=True)
    for k in range(n):
        p = ipost.D / 'render' / f'L{lv}-parts-{k:02d}.png'
        if not p.exists():
            break
        ipost.on_ground(ipost.frame3d(lv, k)).convert('RGB').save(d / f'{k:02d}.png')
# shared parts: L3 is drawn (4, 6.5) Flash px = (48, 78) render px right/down of L1
a = np.asarray(Image.open(ipost.D / 'render' / 'L1-base.png').convert('RGBA')).astype(int)
b = np.asarray(Image.open(ipost.D / 'render' / 'L3-base.png').convert('RGBA')).astype(int)
dx, dy = 48, 78
out = []
for name, (x, y, w, h) in {'drum': (150, 900, 360, 260), 'bowlfront': (380, 860, 360, 200)}.items():
    pa = a[y:y + h, x:x + w]; pb = b[y + dy:y + dy + h, x + dx:x + dx + w]
    diff = np.abs(pa[..., :3] - pb[..., :3]).max(-1)
    print(f"{name}: px differing >24: {(diff > 24).mean() * 100:.1f}%  alpha differing: {(np.abs(pa[..., 3] - pb[..., 3]) > 64).mean() * 100:.1f}%")
    row = np.concatenate([pa[..., :3], pb[..., :3], np.repeat(np.clip(diff * 3, 0, 255)[..., None], 3, -1)], 1)
    out.append(row.astype(np.uint8))
Image.fromarray(np.concatenate(out, 0) if len({o.shape[1] for o in out}) == 1 else out[0]).save(W / 'mark-drum.png')
Image.fromarray(out[1]).save(W / 'mark-bowl.png')
