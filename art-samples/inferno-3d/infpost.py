"""infpost.py : the Inferno towers' game pieces and pictures from their renders (render/t1..t3; see inferno3d.py), as
sqpost.py does for the square towers, beside the Flash art (there is no painted one).

  python infpost.py

Writes tN/ (body@2x.png, strip@2x.png, top@2x.png, strip.json: see sqpost.py) and
  flash-vs-3d.png       Flash | 3D, the three towers, 6x game size, cropped
  contact-tN.png        the 3D tower at all 32 headings, 3x game size
  compare-turning-3x.gif   Flash above, 3D below, the three towers turning
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import sqpost as S  # noqa: E402
sys.path.insert(0, str(HERE))
from infcheck import FLASH, GROUND_GAME  # noqa: E402

NAME = {1: "Inferno Blast Tower", 2: "Sharpshooter", 3: "Magma Tower"}
S.BODY_G = (320, 590)                     # inferno3d.py's taller body canvas


class FlashTier(S.Tier):
    def load_painted(self, cfg, t):
        folder, top, anims = FLASH[t]
        up = lambda im: im.resize((im.width * 2, im.height * 2), Image.LANCZOS)   # noqa: E731  1x -> @2x
        # the still parts (the top, and the Magma's glow ring at its first cell) on one 1x canvas
        parts = [(Image.open(S.ASSETS / folder / top[0]).convert("RGBA"), top[1], top[2])]
        for name, x, y, w, h in anims[1:]:
            parts.append((Image.open(S.ASSETS / folder / name).convert("RGBA").crop((0, 0, w, h)), x, y))
        x0, y0 = min(p[1] for p in parts), min(p[2] for p in parts)
        x1, y1 = max(p[1] + p[0].width for p in parts), max(p[2] + p[0].height for p in parts)
        base = Image.new("RGBA", (x1 - x0, y1 - y0))
        for im, x, y in parts:
            base.alpha_composite(im, (x - x0, y - y0))
        self.pbody, self.pbody_at = up(base), (x0, y0)
        name, x, y, w, h = anims[0]
        s = Image.open(S.ASSETS / folder / name).convert("RGBA")
        self.flash_cells = [up(s.crop((k * w, 0, (k + 1) * w, h))) for k in range(s.width // w)]
        self.pstrip_at = (x, y)
        n = len(self.flash_cells)                 # the Flash cell for heading k: bearing 11.25 k (towerFx FACING)
        self.pcells = [self.flash_cells[min(k, n - 1)] for k in range(32)]
        cfg["cell"] = lambda b: int(round((b % 360) / 11.25)) % 32


def main():
    tiers = []
    for t in (1, 2, 3):
        S.GROUND = GROUND_GAME[t]
        cfg = dict(folder=FLASH[t][0], rest=30, turret_canvas=(200, 200))
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
    g = Image.new("RGBA", (2 * w + 3 * gap, 3 * (h + lab) + 2 * gap), S.GIFBG)
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
    bg = Image.new("RGBA", (3 * bw + 4 * pad, 2 * bh + 3 * pad), S.GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            f.alpha_composite(S.resize_pm(T.frame(k, True).crop(crop), (bw, bh)), (pad + i * (bw + pad), pad))
            f.alpha_composite(S.resize_pm(T.frame(k).crop(crop), (bw, bh)), (pad + i * (bw + pad), 2 * pad + bh))
        d = ImageDraw.Draw(f)
        d.text((pad + 4, pad + 2), "Flash", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((pad + 4, 2 * pad + bh + 2), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        frames.append(f.convert("RGB"))
    S.gif(frames, HERE / "compare-turning-3x.gif")
    for T in tiers:
        print(T.t, "body", T.body_at, "pivot", T.pivot, "strip", [round(v, 2) for v in T.strip_at], T.cells[0].size)


if __name__ == "__main__":
    main()
