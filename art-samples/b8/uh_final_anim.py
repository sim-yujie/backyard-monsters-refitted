"""uh_final_anim.py : the moving parts of the Under Hall (final pass, direction B) as game strips.

For each level 1-6 it takes the still building without its flame (levels 1-3: the approved game pictures; 4-6:
work/body<N>@2x.png from uh_final_body.py) and makes N_FRAMES frames of one seamless loop:
  - glow zones: the lava's hot pixels (found by colour inside hand-set boxes) get brighter and deeper in a slow wave
    (core, plinth cracks), in lumps running down (the lava pouring into the troughs) or up (the furnace mouth, the
    funnel's inside). Only the brightness of painted pixels changes; nothing is redrawn.
  - the flame (levels 4-6): ONE painted Codex flame (jobs/flames/sheet.png, on black) bent by smooth noise that
    scrolls up through it, more towards the tip, with a slight stretch; every noise scrolls a whole number of tiles
    per loop, so the last frame runs into the first. Embers (levels 5, 6) rise on fixed looping paths.
Written to final/: top.c<N>@2x.png (the still: body + frame 0), body.c<N>@2x.png (the building without its flame,
drawn under the cells, `TierAnim.body`), anim.c<N>@2x.png (the strip: COLS cells a row, each the moving pixels only),
anim.json (boxes, offsets, frame counts, loop numbers). Levels 1-3: anim.c<N>@2x.png only (drawn over the game's
own top.c<N>). Run: ~/.cache/bymr-art-venv/bin/python uh_final_anim.py   (from art-samples/b8)
"""
import json
import math

from PIL import ImageDraw

from uh_final_lib import F, FH, FINAL, FW, OX2, OY2, WORK, Image, arr, blur, frame_of, img, np, tile_noise

N_FRAMES, COLS, TICKS = 48, 8, 2           # 48 cells, one every 2nd tick of the yard's 40 a second = 20 a second, 2.4 s
MOUTH = (163, 322, 30, 13)                 # the funnel's open mouth in the frame: centre x, y, half width, half height
TODAY = {1: ("top.c1@2x.webp", -52, -30), 2: ("top.c2@2x.webp", -51, -58), 3: ("top.c3@2x.webp", -51, -54)}

# Glow zones per level: (name, box x0,y0,x1,y1 in frame px, kind, strength). Kinds: "pulse" (slow wave), "down"
# (lumps running down), "up" (lumps running up, twice as fast, with a flicker).
CORE = {1: (96, 470, 232, 580), 2: (100, 440, 232, 580), 3: (96, 440, 232, 590)}
ZONES = {
    1: [("core", CORE[1], "pulse", 0.16)],
    2: [("core", CORE[2], "pulse", 0.16)],
    3: [("core", CORE[3], "pulse", 0.16)],
    4: [("core", (96, 440, 232, 578), "pulse", 0.16), ("cracks", (130, 566, 240, 606), "pulse", 0.22),
        ("mouth", (130, 304, 196, 340), "up", 0.10)],
    5: [("core", (96, 440, 232, 578), "pulse", 0.16), ("cracks", (130, 566, 240, 600), "pulse", 0.20),
        ("streams", (152, 582, 208, 606), "down", 0.40), ("pools", (144, 596, 224, 616), "down", 0.22),
        ("mouth", (130, 304, 196, 340), "up", 0.10)],
    6: [("core", (96, 440, 232, 578), "pulse", 0.16), ("cracks", (130, 566, 240, 600), "pulse", 0.20),
        ("streams", (152, 582, 208, 606), "down", 0.40), ("pools", (144, 596, 224, 616), "down", 0.22),
        ("gate", (134, 496, 222, 562), "up", 0.20), ("mouth", (130, 304, 196, 340), "up", 0.08)],
}
FLAME = {4: (0, 46, 46), 5: (1, 54, 82), 6: (2, 66, 120)}      # sheet column, width, height in frame px
EMBERS = {4: 0, 5: 3, 6: 7}


def heat(a):
    """How much a pixel is glowing lava (0..1): bright, warm, saturated yellow-orange."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    v = np.maximum(r, np.maximum(g, b))
    sat = 1 - b / np.maximum(v, 1e-3)
    h = np.clip((v - 0.6) / 0.3, 0, 1) * np.clip((r - b - 0.2) / 0.2, 0, 1) * np.clip((g - 0.3) / 0.25, 0, 1) * np.clip((sat - 0.3) / 0.25, 0, 1)
    return blur(h, 1.2) * a[..., 3]                       # smoothed: a pixel-sharp mask sparkles when it pulses


def zone_mask(box, feather=4):
    m = np.zeros((FH, FW), np.float32)
    x0, y0, x1, y1 = box
    m[y0:y1, x0:x1] = 1
    return blur(m, feather)


PHASE = tile_noise(FH, FW, (9, 5), 11) * 0.9          # the slow wave reaches each stone at its own moment
LUMP_D = tile_noise(132, FW, (13, 34), 12)            # lumps for running lava (tile 132 px tall)
LUMP_U = tile_noise(132, FW, (9, 24), 13)
ROWS = np.arange(FH)


def gain_at(level, t, h):
    """The brightness wave of frame t (0..N-1): -1..1 per pixel, already times each zone's strength and the heat."""
    s = np.zeros((FH, FW), np.float32)
    ph = t / N_FRAMES
    for _, box, kind, amp in ZONES[level]:
        if kind == "pulse":
            w = np.sin(2 * math.pi * (ph - PHASE))
        elif kind == "down":
            w = (LUMP_D[(ROWS - round(132 * ph)) % 132] - 0.5) * 3.2
        else:
            w = (LUMP_U[(ROWS + round(132 * 2 * ph)) % 132] - 0.5) * 2.6 + 0.35 * math.sin(2 * math.pi * 3 * ph)
        s += zone_mask(box) * amp * np.clip(w, -1, 1)
    return s * h


def glow(body, s):
    """The body with its lava brighter (s > 0: towards white-yellow) or deeper (s < 0: towards orange)."""
    out = body.copy()
    out[..., 0] = np.clip(body[..., 0] * (1 + 0.25 * s), 0, 1)
    out[..., 1] = np.clip(body[..., 1] * (1 + 1.0 * s), 0, 1)
    out[..., 2] = np.clip(body[..., 2] * (1 + 1.5 * s) + 0.06 * np.clip(s, 0, 0.16), 0, 1)
    return out


def flame_sprite(col, row=0):
    """One painted flame off the black sheet, loose sparks dropped: RGBA array, cropped to the flame."""
    cell = Image.open(FINAL / "jobs" / "flames" / "sheet.png").convert("RGB").crop((col * 512, row * 512, col * 512 + 512, row * 512 + 512))
    a = np.asarray(cell).astype(np.float32) / 255
    v = a.max(-1)
    alpha = np.clip((v - 0.07) / 0.45, 0, 1)
    mask = alpha > 0.2
    ys, xs = np.nonzero(alpha > 0.6)
    reach = np.zeros_like(mask)
    reach[ys.max() - 8, int(xs[ys > ys.max() - 12].mean())] = True
    while True:                                                # grow from the foot through the flame: loose sparks are left out
        g = reach.copy()
        g[1:] |= reach[:-1]; g[:-1] |= reach[1:]; g[:, 1:] |= reach[:, :-1]; g[:, :-1] |= reach[:, 1:]
        g &= mask
        if g.sum() == reach.sum():
            break
        reach = g
    keep = blur(reach.astype(np.float32), 2.0) > 0.05
    alpha = alpha * keep
    rgb = np.clip(a / np.maximum(alpha, 0.2)[..., None], 0, 1)
    out = np.dstack([rgb, alpha])
    box = Image.fromarray((alpha > 0.03).astype(np.uint8) * 255).getbbox()
    return out[box[1]:box[3], box[0]:box[2]]


def sample(src, x, y):
    """Bilinear lookup of a premultiplied RGBA array at float coordinates; outside is empty."""
    h, w = src.shape[:2]
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]

    def at(yy, xx):
        ok = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h)
        return src[np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)] * ok[..., None]
    return (at(y0, x0) * (1 - fx) + at(y0, x0 + 1) * fx) * (1 - fy) + (at(y0 + 1, x0) * (1 - fx) + at(y0 + 1, x0 + 1) * fx) * fy


class Flame:
    """A painted flame, standing with its foot in the funnel's mouth, bent a little differently each frame."""
    SS = 2                                                     # worked at twice the frame's size, then halved

    def __init__(self, level):
        col, w, h = FLAME[level]
        self.level, self.w, self.h = level, w, h
        sp = flame_sprite(col)
        pm = sp.copy()
        pm[..., :3] *= pm[..., 3:]
        im = Image.fromarray((pm * 255).astype(np.uint8), "RGBa").resize((w * self.SS, h * self.SS), Image.LANCZOS)
        self.src = np.asarray(im).astype(np.float32) / 255     # premultiplied
        # the work box: the flame with room to lean and stretch (frame px)
        self.padx, self.pady = round(w * 0.3) + 4, round(h * 0.28) + 6
        self.bw, self.bh = w + 2 * self.padx, h + self.pady
        cx, cy, _, ry = MOUTH
        self.x0, self.y0 = cx - self.bw // 2, cy + ry - 5 - self.bh      # the flame's foot just above the mouth's front rim
        H, W = self.bh * self.SS, self.bw * self.SS
        self.n1 = tile_noise(H, W, (3, 2), 21 + level)
        self.n2 = tile_noise(H, W, (4, 3), 31 + level)
        self.n3 = tile_noise(H, W, (2, 2), 41 + level)
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.u = np.clip((H - self.yy) / (h * self.SS), 0, 1.4)          # 0 at the foot, 1 at the painted tip

    def frame(self, t):
        ph = t / N_FRAMES
        H, W = self.yy.shape
        roll = lambda n, cycles: np.roll(n, -round(H * cycles * ph), axis=0)   # the noise climbs through the flame
        u = self.u
        lean = (roll(self.n1, 1) - 0.5) * 2
        curl = (roll(self.n2, 2) - 0.5) * 2
        lift = (roll(self.n3, 1) - 0.5) * 2
        dx = (0.16 * lean * u ** 1.4 + 0.07 * curl * u) * self.w * self.SS
        stretch = 1 + 0.07 * math.sin(2 * math.pi * 2 * ph) + 0.04 * math.sin(2 * math.pi * 3 * ph + 1.3)
        dy = 0.10 * lift * u * self.h * self.SS
        sx = self.xx + dx - self.padx * self.SS
        sy = (self.h * self.SS) - (H - self.yy) / stretch + dy
        out = sample(self.src, sx, sy)
        out[..., :3] *= 1 + 0.05 * math.sin(2 * math.pi * 3 * ph + 0.7)
        out = np.clip(out, 0, 1)
        im = Image.fromarray((out * 255).astype(np.uint8), "RGBa").resize((self.bw, self.bh), Image.LANCZOS)
        full = np.zeros((FH, FW, 4), np.float32)
        full[self.y0:self.y0 + self.bh, self.x0:self.x0 + self.bw] = np.asarray(im).astype(np.float32) / 255
        return full * self.visible()[..., None]                # premultiplied, frame-sized

    def visible(self):
        """1 where the flame shows: everywhere above the mouth's front rim (the funnel's front wall hides its foot)."""
        cx, cy, rx, ry = MOUTH
        yy, xx = np.mgrid[0:FH, 0:FW].astype(np.float32)
        q = np.clip(1 - ((xx - cx) / rx) ** 2, 0, 1)
        edge = cy + ry * np.sqrt(q)                            # the front arc of the inner rim; outside the mouth: its level
        return np.clip((edge - yy) / 3.0, 0, 1)

    def embers(self, t):
        """A few sparks rising from the flame's tip on fixed paths that repeat every loop (premultiplied, frame-sized)."""
        out = np.zeros((FH, FW, 4), np.float32)
        rng = np.random.default_rng(100 + self.level)
        cx = MOUTH[0]
        top = self.y0 + self.pady
        yy, xx = np.mgrid[0:FH, 0:FW].astype(np.float32)
        for i in range(EMBERS[self.level]):
            p0, xo, rise, sway, size = rng.random(), rng.uniform(-0.3, 0.3) * self.w, rng.uniform(0.35, 0.6) * self.h, rng.uniform(2, 6), rng.uniform(1.1, 1.7)
            age = (t / N_FRAMES + p0) % 1.0
            life = 0.75
            if age > life:
                continue
            a = age / life
            x = cx + xo + sway * math.sin(2 * math.pi * (a * 1.5 + p0))
            y = top + self.h * 0.35 - rise * a - self.h * 0.25 * a
            fade = min(1, a / 0.15) * (1 - a) ** 0.8
            dot = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * size * size)) * fade
            col = np.array([1.0, 0.62 + 0.25 * (1 - a), 0.15 + 0.2 * (1 - a)], np.float32)
            add = np.dstack([dot[..., None] * col, dot])
            out = add + out * (1 - add[..., 3:])
        return out


def over(base, top_pm):
    """Premultiplied `top_pm` over a straight-alpha frame; straight alpha out."""
    b = base.copy()
    b[..., :3] *= b[..., 3:]
    a = top_pm[..., 3:]
    b = top_pm + b * (1 - a)
    b[..., :3] /= np.maximum(b[..., 3:], 1e-4)
    return np.clip(b, 0, 1)


def body_of(level):
    if level <= 3:
        f, x, y = TODAY[level]
        return frame_of(Image.open(F / f), x, y)
    return Image.open(WORK / f"body{level}@2x.png").convert("RGBA")


def even_box(box, pad=2):
    x0, y0, x1, y1 = box
    return (max(0, (x0 - pad) // 2 * 2), max(0, (y0 - pad) // 2 * 2), min(FW, -(-(x1 + pad) // 2) * 2), min(FH, -(-(y1 + pad) // 2) * 2))


def build(level):
    """frames (straight RGBA arrays, whole frame), body array"""
    body = arr(body_of(level))
    h = heat(body)
    flame = Flame(level) if level in FLAME else None
    frames = []
    for t in range(N_FRAMES):
        f = glow(body, gain_at(level, t, h)[..., None][..., 0])
        if flame:
            f = over(f, flame.frame(t))
            if EMBERS[level]:
                f = over(f, flame.embers(t))
        frames.append(f)
    return frames, body


def export(level, frames, body, info):
    stack = np.stack(frames)
    pm = lambda a: np.dstack([a[..., :3] * a[..., 3:], a[..., 3]])
    bpm = pm(body)
    diff = np.max([np.abs(pm(f) - bpm).max(-1) for f in frames], axis=0)
    moving = diff > 0.012
    box = even_box(Image.fromarray(moving.astype(np.uint8) * 255).getbbox())
    x0, y0, x1, y1 = box
    cw, ch = x1 - x0, y1 - y0
    soft = np.clip(blur(moving.astype(np.float32), 1.5) * 3, 0, 1)      # the cells: the moving pixels, feathered into the body
    rows = -(-N_FRAMES // COLS)
    strip = Image.new("RGBA", (cw * COLS, ch * rows), (0, 0, 0, 0))
    cells = []
    for i, f in enumerate(frames):
        c = f.copy()
        c[..., 3] *= soft
        cell = img(c[y0:y1, x0:x1])
        cells.append(cell)
        strip.paste(cell, ((i % COLS) * cw, (i // COLS) * ch))
    strip.save(FINAL / f"anim.c{level}@2x.png")
    strip.save(FINAL / f"anim.c{level}@2x.webp", "WEBP", quality=92, method=6, exact=False)
    # what the game shows: body (or today's top) + cell i; check it against the frames, and the loop
    shown = []
    bim = img(body)
    for cell in cells:
        s = bim.copy()
        s.alpha_composite(cell, (x0, y0))
        shown.append(s)
    steps = [float(np.abs(arr(shown[(i + 1) % N_FRAMES]) - arr(shown[i]))[moving].mean()) * 255 for i in range(N_FRAMES)]
    still_px = ~(blur(moving.astype(np.float32), 2) > 0.01)                 # pixels well away from every moving one
    outside = float(max(np.abs(arr(s) - body)[still_px].max() for s in shown)) * 255
    entry = {
        "strip": [f"anim.c{level}@2x.webp", (x0 - OX2) / 2, (y0 - OY2) / 2, cw // 2, ch // 2, N_FRAMES],
        "columns": COLS, "ticksPerFrame": TICKS, "framesPerSecond": 40 / TICKS, "loopSeconds": N_FRAMES * TICKS / 40,
        "cellPx2x": [cw, ch], "stripPx": list(strip.size),
        "moves": [z[0] for z in ZONES[level]] + (["flame"] if level in FLAME else []) + (["embers"] if EMBERS.get(level) else []),
        "loop": {"seamStep": round(steps[-1], 3), "meanStep": round(sum(steps[:-1]) / (N_FRAMES - 1), 3),
                 "maxStep": round(max(steps[:-1]), 3), "minStep": round(min(steps[:-1]), 3), "unit": "mean abs difference per channel (0-255) over the moving pixels"},
        "largestChangeOutsideCells": round(outside, 2),
    }
    if level >= 4:
        bb = even_box(bim.getbbox(), 0)
        bim.crop(bb).save(FINAL / f"body.c{level}@2x.png")
        entry["body"] = [f"body.c{level}@2x.webp", (bb[0] - OX2) / 2, (bb[1] - OY2) / 2]
        bim.crop(bb).save(FINAL / f"body.c{level}@2x.webp", "WEBP", quality=92, method=6, exact=False)
        top = shown[0]
        tb = even_box(top.getbbox(), 0)
        top.crop(tb).save(FINAL / f"top.c{level}@2x.png")
        top.crop(tb).save(FINAL / f"top.c{level}@2x.webp", "WEBP", quality=92, method=6, exact=False)
        entry["top"] = [f"top.c{level}@2x.webp", (tb[0] - OX2) / 2, (tb[1] - OY2) / 2]
        entry["shadow"] = ["shadow.3.v2.jpg", -74, 35]
    else:
        entry["over"] = TODAY[level][0]
    info[str(level)] = entry
    return shown


def main(levels=(1, 2, 3, 4, 5, 6)):
    path = FINAL / "anim.json"
    info = json.loads(path.read_text()) if path.exists() else {}
    for level in levels:
        frames, body = build(level)
        shown = export(level, frames, body, info)
        fr = FINAL / "work" / f"frames{level}"
        fr.mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(shown):
            s.save(fr / f"{i:02d}.png")
        print(level, json.dumps(info[str(level)]))
    path.write_text(json.dumps(info, indent=1))


if __name__ == "__main__":
    import sys
    main([int(a) for a in sys.argv[1:]] or (1, 2, 3, 4, 5, 6))
