"""Krampus (G6) battle sheets for levels 1-6, both looks, from six Codex sheets.

Run from the worktree root (numpy, scipy, Pillow):  python web/tools/frost-kit/krampus_sheets.py

Inputs: art-samples/frost-tribe/kb-<look>-<walk|attack>/sheet.png, 5 columns (headings: front, front-left, left,
back-left, back) x 4 rows (frames) on flat magenta; looks kid (levels 1-2), beast (3-4), armour (5-6), like
Krallen's three looks over her levels.

Sheet layout (`krampusSprites.ts`): 8 headings, `directionOffset` -22.5, so column 0 faces right (E), 1 SE, 2 S
(towards the viewer), 3 SW, 4 W, 5 NW, 6 N, 7 NE; columns 2-6 are painted, 0, 1 and 7 are 4, 3 and 5 mirrored about
the anchor (a goat is left/right symmetric). Rows 0-3 the walk, rows 4-7 the attack. The body is scaled so its
front-left idle stands BODY_H[level] px tall at 1x (Gorgo L1 35, L3 55, L6 67; Korath L3 54; Drull L6 82), its
hooves on the anchor, with a soft ground shadow baked in as Korath's and Krallen's repaints have.

Writes server/public/assets/monsters/:
  krampus_<n>.png              1x, Flash tone (Classic look; the table row's `file`)
  krampus_<n>-anim@2x.png      the painted sheet (Modern, High), and its Quality copies
  krampus_<n>-anim@1.5x.png    (Medium) and krampus_<n>-anim.png (Low), as sheet_copies.py names them.
Prints each level's frame size and anchor for krampusSprites.ts.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ART = REPO / "art-samples" / "frost-tribe"
OUT = REPO / "server" / "public" / "assets" / "monsters"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from krampus_portraits import unlilac  # noqa: E402

LOOK = {1: "kid", 2: "kid", 3: "beast", 4: "beast", 5: "armour", 6: "armour"}
BODY_H = {1: 34, 2: 42, 3: 54, 4: 62, 5: 72, 6: 82}
PAINTED = {2: 0, 3: 1, 4: 2, 5: 3, 6: 4}     # sheet column <- painted column
MIRROR = {1: 3, 0: 4, 7: 5}                   # sheet column <- sheet column mirrored
UP = 2                                         # the painted sheet's resolution


def key_magenta(im):
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g
    alpha = np.clip(1 - (m - 50) / 80, 0, 1)
    # despill the half-keyed edge toward the green channel's grey
    t = np.clip((m - 20) / 110, 0, 1)
    k = g + (np.minimum(r, b) - g) * (1 - t) * 0.3
    r2 = np.where(m > 20, np.minimum(r, np.maximum(k, g)), r)
    b2 = np.where(m > 20, np.minimum(b, np.maximum(k, g)), b)
    alpha[:, :] = ndi.minimum_filter(alpha, 3) * 0.5 + alpha * 0.5
    out = np.dstack([r2, g, b2, alpha * 255]).astype(np.uint8)
    return unlilac(Image.fromarray(out, "RGBA"))


def cells(path):
    im = key_magenta(Image.open(path).convert("RGB").resize((1535, 1024), Image.LANCZOS))
    cw, ch = 307, 256
    grid = [[im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)) for c in range(5)] for r in range(4)]
    for row in grid:
        for n, cell in enumerate(row):
            al = np.asarray(cell)[..., 3].copy()
            al[:4], al[-4:], al[:, :4], al[:, -4:] = 0, 0, 0, 0
            lab, count = ndi.label(al > 60)
            if count > 1:   # keep the body (largest piece) and anything close to it
                sizes = ndi.sum(np.ones_like(al), lab, range(1, count + 1))
                main = int(np.argmax(sizes)) + 1
                near = ndi.binary_dilation(lab == main, iterations=12)
                al = np.where(near, al, 0)
            cell.putalpha(Image.fromarray(al))
            row[n] = cell
    return grid


def body(cell):
    al = np.asarray(cell)[..., 3]
    ys, xs = np.where(al > 128)
    y1 = ys.max()
    band = ys > y1 - (y1 - ys.min()) * 0.12
    return xs.min(), ys.min(), xs.max() + 1, y1 + 1, float(np.median(xs[band]))


def build(look):
    walk = cells(ART / f"kb-{look}-walk" / "sheet.png")
    attack = cells(ART / f"kb-{look}-attack" / "sheet.png")
    # one scale per look: the front-left idle's height; the attack sheet matched to the walk by body area
    h_idle = np.median([body(walk[r][1])[3] - body(walk[r][1])[1] for r in range(4)])
    area = lambda grid: np.median([(np.asarray(c)[..., 3] > 128).sum() for row in grid for c in row])
    attack_scale = float(np.sqrt(area(walk) / area(attack)))
    return walk, attack, h_idle, attack_scale


def place(cell, scale, foot, fw, fh, ax, ay, flip=False):
    """The cell scaled, its ground point (foot) on the anchor, in an fw x fh frame (at UP x)."""
    w, h = cell.size
    s = cell.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    fx, fy = foot[0] * scale, foot[1] * scale
    if flip:
        s = s.transpose(Image.FLIP_LEFT_RIGHT)
        fx = s.width - fx
    frame = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    frame.alpha_composite(s, (round(ax - fx), round(ay - fy)))   # alpha_composite clips at the edges
    return frame


def shadow(fw, fh, ax, ay, width):
    width = float(width)
    sh = Image.new("L", (fw, fh), 0)
    ImageDraw.Draw(sh).ellipse((ax - width * 0.5, ay - width * 0.16, ax + width * 0.5, ay + width * 0.12), fill=105)
    sh = sh.filter(ImageFilter.GaussianBlur(width * 0.06))
    layer = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    layer.putalpha(sh)
    return layer


def flash_tone(im):
    rgb = im.convert("RGB").filter(ImageFilter.GaussianBlur(0.3))
    rgb = ImageEnhance.Brightness(ImageEnhance.Contrast(ImageEnhance.Color(rgb).enhance(0.9)).enhance(0.95)).enhance(0.95)
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def main():
    rows = {}
    looks = {look: build(look) for look in ("kid", "beast", "armour")}
    for level in range(1, 7):
        walk, attack, h_idle, attack_scale = looks[LOOK[level]]
        scale = BODY_H[level] * UP / h_idle
        grids = [(walk, 1.0), (attack, attack_scale)]
        # frame size: the largest scaled body (every painted cell), with room round it
        boxes = [body(c) for g, _ in grids for row in g for c in row]
        reach_x = max(max(bx1 - foot, foot - bx0) for bx0, _, bx1, _, foot in boxes) * scale * max(1, attack_scale)
        up = max(by1 - by0 for bx0, by0, bx1, by1, _ in boxes) * scale * max(1, attack_scale)
        fw = int(np.ceil((reach_x + 4 * UP) / UP)) * 2 * UP
        ay = int(np.ceil((up + 6 * UP) / UP)) * UP
        fh = ay + 8 * UP
        ax = fw // 2
        sheet = Image.new("RGBA", (fw * 8, fh * 8), (0, 0, 0, 0))
        idle_w = float(boxes[1][2] - boxes[1][0]) * float(scale)
        for g_index, (grid, gscale) in enumerate(grids):
            for pcol in range(5):
                feet = [body(grid[r][pcol]) for r in range(4)]
                foot = (float(np.median([f[4] for f in feet])), float(np.median([f[3] for f in feet])))
                for r in range(4):
                    cell = grid[r][pcol]
                    s = scale * gscale
                    row = g_index * 4 + r
                    for col, painted in PAINTED.items():
                        if painted != pcol:
                            continue
                        frame = shadow(fw, fh, ax, ay, idle_w * 0.85)
                        frame.alpha_composite(place(cell, s, foot, fw, fh, ax, ay))
                        sheet.alpha_composite(frame, (col * fw, row * fh))
                        for mcol, src in MIRROR.items():
                            if src == col:
                                m = frame.transpose(Image.FLIP_LEFT_RIGHT)
                                # the mirror keeps the anchor in the middle of the frame (fw even, ax = fw / 2)
                                sheet.alpha_composite(m, (mcol * fw, row * fh))
        name = f"krampus_{level}"
        sheet.save(OUT / f"{name}-anim@2x.png", optimize=True)
        sheet.resize((sheet.width * 3 // 4, sheet.height * 3 // 4), Image.LANCZOS).save(OUT / f"{name}-anim@1.5x.png", optimize=True)
        one = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
        one.save(OUT / f"{name}-anim.png", optimize=True)
        flash_tone(one).save(OUT / f"{name}.png", optimize=True)
        rows[level] = {"frameWidth": fw // UP, "frameHeight": fh // UP, "anchorX": ax // UP, "anchorY": ay // UP,
                       "width": one.width, "height": one.height}
        print(level, LOOK[level], rows[level], "attack scale", round(attack_scale, 3))
    (REPO / "web" / "tools" / "frost-kit" / "krampus-frames.json").write_text(json.dumps(rows, indent=1) + "\n")


if __name__ == "__main__":
    main()
