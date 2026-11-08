"""The coin options beside Shiny: art-samples/coin-options.png. usage: python -I compare.py <worktree root>"""
import sys
from PIL import Image, ImageDraw, ImageFont
root = sys.argv[1]
icons = root + "/web/public/ui/icons/"
shiny = Image.open("C:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/alliances/shiny-icon.png").convert("RGBA")
def big(path, side):
    im = Image.open(path).convert("RGBA"); s = side / max(im.size)
    return im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)
cols = [
    ("Shiny (now)", shiny, lambda n: shiny.resize((n, n), Image.LANCZOS), big("C:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/alliances/shiny-icon.png", 256)),
]
for key, name, word in [("A", "eventcoin", "copper paw token"), ("B", "eventcoinb", "purple/teal gem"), ("C", "eventcoinc", "ribbon medal")]:
    cols.append((f"{key}: {word}", None, (lambda nm: (lambda n: Image.open(f"{icons}{nm}-{n}.webp").convert("RGBA")))(name),
                 big(f"{root}/art-samples/event-coin/large/{name}.png", 256)))
W, H = 300 * len(cols) + 20, 600
img = Image.new("RGBA", (W, H), (245, 240, 228, 255))
d = ImageDraw.Draw(img)
try:
    f = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 20); fs = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 15)
except OSError:
    f = fs = ImageFont.load_default()
for i, (label, _, small, enlarged) in enumerate(cols):
    x = 20 + i * 300
    d.text((x + 140 - d.textlength(label, font=f) / 2, 14), label, fill=(40, 30, 20), font=f)
    img.alpha_composite(enlarged, (x + 140 - enlarged.width // 2, 50 + (256 - enlarged.height) // 2))
    d.text((x + 10, 322), "64 px (actual size):", fill=(80, 70, 60), font=fs)
    img.alpha_composite(small(64), (x + 108, 345))
    # on the dark top bar, at 24 and 16 px beside a number
    d.rounded_rectangle((x, 430, x + 280, 520), 10, fill=(38, 34, 30))
    for j, n in enumerate((24, 16)):
        y = 445 + j * 38
        img.alpha_composite(small(n) if n in (16, 24) else small(n), (x + 20, y + (24 - n) // 2))
        d.text((x + 20 + n + 8, y + 2), "1,250", fill=(255, 255, 255), font=f if n == 24 else fs)
        d.text((x + 150, y + 4), f"{n} px on bar", fill=(170, 160, 150), font=fs)
    d.text((x + 10, 535), "Shiny = gold coin stack" if i == 0 else "event coin option", fill=(110, 100, 90), font=fs)
img.convert("RGB").save(root + "/art-samples/coin-options.png")
print("ok", img.size)
