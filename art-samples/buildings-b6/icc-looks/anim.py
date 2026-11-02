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
onto the building (rim stones, pods, legs, bowl), LAVA x, in idle and active alike, with a soft warm glow on the grass
round the pool's rim (the pool's own area, blurred).

The lava cools and heats (owner, 2 Nov 2026: "Was hoping it transition from the ground's brownish red to yellow like
liquid magma. Right now its just liquid magma yellow."): one smooth cosine every 4.8 s, heat 1 (frame 0) to 0 and back.
The pool's surface goes from its rendered liquid yellow-orange (heat 1) through red-hot to a cooled crust in the Inferno
ground's own brownish red (heat 0: CRUST, measured off an in-game shot, where the render's crust is, VEIN where it glowed
brightest), a smooth curve in sRGB. All of the pool's thrown light (what base has, LAVA x more, the ground glow and the
warm wash) dims with it to LIGHT_LO and reddens (TINT_COOL, LAVA_COL_COOL). The crystal's glow and pulse are as before.
So the loops are as long as one cycle: active NA = 64 frames (the crystal pulses twice, the lava cycles once), idle
NI = 32 frames played at half the game's rate (the game's `rest` cells), so a cycle is 4.8 s in both and the lava keeps
its phase when the building starts or stops hatching (idle cell i = active cell 2i's lava).

    python anim.py game      render/game/: the game's cells for web/tools/tower-tiers/export3d_buildings.py ("icc"):
                             idle-NN.png, active-NN.png (the building and its glows, no ground shadow) and shadow.png
                             (the ground shadow alone, as alpha), all on look C's whole render canvas
                             icc-c-idle.mp4, icc-c-active.mp4 (rebuilt from the game's cells, as the game plays them)
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
NA = 64                       # active loop: two crystal pulses, one lava cycle (4.8 s)
NI = 32                       # idle loop: one lava cycle, each frame shown twice by the game (4.8 s)
CRUST = (58, 35, 28)          # sRGB: the cooled pool's dark crust = the Inferno ground (median of an in-game shot)
VEIN = (140, 46, 28)          # sRGB: the cooled pool where it glowed brightest, a deep brownish red
RED_HOT = (1.0, 0.42, 0.45)   # sRGB channel factors on the hot surface half way: red-hot, between the two ends
LIGHT_LO = 0.15               # the pool's thrown light at the cool end, as a share of its full strength
TINT_COOL = (1.0, 0.45, 0.35) # and its colour there (linear channel factors): redder
LAVA_COL_COOL = (1.0, 0.10, 0.03)  # the ground glow's and wash's colour at the cool end (linear)
NOISE = 0.012                 # the shadow catcher's faint wash over the open ground, taken off the shadow


def pulse(k):
    """The active glow at frame k: one smooth swell and fade per loop, with a slight second beat, peak 1.0."""
    t = 2 * math.pi * k / N
    s = 0.5 - 0.5 * math.cos(t) + 0.05 * math.sin(2 * t)
    s = (s + 0.01) / 1.02
    return LO + (1 - LO) * max(0.0, min(1.0, s))


def heat(k, n):
    """The lava's heat at frame k of an n-frame loop: one smooth cosine, liquid yellow (1.0) at frame 0, cooled crust
    (0.0) half way."""
    return 0.5 + 0.5 * math.cos(2 * math.pi * k / n)


def flicker(k):
    """The cracks' faint flicker at frame k (a share of their glow, added to it): quicker, uneven, small."""
    t = 2 * math.pi * k / N
    return 0.10 * math.sin(3 * t + 0.7) + 0.06 * math.sin(5 * t + 2.1) + 0.12 * (pulse(k) - (1 + LO) / 2)


def layers():
    """The five layers, padded by PAD, plus the halo sources: the crystal's own glow, blurred (0..1 at peak), and the
    magma pool's area, blurred (0.5 at its edge, doubled and clipped: 1 inside), the pool's area itself, and how
    brightly each pool pixel glows in the render (0 crust .. 1 brightest), which picks its colour when cooled."""
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
    y = L[0][..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    L.append((np.clip((y - 0.03) / 0.97, 0, 1) ** 0.6 * pool).astype(np.float32))
    return L


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def compose(L, s, f=0.0, lava=1.0, b=1.0):
    """One frame at glow s (1 = peak) and crack flicker f. The halo is a soft warm glow: added as light where the
    building is, and as a see-through warm layer behind it (on the grass). lava (1 = on, 0 = base alone): the magma
    pool's light on the building and its soft glow on the ground round the rim, at heat b (1 = liquid yellow, 0 = cooled
    crust, `heat()`): the whole of the pool's light, base's 1x and LAVA x more, is lerp(LIGHT_LO, 1, b) x what it is at
    full and reddens toward the cool end, and the pool's surface takes its colour from the hot render, red-hot and the
    cooled crust (a quadratic Bezier in sRGB, so the colour moves smoothly)."""
    base, glow, light, cr, lv, halo, pool, inpool, pat = L
    hs = HALO * s ** 1.5 * halo[..., None]
    col = np.array(HALO_COL, np.float32)
    lw = lava * (LIGHT_LO + (1 - LIGHT_LO) * b)
    tint = np.array(TINT_COOL, np.float32) * (1 - b) + b
    lcol = np.array(LAVA_COL_COOL, np.float32) * (1 - b) + np.array(LAVA_COL, np.float32) * b
    rgb = (base[..., :3] + GAIN * s * glow[..., :3] + LIGHT * s ** LIGHT_POW * light[..., :3] + f * cr[..., :3]
           + 0.35 * hs * col * base[..., 3:4] + (lw * (1 + LAVA) * tint - lava) * lv[..., :3]
           + lw * LAVA_WASH * (pool * (1 - inpool))[..., None] * lcol * base[..., 3:4])
    a = base[..., 3:4]
    straight = np.where(a > 1e-4, rgb / np.maximum(a, 1e-4), 0.0)
    # the building over the halo layers (premultiplied, in linear light): crystal halo over the lava glow
    hs = np.clip(hs, 0, 1)
    hl = np.clip(lw * LAVA_HALO * pool[..., None], 0, 1)
    ha = hs + hl * (1 - hs)
    hcol = np.where(ha > 1e-4, (col * hs + lcol * hl * (1 - hs)) / np.maximum(ha, 1e-4), 0)
    out_a = a + ha * (1 - a)
    pm = straight * a + hcol * ha * (1 - a)
    st = np.where(out_a > 1e-4, pm / np.maximum(out_a, 1e-4), 0.0)
    srgb = to_srgb(st)
    if lava > 0:
        # the pool's surface, in sRGB: hot (the render) <- red-hot <- cooled crust (CRUST .. VEIN by how it glowed)
        ys, xs = np.nonzero(inpool > 0)
        hot = srgb[ys, xs]
        p = pat[ys, xs][:, None]
        cool = (np.array(CRUST, np.float32) + (np.array(VEIN, np.float32) - np.array(CRUST, np.float32)) * p) / 255
        mid = hot * np.array(RED_HOT, np.float32)
        w = b * lava
        srgb[ys, xs] = (1 - w) ** 2 * cool + 2 * w * (1 - w) * mid + w ** 2 * hot
    out = np.concatenate([srgb, np.clip(out_a, 0, 1)], axis=2)
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


def loops(L):
    """The idle and active loops' frames, one at a time: (name, frame index, image). Idle: the crystal steady at IDLE,
    the lava cycling over NI frames; active: the crystal's pulse and the cracks' flicker as before (N frames each), the
    lava cycling over NA."""
    for i in range(NI):
        yield "idle", i, compose(L, IDLE, b=heat(i, NI))
    for k in range(NA):
        yield "active", k, compose(L, pulse(k % N), flicker(k % N), b=heat(k, NA))


def widest(L):
    """The box round everything any frame shows: the crystal at its peak and the lava at full reach furthest."""
    return tight([compose(L, 1.0, b=1.0), compose(L, IDLE, b=1.0)])


def mp4(frames, path, times=2):
    """frames (on grass) `times` round at the game's rate, as an mp4."""
    tmp = Path(tempfile.mkdtemp(prefix="icc-anim-"))
    j = 0
    for _ in range(times):
        for f in frames:
            f = f.crop((0, 0, f.width // 2 * 2, f.height // 2 * 2))
            f.convert("RGB").save(tmp / f"{j:04d}.png")
            j += 1
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", f"{FPS:.4f}", "-i", str(tmp / "%04d.png"),
                    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(path)], check=True)


def run_all():
    L = layers()
    fr = W / "anim"
    fr.mkdir(exist_ok=True)
    for old in fr.glob("*.png"):
        old.unlink()
    box = widest(L)
    kpk = max(range(N), key=pulse)
    klo = min(range(N), key=pulse)
    idle = active = peak = low = None
    for name, k, im in loops(L):
        im = im.crop(box)
        im.save(fr / f"{name}-{k:03d}.png")
        if name == "idle" and k == 0:
            idle = im
        if name == "active" and k == kpk:
            peak = im
        if name == "active" and k == klo:
            low = im
    on_grass(peak).save(HERE / "icc-c-final.png")
    on_grass(idle).save(HERE / "icc-c-idle.png")
    print("pulse", [round(pulse(k), 3) for k in range(N)], "peak frame", kpk)
    print("heat (active)", [round(heat(k, NA), 3) for k in range(0, NA, 4)])
    # the mp4s, as the game plays them (full size, on grass): the active loop and the idle loop (each idle frame
    # shown twice), each twice round (9.6 s)
    sm = lambda g: g.resize((g.width // 2, g.height // 2), Image.LANCZOS)  # noqa: E731  half size: the files stay small
    act = [sm(on_grass(Image.open(fr / f"active-{k:03d}.png"))) for k in range(NA)]
    mp4(act, HERE / "icc-c-active.mp4")
    idl = [sm(on_grass(Image.open(fr / f"idle-{k // 2:03d}.png"))) for k in range(2 * NI)]
    mp4(idl, HERE / "icc-c-idle.mp4")
    # the gif: every other frame (it stays small), a third size
    gif = [g.resize((g.width * 2 // 3, g.height * 2 // 3), Image.LANCZOS).convert("RGB") for g in act[::2]]
    gif[0].save(HERE / "icc-c-active.gif", save_all=True, append_images=gif[1:], duration=int(2000 / FPS), loop=0)
    # the crystal before | after: the same frame area of the old look-C still and of the new peak and idle
    ox, oy, rw, rh = region()
    old = Image.open(R / "icc-c-base.png").convert("RGBA")
    newfull = Image.new("RGBA", (rw, rh))
    newfull.paste(peak, (ox + box[0], oy + box[1]))
    idlefull = Image.new("RGBA", (rw, rh))
    idlefull.paste(idle, (ox + box[0], oy + box[1]))
    cb = crystal_box(old, newfull)
    z = 2
    tiles = [label(on_grass(im.crop(cb)).resize(((cb[2] - cb[0]) * z, (cb[3] - cb[1]) * z), Image.LANCZOS), t)
             for im, t in ((old, "Before (look sample)"), (newfull, "After: active, peak"), (idlefull, "After: idle"))]
    row(tiles).save(HERE / "icc-c-crystal-crop.png")
    game_sheet(idle, low, peak).save(HERE / "icc-c-game.png")


def unshadowed(base):
    """base split into the building with no ground shadow (premultiplied, as base) and the shadow alone (alpha of
    black), as export3d_buildings.py's split(): the shadow catcher's pixels are pure black, the building's never are;
    under the building the shadow is the nearest outside it, and the building's own alpha what base's is over that."""
    from scipy import ndimage
    a = base[..., 3]
    st = np.where(a > 1e-4, base[..., :3].max(2) / np.maximum(a, 1e-4), 0)
    building = (a > 0.02) & ~((st < 0.002) & (a < 0.95))
    building = ndimage.binary_opening(building, iterations=2)
    near = ndimage.binary_dilation(building, iterations=3)
    shade = np.clip((a - NOISE) / (1 - NOISE), 0, 1)
    idx = ndimage.distance_transform_edt(near, return_distances=False, return_indices=True)
    s = np.where(near, shade[idx[0], idx[1]], shade)
    ba = np.where(near, np.clip((a - s) / np.maximum(1 - s, 1e-3), 0, 1), 0)
    ba[ba < 0.04] = 0
    body = base.copy()
    body[..., :3] = np.where(ba[..., None] > 0, base[..., :3], 0)
    body[..., 3] = ba
    return body, s


def run_game():
    """The game's cells (`export3d_buildings.py icc`), on look C's whole render canvas, the padded layers placed in it
    (the halo past the canvas's edge is cut): the building and its glows with no ground shadow, and the shadow."""
    L = layers()
    L[0], shade = unshadowed(L[0])
    out = R / "game"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    ox, oy, rw, rh = region()

    def place(im):
        c = Image.new(im.mode, (rw, rh), 0)
        c.paste(im, (ox, oy))
        return c

    place(Image.fromarray((np.clip(shade, 0, 1) * 255 + 0.5).astype(np.uint8), "L")).save(out / "shadow.png")
    for name, k, im in loops(L):
        place(im).save(out / f"{name}-{k:02d}.png")
    print("game cells", NI, "idle,", NA, "active, canvas", rw, rh, "layers at", ox, oy)


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
    {"check": check, "all": run_all, "game": run_game}[sys.argv[1]]()
