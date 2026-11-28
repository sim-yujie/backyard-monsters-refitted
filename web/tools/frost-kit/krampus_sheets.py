"""Krampus (G6) battle sheets for levels 1-6, both looks: walk painted (Codex), attack and stomp moved from it.

Run from the worktree root (numpy, scipy, Pillow, imagequant), then `python web/tools/sheet_copies.py` for the
Quality copies and `sheetVersions.ts`:  python web/tools/frost-kit/krampus_sheets.py

Inputs, 5 columns (headings: front, front-left, left, back-left, back) x 4 rows (walk frames) on flat magenta; looks
kid (levels 1-2), beast (3-4), armour (5-6), like Krallen's three looks over her levels:
  Modern   art-samples/frost-tribe/kb-<look>-walk/sheet.png
  Classic  art-samples/frost-tribe/classic/cl-<look>-walk/sheet.png (the Modern sheet redrawn in the Flash render look)
The attack (10 frames) and stomp (9 frames) are each heading's idle pose bent by `krampus_motion.py` (owner,
28 Nov 2026: the painted attack frames were "horrendous"; one body in every frame now).

Sheet layout (`krampusSprites.ts`): 8 headings, `directionOffset` -22.5, so column 0 faces right (E), 1 SE, 2 S
(towards the viewer), 3 SW, 4 W, 5 NW, 6 N, 7 NE; columns 2-6 are painted, 0, 1 and 7 are 4, 3 and 5 mirrored about
the anchor (a goat is left/right symmetric). Rows 0-3 the walk, 4-13 the attack, 14-22 the stomp. The body is scaled
so its front-left idle stands BODY_H[level] px tall at 1x (Gorgo L1 35, L3 55, L6 67; Korath L3 54; Drull L6 82),
its hooves on the anchor, with a soft ground shadow baked in as Korath's and Krallen's repaints have. Both looks share
one frame size and anchor, so one table row serves both.

Writes server/public/assets/monsters/:
  krampus_<n>.png              1x, the Classic look (the table row's `file`)
  krampus_<n>-anim@2x.png      the Modern sheet (High), and its Quality copies
  krampus_<n>-anim@1.5x.png    (Medium) and krampus_<n>-anim.png (Low), as sheet_copies.py names them.
Prints each level's frame size and anchor for krampusSprites.ts.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

REPO = Path(__file__).resolve().parents[3]
ART = REPO / "art-samples" / "frost-tribe"
OUT = REPO / "server" / "public" / "assets" / "monsters"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from krampus_portraits import unlilac  # noqa: E402
from krampus_motion import ATTACK_FRAMES, STOMP_FRAMES, motion  # noqa: E402

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


WALK_FRAMES = 4
PAD = 80


def pad(cell):
    out = Image.new("RGBA", (cell.width + 2 * PAD, cell.height + 2 * PAD), (0, 0, 0, 0))
    out.paste(cell, (PAD, PAD))
    return out
SOURCES = {
    "modern": lambda look: ART / f"kb-{look}-walk" / "sheet.png",
    "classic": lambda look: ART / "classic" / f"cl-{look}-walk" / "sheet.png",
}


def build(style, look):
    """Every cell of one look: [kind rows][painted heading], and the front-left idle's height."""
    # room round each painted cell for the lunge and the rear-up to move into
    walk = [[pad(cell) for cell in row] for row in cells(SOURCES[style](look))]
    rows = [list(row) for row in walk]
    for kind, count in (("attack", ATTACK_FRAMES), ("stomp", STOMP_FRAMES)):
        for f in range(count):
            rows.append([motion(walk[0][h], h, kind, f) for h in range(5)])
    h_idle = np.median([body(walk[r][1])[3] - body(walk[r][1])[1] for r in range(WALK_FRAMES)])
    return rows, h_idle


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


def save(im, path):
    """Saved as a palette PNG (libimagequant, as `sheet_copies.py` quantises): a tenth of the bytes."""
    import imagequant
    try:
        small = imagequant.quantize_pil_image(im, max_quality=95, min_quality=60)
    except RuntimeError:
        small = imagequant.quantize_pil_image(im, max_quality=95, min_quality=0)
    small.save(path, optimize=True)


def main():
    rows = {}
    looks = {(style, look): build(style, look) for style in SOURCES for look in ("kid", "beast", "armour")}
    for level in range(1, 7):
        built = {style: looks[(style, LOOK[level])] for style in SOURCES}
        scales = {style: BODY_H[level] * UP / h_idle for style, (_, h_idle) in built.items()}
        # frame size: the largest scaled body of either look (every cell), measured from the ground point
        # each cell is placed on (its heading's walk foot), so a lunge that moves the whole body stays inside
        reach_x = up = down = 0.0
        for style, (grid, _) in built.items():
            for pcol in range(5):
                feet = [body(grid[r][pcol]) for r in range(WALK_FRAMES)]
                fx = float(np.median([f[4] for f in feet]))
                fy = float(np.median([f[3] for f in feet]))
                for row in grid:
                    bx0, by0, bx1, by1, _ = body(row[pcol])
                    reach_x = max(reach_x, max(bx1 - fx, fx - bx0) * scales[style])
                    up = max(up, (fy - by0) * scales[style])
                    down = max(down, (by1 - fy) * scales[style])
        fw = int(np.ceil((reach_x + 4 * UP) / UP)) * 2 * UP
        # 1x height even, so the Medium copy (3/4 of the 2x sheet) is whole pixels
        ay = int(np.ceil((up + 6 * UP) / (2 * UP))) * 2 * UP
        # 8 px under the hooves at least, for the baked shadow (as before)
        fh = ay + max(8 * UP, int(np.ceil((max(down, 0) + 6 * UP) / (2 * UP))) * 2 * UP)
        ax = fw // 2
        for style, (grid, _) in built.items():
            scale = scales[style]
            nrows = len(grid)
            sheet = Image.new("RGBA", (fw * 8, fh * nrows), (0, 0, 0, 0))
            idle = body(grid[0][1])
            idle_w = float(idle[2] - idle[0]) * float(scale)
            for pcol in range(5):
                # one ground point per heading, from its walk frames, so the moved frames stand where the walk does
                feet = [body(grid[r][pcol]) for r in range(WALK_FRAMES)]
                foot = (float(np.median([f[4] for f in feet])), float(np.median([f[3] for f in feet])))
                for r in range(nrows):
                    frame = shadow(fw, fh, ax, ay, idle_w * 0.85)
                    frame.alpha_composite(place(grid[r][pcol], scale, foot, fw, fh, ax, ay))
                    for col, painted in PAINTED.items():
                        if painted == pcol:
                            sheet.alpha_composite(frame, (col * fw, r * fh))
                    for mcol, src in MIRROR.items():
                        if PAINTED.get(src) == pcol:
                            # the mirror keeps the anchor in the middle of the frame (fw even, ax = fw / 2)
                            sheet.alpha_composite(frame.transpose(Image.FLIP_LEFT_RIGHT), (mcol * fw, r * fh))
            name = f"krampus_{level}"
            one = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
            if style == "modern":
                save(sheet, OUT / f"{name}-anim@2x.png")
                save(sheet.resize((sheet.width * 3 // 4, sheet.height * 3 // 4), Image.LANCZOS), OUT / f"{name}-anim@1.5x.png")
                save(one, OUT / f"{name}-anim.png")
            else:
                save(one, OUT / f"{name}.png")
        rows[level] = {"frameWidth": fw // UP, "frameHeight": fh // UP, "anchorX": ax // UP, "anchorY": ay // UP,
                       "rows": nrows, "width": fw * 8 // UP, "height": fh * nrows // UP}
        print(level, LOOK[level], rows[level])
    (REPO / "web" / "tools" / "frost-kit" / "krampus-frames.json").write_text(json.dumps(rows, indent=1) + "\n")


if __name__ == "__main__":
    main()
