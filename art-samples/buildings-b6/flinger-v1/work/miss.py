"""miss.py <look> [render] : the fit overlay's outline panel and miss map side by side (work/_m.png), with a 10 px grid."""
import sys
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
import fref
lv = int(sys.argv[1])
im = Image.open(f'work/fit-overlay-L{lv}.png')
w = im.width // 4
o = Image.new('RGB', (2 * w, im.height))
o.paste(im.crop((2 * w, 0, 4 * w, im.height)), (0, 0))
o.save('work/_m.png')
