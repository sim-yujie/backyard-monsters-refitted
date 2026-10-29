"""octo_post.py : from Blender's cells (render/cXX_rYY.png, @4x) to the game-layout sheets, the owner's comparison sheet
and the animated previews. Plain Python (Pillow, numpy), run after `octo3d.py -- all`:

    python octo_post.py

Writes, next to this file:
  octo3d-anim@4x.png, octo3d-anim@2x.png, octo3d-anim.png   the sheet in the game's layout (30 headings x 12 rows,
                                                             220x144 / 110x72 / 55x36 cells), 256 colours as the
                                                             painted sheets are (pngquant); NOT wired into the game
  compare-painted-vs-3d.png                                  painted now vs 3D, big and at game size
  walk-big.gif, walk-game.gif, preview.webm                  walk at three headings, attack, a full turn
  sizes.json                                                 file sizes of these sheets and the painted ones
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PAINTED = REPO / "server/public/assets/monsters"
PNGQUANT = os.environ.get("PNGQUANT") or shutil.which("pngquant") or \
    "D:/Coding/BYMR/art-trials/sheet-size/node_modules/pngquant-bin/vendor/pngquant.exe"
CW, CH, DIRS, ROWS = 220, 144, 30, 12
GROUND = (108, 92)
GRASS = (86, 92, 74, 255)
FONT = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
SMALL = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 17)
WALK_MS, ATTACK_MS = 100, 50        # 8 and 4 game ticks a frame, 80 ticks a second


def shadow():
    """A soft ground shadow under the tentacles, as the painted sheets have one."""
    im = Image.new("L", (CW, CH), 0)
    d = ImageDraw.Draw(im)
    rx, ry, cx, cy = 54, 24, GROUND[0], GROUND[1] + 3
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=int(255 * 0.36))
    im = im.filter(ImageFilter.GaussianBlur(6))
    sh = Image.new("RGBA", (CW, CH), (20, 26, 18, 0))
    sh.putalpha(im)
    return sh


def premul_resize(im, size):
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] * 255 / np.maximum(al, 1e-6), 0)
    return Image.fromarray(np.clip(np.dstack([rgb, al]), 0, 255).astype("uint8"), "RGBA")


def quantise(path):
    tmp = path.with_suffix(".q.png")
    subprocess.run([PNGQUANT, "256", "--force", "--speed", "1", "-o", str(tmp), str(path)], check=True)
    if tmp.stat().st_size < path.stat().st_size:
        tmp.replace(path)
    else:
        tmp.unlink()


def build_sheets():
    sh = shadow()
    cells = {}
    for r in range(ROWS):
        for c in range(DIRS):
            cell = sh.copy()
            cell.alpha_composite(Image.open(HERE / f"render/c{c:02d}_r{r:02d}.png").convert("RGBA"))
            cells[c, r] = cell
    out = {}
    for name, k in (("octo3d-anim@4x.png", 1), ("octo3d-anim@2x.png", 2), ("octo3d-anim.png", 4)):
        w, h = CW // k, CH // k
        sheet = Image.new("RGBA", (DIRS * w, ROWS * h))
        for (c, r), cell in cells.items():
            sheet.paste(cell if k == 1 else premul_resize(cell, (w, h)), (c * w, r * h))
        sheet.save(HERE / name, optimize=True)
        quantise(HERE / name)
        out[name] = (HERE / name).stat().st_size
    return out


def cell(sheet, c, r, k=1):
    w, h = CW // k, CH // k
    return sheet.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))


def on_grass(im, scale=1.0, nearest=False):
    bg = Image.new("RGBA", im.size, GRASS)
    bg.alpha_composite(im)
    if scale != 1.0:
        bg = bg.resize((round(im.width * scale), round(im.height * scale)), Image.NEAREST if nearest else Image.LANCZOS)
    return bg.convert("RGB")


def label(d, xy, text, font=FONT, fill=(255, 255, 255)):
    d.text(xy, text, font=font, fill=fill, stroke_width=2, stroke_fill=(20, 20, 20))


def compare(old4, new4, old2, new2, old1, new1):
    """Big: four poses side by side (cropped to the monster, 2.5x the @4x cell). Game size: the @2x and 1x copies at
    their real pixel size, and the 1x copy blown up 4x (nearest) to show its pixels."""
    poses = [("idle, facing down-right", 4, 0), ("walk, moving right", 0, 3), ("attack (bite), facing down", 8, 9),
             ("walk, moving away", 22, 4)]
    box = (20, 0, 200, 144)                  # the monster's part of a @4x cell
    z = 2.4
    bw, bh = round((box[2] - box[0]) * z), round((box[3] - box[1]) * z)
    pad, top = 24, 70
    W = pad + 2 * (bw + pad)
    big_h = top + len(poses) * (bh + 40)
    game_h = 520
    img = Image.new("RGB", (W, big_h + game_h), (40, 44, 36))
    d = ImageDraw.Draw(img)
    label(d, (pad, 18), "Octo-Ooze: painted now (left)  vs  Blender 3D trial (right)", FONT)
    for i, (txt, c, r) in enumerate(poses):
        y = top + i * (bh + 40)
        label(d, (pad, y), txt, SMALL, (230, 230, 200))
        for j, sheet in enumerate((old4, new4)):
            img.paste(on_grass(cell(sheet, c, r).crop(box), z), (pad + j * (bw + pad), y + 26))
    # game size
    y0 = big_h + 10
    label(d, (pad, y0), "Game size (what a player sees), same poses", FONT)
    label(d, (pad, y0 + 34), "@2x copy (Medium quality / phone screens): 110x72 per cell", SMALL, (230, 230, 200))
    label(d, (pad, y0 + 214), "1x copy (Low quality): 55x36 per cell, then the same 1x shown 4x bigger", SMALL, (230, 230, 200))
    for j, (s2, s1, nm) in enumerate(((old2, old1, "painted"), (new2, new1, "3D"))):
        x0 = pad + j * (W // 2)
        label(d, (x0, y0 + 60), nm, SMALL)
        strip = Image.new("RGBA", (110 * len(poses), 72), GRASS)
        for i, (_, c, r) in enumerate(poses):
            strip.alpha_composite(cell(s2, c, r, 2), (i * 110, 0))
        img.paste(on_grass(strip), (x0, y0 + 90))
        strip1 = Image.new("RGBA", (55 * len(poses), 36), GRASS)
        for i, (_, c, r) in enumerate(poses):
            strip1.alpha_composite(cell(s1, c, r, 4), (i * 55, 0))
        img.paste(on_grass(strip1), (x0, y0 + 240))
        img.paste(on_grass(strip1, 4, nearest=True), (x0, y0 + 290))
    img.save(HERE / "compare-painted-vs-3d.png", optimize=True)


def frames(old, new, k, heads, scale, nearest=False):
    """Painted (top row) and 3D (bottom row) together: walk 4 cycles, bite twice, then the 3D one turns a full circle
    while walking."""
    w, h = CW // k, CH // k
    seq = [(1 + i % 6, WALK_MS) for i in range(24)] + [(7 + i % 5, ATTACK_MS * 2) for i in range(10)]
    pics = []
    lw = round(w * scale)
    lh = round(h * scale)
    hdr = 30

    def canvas():
        im = Image.new("RGB", (lw * len(heads) + 90, 2 * lh + hdr), (40, 44, 36))
        d = ImageDraw.Draw(im)
        label(d, (6, hdr + lh // 2 - 10), "painted", SMALL)
        label(d, (6, hdr + lh + lh // 2 - 10), "3D", SMALL)
        return im, d

    for row, ms in seq:
        im, d = canvas()
        label(d, (96, 4), "walk" if row <= 6 else "attack (slowed 2x)", SMALL, (230, 230, 200))
        for i, c in enumerate(heads):
            for j, sheet in enumerate((old, new)):
                im.paste(on_grass(cell(sheet, c, row, k), scale, nearest), (90 + i * lw, hdr + j * lh))
        pics.append((im, ms))
    for t in range(DIRS * 2):
        im, d = canvas()
        label(d, (96, 4), "turning while walking", SMALL, (230, 230, 200))
        c = t % DIRS
        row = 1 + t % 6
        for j, sheet in enumerate((old, new)):
            im.paste(on_grass(cell(sheet, c, row, k), scale, nearest), (90 + lw, hdr + j * lh))
        pics.append((im, WALK_MS))
    return pics


def save_gif(path, pics):
    pics[0][0].save(path, save_all=True, append_images=[p for p, _ in pics[1:]], duration=[ms for _, ms in pics],
                    loop=0, optimize=True)


def save_webm(path, pics):
    tmp = HERE / "_webm"
    tmp.mkdir(exist_ok=True)
    lines = []
    for i, (p, ms) in enumerate(pics):
        p.save(tmp / f"f{i:04d}.png")
        lines += [f"file 'f{i:04d}.png'", f"duration {ms / 1000:.3f}"]
    lines.append(f"file 'f{len(pics) - 1:04d}.png'")
    (tmp / "list.txt").write_text("\n".join(lines))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"),
                    "-vsync", "vfr", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-pix_fmt", "yuv420p", str(path)],
                   check=True)
    shutil.rmtree(tmp)


def main():
    sizes = {"3d": build_sheets()}
    sizes["painted"] = {n: (PAINTED / n).stat().st_size for n in ("octo-anim@4x.png", "octo-anim@2x.png", "octo-anim.png")}
    (HERE / "sizes.json").write_text(json.dumps(sizes, indent=1))
    old4, old2, old1 = (Image.open(PAINTED / n).convert("RGBA") for n in ("octo-anim@4x.png", "octo-anim@2x.png", "octo-anim.png"))
    new4, new2, new1 = (Image.open(HERE / n).convert("RGBA") for n in ("octo3d-anim@4x.png", "octo3d-anim@2x.png", "octo3d-anim.png"))
    compare(old4, new4, old2, new2, old1, new1)
    heads = (4, 15, 22)          # down-right, left, away
    big = frames(old4, new4, 1, heads, 1.4)
    save_gif(HERE / "walk-big.gif", big)
    save_webm(HERE / "preview.webm", big)
    save_gif(HERE / "walk-game.gif", frames(old2, new2, 2, heads, 1.0))
    print(json.dumps(sizes))


main()
