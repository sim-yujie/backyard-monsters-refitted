"""Takes the magenta cast off cut-outs (no Codex): a lilac wisp of steam, pink frond tips, pink edges.

    python tidy.py <look folder> <name> [<name> ...]          whole picture
    python tidy.py <look folder> --edges <name> [<name> ...]  only within 3 px of the outline (red/pink flowers)
    python tidy.py <look folder> --bleed <name> [<name> ...]  pink-brown fringe on thin leaves (no red/pink parts!)

Magenta despill: where both red and blue stand above green, the shared excess is taken off both, so a magenta
tint turns neutral and a real red keeps its red. Applied to <name>.png, <name>@2x.png and <name>.full.png.
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter


def despill(path, edges_only):
    im = Image.open(path).convert("RGBA")
    r, g, b, al = im.split()
    excess = ImageChops.subtract(ImageChops.darker(r, b), g)
    if edges_only:
        solid = al.point(lambda v: 255 if v > 200 else 0).filter(ImageFilter.MinFilter(7))
        excess = Image.composite(Image.new("L", im.size, 0), excess, solid)
    Image.merge("RGBA", (ImageChops.subtract(r, excess), g, ImageChops.subtract(b, excess), al)).save(path)
    return sum(1 for v in excess.getdata() if v > 0)


def bleed(path):
    """Olive leaves mixed with the magenta ground give pink-brown edge pixels that despill cannot see (their blue
    stays under green). Near the outline, a pixel redder than green with blue above 70% of green is re-coloured
    from its clean neighbours (colour bled outwards from the solid inside), keeping its alpha."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    rad = max(2, round(w / 140))
    solid = im.getchannel("A").point(lambda v: 255 if v > 200 else 0).filter(ImageFilter.MinFilter(2 * rad + 1))
    px, sp = im.load(), solid.load()
    flagged = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and not sp[x, y] and r > g + 8 and b > 0.7 * g:
                flagged.append((x, y))
    clean = im.copy()
    cp = clean.load()
    for x, y in flagged:
        cp[x, y] = (0, 0, 0, 0)
    # premultiplied blur, then divide: the colour of the clean pixels around
    al = clean.getchannel("A")
    pre = Image.merge("RGB", [ImageChops.multiply(c, al) for c in clean.split()[:3]])
    rb = pre.filter(ImageFilter.GaussianBlur(rad * 2)).load()
    ab = al.filter(ImageFilter.GaussianBlur(rad * 2)).load()
    for x, y in flagged:
        k = ab[x, y]
        if k > 2:
            r, g, b = rb[x, y]
            px[x, y] = (min(255, r * 255 // k), min(255, g * 255 // k), min(255, b * 255 // k), px[x, y][3])
    im.save(path)
    return len(flagged)


def main():
    folder, rest = sys.argv[1], sys.argv[2:]
    edges = "--edges" in rest
    if "--bleed" in rest:
        for name in [n for n in rest if n != "--bleed"]:
            for suffix in (".png", "@2x.png", ".full.png"):
                p = os.path.join(folder, name + suffix)
                if os.path.exists(p):
                    n = bleed(p)
                    if suffix == "@2x.png":
                        print(f"{name}: {n} fringe px re-coloured at 2x")
        return
    for name in [n for n in rest if n != "--edges"]:
        for suffix in (".png", "@2x.png", ".full.png"):
            p = os.path.join(folder, name + suffix)
            if os.path.exists(p):
                n = despill(p, edges)
                if suffix == ".png":
                    print(f"{name}: {n} px despilled at 1x{' (edges only)' if edges else ''}")


if __name__ == "__main__":
    main()
