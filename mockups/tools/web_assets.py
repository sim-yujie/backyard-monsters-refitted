"""Write the game's window art, web/public/ui/skin/<skin>/*.webp, from mockups/assets/<skin>/*@2x.png.
The frame keeps its full size (CSS slices it at 2x); the other pieces are scaled to 0.55.
For "scrap" the steel inside the frame is darkened so light words read on it, and a brass copy of the
small steel button is made for second choices (button-alt).
usage: python web_assets.py [skin ...]
"""
import os
import sys

from PIL import Image, ImageEnhance

M = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(os.path.dirname(M), "web", "public", "ui", "skin")
PIECES = ["title", "close", "button", "button-pressed", "button-small", "tab-on", "tab-off", "chip"]


def darken_steel(im, amount=0.74):
    """Darken blue-grey (steel) pixels only; rust, bone and rivets keep their colour."""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # steel: blue above red, little saturation
            blueness = (b - r) / 40.0
            if blueness <= 0:
                continue
            k = 1 - (1 - amount) * min(1.0, blueness)
            px[x, y] = (round(r * k), round(g * k), round(b * k), a)
    return im


def brass(im):
    """Recolour the grey steel plate to polished brass, keeping its shading and rivets."""
    lum = im.convert("L")
    lum = ImageEnhance.Contrast(lum).enhance(1.15)
    stops = [(0, (40, 22, 4)), (90, (150, 96, 18)), (160, (226, 170, 52)), (215, (250, 214, 110)), (255, (255, 244, 200))]
    lut = []
    for c in range(3):
        for v in range(256):
            for (v0, c0), (v1, c1) in zip(stops, stops[1:]):
                if v0 <= v <= v1:
                    t = (v - v0) / (v1 - v0)
                    lut.append(round(c0[c] + (c1[c] - c0[c]) * t))
                    break
    rgb = Image.merge("RGB", (lum, lum, lum)).point(lut)
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def save(im, path):
    im.save(path, "WEBP", quality=88, method=6)
    print(os.path.relpath(path, os.path.dirname(M)), im.size)


def build(skin):
    src = os.path.join(M, "assets", skin)
    dst = os.path.join(WEB, skin)
    os.makedirs(dst, exist_ok=True)
    frame = Image.open(os.path.join(src, "frame@2x.png")).convert("RGBA")
    if skin == "scrap":
        frame = darken_steel(frame)
    save(frame, os.path.join(dst, "frame.webp"))
    for piece in PIECES:
        im = Image.open(os.path.join(src, f"{piece}@2x.png")).convert("RGBA")
        im = im.resize((round(im.width * 0.55), round(im.height * 0.55)), Image.LANCZOS)
        save(im, os.path.join(dst, f"{piece}.webp"))
        if skin == "scrap" and piece == "button-small":
            save(brass(im), os.path.join(dst, "button-alt.webp"))


if __name__ == "__main__":
    for s in sys.argv[1:] or ["scrap"]:
        build(s)
