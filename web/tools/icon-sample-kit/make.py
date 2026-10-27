"""Write the Codex prompt for one batch of four icons.

usage: make.py <batch> [icon,icon,icon,icon]   (a list overrides BATCHES, for redo batches; env NOTE is appended)
Output folder: art-samples/icons/batches/<batch>/ with prompt.txt and inputs.txt.
"""
import os
import sys

from icons import BATCHES, ICONS, OUT, STYLE

b = sys.argv[1]
names = sys.argv[2].split(",") if len(sys.argv) > 2 else BATCHES[b]
assert len(names) == 4, "a batch paints four icons"
out = OUT / "batches" / b
out.mkdir(parents=True, exist_ok=True)
(out / "names.txt").write_text(",".join(names), encoding="utf-8")
(out / "inputs.txt").write_text(STYLE.as_posix(), encoding="utf-8")

spots = ["TOP-LEFT", "TOP-RIGHT", "BOTTOM-LEFT", "BOTTOM-RIGHT"]
lines = "\n".join(f"- {s}: {ICONS[n]}." for s, n in zip(spots, names))
prompt = f"""Use your image generation tool (one call) to create a new image and save it as sheet.png in the current folder. Do not write code and do not copy or composite pixels from the input.

These are UI icons for the cartoon strategy game Backyard Monsters. They sit next to numbers in the game's panels (like "heart 480") and must read clearly at a tiny 24-32 pixel size.

Input 1, style.png: the game's APPROVED painted art. Top two rows: resource piles (twigs, pebbles, putty, goo, bone, coal, sulfur, magma). Third row: status sticker icons (burning, enraged, frozen, loot boosted, poisoned, puttied, slowed, stunned). Bottom right: a worker monster. STYLE ONLY: copy their look exactly: chunky simple shapes, a bold dark outline around every shape, bright saturated cartoon colours, soft painted shading with a glossy white highlight, and, like the sticker icons, a thin clean white rim just outside the dark outline. Do not copy their subjects.

Output: ONE square image, 1024x1024, with FOUR separate icons on a 2 x 2 grid, each centred in its own quarter and filling about 70% of that quarter, with clear empty space between them (they must not touch each other or the image edge):
{lines}

Each icon: one simple bold silhouette that still reads at 24 pixels, few big shapes, no tiny details, no text, no letters, no numbers (except where an exclamation mark is asked for), front view, no perspective tricks, no drop shadow on the ground.
Background everywhere: flat pure magenta #FF00FF, no gradient, no grid lines, no frames, no labels. The icons themselves must contain no pink or magenta.
""" + os.environ.get("NOTE", "")
(out / "prompt.txt").write_text(prompt, encoding="utf-8")
print("ready", out.as_posix())
