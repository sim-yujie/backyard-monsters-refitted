"""anim.py : look C's crystal glow (idle and active), from icc.py's light layers (run.sh c layers).

    python anim.py check     how well base + 0 x glow matches Blender's own PNG of the base render (the conversion)
    python anim.py all       work/anim/NNN.png      the active loop, 32 frames (2.4 s at the game's 40/3 fps), RGBA
                             icc-c-final.png        the active loop's brightest frame, on grass, cropped
                             icc-c-idle.png         idle (not hatching): the crystal at a steady, dimmer glow
                             icc-c-active.mp4       the active loop, four times round (full size, on grass)
                             icc-c-active.gif       one loop, a third size
                             icc-c-crystal-crop.png the crystal, before (the look sample) | after, enlarged
                             icc-c-game.png         game size 1x and 2x, idle, active low and peak, beside the Magma Tower

Each frame is base + pulse(t) x (glow + light) + flicker(t) x cracks, in linear light, then Blender's Standard view
(sRGB). glow is the crystal's own glow at peak (shell and core), light the light it throws (its point light); pulse 1 =
peak. cracks is the drum's crack glow
(already in base at full strength); flicker adds or takes away a little of it. lava is the light the magma pool throws
onto the building (rim stones, pods, legs, bowl): added steady, LAVA x, in idle and active alike, with a soft warm
glow on the grass round the pool's rim (the pool's own area, blurred).
"""
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
W = HERE / "work"
R = HERE / "render"
GRASS = (96, 140, 60)
K = 12                        # render px per game px
N = 32                        # frames in the loop
FPS = 40 / 3                  # the game's frame rate for animated 3D buildings (as the Lab's 32-frame brew)
IDLE = 0.22                   # idle: steady glow, as a share of the active peak
LO = 0.35                     # active: the pulse's low point
LIGHT = 9.0                   # the crystal's thrown light (warm sheen on the drum's top, bezel, cup) at peak
LIGHT_POW = 1.6               # the thrown light falls off faster than the glow below peak (peak stands out)
GAIN = 1.2                    # the glow at pulse 1 against the strength it was rendered at (looks.py CRYSTAL_E)
HALO = 0.85                   # the soft 2D halo round the crystal at peak (alpha of its brightest point)
HALO_SIGMA = 70               # its blur radius in render px (12 render px = 1 game px)
HALO_COL = (1.0, 0.36, 0.08)  # linear warm orange
PAD = 160                     # room round the layers for the halo
LAVA = 3.0                    # the magma pool's thrown light, added on top of what base has (1x): steady, idle and active
LAVA_HALO = 0.60              # the soft warm glow on the grass just outside the pool's rim stones (alpha at the pool edge)
LAVA_SIGMA = 60               # its blur radius in render px
LAVA_WASH = 0.06              # the same glow as a faint warm wash on the parts next to the pool (rim stones, legs, pods)
LAVA_COL = (1.0, 0.30, 0.05)  # linear warm orange, a little redder than the crystal's halo


def pulse(k):
    """The active glow at frame k: one smooth swell and fade per loop, with a slight second beat, peak 1.0."""
    t = 2 * math.pi * k / N
    s = 0.5 - 0.5 * math.cos(t) + 0.05 * math.sin(2 * t)
    s = (s + 0.01) / 1.02
    return LO + (1 - LO) * max(0.0, min(1.0, s))


def flicker(k):
    """The cracks' faint flicker at frame k (a share of their glow, added to it): quicker, uneven, small."""
    t = 2 * math.pi * k / N
    return 0.10 * math.sin(3 * t + 0.7) + 0.06 * math.sin(5 * t + 2.1) + 0.12 * (pulse(k) - (1 + LO) / 2)


def layers():
    """The five layers, padded by PAD, plus the halo sources: the crystal's own glow, blurred (0..1 at peak), and the
    magma pool's area, blurred (0.5 at its edge, doubled and clipped: 1 inside), and the pool's area itself."""
    from scipy.ndimage import gaussian_filter
    L = [np.pad(np.load(R / f"layer-c-{n}.npy"), ((PAD, PAD), (PAD, PAD), (0, 0)))
         for n in ("base", "glow", "light", "cracks", "lavalight")]
    g = L[1][..., :3].mean(2)
    g = np.clip((g - 0.08) / 0.5, 0, 1)                  # the crystal itself, not the faint glow it casts nearby
    h = gaussian_filter(g, HALO_SIGMA)
    L.append(h / h.max())
    # the pool: solid in base, a clear hole in lavalight (its camera rays are held out); the ground shadow is never solid
    pool = ((L[0][..., 3] > 0.98) & (L[4][..., 3] < 0.02)).astype(np.float32)
    L.append(np.clip(2 * gaussian_filter(pool, LAVA_SIGMA), 0, 1))
    L.append(pool)
    return L


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def compose(L, s, f=0.0, lava=1.0):
    """One frame at glow s (1 = peak) and crack flicker f. The halo is a soft warm glow: added as light where the
    building is, and as a see-through warm layer behind it (on the grass). lava (1 = on, the same in every frame):
    the magma pool's steady light on the building and its soft glow on the grass round the rim."""
    base, glow, light, cr, lv, halo, pool, inpool = L
    hs = HALO * s ** 1.5 * halo[..., None]
    col = np.array(HALO_COL, np.float32)
    rgb = (base[..., :3] + GAIN * s * glow[..., :3] + LIGHT * s ** LIGHT_POW * light[..., :3] + f * cr[..., :3]
           + 0.35 * hs * col * base[..., 3:4] + lava * LAVA * lv[..., :3]
           + lava * LAVA_WASH * (pool * (1 - inpool))[..., None] * np.array(LAVA_COL, np.float32) * base[..., 3:4])
    a = base[..., 3:4]
    straight = np.where(a > 1e-4, rgb / np.maximum(a, 1e-4), 0.0)
    # the building over the halo layers (premultiplied, in linear light): crystal halo over the lava glow
    hs = np.clip(hs, 0, 1)
    hl = np.clip(lava * LAVA_HALO * pool[..., None], 0, 1)
    ha = hs + hl * (1 - hs)
    hcol = np.where(ha > 1e-4, (col * hs + np.array(LAVA_COL, np.float32) * hl * (1 - hs)) / np.maximum(ha, 1e-4), 0)
    out_a = a + ha * (1 - a)
    pm = straight * a + hcol * ha * (1 - a)
    st = np.where(out_a > 1e-4, pm / np.maximum(out_a, 1e-4), 0.0)
    out = np.concatenate([to_srgb(st), np.clip(out_a, 0, 1)], axis=2)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def on_grass(im):
    g = Image.new("RGBA", im.size, GRASS + (255,))
    g.alpha_composite(im)
    return g


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def label(im, text, size=34, pad=14):
    tw = int(ImageDraw.Draw(im).textlength(text, font=font(size))) + 2 * pad
    out = Image.new("RGBA", (max(im.width, tw), im.height + size + 2 * pad), (34, 34, 38, 255))
    out.alpha_composite(im.convert("RGBA"), (0, size + 2 * pad))
    ImageDraw.Draw(out).text((pad, pad), text, fill=(240, 240, 240), font=font(size))
    return out


def row(ims, gap=16, bg=(34, 34, 38, 255)):
    w = sum(i.width for i in ims) + gap * (len(ims) + 1)
    h = max(i.height for i in ims) + 2 * gap
    out = Image.new("RGBA", (w, h), bg)
    x = gap
    for i in ims:
        out.alpha_composite(i.convert("RGBA"), (x, gap + (h - 2 * gap - i.height) // 2))
        x += i.width + gap
    return out


def region():
    """Where the layers sit in the full render frame: (left, top) px."""
    b = (R / "layer-c-border.txt").read_text().split()
    x0, x1, y0, y1 = map(float, b[:4])
    rw, rh = int(b[4]), int(b[5])
    return int(x0 * rw) - PAD, int(rh - y1 * rh) - PAD, rw, rh


def tight(ims, pad=24):
    a = np.zeros(ims[0].size[::-1], bool)
    for im in ims:
        a |= np.array(im.getchannel("A")) > 20
    ys, xs = np.nonzero(a)
    w, h = ims[0].size
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad + 1), min(h, ys.max() + pad + 1)


def check():
    L = layers()
    mine = np.array(compose(L, 0.0, lava=0.0)).astype(int)[PAD:-PAD, PAD:-PAD]
    bl = np.array(Image.open(R / "layer-c-base.png").convert("RGBA")).astype(int)
    m = bl[..., 3] > 250
    d = np.abs(mine[..., :3] - bl[..., :3])[m]
    print("opaque px", m.sum(), "mean diff", d.mean().round(3), "p99", np.percentile(d, 99), "max", d.max())
    print("alpha diff max", np.abs(mine[..., 3] - bl[..., 3]).max())


def game_sheet(idle, low, peak):
    """1x and 2x game size (Flash px): idle, active at its lowest and at its peak, beside the Magma Tower's in-game 3D
    (tier 1 and 3)."""
    mt = Path(sys.argv[2]) if len(sys.argv) > 2 else W / "magma"
    tw = [Image.open(mt / f"body.t{t}@2x.webp").convert("RGBA") for t in (1, 3)]
    tops = [Image.open(mt / f"top.t{t}@2x.webp").convert("RGBA") for t in (1, 3)]
    cols = []
    for scale, name in ((1, "1x"), (2, "2x")):
        tiles = []
        for im, what in ((idle, "idle"), (low, "active low"), (peak, "active peak")):
            g = on_grass(im.resize((im.width * scale // K, im.height * scale // K), Image.LANCZOS))
            tiles.append(label(g.resize((g.width * 2, g.height * 2), Image.NEAREST), f"ICC {what} {name}", 20, 8))
        for t, (b, tp) in enumerate(zip(tw, tops)):
            tower = Image.new("RGBA", b.size, (0, 0, 0, 0))
            tower.alpha_composite(b)
            if t == 1:
                tower.alpha_composite(tp)
            sz = (b.width * scale // 2, b.height * scale // 2)
            g = on_grass(tower.resize(sz, Image.LANCZOS))
            tiles.append(label(g.resize((g.width * 2, g.height * 2), Image.NEAREST),
                               f"Magma Tower t{(1, 3)[t]} {name}", 20, 8))
        cols.append(row(tiles))
    out = Image.new("RGBA", (max(c.width for c in cols), sum(c.height for c in cols)), (34, 34, 38, 255))
    y = 0
    for c in cols:
        out.alpha_composite(c, (0, y))
        y += c.height
    return label(out, "Game size, shown enlarged 2x with hard pixels: top row 1x, bottom row 2x (the game's sharp mode)",
                 22, 10)


def run_all():
    L = layers()
    fr = W / "anim"
    fr.mkdir(exist_ok=True)
    frames = [compose(L, pulse(k), flicker(k)) for k in range(N)]
    idle = compose(L, IDLE)
    box = tight(frames + [idle])
    for k, f in enumerate(frames):
        f.crop(box).save(fr / f"{k:03d}.png")
    kpk = max(range(N), key=pulse)
    klo = min(range(N), key=pulse)
    peak = frames[kpk].crop(box)
    on_grass(peak).save(HERE / "icc-c-final.png")
    on_grass(idle.crop(box)).save(HERE / "icc-c-idle.png")
    print("pulse", [round(pulse(k), 3) for k in range(N)], "peak frame", kpk)
    # the mp4: the loop four times round, full size on grass
    tmp = Path(tempfile.mkdtemp(prefix="icc-anim-"))
    for rep in range(4):
        for k, f in enumerate(frames):
            g = on_grass(f.crop(box))
            g = g.crop((0, 0, g.width // 2 * 2, g.height // 2 * 2))
            g.save(tmp / f"{rep * N + k:03d}.png")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", f"{FPS:.4f}", "-i", str(tmp / "%03d.png"),
                    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(HERE / "icc-c-active.mp4")], check=True)
    gif = [on_grass(f.crop(box)).convert("RGB") for f in frames]
    gif = [g.resize((g.width // 3, g.height // 3), Image.LANCZOS) for g in gif]
    gif[0].save(HERE / "icc-c-active.gif", save_all=True, append_images=gif[1:], duration=int(1000 / FPS), loop=0)
    # the crystal before | after: the same frame area of the old look-C still and of the new peak and idle
    ox, oy, rw, rh = region()
    old = Image.open(R / "icc-c-base.png").convert("RGBA")
    newfull = Image.new("RGBA", (rw, rh))
    newfull.paste(frames[kpk], (ox, oy))
    idlefull = Image.new("RGBA", (rw, rh))
    idlefull.paste(idle, (ox, oy))
    cb = crystal_box(old, newfull)
    z = 2
    tiles = [label(on_grass(im.crop(cb)).resize(((cb[2] - cb[0]) * z, (cb[3] - cb[1]) * z), Image.LANCZOS), t)
             for im, t in ((old, "Before (look sample)"), (newfull, "After: active, peak"), (idlefull, "After: idle"))]
    row(tiles).save(HERE / "icc-c-crystal-crop.png")
    game_sheet(idle.crop(box), frames[klo].crop(box), peak).save(HERE / "icc-c-game.png")


def crystal_box(*ims):
    """The crystal and its cup: the frame area above the drum's top (from icc.py's camera), widened to fit both."""
    a = np.zeros(ims[0].size[::-1], bool)
    for im in ims:
        a |= np.array(im.getchannel("A")) > 20
    ys, xs = np.nonzero(a)
    top = ys.min()
    # the post rises from the pedestal at about 37% of the building's height from its top
    h = ys.max() - top
    y1 = top + int(h * 0.36)
    sel = a[top:y1]
    cols = np.nonzero(sel.any(0))[0]
    cx = int(np.median(np.nonzero(a[top:top + int(h * 0.15)].any(0))[0]))
    half = max(260, int(h * 0.14))
    return cx - half, max(0, top - 30), cx + half, y1


if __name__ == "__main__":
    {"check": check, "all": run_all}[sys.argv[1]]()
