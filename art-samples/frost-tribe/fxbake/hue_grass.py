"""Green tint an effect puts on GRASS (round 3: the mist aura and the stomp mist), measured the round-2 way and two more.

  python3 hue_grass.py <base frames dir> <fx frames dir> [first:last:every] [--base-frame N]

For each fx frame (f00000.jpg...) it takes the same frame of the base take (today's, no aura), or with --base-frame N
always frame N of the base take (for the stomp: a frame just before it, same take). Only pixels that are GRASS in the
base frame count (hue 60-120 deg, saturation > 0.25: not a monster, tower, shadow or the HUD). Of those, the ones the
effect changed (sum of |R|+|G|+|B| difference over 3, i.e. the round-2 'L' of the difference) by at least T are read:

- round-2 metric (T = 40): share of changed grass pixels whose NEW colour reads green/mint (hue 72-170 deg) vs blue
  (170-270) vs white (saturation < 0.18, value > 0.6). The 18% (neon, Classic) was this number.
- the same at T = 12 (a faint mist hardly reaches 40);
- Lab shift (CIE L*a*b*, D65) of the changed grass pixels, new minus old: dL (lighter +), da (greener -), db (bluer -).
  A mint haze is lighter with a small db; an ice-blue one has a large negative db.
"""
import colorsys
import os
import sys

from PIL import Image, ImageChops

base_dir, fx_dir = sys.argv[1], sys.argv[2]
rng = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else "0:100000:10"
fixed = int(sys.argv[sys.argv.index("--base-frame") + 1]) if "--base-frame" in sys.argv else None
first, last, every = (int(v) for v in rng.split(":"))
names = sorted(f for f in os.listdir(fx_dir) if f.endswith(".jpg"))
names = [n for n in names if first <= int(n[1:6]) <= last][::every]
SIZE = (400, 225)


def lab(r, g, b):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116  # noqa: E731
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


stats = {T: {"n": 0, "green": 0, "blue": 0, "white": 0, "dl": 0.0, "da": 0.0, "db": 0.0} for T in (40, 12)}
grass_total = 0
for name in names:
    bname = f"f{fixed:05d}.jpg" if fixed is not None else name
    if not os.path.exists(f"{base_dir}/{bname}"):
        continue
    a = Image.open(f"{fx_dir}/{name}").convert("RGB").resize(SIZE)
    b = Image.open(f"{base_dir}/{bname}").convert("RGB").resize(SIZE)
    diff = ImageChops.difference(a, b).convert("L")
    for (r, g, bb), (r0, g0, b0), dv in zip(a.getdata(), b.getdata(), diff.getdata()):
        h0, s0, v0 = colorsys.rgb_to_hsv(r0 / 255, g0 / 255, b0 / 255)
        if not (60 / 360 <= h0 <= 120 / 360 and s0 > 0.25):
            continue
        grass_total += 1
        for T, s in stats.items():
            if dv < T:
                continue
            h, sat, v = colorsys.rgb_to_hsv(r / 255, g / 255, bb / 255)
            s["n"] += 1
            if sat < 0.18 and v > 0.6:
                s["white"] += 1
            elif 0.20 <= h < 0.47:
                s["green"] += 1
            elif 0.47 <= h < 0.75:
                s["blue"] += 1
            L1, A1, B1 = lab(r, g, bb)
            L0, A0, B0 = lab(r0, g0, b0)
            s["dl"] += L1 - L0
            s["da"] += A1 - A0
            s["db"] += B1 - B0
print(f"{os.path.basename(fx_dir)} vs {os.path.basename(base_dir)}: {len(names)} frames, grass px {grass_total}")
for T, s in stats.items():
    n = max(1, s["n"])
    print(f"  T={T:2d}: changed grass {s['n']:6d} ({s['n'] / max(1, grass_total):5.1%})  green/mint {s['green'] / n:4.0%}  "
          f"blue {s['blue'] / n:4.0%}  white {s['white'] / n:4.0%}  Lab dL {s['dl'] / n:+5.1f} da {s['da'] / n:+5.1f} db {s['db'] / n:+5.1f}")
