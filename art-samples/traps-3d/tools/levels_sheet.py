"""levels_sheet.py : Flash above 3D, every level side by side at ONE scale, for vetting 3D building/tower art.

    python levels_sheet.py --flash "flash/L{lv}.png" --model "render/L{lv}.png" --levels 1,3,6,10 \
        --name "Twig Snapper" -o twig-levels.png
    python levels_sheet.py ... --crop 380,700,300,260      also writes twig-levels-crop.png: that area of every level,
                                                           Flash above 3D, enlarged (--zoom, default 3, hard pixels)
    python levels_sheet.py ... --mark 560,820,tray          a red cross at that point on every 3D still, dashed line
                                                           across both rows: a part fixed to the body sits on it at
                                                           every level (repeat --mark for more parts)
    python levels_sheet.py ... --shift 1:0,52               level 1's body sits 52 px lower (short feet): its marks
                                                           move with it

Inputs, one file per level ({lv} is replaced by the level):
  --flash   the Flash look (with its ground shadow if you have it), any size; it is resized to the 3D still's size,
            so it must cover the same game-space frame as the 3D camera (the 3D pipeline renders that way). If not,
            give --flash-scale K (Flash px -> 3D px) and --flash-offset X,Y (where its top-left goes on the 3D still).
  --model   the 3D still (base + moving parts at frame 0). Every level must be the same size (same camera), which is
            what makes the sheet one scale.
Transparent pictures are laid on grass (--bg). All coordinates (--crop, --mark) are 3D-still pixels, as an image viewer
shows them on the full-size render.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

GRASS = (96, 140, 60)


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def ints(s, n):
    v = [int(float(x)) for x in s.split(",")[:n]]
    if len(v) != n:
        raise argparse.ArgumentTypeError(f"expected {n} numbers: {s}")
    return v


def on_bg(im, bg):
    out = Image.new("RGBA", im.size, bg + (255,))
    out.alpha_composite(im)
    return out


def load_pair(lv, a):
    model = Image.open(a.model.format(lv=lv)).convert("RGBA")
    fl = Image.open(a.flash.format(lv=lv)).convert("RGBA")
    if a.flash_scale:
        fl = fl.resize((round(fl.width * a.flash_scale), round(fl.height * a.flash_scale)), Image.BICUBIC)
        canvas = Image.new("RGBA", model.size, (0, 0, 0, 0))
        canvas.paste(fl, tuple(a.flash_offset))
        fl = canvas
    else:
        r1, r2 = fl.width / fl.height, model.width / model.height
        if abs(r1 / r2 - 1) > 0.01:
            sys.exit(f"level {lv}: Flash {fl.size} and 3D {model.size} have different shapes; "
                     "use --flash-scale/--flash-offset or render the 3D with the Flash frame")
        fl = fl.resize(model.size, Image.BICUBIC)
    return fl, model


def subject_box(ims, pad=30):
    """One crop for every picture: the union of everything not see-through (the full picture if nothing is)."""
    w, h = ims[0].size
    mask = np.zeros((h, w), bool)
    for im in ims:
        alpha = np.array(im.getchannel("A"))
        if alpha.min() < 255:
            mask |= alpha > 40
    if not mask.any():
        return 0, 0, w, h
    ys, xs = np.nonzero(mask)
    return int(max(0, xs.min() - pad)), int(max(0, ys.min() - pad)), int(min(w, xs.max() + 1 + pad)), int(min(h, ys.max() + 1 + pad))


def grid(cells, labels, title, gap=12, head=50, lab=36):
    """cells[row][col] images of one size; labels[row][col] strings."""
    w, h = cells[0][0].size
    cols, rows = len(cells[0]), len(cells)
    out = Image.new("RGB", (cols * w + (cols + 1) * gap, head + rows * (h + lab + gap)), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((gap, 10), title, fill=(255, 255, 255), font=font(26))
    spots = []
    for r in range(rows):
        y = head + r * (h + lab + gap)
        for c in range(cols):
            x = gap + c * (w + gap)
            d.text((x, y + 4), labels[r][c], fill=(255, 255, 255), font=font(24))
            out.paste(cells[r][c].convert("RGB"), (x, y + lab))
            spots.append((r, c, x, y + lab))
    return out, d, spots


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--flash", required=True, help='Flash picture per level, e.g. "flash/L{lv}.png"')
    ap.add_argument("--model", required=True, help='3D still per level, e.g. "render/L{lv}.png"')
    ap.add_argument("--levels", default="1,3,6,10", help="levels in order (default 1,3,6,10)")
    ap.add_argument("--name", default="Building", help="building or tower name for the title")
    ap.add_argument("-o", "--out", default="levels-sheet.png")
    ap.add_argument("--crop", type=lambda s: ints(s, 4), help="x,y,w,h on the 3D still: also write <out>-crop.png")
    ap.add_argument("--zoom", type=float, default=3, help="enlargement of the --crop pictures (default 3)")
    ap.add_argument("--mark", action="append", default=[], help="x,y[,label]: a fixed mounting point to check")
    ap.add_argument("--shift", action="append", default=[], help="level:dx,dy: move that level's marks with its body")
    ap.add_argument("--flash-scale", type=float, help="Flash px -> 3D px, when the Flash does not cover the 3D frame")
    ap.add_argument("--flash-offset", type=lambda s: ints(s, 2), default=[0, 0], help="x,y of the scaled Flash")
    ap.add_argument("--bg", type=lambda s: tuple(ints(s, 3)), default=GRASS, help="r,g,b behind see-through parts")
    a = ap.parse_args()

    levels = [int(x) for x in a.levels.split(",")]
    pairs = [load_pair(lv, a) for lv in levels]
    sizes = {m.size for _, m in pairs}
    if len(sizes) > 1:
        sys.exit(f"3D stills differ in size {sorted(sizes)}: render every level with the same camera so the sheet is one scale")

    box = subject_box([im for p in pairs for im in p])
    cells = [[on_bg(fl, a.bg).crop(box) for fl, _ in pairs], [on_bg(m, a.bg).crop(box) for _, m in pairs]]
    labels = [[f"Level {lv}  Flash" for lv in levels], [f"Level {lv}  3D" for lv in levels]]
    title = f"{a.name}, levels {', '.join(map(str, levels))} at one scale: Flash (top), 3D (bottom)"
    if a.mark:
        title += ". Red crosses: points fixed to the body"
    sheet, d, spots = grid(cells, labels, title)
    w = box[2] - box[0]
    shift = {int(k): ints(v, 2) for k, v in (x.split(":") for x in a.shift)}

    for m in a.mark:
        parts = m.split(",")
        mx, my = int(float(parts[0])) - box[0], int(float(parts[1])) - box[1]
        name = ",".join(parts[2:])
        for r, c, x, y in spots:
            dx, dy = shift.get(levels[c], (0, 0))
            px, py = x + mx + dx, y + my + dy
            for xx in range(x, x + w - 12, 24):
                d.line((xx, py, xx + 12, py), fill=(255, 255, 255), width=2)
            if r == 1:
                d.line((px - 14, py, px + 14, py), fill=(255, 40, 40), width=4)
                d.line((px, py - 14, px, py + 14), fill=(255, 40, 40), width=4)
        if name:
            d.text((spots[-1][2] + w - 150, spots[-1][3] + my - 30), name, fill=(255, 255, 255), font=font(22))

    out = Path(a.out)
    if a.crop:
        cx, cy, cw, ch = a.crop
        for r, c, x, y in spots:
            d.rectangle((x + cx - box[0], y + cy - box[1], x + cx - box[0] + cw, y + cy - box[1] + ch), outline=(255, 220, 0), width=3)
        size = (round(cw * a.zoom), round(ch * a.zoom))
        crops = [[on_bg(fl, a.bg).crop((cx, cy, cx + cw, cy + ch)).resize(size, Image.NEAREST) for fl, _ in pairs],
                 [on_bg(m, a.bg).crop((cx, cy, cx + cw, cy + ch)).resize(size, Image.NEAREST) for _, m in pairs]]
        csheet, _, _ = grid(crops, labels, f"{a.name}: area {cx},{cy} {cw}x{ch} of the full-size render, {a.zoom:g}x, every level")
        cpath = out.with_name(out.stem + "-crop" + out.suffix)
        csheet.save(cpath)
        print("crop", cpath, csheet.size)
    sheet.save(out)
    print("sheet", out, sheet.size, "crop box", box)


if __name__ == "__main__":
    main()
