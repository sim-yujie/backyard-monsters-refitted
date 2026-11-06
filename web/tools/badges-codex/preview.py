"""preview.py <id> [scale] : put every Codex option for one badge on its tier's medal and show it at 176, 60 and 24 px.

Writes art-samples/badges/out/<slug>-option-<k>.webp and art-samples/badges/preview-<slug>.png.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from badge import badge  # noqa: E402
from symbols import SYMBOLS  # noqa: E402

W = Path(__file__).resolve().parents[3] / "art-samples" / "badges"
SHINY = {14: 5, 18: 10, 19: 25, 20: 15, 21: 15, 23: 15, 24: 25, 25: 15, 26: 20, 27: 25}


def tier(aid):
    s = SHINY[aid]
    return "gold" if s >= 20 else "silver" if s >= 10 else "bronze"


if __name__ == "__main__":
    aid = int(sys.argv[1])
    scale = float(sys.argv[2]) if len(sys.argv) > 2 else 0.66
    slug = SYMBOLS[aid][0]
    (W / "out").mkdir(exist_ok=True)
    opts = sorted((W / "gen" / slug).glob("option-*.png"))
    sheet = Image.new("RGBA", (len(opts) * 300, 200), (32, 38, 46, 255))
    for n, p in enumerate(opts):
        out = W / "out" / f"{slug}-{p.stem}.webp"
        badge(tier(aid), str(p), str(out), scale)
        b = Image.open(out).convert("RGBA")
        sheet.alpha_composite(b, (n * 300 + 8, 12))
        sheet.alpha_composite(b.resize((60, 60), Image.LANCZOS), (n * 300 + 200, 20))
        sheet.alpha_composite(b.resize((24, 24), Image.LANCZOS), (n * 300 + 218, 110))
    sheet.save(W / f"preview-{slug}.png")
    print(W / f"preview-{slug}.png")
