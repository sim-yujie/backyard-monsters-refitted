"""Make the Friends window's three icons from art already in the game (9 Nov).

usage: python -I friends_icons.py [out folder]   (default: web/public/ui/icons)

- addfriend: the painted two monster heads (friends-64.webp) with a green plus disc
  on their corner, so Add no longer looks like the friend count.
- mail: Flash's envelope (icon_mail, client/images/606.png), its round frame taken off.
- gift: Flash's red gift box (icon_gifts, client/images/612.png), the same way.
Writes <name>-<side>.webp for every side in SIDES. Run addfriend once only: it
reads friends-64.webp, not its own output.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
WT = str(ROOT)
ICONS = str(ROOT / "web" / "public" / "ui" / "icons")
OUT = sys.argv[1] if len(sys.argv) > 1 else ICONS
SIDES = [16, 24, 32, 48, 64]
S = 512  # working size


def plus_disc(size: int) -> Image.Image:
    """A glossy green disc, dark outline, white plus with a soft shadow."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = size // 16
    d.ellipse([0, 0, size - 1, size - 1], fill=(22, 60, 18, 255))  # outline
    # body: vertical gradient, light top to deep bottom
    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for y in range(size):
        t = y / size
        c = (int(120 - 70 * t), int(205 - 75 * t), int(70 - 40 * t), 255)
        ImageDraw.Draw(body).line([(0, y), (size, y)], fill=c)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([o, o, size - 1 - o, size - 1 - o], fill=255)
    im.paste(body, (0, 0), mask)
    # gloss on the top half
    gloss = Image.new("L", (size, size), 0)
    ImageDraw.Draw(gloss).ellipse([size * 0.2, size * 0.1, size * 0.8, size * 0.5], fill=90)
    gloss = gloss.filter(ImageFilter.GaussianBlur(size / 20))
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    im.paste(white, (0, 0), Image.composite(gloss, Image.new("L", (size, size), 0), mask))
    # plus with shadow
    arm, thick = size * 0.30, size * 0.13
    c = size / 2

    def plus(draw, dx, dy, fill):
        draw.rounded_rectangle([c - arm + dx, c - thick + dy, c + arm + dx, c + thick + dy], radius=thick * 0.5, fill=fill)
        draw.rounded_rectangle([c - thick + dx, c - arm + dy, c + thick + dx, c + arm + dy], radius=thick * 0.5, fill=fill)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plus(ImageDraw.Draw(shadow), size * 0.03, size * 0.04, (10, 40, 10, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size / 60))
    im.alpha_composite(shadow)
    edge = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plus(ImageDraw.Draw(edge), 0, 0, (230, 240, 225, 255))
    im.alpha_composite(edge)
    top = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    td = ImageDraw.Draw(top)
    td.rounded_rectangle([c - arm + 3, c - thick + 3, c + arm - 3, c + thick - 6], radius=thick * 0.45, fill=(255, 255, 255, 255))
    td.rounded_rectangle([c - thick + 3, c - arm + 3, c + thick - 3, c + arm - 6], radius=thick * 0.45, fill=(255, 255, 255, 255))
    im.alpha_composite(top)
    return im


def addfriend() -> Image.Image:
    base = Image.open(ICONS + "/friends-64.webp").convert("RGBA").resize((S, S), Image.LANCZOS)
    # heads a touch smaller and up-left so the plus sits clear at the bottom right
    heads = base.resize((int(S * 0.9), int(S * 0.9)), Image.LANCZOS)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    im.alpha_composite(heads, (0, 0))
    disc = int(S * 0.5)
    im.alpha_composite(plus_disc(disc), (S - disc, S - disc))
    return im


def ringless(n: int, depth: int) -> Image.Image:
    """Flash's round icon with its brown ring taken off: from the transparent
    outside inward, up to `depth` px, pixels of the ring's dull tan and brown go."""
    from collections import deque
    src = Image.open(f"{WT}/client/images/{n}.png").convert("RGBA")
    w, h = src.size
    px = src.load()

    def ringy(c):
        r, g, b, a = c
        if a < 40:
            return True
        return max(r, g, b) - min(r, g, b) <= 72 and r - g <= 40 and r >= g >= b - 8

    dist = {}
    q = deque()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 40:
                dist[(x, y)] = 0
                q.append((x, y))
    while q:
        x, y = q.popleft()
        d = dist[(x, y)]
        if d >= depth:
            continue
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in dist and ringy(px[nx, ny]):
                dist[(nx, ny)] = d + 1
                q.append((nx, ny))
    for (x, y) in dist:
        px[x, y] = (0, 0, 0, 0)
    big = src.resize((w * 8, h * 8), Image.LANCZOS)
    crop = big.crop(big.getbbox())
    side = max(crop.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return sq.resize((S, S), Image.LANCZOS)

def save(name: str, im: Image.Image) -> None:
    for side in SIDES:
        im.resize((side, side), Image.LANCZOS).save(f"{OUT}/{name}-{side}.webp", lossless=True)


if __name__ == "__main__":
    save("addfriend", addfriend())
    save("mail", ringless(606, 11))
    save("gift", ringless(612, 14))
