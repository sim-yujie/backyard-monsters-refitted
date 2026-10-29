"""mapbuildings.py : the map of the yard's non-tower buildings (art levels, Flash animation, footprint, max level), from
buildingArtData.ts and YardGrid.ts in the main checkout (read only). Prints a markdown table."""
import re
from pathlib import Path

import flashart as F

GRID = F.MAIN / "web/src/game/yard/YardGrid.ts"
TOWERS = {20, 21, 23, 25, 115, 118, 129, 132, 136, 137, 22, 140}      # defensive towers, the bunker, the outpost defender
SKIP = set(range(28, 51)) | set(range(52, 112)) | {120, 121, 131, 135, 24, 117}   # decorations and traps
NOTE = {5: "flinger (catapult-like)", 51: "catapult", 112: "outpost (Town Hall of an outpost)", 127: "Inferno yard only"}


def foot():
    t = GRID.read_text(encoding="utf8")
    body = t[t.index("FOOTPRINT_GROUPS"):t.index("const FOOTPRINTS")]
    out = {}
    for size, ids in re.findall(r"\[(\d+), \[([\d, ]+)\]\]", body):
        for i in ids.split(","):
            out[int(i)] = int(size)
    return out


def maxlv():
    out = {}
    for m in re.finditer(r'\n  \[(\d+), "[^"]+", "[^"]+", \[\n.*?\n  \], \[([\d,]*)\], (\d+)\]', F.DATA.read_text(encoding="utf8"), re.S):
        out[int(m[1])] = len(m[2].split(",")) if m[2] else 1
    return out


if __name__ == "__main__":
    fp, mx = foot(), maxlv()
    print("| id | building | art folder | levels | art looks (from level) | Flash anim | footprint |")
    print("|---|---|---|---|---|---|---|")
    for i, r in sorted(F.rows().items()):
        if i in TOWERS or i in SKIP:
            continue
        lv = r["levels"]
        an = [len(l[7]) if len(l) > 7 and l[7] else 0 for l in lv]
        anim = "no" if not any(an) else ("yes, " + "/".join(str(a) for a in an) + " layer(s)")
        files = sorted({a[0] for l in lv if len(l) > 7 and l[7] for a in l[7]})
        if files:
            anim += " (" + ", ".join(files) + ")"
        size = fp.get(i, "-")
        print(f"| {i} | {r['name']} | {r['folder']} | {mx.get(i, '?')} | {len(lv)}: {', '.join('L' + str(l[0]) for l in lv)} "
              f"| {anim} | {size} |")
