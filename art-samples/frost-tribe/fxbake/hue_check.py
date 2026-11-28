"""Colour of what an aura adds over the grass: each take's frames against today's (the same fight, no aura), the
pixels that changed, their median hue and how many read green/mint vs blue or white.

python3 hue_check.py <take prefix e.g. a-modern> [every n frames]   (frames from film.mjs in $FRAMES)
"""
import colorsys
import os
import sys

from PIL import Image, ImageChops

FRAMES = os.environ["FRAMES"]
take, every = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 20
base = f"{FRAMES}/{take}-current"
for fx in ("astra", "neon"):
    d = f"{FRAMES}/{take}-{fx}"
    names = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))[::every]
    hues, white, green, blue, total = [], 0, 0, 0, 0
    for name in names:
        if not os.path.exists(f"{base}/{name}"):
            continue
        a = Image.open(f"{d}/{name}").convert("RGB").resize((400, 225))
        b = Image.open(f"{base}/{name}").convert("RGB").resize((400, 225))
        diff = ImageChops.difference(a, b).convert("L")
        for (r, g, bb), dv in zip(a.getdata(), diff.getdata()):
            if dv < 40:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, bb / 255)
            total += 1
            if s < 0.18 and v > 0.6:
                white += 1
            elif 0.20 <= h < 0.47:      # 72-170 deg: green, mint, teal-green
                green += 1
            elif 0.47 <= h < 0.75:      # 170-270 deg: cyan-blue to blue
                blue += 1
            hues.append(h * 360)
    hues.sort()
    med = hues[len(hues) // 2] if hues else 0
    print(f"{take} {fx}: changed px {total}, median hue {med:.0f} deg, white {white / max(1, total):.0%}, "
          f"blue {blue / max(1, total):.0%}, green/mint {green / max(1, total):.0%}")
