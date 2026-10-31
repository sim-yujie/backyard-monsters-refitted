import sys
from PIL import Image
import numpy as np
sys.path.insert(0, '.')
import fref
fx, fy = fref.FRAME[:2]
F = np.asarray(fref.flash_rgba()).astype(float)
r = Image.open(sys.argv[1]).convert('RGBA'); k = r.width // (fref.FRAME[2] - fref.FRAME[0])
R = np.asarray(r.resize((r.width // k, r.height // k), Image.BOX)).astype(float)
for spec in sys.argv[2:]:
    n, x0, y0, x1, y1 = spec.split(','); x0, y0, x1, y1 = map(int, (x0, y0, x1, y1))
    def m(A):
        a = A[y0 - fy:y1 - fy, x0 - fx:x1 - fx]; a = a[a[..., 3] > 200][:, :3]
        return a.mean(0).round().astype(int).tolist() if len(a) else None
    print(n, 'flash', m(F), '3d', m(R))
