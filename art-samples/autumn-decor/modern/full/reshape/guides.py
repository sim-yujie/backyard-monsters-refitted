"""Shape guides for Codex: each Flash picture placed in its cell on magenta at the size we want back,
plus the current Modern versions (style reference, numbered the same)."""
import os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../../.."))
D = os.path.join(REPO, "server/public/assets/buildings/decorations")
MAG = (255, 0, 255, 255)
SHEETS = {
    "r1": ((1536, 1024), 2, 2, [("pool/top.png", "pool/pool.modern@2x.webp"),
                                ("zengarden/top.png", "zengarden/zen-garden.modern@2x.webp"),
                                ("japaneseteagarden/top.png", "japaneseteagarden/tea-garden.modern@2x.webp"),
                                ("japaneseteagarden/top.png", "japaneseteagarden/tea-garden.modern@2x.webp")]),
    "r2": ((1024, 1536), 1, 1, [("statue-eiffeltower/top.v2.png", "statue-eiffeltower/eiffel-tower.modern@2x.webp")]),
}


def fit(im, cw, ch, fill=0.78):
    z = min(cw * fill / im.width, ch * fill / im.height)
    return im.resize((round(im.width * z), round(im.height * z)), Image.LANCZOS)


def build(name):
    (W, H), cols, rows, items = SHEETS[name]
    cw, ch = W // cols, H // rows
    od = os.path.join(HERE, name); os.makedirs(od, exist_ok=True)
    g = Image.new("RGBA", (W, H), MAG); s = Image.new("RGBA", (W, H), (235, 235, 235, 255))
    f = ImageFont.load_default(size=40)
    for i, (fl, mo) in enumerate(items):
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        a = fit(Image.open(os.path.join(D, fl)).convert("RGBA"), cw, ch)
        g.alpha_composite(a, (x0 + (cw - a.width) // 2, y0 + (ch - a.height) // 2))
        b = fit(Image.open(os.path.join(D, mo)).convert("RGBA"), cw, ch)
        s.alpha_composite(b, (x0 + (cw - b.width) // 2, y0 + (ch - b.height) // 2))
        ImageDraw.Draw(s).text((x0 + 12, y0 + 8), str(i + 1), fill="black", font=f)
    g.convert("RGB").save(os.path.join(od, "shape-guide.png"))
    s.convert("RGB").save(os.path.join(od, "style-current-modern.png"))
    print(name, "ok")


for n in sys.argv[1:]:
    build(n)
