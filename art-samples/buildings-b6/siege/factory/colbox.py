"""colbox.py : mean colour of Flash and of a 3D picture inside named boxes (Flash px), to compare how dark parts are.
./py colbox.py <flash 1x canvas> <3d png, any whole multiple> name:x0,y0,x1,y1 ...   (canvas top left = -84,-104)"""
import sys
import numpy as np
from PIL import Image
fx, fy = -84, -104
f = Image.open(sys.argv[1]).convert("RGBA")
r = np.array(Image.open(sys.argv[2]).convert("RGBA").resize(f.size, Image.BOX)).astype(float)
f = np.array(f).astype(float)
for a in sys.argv[3:]:
    name, b = a.split(":")
    x0, y0, x1, y1 = [int(v) for v in b.split(",")]
    s = (slice(y0 - fy, y1 - fy), slice(x0 - fx, x1 - fx))
    m = (f[s][..., 3] > 200) & (r[s][..., 3] > 200)
    cf, cr = f[s][m][:, :3].mean(0), r[s][m][:, :3].mean(0)
    print("%-10s flash %3d %3d %3d (lum %3d)   3d %3d %3d %3d (lum %3d)" % (name, *cf, cf.mean(), *cr, cr.mean()))
