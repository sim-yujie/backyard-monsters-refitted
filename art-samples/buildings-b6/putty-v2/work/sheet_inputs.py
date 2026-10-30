"""sheet_inputs.py : Flash and 3D per level, same frame and size, for tools/art-check/levels_sheet.py (work/sheet/)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref, post
out = Path(__file__).resolve().parent / "sheet"
out.mkdir(exist_ok=True)
for lv in fref.LEVELS:
    m = post.on_grass(post.frame3d(lv, 0))
    m.convert("RGB").save(out / f"model-L{lv}.png")
    post.flash(lv, 0, m.size).convert("RGB").save(out / f"flash-L{lv}.png")
print("ok")
