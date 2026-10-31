"""post.py : the clean-room Bone Cruncher's pictures and loops, from render/ (no Flash pictures are used here).

python post.py still <tier>       tier<tier>.png               frame 0 on the Inferno ground, full size
python post.py crop <tier> x y w h name [zoom]   crops/tier<tier>-<name>.png   a full-size crop (pixels of the still)
python post.py tiers              tiers.png                    the three tiers side by side, one scale
python post.py game               game-1x.png, game-2x.png     the three tiers at the game's size (1x, 2x)
python post.py anim <tier>        tier<tier>-anim.mp4          the loop, three times round
python post.py loop <tier>        work/tier<tier>-loop.png     which pixels change through the loop (frames)
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
R = D / "render"
GROUND = (62, 44, 38)          # the Inferno yard's dark ground
FPS = 40 / 3
NAMES = {1: "Tier 1 (levels 1-2)", 2: "Tier 2 (levels 3-6)", 3: "Tier 3 (levels 7-10)"}


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def frames(t):
    return sorted(R.glob(f"L{t}-parts-*.png"))


def frame(t, k=0, ground=True):
    base = Image.open(R / f"L{t}-base.png").convert("RGBA")
    p = R / f"L{t}-parts-{k:02d}.png"
    if p.exists():
        base.alpha_composite(Image.open(p).convert("RGBA"))
    if not ground:
        return base
    out = Image.new("RGBA", base.size, GROUND + (255,))
    out.alpha_composite(base)
    return out.convert("RGB")


def box_all():
    """One crop box round every tier (alpha of the stills), so the tiers stay at one scale and place."""
    boxes = []
    for t in (1, 2, 3):
        a = np.array(frame(t, 0, ground=False).getchannel("A")) > 8
        ys, xs = np.nonzero(a)
        boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
    x0, y0 = min(b[0] for b in boxes) - 30, min(b[1] for b in boxes) - 30
    x1, y1 = max(b[2] for b in boxes) + 30, max(b[3] for b in boxes) + 30
    # the moving parts reach a little further (smoke): take the widest over the tier 3 loop as well
    return (max(0, x0), max(0, y0 - 60), x1, y1)


def still(t):
    im = frame(t, 0)
    im.save(D / f"tier{t}.png")
    return im


def crop(t, x, y, w, h, name, zoom=1):
    im = frame(t, 0).crop((x, y, x + w, y + h))
    if zoom != 1:
        im = im.resize((w * zoom, h * zoom), Image.NEAREST)
    (D / "crops").mkdir(exist_ok=True)
    im.save(D / "crops" / f"tier{t}-{name}.png")


def tiers():
    bx = box_all()
    ims = [frame(t, 0).crop(bx) for t in (1, 2, 3)]
    w, h = ims[0].size
    top = 70
    out = Image.new("RGB", (3 * w + 40, h + top), (30, 24, 22))
    d = ImageDraw.Draw(out)
    for i, im in enumerate(ims):
        out.paste(im, (10 + i * (w + 10), top))
        d.text((10 + i * (w + 10) + 14, 18), NAMES[i + 1], fill=(235, 225, 210), font=font(34))
    out.save(D / "tiers.png")


def game():
    """The game draws the building at 1 Flash px per px; the render is 12 render px per Flash px."""
    for zoom in (1, 2):
        ims = []
        for t in (1, 2, 3):
            im = frame(t, 0, ground=False)
            w, h = im.size
            im = im.resize((w * zoom // 12, h * zoom // 12), Image.LANCZOS)
            g = Image.new("RGBA", im.size, GROUND + (255,))
            g.alpha_composite(im)
            ims.append(g.convert("RGB"))
        w, h = ims[0].size
        pad = 6 * zoom
        out = Image.new("RGB", (3 * w + 4 * pad, h + 2 * pad), GROUND)
        for i, im in enumerate(ims):
            out.paste(im, (pad + i * (w + pad), pad))
        out.save(D / f"game-{zoom}x.png")


def anim(t):
    bx = box_all()
    tmp = D / "work" / f"anim{t}"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    n = len(frames(t))
    for k in range(n):
        im = frame(t, k).crop(bx)
        im = im.crop((0, 0, im.width - im.width % 2, im.height - im.height % 2))
        im.save(tmp / f"{k:02d}.png")
    out = D / f"tier{t}-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    print("wrote", out, n, "frames")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "still":
        still(int(sys.argv[2]))
    elif cmd == "crop":
        a = sys.argv[2:]
        crop(int(a[0]), *map(int, a[1:5]), a[5], int(a[6]) if len(a) > 6 else 1)
    elif cmd == "tiers":
        tiers()
    elif cmd == "game":
        game()
    elif cmd == "anim":
        anim(int(sys.argv[2]))
