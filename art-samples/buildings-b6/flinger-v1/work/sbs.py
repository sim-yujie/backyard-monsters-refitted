"""sbs.py <look> <render> x0 y0 x1 y1 scale [out] : Flash | 3D of one area (Flash px), both on grass, at scale px per Flash px."""
import sys
from PIL import Image
sys.path.insert(0, '.')
import fref
lv = int(sys.argv[1]); r = Image.open(sys.argv[2]).convert('RGBA')
x0, y0, x1, y1 = map(int, sys.argv[3:7]); sc = float(sys.argv[7]); out = sys.argv[8] if len(sys.argv) > 8 else 'work/_s.png'
fx, fy = fref.FRAME[:2]; k = r.width // (fref.FRAME[2] - fref.FRAME[0])
W, H = int((x1 - x0) * sc), int((y1 - y0) * sc)
def g(im):
    bg = Image.new('RGBA', im.size, (96, 140, 60, 255)); bg.alpha_composite(im); return bg.convert('RGB')
f = g(fref.flash_rgba(1, lv).crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy))).resize((W, H), Image.LANCZOS)
t = g(r.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k))).resize((W, H), Image.LANCZOS)
o = Image.new('RGB', (2 * W + 8, H), (20, 20, 20)); o.paste(f, (0, 0)); o.paste(t, (W + 8, 0)); o.save(out)
