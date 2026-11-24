"""Copy game files into the wonders folder and write their offsets into revampDecorations.ts.
    python wire.py <classic|modern> <game dir with rows.txt>"""
import re, shutil, sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server/public/assets/buildings/decorations/wonders"
TS = REPO / "web/src/game/yard/revampDecorations.ts"
look, game = sys.argv[1], Path(sys.argv[2])
src = TS.read_text()
for line in (game / "rows.txt").read_text().splitlines():
    m = re.match(r'([\w-]+): \["([^"]+)", (-?\d+), (-?\d+)\], \["([^"]+)", (-?\d+), (-?\d+)\]', line)
    if not m:
        continue
    name, top, tx, ty, sh, sx, sy = m.groups()
    shutil.copyfile(game / top, ASSETS / top)
    shutil.copyfile(game / sh, ASSETS / sh)
    if look == "classic":
        pat = re.compile(r'\["%s@2x\.png", -?\d+, -?\d+\], null, null, \["%s-shadow\.jpg", -?\d+, -?\d+\]' % (name, name))
        new = f'["{top}", {tx}, {ty}], null, null, ["{sh}", {sx}, {sy}]'
    else:
        pat = re.compile(r'modern\(\["%s\.modern@2x\.webp", -?\d+, -?\d+\], \["%s\.modern-shadow\.jpg", -?\d+, -?\d+\]\)' % (name, name))
        new = f'modern(["{top}", {tx}, {ty}], ["{sh}", {sx}, {sy}])'
    src, n = pat.subn(new, src)
    print(name, "rows changed:", n)
TS.write_text(src)
