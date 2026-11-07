"""make.py <id> : write art-samples/badges/prompts/<slug>.txt and .inputs for one badge (run.sh runs it).

Same prompt and rules as the 17 earlier badges (archive/badge-art/work/prompts). NOTE="..." adds a correction.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from symbols import SYMBOLS  # noqa: E402

W = Path(__file__).resolve().parents[3] / "art-samples" / "badges"
RULES = """
Rules for every image:
- One single bold object (or the small group described), front view or a slight 3/4 view, centered, filling about 80% of the canvas with a small margin, whole object in frame.
- It will be shown very small (about 44 pixels, and sometimes 24 pixels) on a round metal medal, so: a strong simple silhouette, big clear shapes, few fine details, strong contrast, a slightly darker rim/edge around the shape so it separates from the medal.
- Same polished painted style as the style sheet. Not flat vector, not pixel art, not photo-real, not simple line icons.
- NO text, NO letters, NO numbers, NO logos, NO frame, NO medal, NO circle behind it, NO ground, NO cast shadow, NO background scenery.
- Transparent background (PNG with alpha). If transparency is impossible, use a perfectly flat pure white background.
- Square image, 1024x1024.
"""

aid = int(sys.argv[1])
slug, name, what, ref, opt1, opt2 = SYMBOLS[aid]
inputs = ["style-sheet.png"]
intro = ('You are making game art for "Backyard Monsters" (a 2010s Facebook strategy game). The first attached image, '
         "a style sheet, shows the game's art: glossy, painted, softly-lit 3D-cartoon look, chunky friendly shapes, "
         "warm saturated colours, light from the upper left.")
if ref:
    inputs.append(f"ref/{ref}")
    intro += " The second attached image is the game's own picture of the thing named below; follow its design and colours."
intro += " Use your image generation tool."
note = os.environ.get("NOTE", "")
task = (f'Task: paint the central SYMBOL for an achievement badge called "{name}" ({what}). '
        f"Option 1: {opt1} Option 2: {opt2}" + (f" IMPORTANT: {note}" if note else ""))
out = (f"\nMake TWO options as described. Save them exactly as:\n  gen/{slug}/option-1.png\n  gen/{slug}/option-2.png\n"
       "(relative to the current working directory; create the folder). Do not edit or create any other files. "
       "When done, reply with the two paths.\n")
(W / "prompts" / f"{slug}.txt").write_text(intro + "\n\n" + task + "\n" + RULES + out, encoding="utf-8")
(W / "prompts" / f"{slug}.inputs").write_text(" ".join(inputs) + "\n")
print(slug)
