"""ipost.py : the sample pictures of an Inferno building in 3D, from its folder's renders (<dir>/render/) and the Flash
art (iref.py). The folder's conf.py gives TID, NAME, FRAME, ORIGINS (per look), LOOKS.

    python ipost.py <dir> side <look>      <dir>/L<look>-side.png     Flash | 3D, large, frame 0
    python ipost.py <dir> outline <look>   <dir>/L<look>-outline.png  Flash outline (red) on the 3D, miss map, IoU
    python ipost.py <dir> anim <look>      <dir>/L<look>-anim.mp4     Flash | 3D, the loop three times at the game's
                                           13.3 frames a second; prints the changed pixels outside the moving layer
    python ipost.py <dir> motion <look>    <dir>/L<look>-motion.png   which pixels change in the loop, Flash and 3D
    python ipost.py <dir> levels           <dir>/<name>-levels.png    every look at one scale, Flash above 3D, each
                                           look placed on its bowl axis (Flash moves the body between looks)
A 3D frame is the base picture (every still part and the ground shadow) with that frame's moving-parts layer over it.
"""
import importlib.util
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import iref

GROUND = (62, 44, 38)          # the Inferno yard's dark ground, for the pictures
FPS = 40 / 3


def load(d):
    spec = importlib.util.spec_from_file_location("conf", Path(d) / "conf.py")
    c = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(c)
    return c


D = Path(sys.argv[1]).resolve() if __name__ == "__main__" else None
C = load(D) if D else None


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def frame3d(lv, k=0):
    r = D / "render"
    base = Image.open(r / f"L{lv}-base.png").convert("RGBA")
    p = r / f"L{lv}-parts-{k:02d}.png"
    if p.exists():
        base.alpha_composite(Image.open(p).convert("RGBA"))
    return base


def flash(lv, k, size):
    sh = iref.shadow_rgba(C.TID, lv, C.FRAME).resize(size, Image.BICUBIC)
    top = iref.flash_rgba(C.TID, lv, k, C.FRAME).resize(size, Image.BICUBIC)
    out = Image.new("RGBA", size, GROUND + (255,))
    out.alpha_composite(sh)
    out.alpha_composite(top)
    return out


def on_ground(im):
    out = Image.new("RGBA", im.size, GROUND + (255,))
    out.alpha_composite(im)
    return out


def box_of(lv, size):
    a = np.array(iref.flash_rgba(C.TID, lv, 0, C.FRAME).resize(size).getchannel("A")) > 8
    a |= np.array(iref.shadow_rgba(C.TID, lv, C.FRAME).resize(size).getchannel("A")) > 40
    a |= np.array(frame3d(lv, 0).getchannel("A")) > 40
    for p in sorted((D / "render").glob(f"L{lv}-parts-*.png")):
        a |= np.array(Image.open(p).getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    pad = 30
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad), min(size[1], ys.max() + pad)


def pair(ims, labels, title):
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims) + 10 * (len(ims) + 1), h + 80), GROUND)
    d = ImageDraw.Draw(out)
    d.rectangle((0, 0, out.width, 40), fill=(24, 24, 24))
    d.text((12, 7), title, fill=(255, 255, 255), font=font(26))
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = 10 + i * (w + 10)
        d.text((x, 46), lab, fill=(255, 255, 255), font=font(22))
        out.paste(im.convert("RGB"), (x, 76))
    return out


def side(lv, k=0, box=None):
    b3 = frame3d(lv, k)
    box = box or box_of(lv, b3.size)
    return pair([flash(lv, k, b3.size).crop(box), on_ground(b3).crop(box)], ["Flash", "3D"],
                f"{C.NAME} look {lv} (levels {C.LEVELS[lv]})")


def anim(lv):
    n = iref.frames(C.TID, lv)
    tmp = D / "work" / f"anim{lv}"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    box = box_of(lv, frame3d(lv, 0).size)
    for k in range(n):
        im = side(lv, k, box)
        im = im.crop((0, 0, im.width - im.width % 2, im.height - im.height % 2))
        im.save(tmp / f"{k:02d}.png")
    out = D / f"L{lv}-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def edge(m):
    im = Image.fromarray((m * 255).astype(np.uint8))
    return (np.array(im.filter(ImageFilter.MaxFilter(5))) > 0) & ~(np.array(im.filter(ImageFilter.MinFilter(3))) > 0)


def outline(lv, src=None):
    im = Image.open(src or D / "render" / f"L{lv}-alone.png").convert("RGBA")
    f = np.array(iref.flash_rgba(C.TID, lv, 0, C.FRAME).getchannel("A").resize(im.size, Image.BILINEAR)) > 128
    t = np.array(im.getchannel("A")) > 128
    a = np.array(on_ground(im).convert("RGB"))
    a[edge(f)] = (255, 30, 30)
    a[edge(t)] = (40, 230, 255)
    miss = np.zeros(a.shape, np.uint8) + np.array(GROUND, np.uint8)
    miss[f & t] = (150, 150, 150)
    miss[f & ~t] = (230, 40, 40)
    miss[t & ~f] = (40, 200, 240)
    fl = np.array(flash(lv, 0, im.size).convert("RGB"))
    plain = np.array(on_ground(im).convert("RGB"))
    ys, xs = np.nonzero(f | t)
    pad = 20
    y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad, max(0, xs.min() - pad), xs.max() + pad
    both = np.concatenate([p[y0:y1, x0:x1] for p in (fl, plain, a, miss)], 1)
    iou = (f & t).sum() / max(1, (f | t).sum())
    return Image.fromarray(both), iou, (f & ~t).sum() / f.sum(), (t & ~f).sum() / f.sum()


def motion(lv):
    ims = []
    size = frame3d(lv, 0).size
    box = box_of(lv, size)
    n = iref.frames(C.TID, lv)
    for kind in ("flash", "3d"):
        get = (lambda k: flash(lv, k, size)) if kind == "flash" else (lambda k: on_ground(frame3d(lv, k)))
        f0 = np.array(get(0).convert("RGB")).astype(int)
        ch = np.zeros(f0.shape[:2], bool)
        for k in range(1, n):
            ch |= np.abs(np.array(get(k).convert("RGB")).astype(int) - f0).max(-1) > 6
        a = f0.astype(float)
        a[ch] = a[ch] * 0.3 + np.array([255, 0, 0]) * 0.7
        ims.append(Image.fromarray(a.astype(np.uint8)).crop(box))
    return pair(ims, ["Flash: pixels that change in the loop", "3D"], f"{C.NAME} look {lv}: what moves")


def still_check(lv):
    base = np.array(frame3d(lv, 0)).astype(int)
    ch = np.zeros(base.shape[:2], bool)
    cover = np.zeros(base.shape[:2], bool)
    for p in sorted((D / "render").glob(f"L{lv}-parts-*.png")):
        k = int(p.stem.split("-")[-1])
        f = np.array(frame3d(lv, k)).astype(int)
        ch |= np.abs(f - base).max(-1) > 0
        cover |= np.array(Image.open(p).getchannel("A")) > 0
    return int(ch.sum()), int((ch & ~cover).sum())


def levels():
    """Every look at one scale, Flash above 3D; each look's crop is placed on its own body axis (ORIGINS)."""
    size = frame3d(C.LOOKS[0], 0).size
    k = size[0] / (C.FRAME[2] - C.FRAME[0])
    crops = []
    for lv in C.LOOKS:
        ox = (C.ORIGINS[lv][0] - C.FRAME[0]) * k
        oy = (C.ORIGINS[lv][1] - C.FRAME[1]) * k
        b = box_of(lv, size)
        crops.append((lv, ox, oy, b))
    left = max(c[1] - c[3][0] for c in crops)
    right = max(c[3][2] - c[1] for c in crops)
    up = max(c[2] - c[3][1] for c in crops)
    down = max(c[3][3] - c[2] for c in crops)
    w, h = int(left + right), int(up + down)
    gap, top, lab = 12, 84, 40
    n = len(C.LOOKS)
    out = Image.new("RGB", (n * w + (n + 1) * gap, top + 2 * (h + lab + gap)), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 8), f"{C.NAME}: every Flash look at one scale, Flash (top) and 3D (bottom)", fill=(255, 255, 255),
           font=font(26))
    d.text((12, 44), C.NOTE, fill=(200, 200, 200), font=font(20))
    for i, (lv, ox, oy, _) in enumerate(crops):
        x = gap + i * (w + gap)
        bx = (int(ox - left), int(oy - up), int(ox - left) + w, int(oy - up) + h)
        for r, (name, im) in enumerate((("Flash", flash(lv, 0, size)), ("3D", on_ground(frame3d(lv, 0))))):
            y = top + r * (h + lab + gap)
            d.text((x, y + 6), f"Look {lv} (levels {C.LEVELS[lv]})  {name}", fill=(255, 255, 255), font=font(24))
            canvas = Image.new("RGBA", (w, h), GROUND + (255,))
            canvas.alpha_composite(im, (-bx[0], -bx[1]))
            out.paste(canvas.convert("RGB"), (x, y + lab))
    return out


if __name__ == "__main__":
    cmd = sys.argv[2]
    if cmd == "side":
        lv = int(sys.argv[3])
        side(lv).save(D / f"L{lv}-side.png")
    elif cmd == "outline":
        lv = int(sys.argv[3])
        src = Path(sys.argv[4]) if len(sys.argv) > 4 else None
        im, iou, miss, extra = outline(lv, src)
        im.save(D / ("work" if src else ".") / f"L{lv}-outline.png")
        print(f"L{lv}: overlap (IoU) {iou:.3f}  Flash not covered {miss:.3f}  3D outside Flash {extra:.3f}")
    elif cmd == "anim":
        lv = int(sys.argv[3])
        print(anim(lv), "changed px (all, outside moving parts):", still_check(lv))
    elif cmd == "motion":
        lv = int(sys.argv[3])
        motion(lv).save(D / f"L{lv}-motion.png")
    elif cmd == "levels":
        levels().save(D / f"{C.SLUG}-levels.png")
