"""Make the achievement badges (same frame + script as the 17 earlier badges, archive/huge-rage-medal/work): a tier-coloured medal frame with a symbol on it.

python -I badge.py frames            -> frames/frame-{gold,silver,bronze}.png (from gen/frame/<pick>)
python -I badge.py badge <id> <tier> <symbol.png> <out.webp> [scale]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = str(__import__('pathlib').Path(__file__).resolve().parents[3] / 'art-samples' / 'badges') + '/'
SIZE = 176
FRAME_PICK = 'gen/frame/option-1.png'

# Rim colours: (shadow, mid, highlight) for the light-to-dark remap of the gold rim.
TIERS = {
    'silver': ((52, 60, 72), (165, 175, 188), (250, 252, 255)),
    'bronze': ((62, 26, 8), (184, 110, 52), (255, 214, 168)),
}


def clean(path):
    im = np.array(Image.open(path).convert('RGBA'))
    a = im[..., 3].copy()
    a[a <= 8] = 0
    lab, n = ndimage.label(a > 0)
    if n:
        sizes = ndimage.sum(a > 0, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 0.001 * sizes.max()])
        a[~keep] = 0
    im[..., 3] = a
    out = Image.fromarray(im)
    return out.crop(out.getchannel('A').getbbox())


def recolour(frame, tier):
    if tier == 'gold':
        return frame
    im = np.array(frame).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    rim = (r > b + 20)  # the gold rim is warm, the inner disc is navy
    rim = ndimage.binary_dilation(rim, iterations=1) & (r >= b)
    lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255.0
    lo, mid, hi = (np.array(c, np.float32) for c in TIERS[tier])
    t = np.clip(lum, 0, 1)[..., None]
    col = np.where(t < 0.55, lo + (mid - lo) * (t / 0.55), mid + (hi - mid) * ((t - 0.55) / 0.45))
    im[..., :3] = np.where(rim[..., None], col, im[..., :3])
    return Image.fromarray(np.clip(im, 0, 255).astype(np.uint8))


def frames():
    import os
    os.makedirs(HERE + 'frames', exist_ok=True)
    f = clean(HERE + FRAME_PICK)
    side = max(f.size)
    sq = Image.new('RGBA', (side, side))
    sq.alpha_composite(f, ((side - f.width) // 2, (side - f.height) // 2))
    for tier in ('gold', 'silver', 'bronze'):
        recolour(sq, tier).save(HERE + f'frames/frame-{tier}.png')


def badge(tier, symbol_path, out, scale=0.66):
    frame = Image.open(HERE + f'frames/frame-{tier}.png').convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    sym = clean(symbol_path)
    box = SIZE * scale
    s = min(box / sym.width, box / sym.height)
    sym = sym.resize((max(1, round(sym.width * s)), max(1, round(sym.height * s))), Image.LANCZOS)
    x, y = (SIZE - sym.width) // 2, (SIZE - sym.height) // 2
    # A soft dark shadow under the symbol so it lifts off the disc.
    sh = Image.new('RGBA', (SIZE, SIZE))
    dark = Image.new('RGBA', sym.size, (0, 0, 0, 255))
    dark.putalpha(sym.getchannel('A').point(lambda v: v * 0.55))
    sh.alpha_composite(dark, (x + 2, y + 3))
    sh = sh.filter(ImageFilter.GaussianBlur(3))
    frame.alpha_composite(sh)
    frame.alpha_composite(sym, (x, y))
    frame.save(out, 'WEBP', quality=90, method=6, alpha_quality=100)


if __name__ == '__main__':
    if sys.argv[1] == 'frames':
        frames()
    else:
        _, _, _id, tier, sym, out, *rest = sys.argv
        badge(tier, sym, out, float(rest[0]) if rest else 0.66)
