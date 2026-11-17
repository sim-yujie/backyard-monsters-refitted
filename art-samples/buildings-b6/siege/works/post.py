"""post.py : the Siege Works' pictures and loop from works.py's renders (needs numpy and Pillow; see run.sh).

python post.py fit [k]     work/cmp-fit.png: Flash cell k, the quick fit render (work/fit-L1.png) and the two laid
                           over each other, on a 10 px grid
python post.py frames      frames/f-NN.png (base + moving parts), works-idle.png (frame 0), works-working-strip.png,
                           works-shadow.png, works-damaged.png and flash/f-NN.png (Flash's layers on the same canvas)
python post.py mp4         works-working.mp4 (Flash beside 3D, the loop three times), works-working-3d.mp4
python post.py sheets      sheet-idle.png, sheet-working.png, sheet-damaged.png: Flash beside 3D at the same scale
python post.py crops       crop-*.png: Flash beside 3D, enlarged, of the risky joints
python post.py check       loop-check.png and the loop's numbers
python post.py game        game/: the renders export3d_buildings.py siegeworks reads (base, alone, parts 00-59, damaged)

A frame is the base picture (every still part and the ground shadow) with the moving parts' layer laid over it.
The canvas is works.py's: Flash px x -75..125, y -95..95, the building's anchor at (0, 0).
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
FLASH = D.parents[3] / "server/public/assets/buildings/siegelab"
FRAME = (-75, -95, 125, 95)
N = 60
G = 2                                   # the game's size: 2 px per Flash px
BG = (104, 132, 72, 255)                # yard grass
W, H = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
CROP = (-70, -93, 122, 90)              # the building and its shadow, in Flash px
TOP = ("top.1.v6.png", -69, -68)
LAYERS = [("anim1.v4.png", -54, 22, 43, 39), ("anim2.v3.png", -24, -92, 59, 100), ("anim3.v3.png", 19, 11, 38, 40)]
SHADOW = ("shadow.1.jpg", -50, 4)
DAMAGED = ("top.1.damaged.v4.png", -66, -98)


def font(n):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash_shadow():
    """Flash's ground shadow as a black layer on the canvas (the game multiplies the jpg onto the ground)."""
    sh = Image.open(FLASH / SHADOW[0]).convert("L")
    a = Image.new("L", (W, H), 0)
    a.paste(ImageChops.invert(sh), (SHADOW[1] - FRAME[0], SHADOW[2] - FRAME[1]))
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.putalpha(a)
    return out


def flash(k=0, shadow=True, damaged=False):
    """Flash's look on the canvas, 1 px per Flash px: shadow, body, and cell k of each moving layer."""
    c = flash_shadow() if shadow else Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if damaged:
        c.alpha_composite(Image.open(FLASH / DAMAGED[0]).convert("RGBA"), (DAMAGED[1] - FRAME[0], DAMAGED[2] - FRAME[1]))
        return c
    c.alpha_composite(Image.open(FLASH / TOP[0]).convert("RGBA"), (TOP[1] - FRAME[0], TOP[2] - FRAME[1]))
    for name, x, y, w, h in LAYERS:
        im = Image.open(FLASH / name).convert("RGBA")
        c.alpha_composite(im.crop((k * w, 0, k * w + w, h)), (x - FRAME[0], y - FRAME[1]))
    return c


def on(im, bg=BG):
    b = Image.new("RGBA", im.size, bg)
    b.alpha_composite(im)
    return b


def grid(im, z):
    d = ImageDraw.Draw(im)
    for x in range(FRAME[0] + 5, FRAME[2], 10):
        d.line([((x - FRAME[0]) * z, 0), ((x - FRAME[0]) * z, im.height)], fill=(255, 255, 255, 70) if x else (255, 0, 0, 255))
        if x % 20 == 0:
            d.text(((x - FRAME[0]) * z + 2, 2), str(x), fill="white")
    for y in range(FRAME[1] + 5, FRAME[3], 10):
        d.line([(0, (y - FRAME[1]) * z), (im.width, (y - FRAME[1]) * z)], fill=(255, 255, 255, 70) if y else (255, 0, 0, 255))
        if y % 20 == 0:
            d.text((2, (y - FRAME[1]) * z + 2), str(y), fill="white")
    return im


def fit(k=0, src="work/fit-L1.png", out="work/cmp-fit.png", z=4, box=(-75, -95, 75, 95)):
    m = Image.open(D / src).convert("RGBA").resize((W * z, H * z), Image.LANCZOS)
    f = flash(k, shadow=False).resize((W * z, H * z), Image.NEAREST)
    over = on(f)
    mm = m.copy()
    mm.putalpha(mm.getchannel("A").point(lambda v: v // 2))
    over.alpha_composite(mm)
    c = tuple((v - o) * z for v, o in zip(box, (FRAME[0], FRAME[1]) * 2))
    tiles = [grid(on(f), z).crop(c), grid(on(m), z).crop(c), grid(over, z).crop(c)]
    sheet = Image.new("RGBA", (sum(t.width for t in tiles) + 20, tiles[0].height), (30, 30, 30, 255))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 10
    sheet.save(D / out)
    print("wrote", D / out)


def layer(sub, name):
    return Image.open(D / sub / "render" / name).convert("RGBA")


def frame_full(k, base=None):
    """Frame k at the render's size: the base picture with frame k's moving parts laid over it."""
    c = (base or layer(".", "L1-base.png")).copy()
    c.alpha_composite(layer(".", f"L1-parts-{k:02d}.png"))
    return c


def small(im, g=G):
    return im.resize((W * g, H * g), Image.LANCZOS)


def frames():
    out, fl = D / "frames", D / "flash"
    out.mkdir(exist_ok=True)
    fl.mkdir(exist_ok=True)
    base = layer(".", "L1-base.png")
    cells = []
    for k in range(N):
        im = small(frame_full(k, base))
        im.save(out / f"f-{k:02d}.png")
        cells.append(im.crop(((-75 - FRAME[0]) * G, 0, (70 - FRAME[0]) * G, H * G)))
        flash(k).save(fl / f"f-{k:02d}.png")
    small(frame_full(0, base)).save(D / "works-idle.png")
    strip = Image.new("RGBA", (cells[0].width * N, cells[0].height), (0, 0, 0, 0))
    for k, c in enumerate(cells):
        strip.paste(c, (k * c.width, 0))
    strip.save(D / "works-working-strip.png")
    # the ground shadow alone: what the base picture holds outside the building itself (frame 0, it never moves)
    alone = np.asarray(layer(".", "L1-alone.png")).astype(float)[..., 3] / 255
    b = np.asarray(base).astype(float)
    sh = np.zeros_like(b)
    sh[..., 3] = b[..., 3] * (1 - alone)
    small(Image.fromarray(sh.astype(np.uint8), "RGBA")).save(D / "works-shadow.png")
    dm = D / "damaged" / "render" / "L1-damaged-base.png"
    if dm.exists():
        small(Image.open(dm).convert("RGBA")).save(D / "works-damaged.png")
    print("wrote", N, "frames, works-idle.png, works-working-strip.png", strip.size, "works-shadow.png")


def label(im, text, size=None):
    d = ImageDraw.Draw(im)
    f = font(size or max(14, im.width // 28))
    d.text((9, 7), text, font=f, fill=(0, 0, 0, 255))
    d.text((8, 6), text, font=f, fill=(255, 255, 255, 255))
    return im


def cut(im, box, z):
    """Flash-px box of a canvas picture (any size), brought to z px per Flash px."""
    k = im.width / W
    c = im.crop(tuple(round((v - o) * k) for v, o in zip(box, (FRAME[0], FRAME[1]) * 2)))
    return c.resize(((box[2] - box[0]) * z, (box[3] - box[1]) * z), Image.NEAREST if k <= z else Image.LANCZOS)


def row(tiles, gap=12, bg=(30, 30, 30, 255)):
    h = max(t.height for t in tiles)
    out = Image.new("RGBA", (sum(t.width for t in tiles) + gap * (len(tiles) - 1), h), bg)
    x = 0
    for t in tiles:
        out.paste(t, (x, 0))
        x += t.width + gap
    return out


def col(tiles, gap=12, bg=(30, 30, 30, 255)):
    w = max(t.width for t in tiles)
    out = Image.new("RGBA", (w, sum(t.height for t in tiles) + gap * (len(tiles) - 1)), bg)
    y = 0
    for t in tiles:
        out.paste(t, (0, y))
        y += t.height + gap
    return out


def pair(fl, m, box, z, names=("Flash", "3D")):
    return row([label(cut(on(fl), box, z), names[0]), label(cut(on(m), box, z), names[1])])


def sheets():
    base = layer(".", "L1-base.png")
    idle = frame_full(0, base)
    big = pair(flash(0), idle, CROP, 4, ("Flash, idle (4x)", "3D, idle (4x)"))
    game = pair(flash(0), small(idle), CROP, 2, ("Flash at the game's size (2x)", "3D at the game's size (2x)"))
    col([big, game]).save(D / "sheet-idle.png")
    rows = []
    for k in (0, 12, 30, 45):
        rows.append(pair(flash(k), frame_full(k, base), (-70, -93, 70, 62), 3, (f"Flash, cell {k}", f"3D, frame {k}")))
    col([row(rows[:2], 24), row(rows[2:], 24)], 24).save(D / "sheet-working.png")
    dm = D / "damaged" / "render" / "L1-damaged-base.png"
    if dm.exists():
        d3 = Image.open(dm).convert("RGBA")
        dbox = (-75, -95, 117, 90)
        big = pair(flash(0, damaged=True), d3, dbox, 4, ("Flash, damaged (4x)", "3D, damaged (4x), one rough pass"))
        game = pair(flash(0, damaged=True), small(d3), dbox, 2,
                    ("Flash at the game's size (2x)", "3D at the game's size (2x)"))
        col([big, game]).save(D / "sheet-damaged.png")
    print("wrote sheet-idle.png, sheet-working.png, sheet-damaged.png")


CROPS = {                               # name: (Flash-px box, frames)
    "rocker": ((-28, -93, 42, -38), (0, 30)),
    "chain": ((-45, -62, 16, 14), (0, 30)),
    "bellows": ((-62, 12, -2, 62), (0, 12)),
    "machine": ((14, -2, 62, 56), (0, 3)),
    "posts": ((-44, -12, 26, 62), (0,)),
    "rod": ((12, -62, 58, 2), (0,)),
    "fringe": ((-72, 36, 68, 92), (0,)),
}


def crops():
    base = layer(".", "L1-base.png")
    for name, (box, ks) in CROPS.items():
        z = 8 if (box[2] - box[0]) <= 70 else 6
        rows = [pair(flash(k), frame_full(k, base), box, z, (f"Flash, cell {k}", f"3D, frame {k} (full render size)"))
                for k in ks]
        col(rows).save(D / f"crop-{name}.png")
    print("wrote", ", ".join(f"crop-{n}.png" for n in CROPS))


def mp4():
    tmp = D / "work" / "mp4"
    tmp.mkdir(parents=True, exist_ok=True)
    base = layer(".", "L1-base.png")
    box = (-70, -93, 70, 88)
    for k in range(N):
        m = frame_full(k, base)
        pair(flash(k), m, box, 4).convert("RGB").save(tmp / f"p-{k:02d}.png")
        cut(on(m), box, 6).convert("RGB").save(tmp / f"m-{k:02d}.png")
    for pre, out in (("p", "works-working.mp4"), ("m", "works-working-3d.mp4")):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-stream_loop", "2", "-framerate", "25", "-i",
                        str(tmp / f"{pre}-%02d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-crf", "16", str(D / out)], check=True)
        print("wrote", out)


def check(tol=10):
    """The loop's numbers: what changes, where, and whether the last frame leads back into the first."""
    fr = [np.asarray(Image.open(D / "frames" / f"f-{k:02d}.png")).astype(int) for k in range(N)]
    ch = np.zeros(fr[0].shape[:2], bool)
    for f in fr[1:]:
        ch |= np.abs(f - fr[0]).max(2) > tol
    boxes = np.zeros_like(ch)
    for _, x, y, w, h in LAYERS:                       # Flash's three moving layers, where they sit on the canvas
        boxes[(y - FRAME[1]) * G:(y + h - FRAME[1]) * G, (x - FRAME[0]) * G:(x + w - FRAME[0]) * G] = True
    ys, xs = np.where(ch)
    print(f"pixels that change during the loop (over {tol}/255, game size): {int(ch.sum())}; box x "
          f"{xs.min() / G + FRAME[0]:.1f}..{xs.max() / G + FRAME[0]:.1f}, y {ys.min() / G + FRAME[1]:.1f}.."
          f"{ys.max() / G + FRAME[1]:.1f} (Flash px)")
    print(f"... of them outside Flash's three moving layers' boxes: {int((ch & ~boxes).sum())}")
    step = [int((np.abs(fr[(k + 1) % N] - fr[k]).max(2) > tol).sum()) for k in range(N)]
    print(f"step 59 -> 0 changes {step[-1]} px; the other steps {min(step[:-1])}..{max(step[:-1])} px")
    p60 = D / "render" / f"L1-parts-{N:02d}.png"
    if p60.exists():
        a = np.asarray(layer(".", "L1-parts-00.png")).astype(int)
        b = np.asarray(Image.open(p60).convert("RGBA")).astype(int)
        print(f"frame {N} rendered again against frame 0 (render size): {int((np.abs(a - b).max(2) > 2).sum())} px differ "
              f"by more than 2/255")
    dark = (fr[0] * 0.35).astype(np.uint8)
    dark[..., 3] = 255
    bgc = np.array(BG[:3]) * 0.35
    a0 = fr[0][..., 3:4] / 255
    dark[..., :3] = (fr[0][..., :3] * 0.35 * a0 + bgc * (1 - a0)).astype(np.uint8)
    dark[ch] = (255, 40, 40, 255)
    Image.fromarray(dark, "RGBA").resize((W * G * 2, H * G * 2), Image.NEAREST).save(D / "loop-check.png")
    print("wrote loop-check.png")


def refs():
    """Flash's stills on the canvas with no shadow: the pictures proj.py lays on the model and outline.py measures."""
    (D / "work").mkdir(exist_ok=True)
    flash(0, shadow=False).save(D / "work" / "flash0.png")
    flash(0, shadow=False, damaged=True).save(D / "work" / "flash-dmg.png")


def game():
    """game/: what `export3d_buildings.py siegeworks` (and `siegeworks:damaged`) reads: the renders without the extra
    closing frame (parts-60 is frame 0 again, for the loop check)."""
    import shutil
    g = D / "game"
    g.mkdir(exist_ok=True)
    for p in g.glob("*.png"):
        p.unlink()
    for name in ("L1-base.png", "L1-alone.png"):
        shutil.copy(D / "render" / name, g)
    for k in range(N):
        shutil.copy(D / "render" / f"L1-parts-{k:02d}.png", g)
    for name in ("L1-damaged-base.png", "L1-damaged-alone.png"):
        shutil.copy(D / "damaged" / "render" / name, g)
    print("game", N, "cells ->", g)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    if cmd == "fit":
        fit(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    else:
        {"refs": refs, "frames": frames, "mp4": mp4, "sheets": sheets, "crops": crops, "check": check, "game": game}[cmd]()
