"""uh_fire2_anim.py [sim|game|glow ...] : the Under Hall's fire done again (levels 4-6), three ways, as game strips.

The owner found the first flame (one painted shape bent by noise, uh_final_anim.py) fake and cartoonish. Everything
else of that pass is kept exactly: the bodies, the lava core pulse, the troughs, the strip format. Only what burns in
the funnel, the light it throws on the funnel, and (level 6) what is seen through the furnace gate are new:
  sim  : a simulated fire, baked and rendered in Blender (uh_fire2_sim.py), laid in as light; the gate shows the
         same kind of fire behind its teeth.
  game : the game's own flame, Flash's Tiki Torch strip (decorations/tikitorch/anim.png), several of them at
         different sizes and moments standing in the funnel; a row of them behind the gate.
  glow : no open flame. The funnel glows from inside and flickers, a warm haze and sparks rise from it, a thin dark
         column of simulated smoke stands above it; the gate is a bed of flickering coals.
No flame here is drawn or bent by hand. Simulated frames do not loop by themselves: the 64 rendered frames are made
into a 48-frame loop by fading the 16 frames after the loop's end into its first 16.
Written to final/fire2/<option>/: anim.c<N>@2x.png|webp, top.c<N>@2x.png|webp, anim.json, and work/frames-<option>/L<N>/
(the frames as the game would show them: final/body.c<N> + cell). The bodies are final/'s own, untouched.
Run: ~/.cache/bymr-art-venv/bin/python uh_fire2_anim.py        (from art-samples/b8, after uh_fire2_make.sh's renders)
"""
import json
import math
import sys

import uh_final_anim as A
from uh_final_lib import B, FH, FINAL, FW, OX2, OY2, Image, arr, blur, img, np, tile_noise

N, COLS, TICKS = 48, 8, 2
FIRE2 = FINAL / "fire2"
SIM = FIRE2 / "work" / "sim"
CX, CY, RX, RY = A.MOUTH
YY, XX = np.mgrid[0:FH, 0:FW].astype(np.float32)
GATE_BOX = (134, 496, 222, 562)
TONE = 5.0
# per level: how big the simulated flame stands (frame px per rendered px x 3), the smoke likewise, sparks
SIM_SCALE = {4: 0.80, 5: 0.84, 6: 0.88}
SMOKE_SCALE = {4: 0.62, 5: 0.8, 6: 1.0}
SPARKS = {"sim": {4: 2, 5: 4, 6: 7}, "game": {4: 0, 5: 3, 6: 6}, "glow": {4: 4, 5: 7, 6: 11}}
SPARK_RISE = {4: 60, 5: 95, 6: 130}
# the game's flames in the funnel: (x offset, y offset of the foot, size against the torch's own 2x, frames later, mirrored)
TIKI = {4: [(-9, -1, 1.0, 7, True), (10, -1, 0.95, 15, False), (0, 2, 1.4, 0, False)],
        5: [(-12, -1, 1.3, 7, True), (12, -1, 1.2, 15, False), (0, 2, 1.95, 0, False), (-3, 3, 1.15, 11, True)],
        6: [(-15, -1, 1.6, 7, True), (15, -1, 1.5, 15, False), (0, 1, 2.5, 0, False), (5, 3, 1.5, 11, True), (-6, 3, 1.35, 19, False)]}
TIKI_GATE = [(-24, 0, 0.85, 3, False), (22, 0, 0.9, 13, True), (-8, 2, 1.05, 9, True), (9, 2, 1.0, 20, False)]


def front_rim():
    """1 where something standing in the funnel shows: above the front arc of its inner rim."""
    q = np.clip(1 - ((XX - CX) / RX) ** 2, 0, 1)
    return np.clip((CY + RY * np.sqrt(q) - YY) / 3.0, 0, 1)


def loop_frames(name):
    """A simulation's frames (on black, 0..1) as an N-frame loop: the frames after the loop fade into its start."""
    meta = json.loads((SIM / name / "meta.json").read_text())
    fr = [np.asarray(Image.open(SIM / name / f"{i:04d}.png").convert("RGB")).astype(np.float32) / 255 for i in range(int(meta["params"]["frames"]))]
    k = len(fr) - N
    out = []
    for i in range(N):
        if i < k:
            w = i / k
            w = w * w * (3 - 2 * w)
            out.append(fr[N + i] * (1 - w) + fr[i] * w)
        else:
            out.append(fr[i])
    return out, meta


def place(a, meta, scale, x, y, wide=1.0):
    """A rendered picture (H, W, C float) in the frame, `scale` x its true size (60 frame px a metre), its burner at (x, y)."""
    k = scale * 60 / meta["px"]
    w, h = max(1, round(a.shape[1] * k * wide)), max(1, round(a.shape[0] * k))
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    full = Image.new("RGB", (FW, FH))
    full.paste(im, (round(x - meta["bx"] * k * wide), round(y - meta["by"] * k)))
    return np.asarray(full).astype(np.float32) / 255


def fire_layer(rgb):
    """Fire on black as a premultiplied layer: it is light, so its own brightness is how much it covers. The thin
    outer flame is pulled towards deep red (the render's is orange all the way out)."""
    rgb = 1 - np.exp(-TONE * rgb ** 2.6)                       # exposure with a soft shoulder: the heart goes yellow, then white, never flat
    v = rgb.max(-1)
    edge = np.clip(v / 0.55, 0, 1)[..., None]
    rgb = rgb * (np.array([1.0, 0.8, 0.7], np.float32) * (1 - edge) + edge)
    a = np.clip(1.35 * v, 0, 1) ** 0.85
    return np.dstack([np.minimum(rgb, a[..., None]), a])


def sparks(level, opt, t):
    """Small sparks rising out of the funnel on fixed paths that repeat with the loop (premultiplied layer)."""
    out = np.zeros((FH, FW, 4), np.float32)
    rng = np.random.default_rng(300 + level)
    for _ in range(SPARKS[opt][level]):
        p0, xo, rise, sway, size, life = rng.random(), rng.uniform(-14, 14), rng.uniform(0.6, 1.0) * SPARK_RISE[level], rng.uniform(2, 7), rng.uniform(0.8, 1.3), rng.uniform(0.55, 0.85)
        age = (t / N + p0) % 1.0
        if age > life:
            continue
        a = age / life
        x = CX + xo * (0.5 + 0.8 * a) + sway * math.sin(2 * math.pi * (a * 1.3 + p0))
        y = CY - 6 - rise * (a ** 0.8)
        fade = min(1, a / 0.1) * (1 - a) ** 0.7
        dot = np.exp(-((XX - x) ** 2 + (YY - y) ** 2) / (2 * size * size)) * fade
        col = np.array([1.0, 0.55 + 0.35 * (1 - a), 0.12 + 0.3 * (1 - a)], np.float32)
        add = np.dstack([dot[..., None] * col, dot])
        out = add + out * (1 - add[..., 3:])
    return out * front_rim()[..., None]


def rim_light(f, body, h, amount):
    """The funnel (rim, horns, collar) lit warm from the fire in its mouth; `amount` flickers with the fire."""
    m = np.exp(-(((XX - CX) / 44) ** 2 + ((YY - (CY + 8)) / 30) ** 2)) * body[..., 3] * (1 - np.clip(h * 2, 0, 1))
    m = (m * amount)[..., None]
    out = f.copy()
    out[..., :3] = np.clip(f[..., :3] * (1 + m * np.array([0.55, 0.30, 0.08], np.float32)) + m * np.array([0.10, 0.035, 0.0], np.float32), 0, 1)
    return out


class Gate:
    """Level 6's furnace mouth: the painted flames behind the teeth give way to an even glow, and what burns is laid
    over it, only on the pixels that were fire (teeth, ring and spikes stay as painted)."""

    def __init__(self, body, h):
        m = np.clip(h * A.zone_mask(GATE_BOX, 3) * 2.2, 0, 1)
        # the painted fire's white-hot heart is too pale to count as fire: take it in too (pale warm pixels ringed by fire)
        pale = (body[..., 0] > 0.7) & (body[..., 0] > body[..., 2] + 0.06) & (blur(m, 6) > 0.45)
        m = self.mask = np.clip(np.maximum(m, blur(pale.astype(np.float32), 1.2) * 1.6), 0, 1)
        ys, xs = np.nonzero(m > 0.5)
        self.x0, self.x1, self.y0, self.y1 = xs.min(), xs.max(), ys.min(), ys.max()
        self.cx = (self.x0 + self.x1) / 2
        den = np.maximum(blur(m, 7), 1e-3)
        even = np.dstack([blur(body[..., c] * m, 7) / den for c in range(3)])
        v = np.clip((YY - self.y0) / max(1, self.y1 - self.y0), 0, 1)[..., None]       # 0 at the top of the opening
        v = v ** 0.8
        ramp = np.array([0.42, 0.07, 0.01], np.float32) * (1 - v) + np.array([1.0, 0.55, 0.12], np.float32) * v
        self.base = np.clip(0.35 * even + 0.65 * ramp, 0, 1)                 # deep red under the arch, orange-yellow at the hearth
        # a bed of coals on the hearth (the opening's lower half): rounded lumps, seen from above so wider than
        # tall, dark cracks between them; each has its own brightness and its own moment to flare
        rng = np.random.default_rng(91)
        n = 46
        px = rng.uniform(self.x0 - 4, self.x1 + 4, n)
        py = self.y1 + 3 - rng.uniform(0, 1, n) ** 1.3 * (self.y1 - self.y0) * 0.62
        d = np.sqrt((XX[..., None] - px) ** 2 + ((YY[..., None] - py) * 1.7) ** 2)
        order = np.argsort(d, axis=-1)[..., :2]
        d1, d2 = np.take_along_axis(d, order[..., :1], -1)[..., 0], np.take_along_axis(d, order[..., 1:], -1)[..., 0]
        self.cell = order[..., 0]
        crack = np.clip((d2 - d1) / 3.0, 0, 1)                                  # 0 in the cracks
        dome = np.clip(1 - d1 / 9.0, 0, 1) ** 0.6                               # each coal brightest in its middle
        bed = np.clip((YY - (self.y0 + (self.y1 - self.y0) * 0.36)) / 6.0, 0, 1)   # where the bed ends and the dark back wall begins
        self.coal = crack * (0.35 + 0.65 * dome) * bed
        self.bed = bed
        self.heat0, self.rate, self.phase = rng.uniform(0.45, 1.0, n), rng.integers(1, 4, n), rng.random(n)
        wall = np.array([0.20, 0.03, 0.005], np.float32) * (1 - v) + np.array([0.55, 0.13, 0.02], np.float32) * v
        self.wall = wall

    def coals(self, t):
        """The opening as a coal bed at frame t: dark red back wall above, glowing lumps below, each flaring in turn."""
        ph = t / N
        flare = self.heat0 * (1 + 0.38 * np.sin(2 * math.pi * (self.rate * ph + self.phase)))
        b = np.clip(self.coal * flare[self.cell], 0, 1)[..., None]
        lo, mid, hi = np.array([0.30, 0.03, 0.0], np.float32), np.array([1.0, 0.42, 0.04], np.float32), np.array([1.0, 0.86, 0.42], np.float32)
        col = np.where(b < 0.55, lo + (mid - lo) * (b / 0.55), mid + (hi - mid) * ((b - 0.55) / 0.45))
        breath = 1 + 0.10 * math.sin(2 * math.pi * 2 * ph) + 0.06 * math.sin(2 * math.pi * 5 * ph + 1)
        return np.clip(self.wall * breath * (1 - self.bed[..., None]) + col * self.bed[..., None], 0, 1)

    def put(self, f, layer_pm=None, gain=None):
        """The frame with the opening's even glow (or the picture `gain`) and a premultiplied fire layer over it."""
        g = self.base if gain is None else gain                                # gain: a ready picture of the opening (the coal bed)
        if layer_pm is not None:
            g = layer_pm[..., :3] + g * (1 - layer_pm[..., 3:])
        out = f.copy()
        m = self.mask[..., None]
        out[..., :3] = f[..., :3] * (1 - m) + np.clip(g, 0, 1) * m
        return out


def tiki_frames():
    """The Tiki Torch's flame (Flash, 16x36, 25 frames of which 3 in a row are the same picture: one of those is
    left out, so 24 frames, twice round in one loop), premultiplied."""
    t = arr(Image.open(B / "decorations/tikitorch/anim.png"))
    fr = [t[:, i * 16:(i + 1) * 16].copy() for i in range(25)]
    del fr[3]
    for f in fr:
        f[..., :3] *= f[..., 3:]
    return fr


def tiki_layer(tk, flames, t, x, y):
    """The game's flames standing with their feet at (x, y): premultiplied frame layer."""
    out = np.zeros((FH, FW, 4), np.float32)
    for dx, dy, size, later, mirror in flames:
        f = tk[(t + later) % 24]
        if mirror:
            f = f[:, ::-1]
        w, h = round(16 * 2 * size), round(36 * 2 * size)
        im = Image.fromarray((f * 255 + 0.5).astype(np.uint8), "RGBa").resize((w, h), Image.BICUBIC)
        lay = Image.new("RGBa", (FW, FH))
        lay.paste(im, (round(x + dx - w / 2), round(y + dy - h)))
        add = np.asarray(lay).astype(np.float32) / 255
        out = add + out * (1 - add[..., 3:])
    return out


def coal_flicker(t, seed, box):
    """-1..1 per pixel: small lumps, each brightening and dimming at its own moment, a few times a loop."""
    ph = t / N
    n1 = tile_noise(FH, FW, (110, 57), seed)
    n2 = tile_noise(FH, FW, (47, 24), seed + 1)
    w = 0.55 * np.sin(2 * math.pi * (2 * ph + n1 * 3)) + 0.45 * np.sin(2 * math.pi * (5 * ph + n2 * 4)) + 0.25 * math.sin(2 * math.pi * 3 * ph)
    return np.clip(w, -1, 1) * A.zone_mask(box)


def build(level, opt):
    A.N_FRAMES = N
    body = arr(A.body_of(level))
    h = A.heat(body)
    rim = front_rim()
    gate = Gate(body, h) if level == 6 else None
    foot = (CX, CY + 11)
    if opt == "sim":
        fire, meta = loop_frames(f"L{level}")
        layers = [fire_layer(place(f, meta, SIM_SCALE[level], *foot)) * rim[..., None] for f in fire]
        if gate:
            gfire, gmeta = loop_frames("gate")
            glayers = [fire_layer(place(f, gmeta, 0.78, gate.cx, gate.y1 + 4, 1.1)) for f in gfire]
    elif opt == "game":
        tk = tiki_frames()
        layers = [tiki_layer(tk, TIKI[level], t, CX, CY + 7) * rim[..., None] for t in range(N)]
        if gate:
            glayers = [tiki_layer(tk, TIKI_GATE, t, gate.cx, gate.y1 + 3) for t in range(N)]
    else:
        smoke, meta = loop_frames("smoke")
        layers = []
        for f in smoke:
            v = place(f, meta, SMOKE_SCALE[level], *foot, 0.62)[..., 0]         # squeezed sideways: a thin column
            a = (1 - np.exp(-3.4 * v)) * 0.78
            a = a * np.clip((CY - 2 - YY) / 16, 0, 1)                          # it gathers above the mouth; the mouth's glow stays clear
            lit = (np.clip(1 - (CY - YY) / 46, 0, 1) ** 1.5)[..., None]        # its foot is lit warm by the glowing mouth
            col = np.array([0.13, 0.115, 0.115], np.float32) * (1 - lit) + np.array([0.46, 0.21, 0.08], np.float32) * lit
            # the warm haze just above the mouth: a faint glow in the air
            haze = np.exp(-(((XX - CX) / 20) ** 2 + ((YY - (CY - 12)) / 20) ** 2)) * 0.10
            sm = np.dstack([col * a[..., None], a])
            hz = np.dstack([haze[..., None] * np.array([1.0, 0.5, 0.12], np.float32), haze * 0.5])
            layers.append((sm + hz * (1 - sm[..., 3:])) * rim[..., None])
    # how brightly the fire's foot burns in each frame, about 1: the funnel's light flickers with it
    low = np.exp(-(((XX - CX) / 30) ** 2 + ((YY - (CY - 12)) / 22) ** 2))
    amt = np.array([float((l[..., 3] * low).sum()) for l in layers])
    amt = amt / max(amt.mean(), 1e-6)
    frames = []
    for t in range(N):
        gain = A.gain_at(level, t, h)
        if opt == "glow":
            gain = gain + coal_flicker(t, 71, (130, 304, 196, 340)) * 0.30 * h      # the funnel's inside flickers like embers
        f = A.glow(body, gain)
        if gate:
            if opt == "glow":
                f = gate.put(f, None, gate.coals(t))
            else:
                f = gate.put(f, glayers[t])
        if opt == "glow":
            f = rim_light(f, body, h, 0.45 * (1 + 0.25 * math.sin(2 * math.pi * 3 * t / N) + 0.15 * math.sin(2 * math.pi * 7 * t / N + 1)))
        else:
            f = rim_light(f, body, h, 0.9 * (0.55 + 0.45 * amt[t]))
        f = A.over(f, layers[t])
        if SPARKS[opt][level]:
            f = A.over(f, sparks(level, opt, t))
        frames.append(f)
    return frames, body


def export(level, opt, frames, body, info):
    """As uh_final_anim.export, into fire2/<opt>/; the body is final/'s (checked equal), not written again."""
    out = FIRE2 / opt
    out.mkdir(parents=True, exist_ok=True)
    pm = lambda a: np.dstack([a[..., :3] * a[..., 3:], a[..., 3]])
    bpm = pm(body)
    moving = np.max([np.abs(pm(f) - bpm).max(-1) for f in frames], axis=0) > 0.012
    x0, y0, x1, y1 = A.even_box(Image.fromarray(moving.astype(np.uint8) * 255).getbbox())
    cw, ch = x1 - x0, y1 - y0
    soft = np.clip(blur(moving.astype(np.float32), 1.5) * 3, 0, 1)
    strip = Image.new("RGBA", (cw * COLS, ch * (-(-N // COLS))), (0, 0, 0, 0))
    cells = []
    for i, f in enumerate(frames):
        c = f.copy()
        c[..., 3] *= soft
        cell = img(c[y0:y1, x0:x1])
        cells.append(cell)
        strip.paste(cell, ((i % COLS) * cw, (i // COLS) * ch))
    strip.save(out / f"anim.c{level}@2x.png")
    strip.save(out / f"anim.c{level}@2x.webp", "WEBP", quality=92, method=6, exact=False)
    old = json.loads((FINAL / "anim.json").read_text())[str(level)]
    bim = img(body)
    bb = A.even_box(bim.getbbox(), 0)
    same = np.abs(arr(bim.crop(bb)) - arr(Image.open(FINAL / f"body.c{level}@2x.png"))).max() * 255
    shown = []
    for cell in cells:
        s = bim.copy()
        s.alpha_composite(cell, (x0, y0))
        shown.append(s)
    sa = [arr(s) for s in shown]
    steps = [float(np.abs(sa[(i + 1) % N] - sa[i])[moving].mean()) * 255 for i in range(N)]
    still_px = ~(blur(moving.astype(np.float32), 2) > 0.01)
    outside = float(max(np.abs(s - body)[still_px].max() for s in sa)) * 255
    top = shown[N // 2]
    tb = A.even_box(top.getbbox(), 0)
    top.crop(tb).save(out / f"top.c{level}@2x.png")
    top.crop(tb).save(out / f"top.c{level}@2x.webp", "WEBP", quality=92, method=6, exact=False)
    info[str(level)] = {
        "strip": [f"anim.c{level}@2x.webp", (x0 - OX2) / 2, (y0 - OY2) / 2, cw // 2, ch // 2, N],
        "columns": COLS, "ticksPerFrame": TICKS, "framesPerSecond": 40 / TICKS, "loopSeconds": N * TICKS / 40,
        "cellPx2x": [cw, ch], "stripPx": list(strip.size),
        "loop": {"seamStep": round(steps[-1], 3), "meanStep": round(sum(steps[:-1]) / (N - 1), 3), "maxStep": round(max(steps[:-1]), 3),
                 "minStep": round(min(steps[:-1]), 3), "unit": "mean abs difference per channel (0-255) over the moving pixels"},
        "largestChangeOutsideCells": round(outside, 2),
        "body": old["body"], "bodyDiffersFromFinal": round(float(same), 2),
        "top": [f"top.c{level}@2x.webp", (tb[0] - OX2) / 2, (tb[1] - OY2) / 2], "topIsFrame": N // 2, "shadow": old["shadow"],
    }
    fr = FIRE2 / "work" / f"frames-{opt}" / f"L{level}"
    fr.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(shown):
        s.save(fr / f"{i:02d}.png")
    print(opt, level, json.dumps(info[str(level)]["loop"]), "cell", cw, ch, "outside", round(outside, 2), "body diff", round(float(same), 2), flush=True)


def main(opts, levels=(4, 5, 6)):
    for opt in opts:
        path = FIRE2 / opt / "anim.json"
        info = json.loads(path.read_text()) if path.exists() else {}
        for level in levels:
            export(level, opt, *build(level, opt), info)
        path.write_text(json.dumps(info, indent=1))


if __name__ == "__main__":
    args = sys.argv[1:]
    lv = tuple(int(a) for a in args if a.isdigit()) or (4, 5, 6)
    main([a for a in args if not a.isdigit()] or ["sim", "game", "glow"], lv)
