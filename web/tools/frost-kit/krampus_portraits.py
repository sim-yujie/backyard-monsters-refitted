"""Krampus (G6) portraits at levels 1-6, both looks, from the Codex painting art-samples/frost-tribe/k1/krampus-levels.png
(3x2 cells of 512 px on flat magenta: levels 1-3, then 4-6, all at one scale so the creature grows).

Run from the worktree root (numpy, scipy, Pillow):  python web/tools/frost-kit/krampus_portraits.py

Writes, as the other champions' (`web/src/game/portraits.ts`):
  web/public/portraits/G6-L<n>.webp        176 px, the whole frame (the creature grows with its level), Modern
  web/public/portraits/G6-L<n>-icon.webp    72 px trimmed to the creature, Modern
  server/public/assets/monsters/G6_L<n>-150.png   150 px whole frame, Classic (Flash tone: softer, a touch darker)
  server/public/assets/monsters/G6_L<n>-small.png  50 px trimmed, Classic
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from artlib import key  # noqa: E402

SRC = REPO / "art-samples" / "frost-tribe" / "k1" / "krampus-levels.png"
PORTRAITS = REPO / "web" / "public" / "portraits"
MON = REPO / "server" / "public" / "assets" / "monsters"


def unlilac(im):
    """Magenta ground spill leaves the grey fur lilac: turn purple-ish greys toward cool ice blue (hue 225)."""
    rgba = np.asarray(im).astype(np.float32)
    hsv = np.asarray(im.convert("RGB").convert("HSV")).astype(np.float32)
    h = hsv[..., 0] * 360 / 255
    s = hsv[..., 1] / 255
    w = np.clip(1 - np.abs(h - 268) / 40, 0, 1) * np.clip((0.6 - s) / 0.2, 0, 1) * np.clip((h - 235) / 10, 0, 1)
    shifted = hsv.copy()
    shifted[..., 0] = ((h - 40 * w) % 360) * 255 / 360
    rgb = np.asarray(Image.fromarray(shifted.astype(np.uint8), "HSV").convert("RGB")).astype(np.float32)
    out = rgba.copy()
    out[..., :3] = rgb
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def with_shadow(cell):
    """A soft dark ground shadow under the feet, as the real champion portraits have."""
    a = np.asarray(cell)[..., 3]
    ys, xs = np.where(a > 128)
    x0, x1, y1 = int(xs.min()), int(xs.max()), int(ys.max())
    w = float(x1 - x0)
    sh = Image.new("L", cell.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(sh).ellipse((x0 + w * 0.04, y1 - w * 0.09, x1 - w * 0.02, y1 + w * 0.05), fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(w * 0.035))
    base = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    base.putalpha(sh)
    base.alpha_composite(cell)
    return base


def trim_square(im, size, pad=0.04):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 40)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * pad))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im.crop((x0, y0, x1, y1)), ((side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2))
    return sq.resize((size, size), Image.LANCZOS)


def flash_tone(im):
    rgb = im.convert("RGB").filter(ImageFilter.GaussianBlur(0.4))
    rgb = ImageEnhance.Brightness(ImageEnhance.Contrast(rgb).enhance(0.95)).enhance(0.97)
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def levels():
    sheet = Image.open(SRC).convert("RGB").resize((1536, 1024), Image.LANCZOS)
    for n in range(6):
        cell = sheet.crop(((n % 3) * 512, (n // 3) * 512, (n % 3) * 512 + 512, (n // 3) * 512 + 512))
        cell = unlilac(key(cell))
        al = np.asarray(cell)[..., 3].copy()
        al[:6], al[-6:], al[:, :6], al[:, -6:] = 0, 0, 0, 0
        cell.putalpha(Image.fromarray(al))
        yield n + 1, cell


def main():
    for level, cell in levels():
        whole = with_shadow(cell)
        whole.resize((176, 176), Image.LANCZOS).save(PORTRAITS / f"G6-L{level}.webp", quality=90, method=6)
        trim_square(cell, 72).save(PORTRAITS / f"G6-L{level}-icon.webp", quality=90, method=6)
        flash_tone(whole.resize((150, 150), Image.LANCZOS)).save(MON / f"G6_L{level}-150.png", optimize=True)
        flash_tone(trim_square(whole, 50)).save(MON / f"G6_L{level}-small.png", optimize=True)
        print("G6 level", level)


if __name__ == "__main__":
    main()
