"""Thanksgiving art: turns the Codex sheets into the game's pictures.

Inputs (made by run-codex.sh from each folder's prompt.txt, on flat magenta):
  turkey/turkey-sheet-v1.png   3 x 2 cells: walk 1-3 / walk 4, startled hop, peck
  props/props-sheet-v1.png     4 x 2 cells: hay bale, corn shock, pumpkin pile, cornucopia / 4 leaves
  popup/golden-turkey-v1.png   the golden-turkey reward picture
Outputs (server/public/assets/specialevent/thanksgiving/):
  turkey.png         6 frames in a row, FRAME_W x FRAME_H each, @2x (drawn at half size)
  turkey-golden.png  the same frames painted gold
  props.png + props.json   the props packed in a row, @2x, with their boxes
  golden-turkey.png  the popup picture, 140 x 140 like goldmushroom.png
And the desk sheet art-samples/thanksgiving/turkey-art-sheet.png.

Usage: python build_art.py
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "server", "public", "assets", "specialevent", "thanksgiving"))

# One turkey frame, @2x. The turkey is drawn at half this size in the yard
# (about 48 world pixels tall, a bit bigger than the 33 px Halloween pumpkin).
FRAME_W, FRAME_H = 112, 104


def key(im: Image.Image) -> Image.Image:
    """Keys the flat magenta out, with a soft, despilled edge."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            m = min(r, b) - g
            if m > 130:
                px[x, y] = (0, 0, 0, 0)
            elif m > 50:
                t = (m - 50) / 80  # 0 keep .. 1 drop
                k = g + int((min(r, b) - g) * (1 - t) * 0.3)
                px[x, y] = (min(r, max(k, g)), g, min(b, max(k, g)), int(255 * (1 - t)))
    return im


def unmix(im: Image.Image) -> Image.Image:
    """Takes the magenta back out of a soft glow that was painted over it.

    A glow pixel is read as glow-colour over magenta: its alpha from how far
    blue stands above green, its colour solved back from the mix. Only for
    magenta-tinted pixels (red and blue both well above green).
    """
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0 or b < g + 20 or r < g + 20:
                continue
            alpha = max(0.0, min(1.0, 1 - (b - g) / max(1, 255 - g)))
            if alpha < 0.04:
                px[x, y] = (0, 0, 0, 0)
                continue
            fr = min(255, int((r - (1 - alpha) * 255) / alpha))
            fg = min(255, int(g / alpha))
            fb = min(255, max(0, int((b - (1 - alpha) * 255) / alpha)))
            px[x, y] = (max(0, fr), fg, fb, int(a * alpha))
    return im


def cells(im: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    w, h = im.width // cols, im.height // rows
    return [im.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)) for r in range(rows) for c in range(cols)]


def clean(im: Image.Image, floor: int = 24) -> Image.Image:
    """Drops stray near-transparent specks so bounding boxes are tight."""
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] < floor:
                px[x, y] = (0, 0, 0, 0)
    return im


def gold(im: Image.Image) -> Image.Image:
    """Paints a frame gold: a luminance gradient map, alpha kept."""
    stops = [(0, (26, 14, 2)), (55, (110, 66, 8)), (90, (160, 104, 14)), (140, (226, 168, 34)), (200, (255, 222, 96)), (255, (255, 250, 210))]
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = int(0.3 * r + 0.59 * g + 0.11 * b)
            lum = min(255, int(lum * 1.15 + 12))
            for (l0, c0), (l1, c1) in zip(stops, stops[1:]):
                if lum <= l1:
                    t = (lum - l0) / max(1, l1 - l0)
                    px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)) + (a,)
                    break
    return out


def build_turkey() -> list[Image.Image]:
    sheet = key(Image.open(os.path.join(HERE, "turkey", "turkey-sheet-v1.png")))
    frames = [clean(c) for c in cells(sheet, 3, 2)]
    boxes = [f.getbbox() for f in frames]
    # Each row was painted on its own ground line: the walking frames' feet.
    ground = [max(boxes[i][3] for i in (0, 1, 2)), boxes[3][3]]
    shift = [0, ground[0] - ground[1]]
    # One window for every frame, relative to its cell, after the row shift.
    left = min(b[0] for b in boxes)
    right = max(b[2] for b in boxes)
    top = min(b[1] + shift[i // 3] for i, b in enumerate(boxes))
    bottom = ground[0]
    w, h = right - left, bottom - top
    scale = min((FRAME_W - 4) / w, (FRAME_H - 2) / h)
    out = []
    for i, f in enumerate(frames):
        s = shift[i // 3]
        piece = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        piece.alpha_composite(f.crop((left, top - s, right, bottom - s)))
        piece = piece.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
        # Feet on the bottom edge, centred.
        cell.alpha_composite(piece, ((FRAME_W - piece.width) // 2, FRAME_H - piece.height - 1))
        out.append(cell)
    return out


def strip(frames: list[Image.Image]) -> Image.Image:
    im = Image.new("RGBA", (FRAME_W * len(frames), FRAME_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im.alpha_composite(f, (i * FRAME_W, 0))
    return im


# Each prop's longest side @2x (world size is half).
PROP_SIZES = {
    "hay": 128,
    "corn": 168,
    "pumpkins": 120,
    "cornucopia": 128,
    "leaf-red": 40,
    "leaf-orange": 40,
    "leaf-yellow": 38,
    "leaf-brown": 38,
}


def build_props() -> dict:
    sheet = key(Image.open(os.path.join(HERE, "props", "props-sheet-v1.png")))
    pieces = []
    for name, cell in zip(PROP_SIZES, cells(sheet, 4, 2)):
        cell = clean(cell)
        cell = cell.crop(cell.getbbox())
        s = PROP_SIZES[name] / max(cell.size)
        pieces.append((name, cell.resize((round(cell.width * s), round(cell.height * s)), Image.LANCZOS)))
    width = sum(p.width + 2 for _, p in pieces)
    height = max(p.height for _, p in pieces)
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    boxes = {}
    x = 0
    for name, p in pieces:
        atlas.alpha_composite(p, (x, 0))
        boxes[name] = {"x": x, "y": 0, "w": p.width, "h": p.height}
        x += p.width + 2
    atlas.save(os.path.join(OUT, "props.png"), optimize=True)
    with open(os.path.join(OUT, "props.json"), "w") as f:
        json.dump(boxes, f, indent=1)
    return {"atlas": atlas, "boxes": boxes}


def build_popup() -> Image.Image:
    im = Image.open(os.path.join(HERE, "popup", "golden-turkey-v1.png")).convert("RGBA")
    im = clean(unmix(im), 12)
    im = im.crop(im.getbbox())
    side = max(im.size)
    pad = int(side * 0.03)
    sq = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    sq.alpha_composite(im, ((sq.width - im.width) // 2, (sq.height - im.height) // 2))
    out = sq.resize((140, 140), Image.LANCZOS)
    out.save(os.path.join(OUT, "golden-turkey.png"), optimize=True)
    return sq


def desk_sheet(frames, golden, props, popup) -> None:
    """The art sheet for the Review Desk: frames large, on a yard green."""
    green = (92, 132, 68, 255)
    big = 2  # frames shown at 2x their @2x size = 4x world size
    fw, fh = FRAME_W * big, FRAME_H * big
    width = max(6 * fw + 70, 900)
    height = 60 + fh + 50 + fh + 50 + props["atlas"].height + 60 + 300
    sheet = Image.new("RGBA", (width, height), green)
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    labels = ["walk 1", "walk 2", "walk 3", "walk 4", "pick (hop)", "idle (peck)"]
    y = 10
    draw.text((10, y), "Turkey: walk cycle, pick moment, idle (shown 4x world size)", fill="white", font=font)
    y += 40
    for i, f in enumerate(frames):
        sheet.alpha_composite(f.resize((fw, fh), Image.LANCZOS), (10 + i * (fw + 10), y))
        draw.text((10 + i * (fw + 10), y + fh + 2), labels[i], fill="white", font=font)
    y += fh + 40
    draw.text((10, y), "Golden turkey (shown when a pick rolls golden)", fill="white", font=font)
    y += 30
    for i, f in enumerate(golden):
        sheet.alpha_composite(f.resize((fw, fh), Image.LANCZOS), (10 + i * (fw + 10), y))
    y += fh + 20
    draw.text((10, y), "Yard dress-up props (Modern look; Classic uses Flash's own scarecrow, pumpkins, acorns)", fill="white", font=font)
    y += 30
    sheet.alpha_composite(props["atlas"], (10, y))
    y += props["atlas"].height + 20
    draw.text((10, y), "Golden turkey reward pop-up", fill="white", font=font)
    sheet.alpha_composite(popup.resize((280, 280), Image.LANCZOS), (10, y + 26))
    sheet.convert("RGB").save(os.path.join(HERE, "turkey-art-sheet.png"))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    frames = build_turkey()
    golden = [gold(f) for f in frames]
    strip(frames).save(os.path.join(OUT, "turkey.png"), optimize=True)
    strip(golden).save(os.path.join(OUT, "turkey-golden.png"), optimize=True)
    props = build_props()
    popup = build_popup()
    desk_sheet(frames, golden, props, popup)
    print("frames", FRAME_W, FRAME_H, "props", props["boxes"])


if __name__ == "__main__":
    main()
