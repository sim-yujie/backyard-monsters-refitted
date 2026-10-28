"""sqpost.py : turn a square tower's Blender renders (<tower>-3d/render/tN/, see square3d.py) into its game pieces and the
pictures for the owner (buildings-3d, 28 Oct 2026).

  python sqpost.py aerial|railgun

Writes into <tower>-3d/:
  tN/body@2x.png      the body without its turret, @2x, cropped (its top-left in game px is strip.json's body_entry)
  tN/strip@2x.png     the turret at 32 headings, @2x, one row, cell k = ground bearing 11.25 k (0 down-right on screen,
                      45 at the viewer); every cell cut round the pivot, the body's parts in front of the turret cut out
  tN/top@2x.png       the whole tower at its resting heading (REST), for icons
  tN/strip.json       the rows for buildingArtTiers.ts (body_entry, strip_entry, pivot, top_entry, all game px from the
                      building's origin), the cell size and the pivot in a cell, and the aim fields (aim_fields.py)
  tN/body-4x.png, tN/turret-4x/hNN.png   the raw 4x renders
  tiers-compare.png   painted (above) and 3D (below), tiers 1-3, 3x game size; game size under them
  large-tN.png        painted | 3D, 6x game size, cropped to the tower
  contact-tN.png      the 3D tower at all 32 headings, 3x game size
  tiers-turning-3x.gif, compare-turning-3x.gif
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import aim_fields  # noqa: E402

ASSETS = Path("D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/buildings")   # read only: the painted tiers
GROUND = (0.0, 37.5)                   # square3d.GROUND
BODY_G = (320, 430)                    # square3d.BODY_CANVAS's ground pixel
# per tower: the painted folder, the painted turret rows (buildingArtTiers.ts: body x, y; strip x, y, w, h, cells), the
# painted strip's cell for a ground bearing (towerFx.ts FACING), the resting heading of the stills (cell of 32)
TOWERS = {
    "aerial": dict(folder="flaktower", rest=28, turret_canvas=(240, 300),
                   painted={1: ((-39, 4), (-27, -17, 54, 43, 30)), 2: ((-39, -1), (-28, -21, 57, 43, 30)),
                            3: ((-39, -13), (-25, -33, 51, 42, 30))},
                   cell=lambda b: min(int((b % 360) // 12), 29)),
    "railgun": dict(folder="railguntower", rest=28, turret_canvas=(260, 260),
                    painted={1: ((-36, 10), (-36, -7, 77, 57, 30)), 2: ((-36, -2), (-38, -21, 75, 57, 30)),
                             3: ((-36, -9), (-40, -29, 77, 59, 30))},
                    cell=lambda b: min(int((b % 360) // 12), 29)),   # as drawn (towerFx's +30 is Flash's aim quirk)
}
GIFBG = (92, 136, 60, 255)
OX, OY, CW, CH = 160, 260, 320, 420     # the 2x picture canvas: the building's origin at (OX, OY)


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in ch], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def even_box(b):
    """A 4x box grown to multiples of 4 (whole 1x pixels)."""
    return b[0] // 4 * 4, b[1] // 4 * 4, -(-b[2] // 4) * 4, -(-b[3] // 4) * 4


def gif(frames, path, ms=90, colors=160):
    w, h = frames[0].size
    some = frames[::4]
    m = Image.new("RGB", (w * len(some), h))
    for i, f in enumerate(some):
        m.paste(f, (i * w, 0))
    pal = m.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.NONE)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0, disposal=1, optimize=True)


class Tier:
    def __init__(self, tower, cfg, base, t):
        self.t, self.cfg = t, cfg
        R, out = base / "render" / f"t{t}", base / f"t{t}"
        (out / "turret-4x").mkdir(parents=True, exist_ok=True)
        cam = json.loads((R / "camera.json").read_text())
        shutil.copy(R / "body-4x.png", out / "body-4x.png")
        for k in range(32):
            shutil.copy(R / "turret-4x" / f"h{k:02d}.png", out / "turret-4x" / f"h{k:02d}.png")
        gx, gy = BODY_G

        def game(px, py):       # 4x body-canvas pixel -> game px from the building's origin
            return (px - gx) / 4 + GROUND[0], (py - gy) / 4 + GROUND[1]

        body4 = Image.open(R / "body-4x.png").convert("RGBA")
        b = even_box(body4.getbbox())
        self.body = resize_pm(body4.crop(b), ((b[2] - b[0]) // 2, (b[3] - b[1]) // 2))
        self.body.save(out / "body@2x.png", optimize=True)
        self.body_at = tuple(round(v) for v in game(b[0], b[1]))
        self.pivot = tuple(round(v, 2) for v in game(*cam["body_pivot_4x"]))
        # the turret cells: what any heading covers, round the pivot, in whole 1x px
        tx, ty = cfg["turret_canvas"]
        tur4 = [Image.open(R / "turret-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
        bbs = [im.getbbox() for im in tur4]
        box = even_box((min(b_[0] for b_ in bbs) - 2, min(b_[1] for b_ in bbs) - 2,
                        max(b_[2] for b_ in bbs) + 2, max(b_[3] for b_ in bbs) + 2))
        # keep the pivot's fraction: shift the box so the pivot sits on the same sub-pixel as on the body canvas
        cw, ch = (box[2] - box[0]) // 2, (box[3] - box[1]) // 2
        self.cells = [resize_pm(im.crop(box), (cw, ch)) for im in tur4]
        self.cpiv = ((tx - box[0]) / 2, (ty - box[1]) / 2)
        strip = Image.new("RGBA", (cw * 32, ch))
        for k, c in enumerate(self.cells):
            strip.alpha_composite(c, (k * cw, 0))
        strip.save(out / "strip@2x.png", optimize=True)
        sx, sy = self.pivot[0] - self.cpiv[0] / 2, self.pivot[1] - self.cpiv[1] / 2
        self.strip_at = (sx, sy)
        still = self.frame(cfg["rest"])
        sb = still.getbbox()
        sb = (sb[0] - sb[0] % 2, sb[1] - sb[1] % 2, sb[2] + sb[2] % 2, sb[3] + sb[3] % 2)
        still.crop(sb).save(out / "top@2x.png", optimize=True)
        (out / "strip.json").write_text(aim_fields.dumps(dict(
            tier=t, cells=32, cell_w_2x=cw, cell_h_2x=ch, pivot_in_cell_2x=[round(v, 2) for v in self.cpiv],
            body_entry=[f"body.t{t}@2x.png", *self.body_at],
            strip_entry=[f"turret.t{t}@2x.png", round(sx, 2), round(sy, 2), cw / 2, ch / 2, 32],
            pivot=list(self.pivot),
            top_entry=[f"top.t{t}@2x.png", (sb[0] - OX) // 2, (sb[1] - OY) // 2],
            rule="cell k = ground bearing 11.25k (0 down-right on screen, 45 at the viewer); the barrels at one fixed "
                 "raise; the game picks the cell by aim_deg and starts the shot at muzzle",
            note="all entries game px from the building's origin; body@2x.png and the cells are @2x. Nothing of the "
                 "body is drawn in front of the turret: its parts in front are cut out of every cell, so no front layer.")))
        aim_fields.merge(out / "strip.json", json.loads((R / "aim.json").read_text()),
                         dict(camera_elevation_deg=cam["elevation"]))
        # the painted pieces
        folder = ASSETS / cfg["folder"]
        (pbx, pby), (psx, psy, pw, ph, pn) = cfg["painted"][t]
        self.pbody, self.pbody_at = Image.open(folder / f"body.t{t}@2x.webp").convert("RGBA"), (pbx, pby)
        ps = Image.open(folder / f"turret.t{t}@2x.webp").convert("RGBA")
        cw2 = ps.width // pn
        self.pcells = [ps.crop((k * cw2, 0, (k + 1) * cw2, ps.height)) for k in range(pn)]
        self.pstrip_at = (psx, psy)

    def frame(self, k, painted=False):
        """The whole tower at heading k (of 32), @2x, the building's origin at (OX, OY)."""
        f = Image.new("RGBA", (CW, CH))
        if painted:
            f.alpha_composite(self.pbody, (OX + 2 * self.pbody_at[0], OY + 2 * self.pbody_at[1]))
            cell = self.pcells[self.cfg["cell"](11.25 * k)]
            f.alpha_composite(cell, (OX + 2 * self.pstrip_at[0], OY + 2 * self.pstrip_at[1]))
        else:
            f.alpha_composite(self.body, (OX + 2 * self.body_at[0], OY + 2 * self.body_at[1]))
            f.alpha_composite(self.cells[k], (round(OX + 2 * self.strip_at[0]), round(OY + 2 * self.strip_at[1])))
        return f


def main():
    tower = sys.argv[1]
    cfg = TOWERS[tower]
    base = HERE.parent / f"{tower}-3d"
    tiers = [Tier(tower, cfg, base, t) for t in (1, 2, 3)]
    boxes = []
    for T in tiers:
        for k in range(0, 32, 2):
            boxes += [T.frame(k).getbbox(), T.frame(k, True).getbbox()]
    crop = (min(b[0] for b in boxes) - 6, min(b[1] for b in boxes) - 6, max(b[2] for b in boxes) + 6, max(b[3] for b in boxes) + 6)
    cw, chh = crop[2] - crop[0], crop[3] - crop[1]
    font, small = ImageFont.truetype("arialbd.ttf", 26), ImageFont.truetype("arialbd.ttf", 18)
    white, dark = (255, 255, 255, 255), (20, 20, 20, 255)
    S = 1.5                                   # 3x game size
    bw, bh = int(cw * S), int(chh * S)
    gap, lab = 20, 40
    rest = cfg["rest"]

    # ---- tiers-compare.png
    W = 3 * bw + 4 * gap
    H = lab + 2 * bh + gap + lab + chh // 2 + gap
    g = Image.new("RGBA", (W, H), GIFBG)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, W, lab), fill=dark)
    for i, T in enumerate(tiers):
        x = gap + i * (bw + gap)
        d.text((x, 6), f"Tier {T.t}", fill=white, font=font)
        for j, painted in enumerate((True, False)):
            g.alpha_composite(resize_pm(T.frame(rest, painted).crop(crop), (bw, bh)), (x, lab + j * bh))
        d.text((x + 4, lab + 4), "painted", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((x + 4, lab + bh + 4), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
    y = lab + 2 * bh + gap
    d.rectangle((0, y, W, y + lab), fill=dark)
    d.text((gap, y + 6), "Game size (painted | 3D)", fill=white, font=font)
    for i, T in enumerate(tiers):
        x = gap + i * (bw + gap)
        for j, painted in enumerate((True, False)):
            im = resize_pm(T.frame(rest, painted).crop(crop), (cw // 2, chh // 2))
            g.alpha_composite(im, (x + bw // 2 - cw // 2 - 4 + j * (cw // 2 + 8), y + lab + gap // 2))
    g.convert("RGB").save(base / "tiers-compare.png", optimize=True)

    # ---- large-tN.png: painted | 3D at 6x game size, cropped to the tower, barrels down-right (heading 1)
    for T in tiers:
        a, b = T.frame(1, True), T.frame(1)
        ba, bb_ = a.getbbox(), b.getbbox()
        bx = (min(ba[0], bb_[0]) - 8, min(ba[1], bb_[1]) - 8, max(ba[2], bb_[2]) + 8, max(ba[3], bb_[3]) + 8)
        w, h = (bx[2] - bx[0]) * 3, (bx[3] - bx[1]) * 3
        g = Image.new("RGBA", (2 * w + gap, h + lab), GIFBG)
        d = ImageDraw.Draw(g)
        for i, (im, name) in enumerate(((a, "painted"), (b, "3D"))):
            g.alpha_composite(resize_pm(im.crop(bx), (w, h)), (i * (w + gap), lab))
            d.text((i * (w + gap) + 8, 6), f"Tier {T.t} {name}", fill=white, font=font, stroke_width=2, stroke_fill=(0, 0, 0))
        g.convert("RGB").save(base / f"large-t{T.t}.png", optimize=True)

    # ---- contact-tN.png: all 32 headings, 8 a row
    for T in tiers:
        cols, rows = 8, 4
        g = Image.new("RGBA", (cols * bw, lab + rows * bh), GIFBG)
        d = ImageDraw.Draw(g)
        d.rectangle((0, 0, g.width, lab), fill=dark)
        d.text((gap, 6), f"{tower.capitalize()} tier {T.t}: the 32 headings (3x game size)", fill=white, font=font)
        for k in range(32):
            x, yy = (k % cols) * bw, lab + (k // cols) * bh
            g.alpha_composite(resize_pm(T.frame(k).crop(crop), (bw, bh)), (x, yy))
            d.text((x + 6, yy + 4), str(k), fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        g.convert("RGB").save(base / f"contact-t{T.t}.png", optimize=True)

    # ---- the turning GIFs
    pad = 8
    W2 = 3 * bw + 2 * pad
    bg = Image.new("RGBA", (W2 + 2 * pad, bh + 2 * pad), GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            f.alpha_composite(resize_pm(T.frame(k).crop(crop), (bw, bh)), (pad + i * (bw + pad), pad))
        frames.append(f.convert("RGB"))
    gif(frames, base / "tiers-turning-3x.gif")
    bg = Image.new("RGBA", (W2 + 2 * pad, 2 * bh + 3 * pad), GIFBG)
    frames = []
    for k in range(32):
        f = bg.copy()
        for i, T in enumerate(tiers):
            for j, painted in enumerate((True, False)):
                f.alpha_composite(resize_pm(T.frame(k, painted).crop(crop), (bw, bh)), (pad + i * (bw + pad), pad + j * (bh + pad)))
        d = ImageDraw.Draw(f)
        d.text((pad + 4, pad + 2), "painted", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        d.text((pad + 4, 2 * pad + bh + 2), "3D", fill=white, font=small, stroke_width=2, stroke_fill=(0, 0, 0))
        frames.append(f.convert("RGB"))
    gif(frames, base / "compare-turning-3x.gif")
    for T in tiers:
        print(T.t, "body", T.body_at, "pivot", T.pivot, "strip", [round(v, 2) for v in T.strip_at], T.cells[0].size)


main()
