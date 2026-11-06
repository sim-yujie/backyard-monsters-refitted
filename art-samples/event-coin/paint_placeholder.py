"""PLACEHOLDER event coin icon (beta 7 event coins), until Codex paints the real one.

usage: python -I paint_placeholder.py
       then: python -I ../../web/tools/game-icons/make.py . eventcoin

Draws large/eventcoin.png (512 px): a thick gold coin seen slightly from
below, with a dark outline like the painted icons, a shaded rim, a soft
highlight and a raised star. Owner rule: icons must be painted, so this is a
stand-in only; the Codex brief is in the event-coins report.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 512
HERE = Path(__file__).resolve().parent


def radial(size, centre, radius, inner, outer):
    yy, xx = np.mgrid[0:size, 0:size].astype("float32")
    d = np.sqrt((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2) / radius
    d = np.clip(d, 0, 1)[..., None]
    rgb = np.array(inner, "float32") * (1 - d) + np.array(outer, "float32") * d
    return Image.fromarray(rgb.astype("uint8"), "RGB")


def star(cx, cy, r_out, r_in, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = np.deg2rad(rot + i * 180 / points)
        pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return pts


def main():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    cx, cy, rx, ry = S / 2, S / 2 - 6, 220, 220
    depth = 26

    # Outline and the coin's edge (its thickness, below the face).
    d = ImageDraw.Draw(im)
    d.ellipse((cx - rx - 12, cy - ry - 12, cx + rx + 12, cy + ry + depth + 12), fill=(58, 34, 8, 255))
    edge = radial(S, (cx, cy + depth), rx * 1.1, (214, 140, 30), (120, 66, 10)).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry + depth, cx + rx, cy + ry + depth), fill=255)
    im.paste(edge, (0, 0), mask)
    # Ridges on the edge.
    for i in range(-10, 11):
        x = cx + i * rx / 11
        d.line((x, cy + ry * 0.2 + depth, x, cy + ry * 0.2 + depth + 12), fill=(150, 90, 20, 0))

    # The face: rim, then the inner field.
    face = radial(S, (cx - 60, cy - 80), rx * 1.35, (255, 236, 140), (205, 128, 22)).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    im.paste(face, (0, 0), mask)
    d = ImageDraw.Draw(im)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=(120, 70, 12, 255), width=6)
    ri = rx * 0.78
    field = radial(S, (cx + 40, cy + 50), ri * 1.4, (250, 200, 70), (196, 120, 20)).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse((cx - ri, cy - ri, cx + ri, cy + ri), fill=255)
    im.paste(field, (0, 0), mask)
    d = ImageDraw.Draw(im)
    d.ellipse((cx - ri, cy - ri, cx + ri, cy + ri), outline=(150, 88, 16, 255), width=5)
    d.arc((cx - ri + 6, cy - ri + 6, cx + ri - 6, cy + ri - 6), 200, 340, fill=(255, 244, 190, 255), width=4)

    # The raised star: shadow, body, light side.
    sh = star(cx + 8, cy + 12, ri * 0.72, ri * 0.32)
    d.polygon(sh, fill=(140, 80, 12, 255))
    body = star(cx, cy, ri * 0.72, ri * 0.32)
    d.polygon(body, fill=(255, 214, 72, 255), outline=(110, 60, 10, 255))
    d.line(body + [body[0]], fill=(110, 60, 10, 255), width=6, joint="curve")
    hi = star(cx - 6, cy - 8, ri * 0.48, ri * 0.2)
    d.polygon(hi, fill=(255, 240, 160, 255))

    # A soft gloss and a sparkle, as the painted icons have.
    gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse((cx - rx * 0.75, cy - ry * 0.92, cx - rx * 0.05, cy - ry * 0.45), fill=(255, 255, 255, 90))
    gloss = gloss.filter(ImageFilter.GaussianBlur(14))
    im.alpha_composite(gloss)
    sp = star(cx + rx * 0.62, cy - ry * 0.62, 34, 7, points=4, rot=0)
    ImageDraw.Draw(im).polygon(sp, fill=(255, 255, 255, 235))

    out = HERE / "large"
    out.mkdir(exist_ok=True)
    bbox = im.getbbox()
    im.crop(bbox).save(out / "eventcoin.png")
    print("wrote", out / "eventcoin.png", im.crop(bbox).size)


if __name__ == "__main__":
    main()
