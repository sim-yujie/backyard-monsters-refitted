"""waitn.py <n> [secs]: wait until queue.log has at least n more 'exit' lines than now (or secs pass, default 580), print new lines."""
import os, sys, time
p = "D:/Coding/BYMR/art-trials/champions/_kit/l456/queue.log"
mark = "D:/Coding/BYMR/art-trials/champions/_kit/l456/.seen"
seen = int(open(mark).read()) if os.path.exists(mark) else 0
n = int(sys.argv[1]); t = time.time(); lim = float(sys.argv[2]) if len(sys.argv) > 2 else 580
while time.time() - t < lim:
    lines = open(p).read().splitlines()
    if len(lines) - seen >= n: break
    time.sleep(10)
lines = open(p).read().splitlines()
print("\n".join(l.replace("/d/Coding/BYMR/art-trials/champions/", "") for l in lines[seen:]))
open(mark, "w").write(str(len(lines)))
