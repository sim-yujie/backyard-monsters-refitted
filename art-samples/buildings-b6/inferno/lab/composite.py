"""composite.py : each direction's render pasted into a real Inferno yard screenshot (yardtester's Inferno yard, Modern
look, the helper's own game, zoom 2 at device scale 2 = 4 screen px per Flash px), on free ground between the towers
and the Strongbox. A COMPOSITE, not an in-game shot: the building is not in the game yet. The render keeps the kit's
camera and its own ground shadow; it is only scaled 12 -> 4 px per Flash px (the game shows @2x art the same way).
Writes shots/<dir>-yard.png (cropped to the neighbourhood), shots/<dir>-yard-full.png and shots/yard-all.png."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "shots"
SHOT = OUT / "yard" / "inferno-in2.png"
PX = 4                          # screen px per Flash px in the screenshot (the Strongbox's sprite matched, see scale())
SPOT = (1560, 960)              # where the building's origin (its footprint's middle on the ground) goes
FRAME, ORIGIN = (-86, -104), (0.0, 45.0)
CROP = (560, 300, 2560, 1500)

row = []
for d in "abc":
    yard = Image.open(SHOT).convert("RGBA")
    base = Image.open(HERE / d / "render" / "L1-base.png").convert("RGBA")
    edge = Image.new("RGBA", base.size, (0, 0, 0, 0))            # the render's outermost rows carry a stray line of
    edge.paste(base.crop((6, 6, base.width - 6, base.height - 6)), (6, 6))      # alpha (the denoiser's edge): dropped
    base = edge
    ramp = Image.new("L", base.size, 0)                            # and the shadow's faint tail fades out over the last
    for k in range(60):                                            # 60 px, so no canvas edge shows on the ground
        ImageDraw.Draw(ramp).rectangle((k, k, base.width - 1 - k, base.height - 1 - k), outline=None, fill=round(255 * (k + 1) / 60))
    base.putalpha(ImageChops.multiply(base.getchannel("A"), ramp))
    im = base.resize((base.width * PX // 12, base.height * PX // 12), Image.LANCZOS)
    at = (round(SPOT[0] - (ORIGIN[0] - FRAME[0]) * PX), round(SPOT[1] - (ORIGIN[1] - FRAME[1]) * PX))
    yard.alpha_composite(im, at)
    yard.convert("RGB").save(OUT / f"{d}-yard-full.png")
    c = yard.crop(CROP).convert("RGB")
    c.save(OUT / f"{d}-yard.png")
    row.append(c)
s = Image.new("RGB", (row[0].width, sum(r.height for r in row)))
y = 0
for r in row:
    s.paste(r, (0, y))
    y += r.height
s.save(OUT / "yard-all.png")
