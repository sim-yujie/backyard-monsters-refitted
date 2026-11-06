"""post.py : the sample pictures and loops of the Coal Extractor in 3D (coal.py's renders), as the Bone Cruncher's
../bone-clean2/post.py, plus Flash beside the 3D.

python post.py stills          tier1-3.png, tiers.png, coal-levels.png (Flash above 3D at levels 1, 3, 6, 10),
                               crops (crop-<part>.png: every tier, Flash above 3D), game-1x.png, game-2x.png
python post.py anim <level>    tier<t>-anim.mp4 (Flash beside 3D, the loop three times) and the loop check
python post.py loop <level>    only the loop check

A 3D frame is the base picture (every still part and the ground shadow) with that frame's moving-parts layer laid over
it. Levels 1, 3 and 10 are rendered (tiers 1, 2, 3); level 6 is tier 2, the same picture as level 3.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
sys.path.insert(0, str(D.parent))
import iref  # noqa: E402

R = D / "render"
FRAME = (-56, -72, 64, 84)
N = 36
BG = (62, 44, 38, 255)                  # the Inferno yard's dark ground
TIER = {1: 1, 3: 2, 6: 2, 10: 3}
REND = {1: 1, 2: 3, 3: 10}              # tier -> rendered level
FLASH = {1: 1, 3: 3, 6: 3, 10: 3}       # level -> Flash look
NAMES = {1: "Tier 1 (levels 1-2)", 2: "Tier 2 (levels 3-6)", 3: "Tier 3 (levels 7-10)"}


def font(n):
    for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(f, n)
        except OSError:
            pass
    return ImageFont.load_default()


def frame(lv, k=0):
    base = Image.open(R / f"L{lv}-base.png").convert("RGBA")
    p = R / f"L{lv}-parts-{k:02d}.png"
    if p.exists():
        parts = Image.open(p).convert("RGBA")
        if parts.size != base.size:
            parts = parts.resize(base.size, Image.LANCZOS)
        base.alpha_composite(parts)
    return base


def flash(look, k, size):
    sh = iref.shadow_rgba(2, look, FRAME).resize(size, Image.BICUBIC)
    top = iref.flash_rgba(2, look, k, FRAME).resize(size, Image.BICUBIC)
    out = Image.new("RGBA", size, BG)
    out.alpha_composite(sh)
    out.alpha_composite(top)
    return out


def on(im, bg=BG):
    out = Image.new("RGBA", im.size, bg)
    out.alpha_composite(im)
    return out


def bbox(ims, pad=30):
    a = None
    for im in ims:
        m = np.array(im.getchannel("A")) > 40
        a = m if a is None else a | m
    ys, xs = np.nonzero(a)
    h, w = a.shape
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad), min(h, ys.max() + pad)


# areas to crop, in Flash px of the frame (x0, y0, x1, y1)
CROPS = {"bin": (-30, -22, 6, 26), "turret": (-6, -50, 36, -8), "pipes": (-46, -56, 20, -10),
         "feet": (-16, 22, 40, 52), "windows": (-4, 8, 34, 34), "column": (-46, -16, -6, 56)}


def stills():
    ims = {t: frame(REND[t]) for t in (1, 2, 3)}
    size = ims[1].size
    k = size[0] / (FRAME[2] - FRAME[0])
    fl = {lv: flash(lv, 0, size) for lv in (1, 3)}
    bb = bbox([Image.open(R / f"L{REND[t]}-alone.png") for t in (1, 2, 3)] +
              [iref.flash_rgba(2, lv, 0, FRAME).resize(size) for lv in (1, 3)], 60)
    for t, im in ims.items():
        on(im).crop(bb).save(D / f"tier{t}.png")
    cw, ch = bb[2] - bb[0], bb[3] - bb[1]
    # tiers side by side
    sheet = Image.new("RGBA", (3 * cw, ch + 70), BG)
    d = ImageDraw.Draw(sheet)
    for i, t in enumerate((1, 2, 3)):
        sheet.alpha_composite(on(ims[t]).crop(bb), (i * cw, 70))
        d.text((i * cw + 20, 18), NAMES[t], fill=(240, 230, 220, 255), font=font(34))
    sheet.save(D / "tiers.png")
    # Flash above 3D at levels 1, 3, 6, 10, one scale
    lvls = (1, 3, 6, 10)
    s = Image.new("RGBA", (4 * cw, 2 * ch + 120), BG)
    d = ImageDraw.Draw(s)
    d.text((16, 10), "Inferno Coal Extractor: Flash (top) and 3D (bottom), one scale", fill=(255, 255, 255, 255),
           font=font(36))
    for i, lv in enumerate(lvls):
        s.alpha_composite(fl[FLASH[lv]].crop(bb), (i * cw, 60))
        s.alpha_composite(on(ims[TIER[lv]]).crop(bb), (i * cw, 60 + ch + 50))
        d.text((i * cw + 16, 66), "Flash level %d" % lv, fill=(255, 230, 160, 255), font=font(30))
        d.text((i * cw + 16, 60 + ch + 56), "3D level %d (%s)" % (lv, NAMES[TIER[lv]].split(" (")[0].lower()),
               fill=(255, 230, 160, 255), font=font(30))
    s.convert("RGB").save(D / "coal-levels.png")
    # crops: every tier, Flash above 3D, enlarged
    for name, (x0, y0, x1, y1) in CROPS.items():
        box = tuple(int(v) for v in ((x0 - FRAME[0]) * k, (y0 - FRAME[1]) * k, (x1 - FRAME[0]) * k,
                                     (y1 - FRAME[1]) * k))
        w, h = box[2] - box[0], box[3] - box[1]
        z = max(1.0, 520 / w)
        W, H = int(w * z), int(h * z)
        c = Image.new("RGBA", (3 * W + 20, 2 * H + 10), BG)
        for i, t in enumerate((1, 2, 3)):
            c.alpha_composite(fl[1 if t == 1 else 3].crop(box).resize((W, H), Image.LANCZOS), (i * (W + 10), 0))
            c.alpha_composite(on(ims[t]).crop(box).resize((W, H), Image.LANCZOS), (i * (W + 10), H + 10))
        c.convert("RGB").save(D / f"crop-{name}.png")
    # game size: the whole frame at 1x and 2x, Flash look 1 | tier 1 | tier 2 | tier 3 | Flash look 3
    for sc in (1, 2):
        w, h = (FRAME[2] - FRAME[0]) * sc, (FRAME[3] - FRAME[1]) * sc
        g = Image.new("RGBA", (5 * w, h), BG)
        for i, im in enumerate((fl[1], ims[1], ims[2], ims[3], fl[3])):
            g.alpha_composite(im.resize((w, h), Image.LANCZOS), (i * w, 0))
        g.convert("RGB").save(D / f"game-{sc}x.png")
    print("DONE stills", bb)


def loopcheck(lv):
    """Frame 36 against frame 0, the last-to-first jump against the usual step, and changed pixels outside the
    moving parts' layer (must be 0)."""
    def arr(k):
        return np.asarray(frame(lv, k), dtype=np.float32)
    f0 = arr(0)
    steps = [np.abs(arr(k + 1) - arr(k)).mean() for k in range(0, N - 1, 5)]
    res = {"mean step": round(float(np.mean(steps)), 3), "last->first": round(float(np.abs(f0 - arr(N - 1)).mean()), 3)}
    if (R / f"L{lv}-parts-{N:02d}.png").exists():
        f36 = arr(N)
        res["frame36 vs frame0 pixels >8"] = int((np.abs(f36 - f0).max(axis=2) > 8).sum())
    moving = np.zeros(f0.shape[:2], bool)
    for k in range(N):
        moving |= np.asarray(Image.open(R / f"L{lv}-parts-{k:02d}.png").getchannel("A")) > 0
    out = 0
    for k in range(1, N):
        out += int(((np.abs(arr(k) - f0).max(axis=2) > 1) & ~moving).sum())
    res["changed pixels outside the moving layer"] = out
    print("LOOP level", lv, res)
    return res


def anim(lv):
    t = TIER[lv]
    look = FLASH[lv]
    tmp = R / f"mp4-{lv}"
    tmp.mkdir(exist_ok=True)
    fr = [frame(lv, k) for k in range(N)]
    size = fr[0].size
    nf = iref.frames(2, look)
    flf = [flash(look, k, size) for k in range(nf)]
    bb = bbox([Image.open(R / f"L{lv}-alone.png")] + [Image.open(R / f"L{lv}-parts-{k:02d}.png") for k in range(N)] +
              [iref.flash_rgba(2, look, 0, FRAME).resize(size)], 40)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    w, h = w + w % 2, h + h % 2
    # Flash runs its own frame count at 24 a second; the 3D loop runs 36 frames at 40/3 a second (the game's rate)
    fps = 24
    total = int(round(3 * N / (40 / 3) * fps))
    for j in range(total):
        tsec = j / fps
        a = on(flf[int(tsec * 24) % nf]).crop((bb[0], bb[1], bb[0] + w, bb[1] + h))
        b = on(fr[int(tsec * 40 / 3) % N]).crop((bb[0], bb[1], bb[0] + w, bb[1] + h))
        c = Image.new("RGBA", (2 * w + 8, h + 56), BG)
        c.alpha_composite(a, (0, 56))
        c.alpha_composite(b, (w + 8, 56))
        d = ImageDraw.Draw(c)
        d.text((14, 10), "Flash look %d" % look, fill=(255, 230, 160, 255), font=font(32))
        d.text((w + 22, 10), "3D " + NAMES[t], fill=(255, 230, 160, 255), font=font(32))
        if c.width % 2:
            c = c.crop((0, 0, c.width - 1, c.height))
        c.convert("RGB").save(tmp / f"f{j:03d}.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "f%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", str(D / f"tier{t}-anim.mp4")], check=True)
    for p in tmp.glob("*.png"):
        p.unlink()
    tmp.rmdir()
    print("DONE anim", lv)
    loopcheck(lv)


if __name__ == "__main__":
    if sys.argv[1] in ("anim", "loop"):
        R = D / "anim" / "render"
    if sys.argv[1] == "stills":
        stills()
    elif sys.argv[1] == "anim":
        anim(int(sys.argv[2]))
    else:
        loopcheck(int(sys.argv[2]))
