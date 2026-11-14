"""sheets.py : owner sheets for the high-res redraw of Flash's fortification (run after build.py).
Every scene is drawn as the yard draws it: ground, building shadow, back half, building, front half, with the
game's real pictures and Flash's offsets (web/src/game/yard/fortArt.ts) for both looks.
Run: ~/.cache/bymr-art-venv/bin/python sheets.py
"""
import json
import sys

import numpy as np
from PIL import Image

import fh
sys.path.insert(0, str(fh.HERE.parent / "b8"))
from b8lib import B, hstack, label, multiply, resize_pm, titled, vstack  # noqa: E402
from build_fort_final import F_HALL, F_SILO, F_TOWER, GRASS, SHOW, lava  # noqa: E402

OUT = fh.HERE / "out"
SHEETS = fh.HERE / "sheets"


def new_piece(size, half, tier):
    return Image.open(OUT / f"fort{size}_{half}{tier}.modern@2x.png").convert("RGBA")


def scene(key, new, tier, up):
    name, size, group, flash, top, tx, ty, sh, sx, sy, (w, h, ox, oy), ground = SHOW[key]
    bg = lava(w, h, up) if ground == "lava" else Image.new("RGB", (w, h), GRASS)
    bg = multiply(bg, Image.open(B / sh), ox + sx, oy + sy)
    c = bg.resize((w * up, h * up), Image.LANCZOS).convert("RGBA")

    def put(im, x, y, src=1):
        im = im.convert("RGBA")
        if up != src:
            im = resize_pm(im, (im.width * up // src, im.height * up // src))
        c.alpha_composite(im, (round((ox + x) * up), round((oy + y) * up)))

    def part(p):
        f = flash[tier - 1]
        x, y = f[2:] if p == "B" else f[:2]
        if new:
            put(new_piece(size, p, tier), x, y, 2)
        else:
            put(fh.flash(size, p, tier), x, y)

    part("B")
    put(Image.open(B / top), tx, ty, 2)
    part("F")
    return c.convert("RGB")


def overlay(size, half, tier, z=4):
    """Flash | new reduced to game size | new over Flash in two colours | new outline over Flash, all at z x."""
    fl = fh.flash(size, half, tier)
    vine, _ = fh.split(fl)
    new = Image.open(OUT / f"fort{size}_{half}{tier}.vines@2x.png").convert("RGBA")
    full = new_piece(size, half, tier)
    w, h = fl.size
    big = (w * z, h * z)

    def on_grass(im, how):
        c = Image.new("RGBA", big, GRASS + (255,))
        c.alpha_composite(im.resize(big, how) if how == Image.NEAREST else resize_pm(im, big))
        return c.convert("RGB")

    small = resize_pm(full, (w, h))
    f = np.asarray(vine.getchannel("A").resize(big, Image.BICUBIC), np.float32) / 255
    n = np.asarray(resize_pm(new, big).getchannel("A"), np.float32) / 255
    # red = Flash only, cyan = new only, white = both
    mix = np.dstack([f, n, n]) * 255
    both = Image.fromarray(np.clip(mix + 24, 0, 255).astype(np.uint8), "RGB")
    # the new piece's outline (yellow) drawn over Flash enlarged
    solid = n > 0.5
    p = np.pad(solid, 1)
    rim = solid & ~(p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:])
    base = np.asarray(on_grass(fl, Image.NEAREST)).copy()
    base[rim] = (255, 230, 0)
    cells = [label(on_grass(fl, Image.NEAREST), "Flash (game size, enlarged)", 16),
             label(on_grass(small, Image.NEAREST), "High-res reduced to game size", 16),
             label(both, "red = Flash only  cyan = new only  white = both", 16),
             label(Image.fromarray(base), "new outline (yellow) over Flash", 16)]
    return cells


if __name__ == "__main__":
    SHEETS.mkdir(exist_ok=True)
    rep = json.loads((OUT / "report.json").read_text())
    ups = {"townhall": 3, "tower": 5, "silo": 5, "underhall": 3}
    for key, up in ups.items():
        rows = []
        for tier in (1, 2, 3, 4):
            a = label(scene(key, False, tier, up), f"Fortify {tier}  Flash art (Classic, today)", fill=(255, 220, 150))
            b = label(scene(key, True, tier, up), f"Fortify {tier}  HIGH-RES Flash art (Modern)")
            rows.append(hstack([a, b]))
        titled(f"High-res Flash fortification on the {SHOW[key][0]} ({up}x)", vstack(rows), 34).save(SHEETS / f"fort-hires-{key}.png")
    rows = [hstack([scene(key, new, t, 1) for new in (False, True) for t in (1, 2, 3, 4)], 2) for key in SHOW]
    titled("True game size: Flash fortify 1-4, then high-res fortify 1-4", vstack(rows, 2), 22).save(SHEETS / "fort-hires-gamesize.png")
    # the same at 2x, what a sharp (retina / zoomed-in) screen shows
    rows = [hstack([scene(key, new, t, 2) for new in (False, True) for t in (1, 2, 3, 4)], 4) for key in SHOW]
    titled("Twice game size (zoomed in): Flash fortify 1-4, then high-res fortify 1-4", vstack(rows, 4), 30).save(SHEETS / "fort-hires-2x.png")
    for size, z in ((70, 4), (130, 3)):
        rows = []
        for tier in (1, 2, 3, 4):
            for half in "BF":
                cells = overlay(size, half, tier, z)
                r = rep[f"fort{size}_{half}{tier}"]
                txt = (f"size {size}  fortify {tier}  {'back' if half == 'B' else 'front'}:  {r['flash_covered']:.0%} of Flash's solid pixels covered, "
                       f"{r['flash_within_1px']:.0%} within 1 px;  outline {r['outline_px_flash_to_new']} px off on average")
                rows.append(titled(txt, hstack(cells, 6), 20))
        vstack(rows, 10).save(SHEETS / f"fort-hires-overlay-{size}.png")
    # the files as they are (2x) on grass and on dark: sharpness, fringe, the halves meeting
    for size, offs in ((70, F_TOWER), (130, F_HALL)):
        cells = []
        for tier in (1, 2, 3, 4):
            fx, fy, bx, by = offs[tier - 1]
            x0 = min(fx, bx) - 8
            y0 = by - 8
            fr, bk = new_piece(size, "F", tier), new_piece(size, "B", tier)
            w = max(fx + fr.width // 2, bx + bk.width // 2) - x0 + 8
            h = fy + fr.height // 2 - y0 + 8
            for bgc in (GRASS, (30, 30, 34)):
                c = Image.new("RGBA", (w * 2, h * 2), bgc + (255,))
                c.alpha_composite(bk, ((bx - x0) * 2, (by - y0) * 2))
                c.alpha_composite(fr, ((fx - x0) * 2, (fy - y0) * 2))
                cells.append(label(c.convert("RGB"), f"size {size} fortify {tier} (the files, 2x)", 20))
        vstack([hstack(cells[i:i + 2]) for i in range(0, 8, 2)]).save(SHEETS / f"fort-hires-ring-{size}.png")
    print("ok")
