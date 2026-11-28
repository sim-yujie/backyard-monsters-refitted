# COMPOSITE previews: each option pasted at 30 px into the real 1x Champion tab screenshot in place of the
# current Obsidian Hide icon (old icon painted out with the flat slot colour), cropped to Drull's
# three slots, then enlarged 3x so all three icons are scaled the same way.
from PIL import Image, ImageDraw, ImageFont
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", s)
LOOKS = {"modern": ((757, 461), (480, 430, 820, 505)), "classic": ((753, 467), (480, 436, 820, 511))}
tiles = {}
for look, ((cx, cy), crop) in LOOKS.items():
    base = Image.open(f"ui/r2/{look}-desk-1280x720-abilities-picked.png").convert("RGBA")
    for i in range(1, 7):
        im = base.copy(); px = im.load()
        for y in range(cy - 17, cy + 17):
            l = px[cx - 22, y]  # the slot is flat; the right side runs into the Next badge
            for x in range(cx - 18, cx + 18):
                px[x, y] = l
        ic = Image.open(f"art2/final/obsidian-hide-option{i}.png").convert("RGBA").resize((30, 30), Image.LANCZOS)
        im.alpha_composite(ic, (cx - 15, cy - 15))
        c = im.crop(crop); c = c.resize((c.size[0] * 3, c.size[1] * 3), Image.LANCZOS)
        cap = Image.new("RGBA", (c.size[0], c.size[1] + 36), (0, 0, 0, 255))
        ImageDraw.Draw(cap).text((8, 6), f"COMPOSITE  option {i}  {look}", fill=(255, 255, 255), font=F(22))
        cap.alpha_composite(c, (0, 36)); c = cap
        c.convert("RGB").save(f"art2/rows/option{i}-{look}-drull-row-composite-3x.png")
        tiles[(i, look)] = c
w, h = tiles[(1, "modern")].size
out = Image.new("RGB", (w * 2 + 10, (h + 10) * 6 + 50), (20, 20, 20))
ImageDraw.Draw(out).text((10, 10), "COMPOSITE: options pasted into the real Champion tab screenshot (1x, then all enlarged 3x). Not an in-game capture.", fill=(255, 255, 255), font=F(24))
for (i, look), t in tiles.items():
    out.paste(t.convert("RGB"), ((0 if look == "modern" else w + 10), 50 + (i - 1) * (h + 10)))
out.save("art2/obsidian-hide-round2-drull-row-composites.png"); print(out.size)
