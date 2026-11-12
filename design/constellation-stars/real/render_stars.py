"""Realistic night-sky stars, drawn procedurally (owner, 12 Nov: "more realistic looking
stars, not cartoon or game star icons").

Each star is light, not a shape: a white-hot core, a soft coloured bloom, a wide faint halo
and thin diffraction spikes, added up as light and tone-mapped (1 - exp(-light)), so the core
burns white while the glow keeps its colour. Alpha = the brightest channel, colour = light /
alpha, so it lays over the dark sky like light does.

python render_stars.py <out dir>
Writes, per option o in r1 (4 spikes), r2 (6 spikes, Webb-like), r3 (big bloom, short glints):
  star-<o>-lit-<tint>@2x.png   tint = blue, white, gold     128 x 128 (spikes fade before the edge)
  star-<o>-next@2x.png         a dim star + a faint halo ring   128 x 128
  star-<o>-dim@2x.png          a faint small point, a hint of glow   64 x 64
  star-<o>-lit-small@2x.png / star-<o>-dim-small@2x.png   24 x 24 for the count rows
and dust@2x.png, a faint star-dust backdrop for the 200 x 170 card (r3's extra).
"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1]
SS = 2  # supersample

TINTS = {
    "blue": np.array([0.55, 0.72, 1.00]),
    "white": np.array([1.00, 0.97, 0.92]),
    "gold": np.array([1.00, 0.76, 0.42]),
}
COOL = np.array([0.62, 0.72, 1.00])


def grid(n):
    c = (n - 1) / 2
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    return x - c, y - c


def gauss(r2, s):
    return np.exp(-r2 / (2 * s * s))


def spikes(x, y, count, length, width, offset_deg=0.0):
    """Thin rays through the centre: `count` rays (count/2 lines), exponential fall-off."""
    out = np.zeros_like(x)
    lines = count // 2
    for k in range(lines):
        a = np.radians(offset_deg + 180.0 * k / lines)
        along = x * np.sin(a) - y * np.cos(a)
        perp = x * np.cos(a) + y * np.sin(a)
        # rays get a touch thinner toward the tips
        w = width * (1.0 - 0.35 * np.clip(np.abs(along) / (length * 3), 0, 1))
        out += np.exp(-perp ** 2 / (2 * w * w)) * np.exp(-np.abs(along) / length)
    return out


def window(x, y, n):
    """Fades everything to nothing before the square's edge (no square ever shows)."""
    r = np.hypot(x, y) / (n / 2)
    return np.clip((1.0 - r) / 0.22, 0, 1) ** 2


def to_rgba(light, exposure=1.0):
    v = 1.0 - np.exp(-light * exposure)
    a = v.max(axis=2)
    rgb = np.where(a[..., None] > 1e-6, v / np.maximum(a[..., None], 1e-6), 0)
    img = np.dstack([np.clip(rgb, 0, 1) * 255, np.clip(a, 0, 1) * 255]).astype(np.uint8)
    return Image.fromarray(img, "RGBA")


def star(n, tint, core, bloom, halo, spike, spike_count, spike_len, spike_w, offset=0.0,
         ring=None, extra=None):
    """All sizes in final pixels of an n x n picture."""
    N = n * SS
    x, y = grid(N)
    x, y = x / SS, y / SS
    r2 = x * x + y * y
    white = np.array([1.0, 1.0, 1.0])
    L = np.zeros((N, N, 3))
    L += gauss(r2, core[0])[..., None] * core[1] * (0.6 * white + 0.4 * tint)
    L += gauss(r2, bloom[0])[..., None] * bloom[1] * tint
    L += (1.0 / (1.0 + r2 / (halo[0] ** 2)))[..., None] * halo[1] * tint
    if spike:
        s = spikes(x, y, spike_count, spike_len, spike_w, offset)
        L += s[..., None] * spike * (0.55 * white + 0.45 * tint)
    if extra:
        L += extra(x, y)[..., None] * tint
    if ring:
        rad, width, amount, colour = ring
        L += (np.exp(-((np.sqrt(r2) - rad) ** 2) / (2 * width * width)))[..., None] * amount * colour
    L *= window(x, y, n)[..., None]
    im = to_rgba(L)
    return im.resize((n, n), Image.LANCZOS)


OPTIONS = {
    # 4 thin rays, like a reflecting telescope's photo.
    "r1": dict(spike_count=4, spike_len=7.0, spike_w=0.55, spike=1.6, offset=0.0,
               bloom=(9.0, 0.85), halo=(7.0, 0.18)),
    # 6 rays (two more short ones across), like the Webb telescope's stars.
    "r2": dict(spike_count=6, spike_len=7.0, spike_w=0.5, spike=1.4, offset=0.0,
               bloom=(9.0, 0.85), halo=(7.0, 0.18)),
    # A big soft bloom and only short glints: a dreamy sky photo.
    "r3": dict(spike_count=4, spike_len=2.6, spike_w=0.4, spike=0.9, offset=45.0,
               bloom=(12.0, 1.0), halo=(9.0, 0.24)),
}


def webb_bar(x, y):
    """Webb's short horizontal ray, on top of its six."""
    return np.exp(-y ** 2 / (2 * 0.45 ** 2)) * np.exp(-np.abs(x) / 3.0) * 0.6


for o, p in OPTIONS.items():
    extra = webb_bar if o == "r2" else None
    for tname, t in TINTS.items():
        star(128, t, core=(3.3, 12.0), bloom=p["bloom"], halo=p["halo"], spike=p["spike"],
             spike_count=p["spike_count"], spike_len=p["spike_len"] * 2.2, spike_w=p["spike_w"] * 2.2,
             offset=p["offset"], extra=extra).save(f"{OUT}/star-{o}-lit-{tname}@2x.png")
    # next: an asleep star a little brighter than the others, with a faint halo ring.
    star(128, COOL, core=(2.9, 1.7), bloom=(6.0, 0.34), halo=(4.0, 0.05), spike=0,
         spike_count=4, spike_len=1, spike_w=1,
         ring=(26.0, 1.3, 0.5, np.array([1.0, 0.88, 0.62]))).save(f"{OUT}/star-{o}-next@2x.png")
    # dim: a faint small point with a hint of glow.
    star(64, COOL, core=(2.7, 1.3), bloom=(5.5, 0.3), halo=(2.5, 0.03), spike=0,
         spike_count=4, spike_len=1, spike_w=1).save(f"{OUT}/star-{o}-dim@2x.png")
    # small count-row stars: lit = a hot point with a short cross; dim = a faint point.
    sx = 0 if o != "r3" else 45.0
    star(24, TINTS["white"], core=(2.0, 9.0), bloom=(3.6, 1.0), halo=(2.0, 0.08), spike=1.6,
         spike_count=4, spike_len=3.2, spike_w=0.55, offset=sx).save(f"{OUT}/star-{o}-lit-small@2x.png")
    star(24, COOL, core=(1.9, 1.1), bloom=(3.2, 0.22), halo=(2.0, 0.03), spike=0,
         spike_count=4, spike_len=1, spike_w=1).save(f"{OUT}/star-{o}-dim-small@2x.png")


def dust(w=400, h=340, seed=7):
    """Faint star dust and a whisper of nebula for the card (2x of 200 x 170)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    L = np.zeros((h, w, 3))
    # nebula: a few large soft blobs, blue and violet, very faint
    for _ in range(5):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        s = rng.uniform(50, 110)
        col = [np.array([0.35, 0.45, 1.0]), np.array([0.65, 0.4, 1.0])][rng.integers(0, 2)]
        L += gauss((x - cx) ** 2 + (y - cy) ** 2, s)[..., None] * 0.07 * col
    # dust: many tiny dim points
    for _ in range(140):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        b = rng.uniform(0.15, 0.7) ** 2
        t = list(TINTS.values())[rng.integers(0, 3)]
        L += gauss((x - cx) ** 2 + (y - cy) ** 2, rng.uniform(0.5, 0.9))[..., None] * b * t
    return to_rgba(L)


dust().save(f"{OUT}/dust@2x.png")
print("ok")
