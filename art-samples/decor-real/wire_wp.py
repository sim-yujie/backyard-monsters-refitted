"""Copy the windpump's game files (windpump/game/<look>/) into props/ and write their rows into
revampDecorations.ts (the Classic row and the Modern moving(...) row of type 213)."""
import json, re, shutil
from pathlib import Path
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROPS = REPO / "server/public/assets/buildings/decorations/props"
TS = REPO / "web/src/game/yard/revampDecorations.ts"
rows = json.load(open(HERE / "windpump/game/rows.json"))
src = TS.read_text()
for look, r in rows.items():
    for f in (r["top"][0], r["shadow"][0], r["anim"][0]):
        shutil.copyfile(HERE / "windpump/game" / look / f, PROPS / f)
    t, s, a = r["top"], r["shadow"], r["anim"]
    if look == "classic":
        pat = re.compile(r'\[1, \["windpump@2x\.png", -?\d+, -?\d+\], null, null, \["windpump-shadow\.jpg", -?\d+, -?\d+\], null, null,\n(\s*)\[\["windpump-anim@2x\.png", -?\d+, -?\d+, \d+, \d+, \d+\]\]\]')
        new = (f'[1, ["{t[0]}", {t[1]}, {t[2]}], null, null, ["{s[0]}", {s[1]}, {s[2]}], null, null,\n\\1'
               f'[["{a[0]}", {a[1]}, {a[2]}, {a[3]}, {a[4]}, {a[5]}]]]')
    else:
        pat = re.compile(r'213: moving\(\["windpump\.modern@2x\.webp", -?\d+, -?\d+\], \["windpump\.modern-shadow\.jpg", -?\d+, -?\d+\],\n(\s*)\["windpump-anim\.modern@2x\.webp", -?\d+, -?\d+, \d+, \d+, \d+\]\)')
        new = (f'213: moving(["{t[0]}", {t[1]}, {t[2]}], ["{s[0]}", {s[1]}, {s[2]}],\n\\1'
               f'["{a[0]}", {a[1]}, {a[2]}, {a[3]}, {a[4]}, {a[5]}])')
    src, n = pat.subn(new, src)
    print(look, "rows changed:", n)
    assert n == 1
TS.write_text(src)
