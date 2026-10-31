"""z.py lv x0 y0 x1 y1 zoom [out] : one area of a Flash look, smooth-enlarged on grass."""
import sys
sys.path.insert(0, '.')
import fref
from PIL import Image
lv, x0, y0, x1, y1, z = map(int, sys.argv[1:7])
look = int(sys.argv[8]) if len(sys.argv) > 8 else 1
im = fref.flash_rgba(look, lv); fx, fy = fref.FRAME[:2]
c = im.crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy)); bg = Image.new('RGBA', c.size, (96, 140, 60, 255)); bg.alpha_composite(c)
bg.resize((c.width * z, c.height * z), Image.LANCZOS).convert('RGB').save(sys.argv[7] if len(sys.argv) > 7 else 'work/_z.png')
