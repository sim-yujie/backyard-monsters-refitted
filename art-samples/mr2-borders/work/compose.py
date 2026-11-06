"""Side-by-side and crop helpers for the mr2-borders pictures.

python -I compose.py crop SRC OUT x0 y0 x1 y1 [scale]
python -I compose.py sbs LEFT RIGHT OUT [height] [left-label] [right-label]
python -I compose.py grid OUT cols IMG... (each with optional ::label)
"""
import sys
from PIL import Image, ImageDraw, ImageFont


def font(size):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def label(im, text):
    if not text:
        return im
    d = ImageDraw.Draw(im)
    f = font(max(18, im.height // 28))
    box = d.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.rectangle((0, 0, w + 24, h + 20), fill=(0, 0, 0))
    d.text((12, 8), text, fill=(255, 255, 255), font=f)
    return im


def save(im, out):
    im.convert("RGB").save(out, quality=88)


def crop(src, out, x0, y0, x1, y1, scale=2.0):
    im = Image.open(src).crop((int(x0), int(y0), int(x1), int(y1)))
    im = im.resize((int(im.width * float(scale)), int(im.height * float(scale))), Image.LANCZOS)
    save(im, out)


def sbs(left, right, out, height=700, ll="", rl=""):
    height = int(height)
    ims = []
    for path, text in ((left, ll), (right, rl)):
        im = Image.open(path).convert("RGB")
        im = im.resize((int(im.width * height / im.height), height), Image.LANCZOS)
        ims.append(label(im, text))
    canvas = Image.new("RGB", (ims[0].width + ims[1].width + 12, height), (20, 20, 20))
    canvas.paste(ims[0], (0, 0))
    canvas.paste(ims[1], (ims[0].width + 12, 0))
    save(canvas, out)


def grid(out, cols, items):
    cols = int(cols)
    ims = []
    for item in items:
        path, _, text = item.partition("::")
        ims.append(label(Image.open(path).convert("RGB"), text))
    w = max(i.width for i in ims)
    h = max(i.height for i in ims)
    rows = (len(ims) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * w + (cols - 1) * 12, rows * h + (rows - 1) * 12), (20, 20, 20))
    for n, im in enumerate(ims):
        canvas.paste(im, ((n % cols) * (w + 12), (n // cols) * (h + 12)))
    save(canvas, out)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"crop": crop, "sbs": sbs}.get(cmd, lambda *a: grid(a[0], a[1], a[2:]))(*args)
