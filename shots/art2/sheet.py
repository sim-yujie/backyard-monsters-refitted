# Obsidian Hide round 2: six options next to Bloodthirst and Twin Bite, on both looks' slot colours.
from PIL import Image, ImageDraw, ImageFont, ImageOps
P = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hide-icon/web/public/ui/abilities/"
cols = [("Bloodthirst", Image.open(P + "bloodthirst.webp")), ("Twin Bite", Image.open(P + "twin-bite.webp"))]
cols += [(str(i), Image.open(f"final/obsidian-hide-option{i}.png")) for i in range(1, 7)]
cols = [(n, im.convert("RGBA")) for n, im in cols]
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", s)
CW = 300
W = CW * len(cols)

def locked(im):
    g = ImageOps.grayscale(im).convert("RGBA")
    rgb = Image.blend(im, g, 0.8)
    a = im.getchannel("A").point(lambda v: int(v * 0.35))
    rgb.putalpha(a)
    return rgb

def band(title, bg, ink, big):
    rows = [("real size 30 px", 70), ("30 px shown 3x (pixels as in game)", 130), ("locked (greyed) 30 px shown 3x", 130)]
    if big:
        rows.append(("3x of the 96 px file", 330))
    H = 50 + 70 + sum(h + 30 for _, h in rows)
    b = Image.new("RGBA", (W, H), bg + (255,))
    d = ImageDraw.Draw(b)
    d.text((12, 10), title, fill=ink, font=F(26))
    for c, (name, _) in enumerate(cols):
        f = F(54) if name.isdigit() else F(24)
        col = (230, 60, 40) if name.isdigit() else ink
        bb = d.textbbox((0, 0), name, font=f)
        d.text((c * CW + (CW - bb[2]) // 2, 55 + (60 - bb[3]) // 2), name, fill=col, font=f)
    y = 120
    for label, h in rows:
        d.text((12, y), label, fill=ink, font=F(18))
        y += 28
        for c, (_, im) in enumerate(cols):
            if label.startswith("real"):
                t = im.resize((30, 30), Image.LANCZOS); x = c * CW + (CW - 30) // 2; b.alpha_composite(t, (x, y + 20))
            elif label.startswith("3x of"):
                t = im.resize((288, 288), Image.LANCZOS); b.alpha_composite(t, (c * CW + 6, y))
            else:
                t = im.resize((30, 30), Image.LANCZOS)
                if label.startswith("locked"):
                    t = locked(t)
                tile = Image.new("RGBA", (30, 30), bg + (255,)); tile.alpha_composite(t)
                t = tile.resize((90, 90), Image.NEAREST); b.alpha_composite(t, (c * CW + (CW - 90) // 2, y + 10))
        y += h
    return b

bands = [band("MODERN look (slot colour sampled from the Champion tab)", (66, 70, 68), (235, 235, 235), True),
         band("CLASSIC look (slot colour sampled from the Champion tab)", (255, 242, 194), (60, 40, 20), False)]
head = Image.new("RGBA", (W, 60), (20, 20, 20, 255))
ImageDraw.Draw(head).text((12, 14), "Obsidian Hide icon, round 2: options 1-6, with Bloodthirst and Twin Bite (its slot neighbours) for scale", fill=(255, 255, 255), font=F(26))
out = Image.new("RGBA", (W, 60 + sum(x.size[1] for x in bands)))
out.alpha_composite(head, (0, 0)); y = 60
for x in bands:
    out.alpha_composite(x, (0, y)); y += x.size[1]
out.convert("RGB").save("obsidian-hide-round2-options.png")
print(out.size)
