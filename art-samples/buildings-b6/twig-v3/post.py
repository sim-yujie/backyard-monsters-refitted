"""post.py : the Twig Snapper v3 sample pictures, with v2 (../twig-v2/render) beside them for comparison,, from twig2.py's renders (render/) and the Flash art (fref.py).

    python post.py side <level>      L<level>-side.png      Flash | v2 | v3, large (the building fills the frame), frame 0
    python post.py outline <level>   L<level>-outline.png   Flash outline (red) on the 3D, the miss map; overlap printed
    python post.py anim <level>      L<level>-anim.mp4      Flash | v2 | v3, the producing loop at the game's 13.3 frames a
                                     second (40 Hz yard tick, a frame every 3rd tick), three times round
    python post.py sheet             twig-levels-v3.png     all four looks, Flash | v2 | v3
A 3D frame is the base picture (every still part and the ground shadow) with the frame's moving-parts layer laid over
it, so nothing outside the moving parts can change between frames.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

import fit
import fref

HERE = Path(__file__).resolve().parent
R = HERE / "render"
R2 = HERE.parent / "twig-v2" / "render"       # the previous version, shown beside this one
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


def flash(lv, k, size):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top and the saw cell), scaled up."""
    sh = fref.shadow_rgba(lv).resize(size, Image.BICUBIC)
    top = fref.flash_rgba(lv, k).resize(size, Image.BICUBIC)
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
    for r in (R, R2):
        a |= np.array(frame3d(lv, 0, r).getchannel("A")) > 40
        for p in sorted(r.glob(f"L{lv}-parts-*.png")):
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
    return pair([flash(lv, k, b3.size).crop(box), on_grass(frame3d(lv, k, R2)).crop(box), on_grass(b3).crop(box)],
                ["Flash", "3D v2 (before)", "3D v3 (now)"], f"Twig Snapper level {lv}")


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
    if cmd == "side":
        lv = int(sys.argv[2])
        side(lv).save(HERE / f"L{lv}-side.png")
    elif cmd == "outline":
        lv = int(sys.argv[2])
        r = fit.overlay(lv, R / f"L{lv}-alone.png", HERE / f"L{lv}-outline.png")
        print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif cmd == "anim":
        lv = int(sys.argv[2])
        print(anim(lv), "changed px (all, outside moving parts):", still_check(lv))
    elif cmd == "sheet":
        rows = [side(lv) for lv in fref.LEVELS]
        w = max(r.width for r in rows)
        out = Image.new("RGB", (w, sum(r.height for r in rows)), GRASS)
        y = 0
        for r in rows:
            out.paste(r, ((w - r.width) // 2, y))
            y += r.height
        out.save(HERE / "twig-levels-v3.png")
