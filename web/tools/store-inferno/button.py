"""button.py [<out file>] : the Inferno's Classic build button for the General Store (lead, 20 Nov 2026: match the
other Classic Inferno buttons, flames behind the building, not the surface's 12.jpg on white).

No new painting: Flash's own pieces. The flames are the Inferno Booby Trap's button (`booby_trap.v2.jpg`, whose trap is
a small disc low in the middle); Flash's General Store (`buildings/generalstore/top.1.png`, with its own shadow
multiplied onto the ground) stands over that disc at the size and place of the surface button (`12.jpg`): fitted into
70 x 82, its bottom at y 136, a little smaller than there so the flames show above it. Default output: server/public/assets/buildingbuttons/general_store.v2.jpg.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
ASSETS = REPO / "server" / "public" / "assets"
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ASSETS / "buildingbuttons" / "general_store.v2.jpg"

bg = Image.open(ASSETS / "buildingbuttons" / "booby_trap.v2.jpg").convert("RGB").resize((120, 160), Image.LANCZOS)
# the flames grown 1.3x about their foot (60, 128), so they rise behind the store as the others' rise behind theirs
G = 1.3
big = bg.resize((round(120 * G), round(160 * G)), Image.LANCZOS)
bg = big.crop((round(60 * G - 60), round(128 * G - 128), round(60 * G - 60) + 120, round(128 * G - 128) + 160))
top = Image.open(ASSETS / "buildings" / "generalstore" / "top.1.png").convert("RGBA")
shadow = Image.open(ASSETS / "buildings" / "generalstore" / "shadow.1.jpg").convert("RGB")
TOP_XY, SHADOW_XY = (-40, -37), (-44, 13)   # the art row's offsets (buildingArtData.ts, type 12)

k = min(70 / top.width, 82 / top.height)
bx = (120 - round(top.width * k)) // 2 - 4
by = 136 - round(top.height * k)
ox, oy = bx - TOP_XY[0] * k, by - TOP_XY[1] * k   # the building's origin on the button

s = shadow.resize((round(shadow.width * k), round(shadow.height * k)), Image.LANCZOS)
a = np.asarray(bg).astype(float)
x0, y0 = round(ox + SHADOW_XY[0] * k), round(oy + SHADOW_XY[1] * k)
sh = np.asarray(s).astype(float) / 255
h, w = sh.shape[:2]
a[y0:y0 + h, x0:x0 + w] *= sh[: max(0, min(h, 160 - y0)), : max(0, min(w, 120 - x0))]
button = Image.fromarray(a.clip(0, 255).astype("uint8")).convert("RGBA")
button.alpha_composite(top.resize((round(top.width * k), round(top.height * k)), Image.LANCZOS), (bx, by))
button.convert("RGB").save(out, quality=92)
print(out)
