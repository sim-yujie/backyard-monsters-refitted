"""make_all_directions.py : old vs new Bolt, all 30 headings (enlarged), then a real-size strip. Writes art-trials/bolt/all-directions.png."""
from PIL import Image, ImageDraw
R = 'D:/Coding/BYMR/wt-repaint-bolt/server/public/assets/monsters/'
old = Image.open(R + 'sprite.3.v2.png').convert('RGBA')
new = Image.open(R + 'bolt-repaint@4x.png').convert('RGBA')
grey = (128, 128, 128, 255)
def on_grey(im):
    b = Image.new('RGBA', im.size, grey); b.alpha_composite(im); return b
W, H, S = 30, 28, 4
per_row = 5
rows = (30 + per_row - 1) // per_row
pw = 2 * W * S + 12
out = Image.new('RGB', (per_row * pw, rows * (H * S + 16) + 3 * H * 3 + 140), (50, 50, 50))
d = ImageDraw.Draw(out)
for c in range(30):
    x, y = (c % per_row) * pw, (c // per_row) * (H * S + 16)
    o = on_grey(old.crop((c * W, 0, (c + 1) * W, H))).resize((W * S, H * S), Image.LANCZOS)
    n = on_grey(new.crop((c * W * S, 0, (c + 1) * W * S, H * S)))
    out.paste(o.convert('RGB'), (x, y + 14)); out.paste(n.convert('RGB'), (x + W * S, y + 14))
    d.text((x + 4, y + 1), f'col {c}  ({c * 12} deg)', fill=(255, 255, 255))
y0 = rows * (H * S + 16) + 8
d.text((4, y0), 'real size: old row, new row (1x); then both at 3x nearest', fill=(255, 255, 255))
real_old = on_grey(old).convert('RGB')
real_new = on_grey(new.resize(old.size, Image.LANCZOS)).convert('RGB')
out.paste(real_old, (0, y0 + 16)); out.paste(real_new, (0, y0 + 16 + H + 4))
out.paste(real_old.crop((0, 0, 450, H)).resize((450 * 3, H * 3), Image.NEAREST), (0, y0 + 16 + 2 * H + 10))
out.paste(real_new.crop((0, 0, 450, H)).resize((450 * 3, H * 3), Image.NEAREST), (0, y0 + 16 + 2 * H + 10 + H * 3 + 4))
out.crop((0, 0, out.width, y0 + 16 + 2 * H + 10 + 2 * (H * 3 + 4))).save('D:/Coding/BYMR/art-trials/bolt/all-directions.png')
