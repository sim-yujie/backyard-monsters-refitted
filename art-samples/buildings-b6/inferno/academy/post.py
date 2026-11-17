"""post.py : the Inferno Academy's pictures from its renders.

python post.py fit <look>      work/cmp-fit-L<n>.png: the quick fit render with Flash's outline (red) laid over it,
                               beside Flash and a half-and-half blend
python post.py frames <look>   render/L<n>-f-kk.png: base + moving parts, every cell
python post.py sheets          sheet-*.png, crop-*.png
python post.py mp4 <look>      academy-L<n>-training.mp4 (Flash still beside the 3D loop, three times)
python post.py game            game/: the renders export3d_buildings.py iacademy reads
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FLASH = HERE.parents[3] / "server/public/assets/buildings/iacademy"
FRAME = (-80, -110, 90, 80)
POINT = {1: (-50, -55), 2: (-56, -95)}
DPOINT = {1: (-48, -21), 2: (-56, -91)}
SHADOW = {1: (-50, -30), 2: (-61, -30)}
BG = (96, 60, 52)
CELLS = {1: 44, 2: 47}


def flash_canvas(look, k, state=""):
    """Flash's picture on the render's canvas at k px per Flash px (hard pixels)."""
    name = f"top.{look}{'.' + state if state else ''}.png"
    im = Image.open(FLASH / name).convert("RGBA")
    pt = (DPOINT if state == "damaged" else POINT)[look]
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    c.alpha_composite(im, (pt[0] - FRAME[0], pt[1] - FRAME[1]))
    return c.resize((w * k, h * k), Image.NEAREST)


def outline(im, width=2):
    a = im.getchannel("A").point(lambda v: 255 if v > 100 else 0)
    edge = Image.fromarray(np.asarray(a.filter(ImageFilter.MaxFilter(2 * width + 1))) - np.asarray(a))
    red = Image.new("RGBA", im.size, (255, 30, 30, 255))
    red.putalpha(edge)
    return red


def on_bg(im):
    b = Image.new("RGBA", im.size, BG + (255,))
    b.alpha_composite(im)
    return b


def fit(look):
    r = Image.open(HERE / f"work/fit-L{look}.png").convert("RGBA")
    k = r.width // (FRAME[2] - FRAME[0])
    f = flash_canvas(look, k)
    a = on_bg(r)
    a.alpha_composite(outline(f))
    blend = Image.blend(on_bg(r), on_bg(f), 0.5)
    box = {1: (20, 45, 140, 175), 2: (15, 5, 150, 180)}[look]
    box = tuple(v * k for v in box)
    parts = [im.crop(box).resize(((box[2] - box[0]) * 2, (box[3] - box[1]) * 2), Image.NEAREST) for im in (a, blend)]
    d = ImageDraw.Draw(parts[0])
    for gx in range(0, parts[0].width, 80):          # a tick every 10 Flash px
        d.line((gx, 0, gx, 12), fill=(255, 255, 255))
        d.text((gx + 2, 12), str(FRAME[0] + (box[0] // k) + gx // 8), fill=(255, 255, 255))
    for gy in range(0, parts[0].height, 80):
        d.line((0, gy, 12, gy), fill=(255, 255, 255))
        d.text((14, gy), str(FRAME[1] + (box[1] // k) + gy // 8), fill=(255, 255, 255))
    s = Image.new("RGB", (sum(p.width for p in parts), parts[0].height))
    x = 0
    for p in parts:
        s.paste(p.convert("RGB"), (x, 0))
        x += p.width
    s.save(HERE / f"work/cmp-fit-L{look}.png")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "fit":
        fit(int(sys.argv[2]))


def frame(look, k, state=""):
    """Cell k of the look: the still base with the moving parts laid over it."""
    r = HERE / "render"
    if state:
        return Image.open(r / f"L{look}-{state}-base.png").convert("RGBA")
    base = Image.open(r / f"L{look}-base.png").convert("RGBA")
    base.alpha_composite(Image.open(r / f"L{look}-parts-{k:02d}.png").convert("RGBA"))
    return base


def flash_shadowed(look, k, state=""):
    """Flash's picture over its ground shadow (multiplied onto the ground colour), on the render's canvas."""
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    g = Image.new("RGB", (w, h), BG)
    sh = Image.open(FLASH / f"shadow.{look}.jpg").convert("RGB")
    pos = (SHADOW[look][0] - FRAME[0], SHADOW[look][1] - FRAME[1])
    reg = np.asarray(g.crop((pos[0], pos[1], pos[0] + sh.width, pos[1] + sh.height))).astype(float)
    m = np.asarray(sh).astype(float) / 255
    g.paste(Image.fromarray((reg * m[:reg.shape[0], :reg.shape[1]]).astype("uint8")), pos)
    g = g.resize((w * k, h * k), Image.NEAREST).convert("RGBA")
    g.alpha_composite(flash_canvas(look, k, state))
    return g


BOX = {1: (-62, -62, 72, 66), 2: (-66, -100, 76, 70)}


def pair(look, k=0, state="", zoom=4, box=None):
    """Flash beside 3D at `zoom` px per Flash px, cut to box (Flash px)."""
    r = frame(look, k, state)
    kk = r.width // (FRAME[2] - FRAME[0])
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    r = on_bg(r).resize((w * zoom, h * zoom), Image.LANCZOS)
    f = flash_shadowed(look, zoom, state)
    b = box or BOX[look]
    cut = tuple((v - FRAME[i % 2]) * zoom for i, v in enumerate(b))
    f, r = f.crop(cut), r.crop(cut)
    s = Image.new("RGB", (f.width * 2 + 6, f.height), (20, 20, 20))
    s.paste(f.convert("RGB"), (0, 0))
    s.paste(r.convert("RGB"), (f.width + 6, 0))
    return s


if __name__ == "__main__" and sys.argv[1] == "pair":
    look = int(sys.argv[2])
    state = sys.argv[3] if len(sys.argv) > 3 else ""
    pair(look, 0, state).save(HERE / f"work/pair-L{look}{'-' + state if state else ''}.png")


def label(im, text):
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    d.text((9, 7), text, fill=(0, 0, 0), font=font)
    d.text((8, 6), text, fill=(255, 255, 255), font=font)
    return im


def side(look, k=0, state="", zoom=6, box=None):
    """(Flash, 3D) at zoom px per Flash px, cut to box."""
    b = box or BOX[look]
    cut = tuple((v - FRAME[i % 2]) * zoom for i, v in enumerate(b))
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    r = on_bg(frame(look, k, state))
    if r.width != w * zoom:
        r = r.resize((w * zoom, h * zoom), Image.LANCZOS)
    return flash_shadowed(look, zoom, state).crop(cut).convert("RGB"), r.crop(cut).convert("RGB")


def row(ims, gap=6):
    s = Image.new("RGB", (sum(i.width for i in ims) + gap * (len(ims) - 1), max(i.height for i in ims)), (20, 20, 20))
    x = 0
    for i in ims:
        s.paste(i, (x, 0))
        x += i.width + gap
    return s


def col(ims, gap=6):
    s = Image.new("RGB", (max(i.width for i in ims), sum(i.height for i in ims) + gap * (len(ims) - 1)), (20, 20, 20))
    y = 0
    for i in ims:
        s.paste(i, (0, y))
        y += i.height + gap
    return s


DBOX = {1: (-62, -62, 72, 66), 2: (-66, -100, 76, 70)}
CROPS = {"hub": {1: (-2, -18, 44, 20), 2: (-6, -26, 52, 16)}, "top": {1: (-34, -62, 26, -18), 2: (-52, -100, 28, -40)},
         "rock": {1: (-52, 6, 20, 62), 2: (-56, 0, 20, 66)}}


def frames(look):
    out = HERE / "frames"
    out.mkdir(exist_ok=True)
    for k in range(CELLS[look] + 1):
        if (HERE / f"render/L{look}-parts-{k:02d}.png").exists():
            frame(look, k).save(out / f"L{look}-f-{k:02d}.png")


def sheets():
    both = (BOX[2][0], BOX[2][1], BOX[2][2], BOX[2][3])          # one box and one scale for both looks
    idle, dmg, train = [], [], []
    for look in (1, 2):
        f, r = side(look, 0, box=both)
        idle.append(row([label(f, f"Flash, look {look} ({'level 1' if look == 1 else 'levels 2-4'})"),
                         label(r, f"3D, look {look}, idle (frame 0)")]))
        f, r = side(look, 0, "damaged", box=both)
        dmg.append(row([label(f, f"Flash, look {look}, damaged"), label(r, f"3D, look {look}, damaged")]))
        n = CELLS[look]
        ks = [0, 12, 24, 36]
        f, _ = side(look, 0, zoom=4, box=both)
        cells = [label(f, f"Flash, look {look} (no motion in Flash)")]
        for k in ks:
            cells.append(label(side(look, k, zoom=4, box=both)[1], f"3D training, frame {k} of {n}"))
        train.append(row(cells))
    col(idle).save(HERE / "sheet-idle.png")
    col(dmg).save(HERE / "sheet-damaged.png")
    col(train).save(HERE / "sheet-training.png")
    for name, boxes in CROPS.items():
        rows = []
        for look in (1, 2):
            f, r = side(look, 0, zoom=12, box=boxes[look])
            rows.append(row([label(f, f"Flash, look {look}"), label(r, f"3D, look {look} (render at twice full size)")]))
        col(rows).save(HERE / f"crop-{name}.png")


def mp4(look):
    tmp = HERE / "work/mp4"
    tmp.mkdir(parents=True, exist_ok=True)
    for p in tmp.glob("*.png"):
        p.unlink()
    n = CELLS[look]
    f, _ = side(look, 0, zoom=4)
    label(f, "Flash (still; its strips were never shipped)")
    for i in range(n * 3):
        r = side(look, i % n, zoom=4)[1]
        label(r, "3D, training")
        s = row([f, r])
        s = s.crop((0, 0, s.width // 2 * 2, s.height // 2 * 2))
        s.save(tmp / f"{i:03d}.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "13.333", "-i", str(tmp / "%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", str(HERE / f"academy-L{look}-training.mp4")],
                   check=True)


if __name__ == "__main__":
    if sys.argv[1] == "frames":
        frames(int(sys.argv[2]))
    if sys.argv[1] == "sheets":
        sheets()
    if sys.argv[1] == "mp4":
        mp4(int(sys.argv[2]))
    if sys.argv[1] == "game":
        # game/: what export3d_buildings.py iacademy reads (the renders without the extra closing frame)
        import shutil
        g = HERE / "game"
        g.mkdir(exist_ok=True)
        for p in g.glob("*.png"):
            p.unlink()
        for look in (1, 2):
            for stem in ("base", "alone", "damaged-base", "damaged-alone"):
                shutil.copy(HERE / f"render/L{look}-{stem}.png", g)
            for k in range(CELLS[look]):
                shutil.copy(HERE / f"render/L{look}-parts-{k:02d}.png", g)
