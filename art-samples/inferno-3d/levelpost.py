"""levelpost.py : the game pieces and a contact sheet for an Inferno tower's three levels (buildings-3d-4, 29 Oct 2026), from
the renders render/tT (level 1), render/tT-look2 and render/tT-look3 (inferno3d.py with INFERNO_LOOK=2|3; the owner's
levels: worn, Brimstone, Forged Steel, each taller than the last).

  python levelpost.py T

Writes tT-look2/ and tT-look3/ (body@2x.png, strip@2x.png, top@2x.png, strip.json, as infpost.py does for tT/) and
  levels-tT.png     the three levels in rows at 8 of the 32 headings, 3x game size
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from infpost import NAME, FlashTier, S  # noqa: E402
from infcheck import FLASH, GROUND_GAME  # noqa: E402

LEVELS = {1: "Level 1: worn", 2: "Level 2: Brimstone", 3: "Level 3: Forged Steel"}


class LevelTier(FlashTier):
    """One level of tower t: its renders under render/t{t}-look{look} (level 1: render/t{t})."""

    def __init__(self, cfg, t, look):
        self.tower, self.look = t, look
        super().__init__("spurtz", cfg, HERE, t if look == 1 else f"{t}-look{look}")

    def load_painted(self, cfg, t):
        FlashTier.load_painted(self, cfg, self.tower)


def main():
    t = int(sys.argv[1])
    S.GROUND = GROUND_GAME[t]
    cfg = dict(folder=FLASH[t][0], rest=30, turret_canvas=(200, 200))
    levels = [LevelTier(cfg, t, look) for look in (1, 2, 3)]
    heads = list(range(0, 32, 4))
    boxes = [T.frame(k).getbbox() for T in levels for k in heads]
    crop = (min(b[0] for b in boxes) - 6, min(b[1] for b in boxes) - 6, max(b[2] for b in boxes) + 6, max(b[3] for b in boxes) + 6)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    bw, bh = int(cw * 1.5), int(ch * 1.5)            # 3x game size (1.5 x the @2x)
    font, small = ImageFont.truetype("arialbd.ttf", 26), ImageFont.truetype("arialbd.ttf", 18)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    lab = 40
    g = Image.new("RGBA", (len(heads) * bw, lab + 3 * (lab + bh)), S.GIFBG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, g.width, lab), fill=dark)
    d.text((12, 6), f"{NAME[t]}: the three levels at 8 of the 32 headings (3x game size)", fill=white, font=font)
    for r, T in enumerate(levels):
        y = lab + r * (lab + bh)
        d.rectangle((0, y, g.width, y + lab), fill=(48, 48, 48, 255))
        d.text((12, y + 8), LEVELS[T.look], fill=white, font=small)
        for i, k in enumerate(heads):
            g.alpha_composite(S.resize_pm(T.frame(k).crop(crop), (bw, bh)), (i * bw, y + lab))
            d.text((i * bw + 6, y + lab + 4), str(k), fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
    g.convert("RGB").save(HERE / f"levels-t{t}.png", optimize=True)
    for T in levels:
        print(T.t, "body", T.body_at, "pivot", T.pivot, "strip", [round(v, 2) for v in T.strip_at], T.cells[0].size)


if __name__ == "__main__":
    main()
