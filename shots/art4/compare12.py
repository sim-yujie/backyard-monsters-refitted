# Old vs new for all 12 ability icons: at game size (30 px, 1x) on both looks' slot colours, and at 3x
# (the 96 px file drawn at 90 px, as a 3x phone shows a 30 px slot). Grouped by champion.
from PIL import Image, ImageDraw, ImageFont
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", s)
ROWS = [("Gorgo", [("Stone Skin", "stone", "stone-skin"), ("Chest Pound", "chest-pound", "chest-pound"), ("Ground Slam", "ground-slam", "ground-slam")]),
        ("Drull", [("Bloodthirst", "bloodthirst", "bloodthirst"), ("Twin Bite", "twin-bite", "twin-bite"), ("Obsidian Hide", "obsidian-hide", "obsidian-hide")]),
        ("Fomor", [("Healing Mist", "healing-mist", "healing-mist"), ("Bubble", "shielded", "bubble"), ("Acid Spit", "marked", "acid-spit")]),
        ("Korath", [("Burn", "burn", "burn"), ("Breath of Fire", "breath-of-fire", "breath-of-fire"), ("Fists of Doom", "fists-of-doom", "fists-of-doom")])]
MOD, CLA = (66, 70, 68), (255, 242, 194)
CW, GW = 230, 3 * 230 + 30
W, H = 2 * GW + 40, 0
def load(p): return Image.open(p).convert("RGBA")
def at(im, s): return im.resize((s, s), Image.LANCZOS)
def group(champ, items):
    g = Image.new("RGBA", (GW, 560), (24, 24, 24, 255)); d = ImageDraw.Draw(g)
    d.text((10, 6), champ, fill=(255, 210, 120), font=F(26))
    for c, (name, old, new) in enumerate(items):
        x = c * CW + 10
        o, n = load(f"old/{old}.webp"), load(f"final/{new}.png")
        d.text((x, 44), name, fill=(235, 235, 235), font=F(17))
        for r, bg in enumerate((MOD, CLA)):
            y = 74 + r * 58
            d.rectangle((x, y, x + 210, y + 50), fill=bg)
            ink = (235, 235, 235) if bg == MOD else (60, 40, 20)
            d.text((x + 6, y + 16), "old", fill=ink, font=F(14)); g.alpha_composite(at(o, 30), (x + 42, y + 10))
            d.text((x + 112, y + 16), "new", fill=ink, font=F(14)); g.alpha_composite(at(n, 30), (x + 152, y + 10))
        y = 200
        d.rectangle((x, y, x + 210, y + 340), fill=MOD)
        d.text((x + 6, y + 6), "old 3x", fill=(235, 235, 235), font=F(14)); g.alpha_composite(at(o, 90), (x + 60, y + 26))
        d.text((x + 6, y + 172), "new 3x", fill=(235, 235, 235), font=F(14)); g.alpha_composite(at(n, 90), (x + 60, y + 192))
    return g
out = Image.new("RGBA", (W, 70 + 2 * 580), (10, 10, 10, 255)); d = ImageDraw.Draw(out)
d.text((14, 14), "Ability icons: old (sticker) vs new (C1 style). Small rows = real 30 px on the Modern and Classic slot colours; big = 3x.", fill=(255, 255, 255), font=F(20))
for i, (champ, items) in enumerate(ROWS):
    out.alpha_composite(group(champ, items), (14 + (i % 2) * (GW + 12), 60 + (i // 2) * 580))
out.convert("RGB").save("ability-icons-old-vs-new.png"); print(out.size)
