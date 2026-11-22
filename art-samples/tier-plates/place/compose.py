# Draws each Classic tower as the yard does (fort back, top, first anim cell, fort front), with the
# building origin (+), the battle health bar (red box) and the plate box, to pick plate positions.
import json, sys
from PIL import Image, ImageDraw
A = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/tier-build/server/public/assets/"
TOWERS = {  # key: (folder, top, anims)
 "m20 cannon": ("buildings/cannontower/", ["top.3.png", -33, -25], []),
 "m21 sniper": ("buildings/snipertower/", ["top.3.png", -40, -30], [["anim.3.png", -27, -50, 55, 47]]),
 "m22 bunker": ("buildings/bunker/", ["anim.1.png", -46, -15, 90, 83], []),
 "m23 laser": ("buildings/lasertower/", ["top.1.png", -33, -29], [["anim.1.png", -13, -50, 29, 32]]),
 "m25 tesla": ("buildings/lightningtower/", ["top.3.png", -33, -57], [["anim.3.png", -25, -15, 27, 53]]),
 "m115 aerial": ("buildings/flaktower/", ["top.3.png", -39, 6], [["anim.3.png", -32, -23, 62, 52]]),
 "m118 railgun": ("buildings/railguntower/", ["top.3.png", -39, 7], [["anim.3.loaded.png", -49, -9, 96, 56]]),
 "m132 magma": ("buildings/imagmatower/", ["top.1.v2.png", -34, -9], [["anim.1.v2.png", -26, -50, 54, 42], ["anim.2.v2.png", -17, 26, 38, 19]]),
 "i20 blast": ("buildings/icannontower/", ["top.1.v2.png", -38, 11], [["anim.1.v2.png", -38, -53, 74, 64]]),
 "i21 sharp": ("buildings/isnipertower/", ["top.1.v2.png", -35, -5], [["anim.1.v2.png", -56, -86, 85, 81]]),
}
FORT = {"m20 cannon", "m21 sniper", "m23 laser", "m25 tesla", "m115 aerial", "m118 railgun"}
plates = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
PW, PH = 26, 18
Z = 4
W, H = 160, 170; OX, OY = 80, 105  # canvas px per tower at 1x, origin position
def img(path, x, y, w=None, h=None):
    im = Image.open(A + path).convert("RGBA")
    if w: im = im.crop((0, 0, w, h))
    return im, x, y
cells = []
for key, (folder, top, anims) in TOWERS.items():
    c = Image.new("RGBA", (W, H), (96, 120, 60, 255))
    layers = []
    fort = key in FORT
    if fort: layers.append(img("buildings/fortifications/fort70_B4.png", -61, -36))
    layers.append(img(folder + top[0], *top[1:]))
    for a in anims: layers.append(img(folder + a[0], *a[1:]))
    if fort: layers.append(img("buildings/fortifications/fort70_F4.png", -70, -11))
    for im, x, y in layers: c.alpha_composite(im, (OX + x, OY + y))
    c = c.resize((W * Z, H * Z), Image.NEAREST)
    d = ImageDraw.Draw(c)
    d.line([(OX*Z-12, OY*Z), (OX*Z+12, OY*Z)], fill="yellow", width=2); d.line([(OX*Z, OY*Z-12), (OX*Z, OY*Z+12)], fill="yellow", width=2)
    d.rectangle([(OX-26)*Z, (OY-14)*Z, (OX+25)*Z, (OY-8)*Z], outline="red", width=3)
    p = plates.get(key.split()[0])
    if p:
        x0, y0 = OX + p[0] - PW/2, OY + p[1]
        d.rectangle([x0*Z, y0*Z, (x0+PW)*Z, (y0+PH)*Z], outline="cyan", width=3)
    d.text((6, 6), key, fill="white")
    cells.append(c)
cols = 5
sheet = Image.new("RGBA", (W*Z*cols, H*Z*((len(cells)+cols-1)//cols)), (0,0,0,255))
for i, c in enumerate(cells): sheet.paste(c, ((i%cols)*W*Z, (i//cols)*H*Z))
sheet = sheet.resize((sheet.width//2, sheet.height//2))
sheet.save(sys.argv[2] if len(sys.argv) > 2 else "place.png")
