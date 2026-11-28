# Round 3 sheet: one band per take (A neon, B astra, C mine). Each new icon beside Bloodthirst and Twin Bite at
# 30 px on the Modern and Classic slot colours (real size and 3x pixel view) and at 3x of the 96 px file, plus a
# COMPOSITE crop of Drull's three slots made from the real 1x Champion tab screenshot.
import json, sys
from PIL import Image, ImageDraw, ImageFont
P = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/web/public/ui/abilities/"
UI = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/shots/ui/r2/"
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", s)
TAKES = json.load(open("takes.json"))  # [{"title":..., "icons":[["A1","path"],...]}]
NB = [("Bloodthirst", Image.open(P + "bloodthirst.webp").convert("RGBA")), ("Twin Bite", Image.open(P + "twin-bite.webp").convert("RGBA"))]
LOOKS = {"modern": ((66, 70, 68), (235, 235, 235), (757, 461), (480, 430, 820, 505)),
         "classic": ((255, 242, 194), (60, 40, 20), (753, 467), (480, 436, 820, 511))}
CW = 300

def composite(look, icon):
    _, _, (cx, cy), crop = LOOKS[look]
    im = Image.open(UI + f"{look}-desk-1280x720-abilities-picked.png").convert("RGBA"); px = im.load()
    for y in range(cy - 17, cy + 17):
        l = px[cx - 22, y]
        for x in range(cx - 18, cx + 18):
            px[x, y] = l
    im.alpha_composite(icon.resize((30, 30), Image.LANCZOS), (cx - 15, cy - 15))
    c = im.crop(crop)
    return c.resize((c.size[0] * 3, c.size[1] * 3), Image.LANCZOS)

def band(take):
    cols = NB + [(n, Image.open(p).convert("RGBA")) for n, p in take["icons"]]
    W = CW * 5
    comp_h = 225 + 40
    H = 60 + 70 + 2 * 150 + 330 + len(take["icons"]) * comp_h + 20
    b = Image.new("RGBA", (W * 2 if False else W, H), (24, 24, 24, 255)); d = ImageDraw.Draw(b)
    d.text((12, 12), take["title"], fill=(255, 210, 120), font=F(28))
    y = 60
    for c, (n, _) in enumerate(cols):
        f = F(50) if not n[0].isalpha() or len(n) <= 3 else F(24)
        bb = d.textbbox((0, 0), n, font=f)
        d.text((c * CW + (CW - bb[2]) // 2, y + (60 - bb[3]) // 2), n, fill=(230, 70, 50) if len(n) <= 3 else (230, 230, 230), font=f)
    y += 70
    for look, (bg, ink, _, _) in LOOKS.items():
        d.rectangle((0, y, W, y + 150), fill=bg)
        d.text((12, y + 6), f"{look.upper()} slot colour: real 30 px, then the same 30 px shown 3x", fill=ink, font=F(18))
        for c, (_, im) in enumerate(cols):
            t = im.resize((30, 30), Image.LANCZOS)
            b.alpha_composite(t, (c * CW + 60, y + 75))
            tile = Image.new("RGBA", (30, 30), bg + (255,)); tile.alpha_composite(t)
            b.alpha_composite(tile.resize((90, 90), Image.NEAREST), (c * CW + 130, y + 45))
        y += 150
    d.text((12, y + 4), "3x of the 96 px file", fill=(230, 230, 230), font=F(18))
    for c, (_, im) in enumerate(cols):
        b.alpha_composite(im.resize((288, 288), Image.LANCZOS), (c * CW + 6, y + 30))
    y += 330
    for n, p in take["icons"]:
        icon = Image.open(p).convert("RGBA")
        d.text((12, y + 6), f"COMPOSITE (pasted into the real Champion tab screenshot, not an in-game capture): {n}", fill=(255, 255, 255), font=F(18))
        x = 0
        for look in LOOKS:
            t = composite(look, icon); t = t.resize((t.size[0] * 735 // t.size[0], t.size[1] * 735 // t.size[0]), Image.LANCZOS)
            b.alpha_composite(t, (x, y + 34)); x += t.size[0] + 30
        y += comp_h - 225 + t.size[1]
    return b.crop((0, 0, W, y + 10))

bands = [band(t) for t in TAKES]
for t, x in zip(TAKES, bands):
    x.convert("RGB").save(f"obsidian-hide-round3-take{t['icons'][0][0][0]}.png")
W = max(x.size[0] for x in bands)
out = Image.new("RGB", (W, sum(x.size[1] for x in bands) + 10 * len(bands)), (0, 0, 0)); y = 0
for x in bands:
    out.paste(x.convert("RGB"), (0, y)); y += x.size[1] + 10
out.save(sys.argv[1] if len(sys.argv) > 1 else "obsidian-hide-round3.png"); print(out.size)
