"""Replace the rows of the given types in decorationModernArt.ts with the rows fit.py printed (rows.txt)."""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
TS = os.path.abspath(os.path.join(HERE, "../../../../../web/src/game/yard/decorationModernArt.ts"))
t = open(TS, encoding="utf-8").read()
for ln in open(os.path.join(HERE, "rows.txt"), encoding="utf-8"):
    m = re.match(r"\s*(\d+): modernLook\(", ln)
    if m:
        t, n = re.subn(rf"^  {m.group(1)}: modernLook\(.*$", ln.rstrip("\n"), t, flags=re.M)
        print(m.group(1), "replaced" if n else "NOT FOUND")
open(TS, "w", encoding="utf-8", newline="\n").write(t)
