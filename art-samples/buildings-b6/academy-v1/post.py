"""post.py : the Monster Academy 3D sample pictures, from academy.py's renders (render/) and the Flash art (fref.py).

    python post.py side <level>      L<level>-side.png      Flash | 3D, large (the building fills the frame), frame 0
    python post.py outline <level>   L<level>-outline.png   Flash outline (red) on the 3D, the miss map; overlap printed
    python post.py anim <level>      L<level>-anim.mp4      Flash | 3D, the loop (gold blocks turning) at the game's 13.3
                                     frames a second (40 Hz yard tick, a frame every 3rd tick), three times round
    python post.py motion <level>    L<level>-motion.png    where the 3D loop changes pixels (red), beside Flash's
    python post.py levels            academy-levels.png     L1-L4 at one scale: Flash above 3D, lines through the parts
                                     every level shares (on the 3D); academy-levels-clean.png without them
    python post.py game              academy-game.png       Flash | 3D at the game's own size (1x) and 2x, every level
    python post.py crops <level>     crops/L<level>-<name>.png   full-size details, Flash beside 3D
A 3D frame is the base picture (every still part and the ground shadow) with the frame's moving-parts layer laid over
it, so nothing outside the moving parts can change between frames.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import fit
import fref
import stack as S

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)
FPS = 40 / 3


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def frame3d(lv, k=0, r=R):
    base = Image.open(r / f"L{lv}-base.png").convert("RGBA")
    p = r / f"L{lv}-parts-{k:02d}.png"
    if p.exists():
        base.alpha_composite(Image.open(p).convert("RGBA"))
    return base


def flash(lv, k, size, look=1):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top and the animation cell),
    scaled up."""
    sh = fref.shadow_rgba(lv, look).resize(size, Image.BICUBIC)
    top = fref.flash_rgba(lv, look, k).resize(size, Image.BICUBIC)
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(sh)
    out.alpha_composite(top)
    return out


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def box_of(lv, size):
    """One crop box for a look: Flash and 3D together, building and shadow, every frame (still parts never shift)."""
    a = np.array(fref.flash_rgba(lv).resize(size).getchannel("A")) > 8
    a |= np.array(fref.shadow_rgba(lv).resize(size).getchannel("A")) > 40
    a |= np.array(frame3d(lv, 0).getchannel("A")) > 40
    for p in sorted(R.glob(f"L{lv}-parts-*.png")):
        a |= np.array(Image.open(p).getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    pad = 30
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad), min(size[1], ys.max() + pad)


def pair(ims, labels, title):
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims) + 10 * (len(ims) + 1), h + 80), GRASS)
    d = ImageDraw.Draw(out)
    d.rectangle((0, 0, out.width, 40), fill=(24, 24, 24))
    d.text((12, 7), title, fill=(255, 255, 255), font=font(26))
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = 10 + i * (w + 10)
        d.text((x, 46), lab, fill=(255, 255, 255), font=font(22))
        out.paste(im.convert("RGB"), (x, 76))
    return out


def side(lv, k=0):
    b3 = frame3d(lv, k)
    box = box_of(lv, b3.size)
    name = f"Monster Academy level {lv}" + (" (game levels 4 and up)" if lv == 4 else "")
    return pair([flash(lv, k, b3.size).crop(box), on_grass(b3).crop(box)], ["Flash", "3D"], name)


def anim(lv):
    n = fref.frames(lv)
    tmp = HERE / "work" / f"anim{lv}"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    for k in range(n):
        im = side(lv, k)
        im = im.crop((0, 0, im.width - im.width % 2, im.height - im.height % 2))
        im.save(tmp / f"{k:02d}.png")
    out = HERE / f"L{lv}-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def scr(v, lv):
    """Flash pixel of world point v at level lv (as academy.scr)."""
    o = S.Lv(lv).ORIGIN
    sx, sy, sz = 10 * np.cos(np.pi / 4), 10 * np.sin(np.pi / 4) * 0.5, 10 * np.cos(np.pi / 6)
    return o[0] + sx * (v[0] + v[1]), o[1] + sy * (v[0] - v[1]) - sz * v[2]


def levels(clean=False):
    """The four looks at one scale and one crop: Flash on top, 3D below; on the 3D, dashed lines through the shared
    parts (the opening and the foot). clean: no lines or crosses (the owner's copy)."""
    size = frame3d(1, 0).size
    k = size[0] / (fref.FRAME[2] - fref.FRAME[0])
    boxes = [box_of(lv, size) for lv in fref.LEVELS]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    w, h = box[2] - box[0], box[3] - box[1]
    gap, top, lab = 12, 84, 40
    nl = len(fref.LEVELS)
    out = Image.new("RGB", (nl * w + (nl + 1) * gap, top + 2 * (h + lab + gap)), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 8), "Monster Academy, levels 1-4 at one scale: Flash (top), 3D (bottom); game levels 5+ use level 4",
           fill=(255, 255, 255), font=font(26))
    if not clean:
        d.text((12, 44), "Red crosses on the 3D: the opening and the foot. Flash redraws the body at level 3 "
               "(ribs, glass ring) and draws it smaller and lower; level 4 lifts the dome on a taller tank",
               fill=(200, 200, 200), font=font(20))
    rows = (("Flash", lambda lv: flash(lv, 0, size)), ("3D", lambda lv: on_grass(frame3d(lv, 0))))
    ys = [top + r * (h + lab + gap) for r in range(2)]
    for i, lv in enumerate(fref.LEVELS):
        x = gap + i * (w + gap)
        for (name, get), y in zip(rows, ys):
            d.text((x, y + 6), f"Level {lv}  {name}", fill=(255, 255, 255), font=font(24))
            out.paste(get(lv).crop(box).convert("RGB"), (x, y + lab))
    y3 = ys[1] + lab
    for i, lv in enumerate(fref.LEVELS if not clean else ()):
        x0 = gap + i * (w + gap)
        for name, v in S.mounts(lv).items():
            fx, fy = scr(v, lv)
            py = y3 + (fy - fref.FRAME[1]) * k - box[1]
            for xx in range(x0, x0 + w - 12, 24):
                d.line((xx, py, xx + 12, py), fill=(255, 255, 255), width=2)
            cx = x0 + (fx - fref.FRAME[0]) * k - box[0]
            d.line((cx - 14, py, cx + 14, py), fill=(255, 40, 40), width=4)
            d.line((cx, py - 14, cx, py + 14), fill=(255, 40, 40), width=4)
    return out


def game():
    """At the game's size: 1x and 2x, Flash beside 3D for every level (each scaled down from its large picture)."""
    size = frame3d(1, 0).size
    k = size[0] // (fref.FRAME[2] - fref.FRAME[0])
    boxes = [box_of(lv, size) for lv in fref.LEVELS]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    cols = []
    for lv in fref.LEVELS:
        f = flash(lv, 0, size).crop(box)
        t = on_grass(frame3d(lv, 0)).crop(box)
        cols.append([(s, f.resize((f.width * s // k, f.height * s // k), Image.LANCZOS),
                      t.resize((f.width * s // k, f.height * s // k), Image.LANCZOS)) for s in (1, 2)])
    cw = max(c[1][1].width for c in cols) * 2 + 20
    h1, h2 = cols[0][0][1].height, cols[0][1][1].height
    out = Image.new("RGB", (len(cols) * cw + 10, 76 + h1 + 40 + h2 + 20), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), "Monster Academy at game size: 1x (top) and 2x, Flash | 3D, levels 1-4", fill=(255, 255, 255),
           font=font(22))
    for i, (lv, c) in enumerate(zip(fref.LEVELS, cols)):
        x = 10 + i * cw
        d.text((x, 46), f"L{lv}", fill=(255, 255, 255), font=font(18))
        y = 76
        for s, a, b in c:
            out.paste(a.convert("RGB"), (x, y))
            out.paste(b.convert("RGB"), (x + a.width + 6, y))
            y += a.height + 40
    return out


CROPS = {1: {"opening": (-26, -16, 28, 14), "porthole": (-48, 10, -8, 50), "band": (-46, 30, 48, 62)},
         2: {"opening": (-26, -16, 28, 14), "finL": (-56, -24, -14, 20), "finR": (14, -24, 56, 20),
             "portR": (8, 10, 48, 50)},
         3: {"opening": (-28, -20, 28, 8), "ribL": (-56, -6, -8, 80), "ribtop": (-44, -16, 0, 30),
             "glass": (-30, 30, 30, 72)},
         4: {"opening": (-28, -40, 28, -12), "ribL": (-56, -24, -8, 80), "ribtop": (-44, -36, 0, 10),
             "tank": (-30, 10, 30, 72)}}


def crops(lv, zoom=6):
    """Full-size details: Flash beside 3D, both enlarged to zoom px per Flash px (the 3D is K px per Flash px)."""
    b3 = on_grass(frame3d(lv, 0))
    k = b3.width // (fref.FRAME[2] - fref.FRAME[0])
    fl = flash(lv, 0, b3.size)
    fx, fy = fref.FRAME[:2]
    out = []
    (HERE / "crops").mkdir(exist_ok=True)
    for name, (x0, y0, x1, y1) in CROPS[lv].items():
        bx = ((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)
        sz = ((x1 - x0) * zoom, (y1 - y0) * zoom)
        a = fl.crop(bx).resize(sz, Image.LANCZOS)
        b = b3.crop(bx).resize(sz, Image.LANCZOS)
        p = HERE / "crops" / f"L{lv}-{name}.png"
        pair([a, b], ["Flash", "3D"], f"Level {lv}: {name}").save(p)
        out.append(p)
    return out


def motion(lv):
    """Where the 3D loop changes pixels (red on the frame), beside the same for Flash."""
    ims = []
    n = fref.frames(lv)
    size = frame3d(lv, 0).size
    for kind in ("flash", "3d"):
        get = (lambda k: flash(lv, k, size)) if kind == "flash" else (lambda k: on_grass(frame3d(lv, k)))
        f0 = np.array(get(0).convert("RGB")).astype(int)
        ch = np.zeros(f0.shape[:2], bool)
        for k in range(1, n):
            ch |= np.abs(np.array(get(k).convert("RGB")).astype(int) - f0).max(-1) > 6
        a = f0.astype(float)
        a[ch] = a[ch] * 0.3 + np.array([255, 0, 0]) * 0.7
        ims.append(Image.fromarray(a.astype(np.uint8)).crop(box_of(lv, size)))
    return pair(ims, ["Flash: pixels that change in the loop", "3D"], f"Monster Academy level {lv}: what moves")


def still_check(lv):
    """Changed pixels between 3D frames, outside the moving parts' layers (must be 0) and in all."""
    base = np.array(frame3d(lv, 0)).astype(int)
    ch = np.zeros(base.shape[:2], bool)
    cover = np.zeros(base.shape[:2], bool)
    for p in sorted(R.glob(f"L{lv}-parts-*.png")):
        k = int(p.stem.split("-")[-1])
        f = np.array(frame3d(lv, k)).astype(int)
        ch |= np.abs(f - base).max(-1) > 0
        cover |= np.array(Image.open(p).getchannel("A")) > 0
    return int(ch.sum()), int((ch & ~cover).sum())


if __name__ == "__main__":
    cmd = sys.argv[1]
    lv = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    if cmd == "side":
        side(lv).save(HERE / f"L{lv}-side.png")
    elif cmd == "outline":
        r = fit.overlay(lv, R / f"L{lv}-alone.png", HERE / f"L{lv}-outline.png")
        print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif cmd == "anim":
        print(anim(lv), "changed px (all, outside moving parts):", still_check(lv))
    elif cmd == "levels":
        levels().save(HERE / "academy-levels.png")
        levels(clean=True).save(HERE / "academy-levels-clean.png")
    elif cmd == "game":
        game().save(HERE / "academy-game.png")
    elif cmd == "crops":
        print(*crops(lv), sep="\n")
    elif cmd == "motion":
        motion(lv).save(HERE / f"L{lv}-motion.png")
