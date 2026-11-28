"""Frost tribe portraits (both looks) from the Codex paintings, at the real cards' sizes and on the real cards' ground.

Run from the worktree root (numpy, scipy, Pillow):  python web/tools/frost-kit/frost_portraits.py

Inputs: art-samples/frost-tribe/f3/frost-set3-strong.png (Pokey, Fang, Eye-ra, Brain) and
        art-samples/frost-tribe/p1/frost-set4-strong.png (Ichi, Teratorn, Crabatron, Vorg), 2x2 grids of 768x512 cells.
Outputs, as the real portraits (`web/src/game/portraits.ts`):
  web/public/portraits/frost/<id>.webp           360x240 card (Modern)
  web/public/portraits/frost/<id>-icon.webp      112 px square round the creature (Modern)
  server/public/assets/monsters/frost/<id>-portrait.jpg  180x120 (Classic: the same painting at Flash's size and tone)
  server/public/assets/monsters/frost/<id>-small.png     45x40 cut-out with a soft shadow (Classic)
The Codex ground is a little cooler than the real cards' (known gap from the options round): the ground (and only the
ground: warm-neutral pixels near its brightness) is shifted to the real card's measured border colour.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ART = REPO / "art-samples" / "frost-tribe"
PORTRAITS = REPO / "web" / "public" / "portraits"
MON = REPO / "server" / "public" / "assets" / "monsters"
SETS = {"f3/frost-set3-strong.png": ["C1", "C8", "C5", "C9"], "p1/frost-set4-strong.png": ["C6", "C14", "C10", "C16"]}


def cells(path):
    im = Image.open(ART / path).convert("RGB").resize((1536, 1024), Image.LANCZOS)
    return [im.crop(((n % 2) * 768, (n // 2) * 512, (n % 2) * 768 + 768, (n // 2) * 512 + 512)) for n in range(4)]


def border_mean(a, w=12):
    b = np.concatenate([a[:w].reshape(-1, 3), a[-w:].reshape(-1, 3), a[:, :w].reshape(-1, 3), a[:, -w:].reshape(-1, 3)])
    return b.mean(0)


def match_ground(card, real):
    """Shift the warm-neutral ground of `card` (360x240) to the real card's border colour."""
    a = np.asarray(card).astype(np.float32)
    r = np.asarray(real.convert("RGB").resize(card.size, Image.LANCZOS)).astype(np.float32)
    delta = border_mean(r) - border_mean(a)
    g_lum = border_mean(a).mean()
    lum = a.mean(-1)
    warm = np.clip((a[..., 0] - a[..., 2] + 8) / 12, 0, 1)          # ice is blue (B > R): weight 0
    near = np.clip(1 - (np.abs(lum - g_lum) - 30) / 30, 0, 1)       # snow highlights and dark parts: weight 0
    w = ndi.gaussian_filter(warm * near, 1.5)[..., None]
    return Image.fromarray(np.clip(a + delta * w, 0, 255).astype(np.uint8), "RGB"), delta


def ground_model(a):
    """A smooth ground (bilinear between the four corner patches) to cut the creature against."""
    h, w, _ = a.shape
    p = 24
    c = [a[:p, :p], a[:p, -p:], a[-p:, :p], a[-p:, -p:]]
    tl, tr, bl, br = [x.reshape(-1, 3).mean(0) for x in c]
    yy, xx = np.mgrid[0:h, 0:w]
    fy, fx = (yy / (h - 1))[..., None], (xx / (w - 1))[..., None]
    return (tl * (1 - fx) + tr * fx) * (1 - fy) + (bl * (1 - fx) + br * fx) * fy


def cutout(cell):
    """The creature (and its shadow, darker than the ground) as RGBA."""
    a = np.asarray(cell).astype(np.float32)
    g = ground_model(a)
    d = np.sqrt(((a - g) ** 2).sum(-1))
    alpha = np.clip((d - 10) / 30, 0, 1)
    alpha[:8], alpha[-8:], alpha[:, :8], alpha[:, -8:] = 0, 0, 0, 0   # Codex leaves faint seams at the cell edges
    alpha = ndi.gaussian_filter(alpha, 0.8)
    # shadow: darker-than-ground soft areas become a black translucent shadow like the Flash smalls
    rgb = a
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def creature_box(alpha, thr=0.5):
    ys, xs = np.where(alpha > thr * 255)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def fit(im, box, size, pad=0.06):
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0) * (1 + 2 * pad)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # a square past the painting's edge is filled with its ground (each side's own edge colour, as the real icons)
    side = int(side)
    sq = Image.new("RGB", (side, side), tuple(int(v) for v in border_mean(np.asarray(im).astype(np.float32))))
    sq.paste(im, (int(side / 2 - cx), int(side / 2 - cy)))
    return sq.resize(size, Image.LANCZOS)


def main():
    for d in (PORTRAITS / "frost", MON / "frost"):
        d.mkdir(parents=True, exist_ok=True)
    for path, ids in SETS.items():
        for mid, cell in zip(ids, cells(path)):
            real = Image.open(PORTRAITS / f"{mid}.webp")
            card, delta = match_ground(cell.resize((360, 240), Image.LANCZOS), real)
            card.save(PORTRAITS / "frost" / f"{mid}.webp", quality=90, method=6)
            big, _ = match_ground(cell, real)
            cut = cutout(cell)
            box = creature_box(np.asarray(cut)[..., 3])
            fit(big, box, (112, 112)).save(PORTRAITS / "frost" / f"{mid}-icon.webp", quality=90, method=6)
            classic = card.resize((180, 120), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
            classic = ImageEnhance.Brightness(ImageEnhance.Color(classic).enhance(1.05)).enhance(1.02)
            classic.save(MON / "frost" / f"{mid}-portrait.jpg", quality=88)
            # Classic small: the cut-out, 45x40, creature filling it as the Flash smalls do
            x0, y0, x1, y1 = box
            bw, bh = x1 - x0, y1 - y0
            s = min(43 / bw, 38 / bh)
            small = cut.crop(box).resize((max(1, round(bw * s)), max(1, round(bh * s))), Image.LANCZOS)
            canvas = Image.new("RGBA", (45, 40), (255, 255, 255, 0))
            canvas.alpha_composite(small, ((45 - small.width) // 2, 40 - small.height - 1))
            canvas.save(MON / "frost" / f"{mid}-small.png", optimize=True)
            print(mid, "ground shift", np.round(delta, 1))


if __name__ == "__main__":
    main()
