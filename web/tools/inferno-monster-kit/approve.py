"""
approve.py <IC id> <work dir> <batch dir> [heading ...]
Adds the painted views of a vetted still batch to <work>/approved.json (the style row later batches copy).
With headings named, only those views are added. Cut views go to <work>/views/h<N>.png.
"""
import json
import sys
from pathlib import Path

import common

mid, work, batch = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
hs = [int(x) for x in batch.name.split("-")[1:]]
only = {int(x) for x in sys.argv[4:]} or set(hs)
(work / "views").mkdir(exist_ok=True)
path = work / "approved.json"
views = json.loads(path.read_text()) if path.exists() else []
for h, cell in zip(hs, common.grid_cells(batch / "frames-new.png", 2, 2)):
    if h not in only:
        continue
    cut = common.key_cell(cell)
    f = work / "views" / f"h{h}.png"
    common.flat(cut, (255, 0, 255)).save(f)
    views = [v for v in views if v["heading"] != h] + [{"heading": h, "file": str(f)}]
path.write_text(json.dumps(sorted(views, key=lambda v: v["heading"]), indent=1))
print("approved", sorted(v["heading"] for v in views))
