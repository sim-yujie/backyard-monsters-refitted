"""spurtzpost.py : the Spurtz Cannon's and Black Spurtz Cannon's game pieces and pictures from their renders (render/t1,
render/t2; see spurtz3d.py), as sqpost.py does for the square towers, but beside the Flash art (there is no painted one).

  python spurtzpost.py

Writes tN/ (body@2x.png, strip@2x.png, top@2x.png, strip.json: see sqpost.py) and
  flash-vs-3d.png       Flash | 3D, both towers, 6x game size, cropped
  contact-tN.png        the 3D tower at all 32 headings, 3x game size
  compare-turning-3x.gif   Flash (its own loop) above, 3D turning below, both towers
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import sqpost as S  # noqa: E402

FOLDER = {1: "spurtztower", 2: "blackspurtztower"}
NAME = {1: "Spurtz Cannon", 2: "Black Spurtz Cannon"}
GROUND = {1: (-1.5, 33.0), 2: (-1.5, 36.0)}     # the 3D ground middle, game px from the origin (fitted on the Flash base)
BASE_AT, TOP_AT, CELL = (-39, -35), (-27, -57), 54
# the Flash top's loop is not a heading strip (the game does not turn it); roughly where its nozzle points per frame
ANCHORS = [(0, -20.0), (4, 45.0), (8, 135.0), (20, 225.0), (28, 315.0), (31, 340.0)]


def flash_bearing(f):
    for (f0, b0), (f1, b1) in zip(ANCHORS, ANCHORS[1:]):
        if f0 <= f <= f1:
            return b0 + (b1 - b0) * (f - f0) / (f1 - f0)
    return ANCHORS[-1][1]


class FlashTier(S.Tier):
    def load_painted(self, cfg, t):
        folder = S.ASSETS / FOLDER[t]
        up = lambda im: im.resize((im.width * 2, im.height * 2), Image.LANCZOS)   # noqa: E731  1x -> @2x
        self.pbody, self.pbody_at = up(Image.open(folder / "normal_base.png").convert("RGBA")), BASE_AT
        s = Image.open(folder / "top-normal-anim.v2.png").convert("RGBA")
        self.flash_cells = [up(s.crop((k * CELL, 0, (k + 1) * CELL, s.height))) for k in range(s.width // CELL)][:31]
        self.pstrip_at = TOP_AT
        bears = [flash_bearing(f) for f in range(len(self.flash_cells))]
        # pcells[k]: the Flash frame pointing nearest heading k of 32
        self.pcells = [self.flash_cells[min(range(len(bears)), key=lambda f: abs((bears[f] - 11.25 * k + 180) % 360 - 180))]
                       for k in range(32)]
        cfg["cell"] = lambda b: int(round((b % 360) / 11.25)) % 32


def main():
    tiers = []
    for t in (1, 2):
        S.GROUND = GROUND[t]
        cfg = dict(folder=FOLDER[t], rest=30, turret_canvas=(200, 200))
        tiers.append(FlashTier("spurtz", cfg, HERE, t))
    font, small = ImageFont.truetype("arialbd.ttf", 26), ImageFont.truetype("arialbd.ttf", 18)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    boxes = []
    for T in tiers:
        for k in range(32):
            boxes += [T.frame(k).getbbox(), T.frame(k, True).getbbox()]
    crop = (min(b[0] for b in boxes) - 6, min(b[1] for b in boxes) - 6, max(b[2] for b in boxes) + 6, max(b[3] for b in boxes) + 6)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]

    # ---- flash-vs-3d.png: 6x game size (3x the @2x), the rest heading
    S3 = 3
    w, h = cw * S3, ch * S3
    gap, lab = 24, 44
    g = Image.new("RGBA", (2 * w + 3 * gap, 2 * (h + lab) + gap), S.GIFBG)
    d = ImageDraw.Draw(g)
    for i, T in enumerate(tiers):
        y = i * (h + lab + gap)
        d.rectangle((0, y, g.width, y + lab), fill=dark)
        d.text((gap, y + 8), NAME[T.t], fill=white, font=font)
        for j, (flash, label) in enumerate(((True, "Flash"), (False, "3D"))):
            x = gap + j * (w + gap)
            g.alpha_composite(S.resize_pm(T.frame(30, flash).crop(crop), (w, h)), (x, y + lab))
            d.text((x + 6, y + lab + 6), label, fill=white, font=font, stroke_width=3, stroke_fill=(0, 0, 0))
    g.convert("RGB").save(HERE / "flash-vs-3d.png", optimize=True)

    # ---- contact-tN.png
    bw, bh = int(cw * 1.5), int(ch * 1.5)
    for T in tiers:
        cols, rows = 8, 4
        g = Image.new("RGBA", (cols * bw, lab + rows * bh), S.GIFBG)
        d = ImageDraw.Draw(g)
        d.rectangle((0, 0, g.width, lab), fill=dark)
        d.text((gap, 8), f"{NAME[T.t]}: the 32 headings (3x game size)", fill=white, font=font)
        for k in range(32):
            x, yy = (k % cols) * bw, lab + (k // cols) * bh
            g.alpha_composite(S.resize_pm(T.frame(k).crop(crop), (bw, bh)), (x, yy))
            d.text((x + 6, yy + 4), str(k), fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        g.convert("RGB").save(HERE / f"contact-t{T.t}.png", optimize=True)

    # ---- compare-turning-3x.gif: Flash's own loop above, 3D turning below (32 frames; Flash frame f = k * 31 // 32)
    pad = 8
    bg = Image.new("RGBA", (2 * bw + 3 * pad, 2 * bh + 3 * pad), S.GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            fl = Image.new("RGBA", (S.CW, S.CH))
            fl.alpha_composite(T.pbody, (S.OX + 2 * BASE_AT[0], S.OY + 2 * BASE_AT[1]))
            fl.alpha_composite(T.flash_cells[k * len(T.flash_cells) // 32], (S.OX + 2 * TOP_AT[0], S.OY + 2 * TOP_AT[1]))
            f.alpha_composite(S.resize_pm(fl.crop(crop), (bw, bh)), (pad + i * (bw + pad), pad))
            f.alpha_composite(S.resize_pm(T.frame(k).crop(crop), (bw, bh)), (pad + i * (bw + pad), 2 * pad + bh))
        d = ImageDraw.Draw(f)
        d.text((pad + 4, pad + 2), "Flash", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((pad + 4, 2 * pad + bh + 2), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        frames.append(f.convert("RGB"))
    S.gif(frames, HERE / "compare-turning-3x.gif")
    for T in tiers:
        print(T.t, "body", T.body_at, "pivot", T.pivot, "strip", [round(v, 2) for v in T.strip_at], T.cells[0].size)


main()
