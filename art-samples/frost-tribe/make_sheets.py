"""Frost tribe options round: portrait files (both looks) and owner sheets.

Run from anywhere: python3 make_sheets.py  (Pillow only)
Inputs: f1/frost-set1.png, f2/frost-set2.png (Codex, 2x2 of 768x512 cells),
        c1..c3/champ-*.png (Codex, 2x2: L1, L3, L6, action).
Classic = the same painting brought to Flash's portrait size (180x120 jpg) with Flash's
measured tone (about +2% brightness, +5% saturation, a touch softer), as the real Classic and
Modern portraits are the same picture (Modern = the sharper repaint).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = HERE / "out"
SHEETS = HERE / "sheets"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (34, 38, 46)
INK = (235, 238, 242)
DIM = (160, 170, 182)
ICE = (140, 220, 255)

NAMES = {"C1": "Pokey", "C5": "Eye-ra", "C6": "Ichi", "C8": "Fang", "C9": "Brain",
         "C10": "Crabatron", "C14": "Teratorn", "C16": "Vorg"}
ROLE = {"C1": "swarm", "C5": "kamikaze", "C6": "tank", "C8": "fast damage", "C9": "looter",
        "C10": "heavy tank", "C14": "flyer", "C16": "flying healer"}
SETS = {"f1/frost-set1.png": ["C1", "C6", "C5", "C14"], "f2/frost-set2.png": ["C8", "C9", "C10", "C16"]}
ROSTERS = [
    ("A  Small: 4", ["C1", "C6", "C5", "C14"]),
    ("B  Medium: 6", ["C1", "C6", "C5", "C14", "C8", "C9"]),
    ("C  One per role: 8", ["C1", "C6", "C5", "C14", "C8", "C9", "C10", "C16"]),
]
CHAMPS = [("c1/champ-glacier.png", "glacier", "Glacier Behemoth", "ground tank: its stomps freeze buildings, they stop working for a few seconds"),
          ("c2/champ-wyrm.png", "wyrm", "Rime Wyrm", "flyer: frost breath in a cone, towers hit shoot slower"),
          ("c3/champ-krampus.png", "krampus", "Krampus", "fast raider: frost ring round it, towers in range shoot slower")]


def font(size, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, size)


def cells(path):
    im = Image.open(HERE / path).convert("RGB").resize((1536, 1024), Image.LANCZOS)
    return [im.crop(((n % 2) * 768, (n // 2) * 512, (n % 2) * 768 + 768, (n // 2) * 512 + 512)) for n in range(4)]


def classic_of(card):
    """A 3:2 painting -> Flash-style 180x120 portrait (same picture, Flash's measured tone)."""
    im = card.resize((180, 120), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
    im = ImageEnhance.Color(im).enhance(1.05)
    return ImageEnhance.Brightness(im).enhance(1.02)


def creature_box(im, pad=6):
    """Bounding box of the creature on the plain studio ground (shadow left out)."""
    w, h = im.size
    border = [im.getpixel((x, y)) for x in range(0, w, 8) for y in (2, h - 3)]
    border += [im.getpixel((x, y)) for y in range(0, h, 8) for x in (2, w - 3)]
    g = [sorted(c[i] for c in border)[len(border) // 2] for i in range(3)]
    hsv = im.convert("HSV")
    xs, ys = [], []
    small = im.resize((w // 2, h // 2)); shsv = hsv.resize((w // 2, h // 2))
    for y in range(h // 2):
        for x in range(w // 2):
            r, gg, b = small.getpixel((x, y)); s = shsv.getpixel((x, y))[1]
            bright = (r + gg + b) / 3 - sum(g) / 3
            if s > 45 or bright > 28 or bright < -95:
                xs.append(x * 2); ys.append(y * 2)
    return (max(0, min(xs) - pad), max(0, min(ys) - pad), min(w, max(xs) + pad), min(h, max(ys) + pad))


def square_icon(im, size):
    x0, y0, x1, y1 = creature_box(im)
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) / 2
    side = int(2 * half)
    sq = Image.new("RGB", (side, side), im.getpixel((4, 4)))
    sq.paste(im, (int(half - cx), int(half - cy)))
    return sq.resize((size, size), Image.LANCZOS)


def label(d, xy, text, size=28, fill=INK, bold=False):
    d.text(xy, text, font=font(size, bold), fill=fill)


def original_modern(i):
    return Image.open(REPO / f"web/public/portraits/{i}.webp").convert("RGB")


def original_classic(i):
    return Image.open(REPO / f"server/public/assets/monsters/{i}-portrait.jpg").convert("RGB")


def main():
    for sub in ("modern", "classic", "big"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    SHEETS.mkdir(exist_ok=True)
    frost = {}
    for path, ids in SETS.items():
        for i, c in zip(ids, cells(path)):
            frost[i] = c
            c.save(OUT / "big" / f"{i}-frost.png")
            c.resize((360, 240), Image.LANCZOS).save(OUT / "modern" / f"{i}-frost.webp", quality=90)
            classic_of(c).save(OUT / "classic" / f"{i}-frost-portrait.jpg", quality=82)

    # Per-monster comparison: Modern pair big, Classic pair at 2x, icon-size test.
    def monster_block(i):
        W, H = 1600, 1000
        s = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(s)
        label(d, (24, 16), f"{NAMES[i]}  >  Frost {NAMES[i]}", 40, bold=True)
        label(d, (24, 66), ROLE[i], 26, ICE)
        label(d, (24, 112), "Modern", 26, DIM)
        s.paste(original_modern(i).resize((768, 512), Image.LANCZOS), (24, 146))
        s.paste(frost[i], (808, 146))
        label(d, (24, 674), "Classic (shown 2x)", 26, DIM)
        s.paste(original_classic(i).resize((360, 240), Image.LANCZOS), (24, 708))
        fc = Image.open(OUT / "classic" / f"{i}-frost-portrait.jpg").resize((360, 240), Image.LANCZOS)
        s.paste(fc, (400, 708))
        label(d, (808, 674), "Icon size (56 px, real size)", 26, DIM)
        oi = Image.open(REPO / f"web/public/portraits/{i}-icon.webp").convert("RGB").resize((56, 56), Image.LANCZOS)
        fi = square_icon(frost[i], 56)
        s.paste(oi, (808, 712)); s.paste(fi, (880, 712))
        label(d, (808, 790), "Icon at 3x", 26, DIM)
        s.paste(oi.resize((168, 168), Image.NEAREST), (808, 824)); s.paste(fi.resize((168, 168), Image.NEAREST), (996, 824))
        return s

    for i in frost:
        monster_block(i).save(SHEETS / f"monster-{i}-{NAMES[i].lower().replace('-', '')}.png")

    # Option sheets: what each roster ADDS, one pair per row (original | frost), Modern.
    def pair_rows(ids, title, sub):
        rowh = 400
        s = Image.new("RGB", (1240, 130 + rowh * len(ids)), BG); d = ImageDraw.Draw(s)
        label(d, (24, 16), title, 40, bold=True); label(d, (24, 70), sub, 26, DIM)
        for n, i in enumerate(ids):
            y = 120 + n * rowh
            s.paste(original_modern(i).resize((540, 360), Image.LANCZOS), (24, y + 30))
            s.paste(frost[i].resize((540, 360), Image.LANCZOS), (600, y + 30))
            label(d, (24, y), f"{NAMES[i]}  ({ROLE[i]})", 26, ICE)
            label(d, (600, y), f"Frost {NAMES[i]}", 26, INK)
        return s

    pair_rows(ROSTERS[0][1], "Roster A: 4 frost monsters", "Original (left) and frost (right), Modern look").save(SHEETS / "roster-A-four.png")
    pair_rows(["C8", "C9"], "Roster B = A + 2", "Adds fast damage and a looter").save(SHEETS / "roster-B-adds.png")
    pair_rows(["C10", "C16"], "Roster C = B + 2", "Adds a heavy tank and a flying healer").save(SHEETS / "roster-C-adds.png")

    # Card-ready roster: the 8 frost monsters, 2 per row, each with the options that include it.
    tw, th = 720, 480
    order = ROSTERS[2][1]
    s = Image.new("RGB", (24 + 2 * (tw + 24), 130 + 4 * (th + 70)), BG); d = ImageDraw.Draw(s)
    label(d, (24, 16), "Frost tribe: which monsters?", 40, bold=True)
    label(d, (24, 70), "A = first 4 · B = first 6 · C = all 8 (one per role). Modern look.", 26, DIM)
    for n, i in enumerate(order):
        x, y = 24 + (n % 2) * (tw + 24), 130 + (n // 2) * (th + 70)
        s.paste(frost[i].resize((tw, th), Image.LANCZOS), (x, y))
        label(d, (x, y + th + 10), f"Frost {NAMES[i]}", 30, INK, bold=True)
        label(d, (x + 20 + d.textlength(f"Frost {NAMES[i]}", font=font(30, True)), y + th + 14), ROLE[i], 26, ICE)
        cx = x + tw
        for name, ids in reversed(ROSTERS):
            letter = name.strip()[0]
            on = i in ids
            cx -= 52
            d.rounded_rectangle((cx, y + th + 8, cx + 44, y + th + 52), 10, fill=(70, 150, 200) if on else (52, 58, 68))
            d.text((cx + 22, y + th + 30), letter, font=font(28, True), fill=INK if on else (95, 102, 114), anchor="mm")
    s.save(SHEETS / "card-roster.png")

    # Champions: per concept L1 / L3 / L6 (+ action), Modern big, Classic small; and a card overview.
    champ_cells = {}
    for path, key, title, idea in CHAMPS:
        # Same square frame for every level, so the creature grows (as the real G<n>-L<l> art).
        # The Codex sheet's L6 reaches above its cell line, so take the top row to y 450 and
        # the bottom row from y 440; each level goes on one 768 square of studio ground with
        # its feet on the same line, so the creature grows in a fixed frame.
        full = Image.open(HERE / path).convert("RGB").resize((1536, 1024), Image.LANCZOS)
        ground = full.getpixel((760, 6))
        regions = [(0, 0, 768, 450), (768, 0, 1536, 450), (0, 440, 768, 1024)]
        parts = [full.crop(b) for b in regions]
        boxes = [creature_box(pt) for pt in parts]
        b6 = boxes[2]
        S = int(max(b6[2] - b6[0], b6[3] - b6[1]) * 1.08)  # frame from L6, as the real L6 fills its frame
        sq = []
        for pt, (x0, y0, x1, y1) in zip(parts, boxes):
            frame = Image.new("RGB", (S, S), ground)
            frame.paste(pt, (int(S / 2 - (x0 + x1) / 2), int(S * 0.96 - y1)))
            sq.append(frame.resize((512, 512), Image.LANCZOS))
        act = full.crop((768, 470, 1536, 1024))
        champ_cells[key] = act
        for lvl, img in zip((1, 3, 6), sq):
            img.resize((352, 352), Image.LANCZOS).save(OUT / "modern" / f"champ-{key}-L{lvl}.webp", quality=90)
            cl = img.resize((150, 150), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
            ImageEnhance.Color(cl).enhance(1.05).save(OUT / "classic" / f"champ-{key}-L{lvl}-150.png")
        W = 24 + 3 * (512 + 16)
        s = Image.new("RGB", (W, 1500), BG); d = ImageDraw.Draw(s)
        label(d, (24, 16), title, 40, bold=True); label(d, (24, 70), idea, 26, ICE)
        for n, (lvl, img) in enumerate(zip((1, 3, 6), sq)):
            x = 24 + n * (512 + 16)
            label(d, (x, 116), f"Level {lvl}" + ("  (Modern)" if n == 0 else ""), 26, DIM)
            s.paste(img, (x, 150))
        label(d, (24, 682), "Classic (150 px, shown 2x)", 26, DIM)
        for n, lvl in enumerate((1, 3, 6)):
            s.paste(Image.open(OUT / "classic" / f"champ-{key}-L{lvl}-150.png").resize((300, 300), Image.LANCZOS), (24 + n * 316, 716))
        label(d, (980, 682), "Its power (level 3)", 26, DIM)
        s.paste(act.resize((532, 384), Image.LANCZOS), (980, 716))
        label(d, (24, 1040), "Beside a real champion at level 6 (Modern, same frame)", 26, DIM)
        real = Image.open(REPO / "web/public/portraits/G2-L6.webp").convert("RGBA").resize((400, 400), Image.LANCZOS)
        ground = Image.new("RGB", (400, 400), sq[2].getpixel((5, 5))); ground.paste(real, (0, 0), real)
        s.paste(ground, (24, 1076)); s.paste(sq[2].resize((400, 400), Image.LANCZOS), (440, 1076))
        s.crop((0, 0, W, 1490)).save(SHEETS / f"champion-{key}.png")

    W = 24 + 3 * (520 + 16)
    s = Image.new("RGB", (W, 1290), BG); d = ImageDraw.Draw(s)
    label(d, (24, 16), "Frost champion: which one?", 40, bold=True)
    label(d, (24, 66), "Level 1, 3 and 6 of one design that grows. Enemy only this Christmas.", 24, DIM)
    for n, (path, key, title, idea) in enumerate(CHAMPS):
        x = 24 + n * (520 + 16)
        label(d, (x, 110), f"{'ABC'[n]}  {title}", 30, ICE, bold=True)
        words, line, yy = idea.split(), "", 150
        for w in words:
            if d.textlength(line + " " + w, font=font(22)) > 510:
                label(d, (x, yy), line.strip(), 22, DIM); yy += 28; line = ""
            line += " " + w
        label(d, (x, yy), line.strip(), 22, DIM)
        l6 = Image.open(OUT / "modern" / f"champ-{key}-L6.webp").convert("RGB").resize((520, 520), Image.LANCZOS)
        s.paste(l6, (x, 220))
        for m, lvl in enumerate((1, 3)):
            img = Image.open(OUT / "modern" / f"champ-{key}-L{lvl}.webp").convert("RGB").resize((256, 256), Image.LANCZOS)
            s.paste(img, (x + m * 264, 750))
        s.paste(champ_cells[key].resize((360, 260), Image.LANCZOS), (x + 80, 1014))
    s.save(SHEETS / "card-champion.png")
    print("done", sorted(p.name for p in SHEETS.iterdir()))


if __name__ == "__main__":
    main()
