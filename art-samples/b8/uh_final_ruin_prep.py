"""uh_final_ruin_prep.py <level> <d|x> : set up the Codex job for the damaged (d) or destroyed (x) look of the final
Under Hall level 4, 5 or 6. Writes final/jobs/L<level><d|x>/: base.png (this pass's whole level, no flame, 3x on green
at the fixed spot), manner.png (the approved level 3: whole | damaged | destroyed, the manner to break it in) and
prompt.txt. Then: bash $S/run_codex.sh <job> <job>/base.png <job>/manner.png
"""
import sys

from PIL import Image

from b8lib import B, HERE, resize_pm

FINAL = HERE / "underhall-levels" / "final"
CW, CH, UPB = 1024, 1536, 3
FW, FH, L3X, L3Y, CX, CY = 340, 660, 58, 292, 161, 410

HOW = {
    "d": ("DAMAGED (hit in a battle, still standing)",
          "the same building at the same size and place, battered in the same way and to the same degree as the middle "
          "picture of manner.png: the roof torn and dented with a panel ripped open, the funnel bent and dented and its "
          "glow gone dark (no fire), a broken bone horn, cracked lava stones with a little lava oozing out, bent iron "
          "straps, chipped stone blocks, dark scorch marks; this level's own additions are damaged too (broken or bent "
          "spikes, a snapped hanging chain, a cracked trough, a bent gate bar, a broken iron horn, whichever it has). "
          "A few broken-off pieces lie on the ground right next to the base. The stone base stays exactly where it is in base.png."),
    "x": ("DESTROYED (what is left after it was blown up)",
          "a low wreck in the same way and to the same degree as the right picture of manner.png: the stone base and the "
          "lower part of the cracked lava core still there and glowing a little, the roof collapsed and torn down over it, "
          "the funnel knocked over, broken bone horns and teal slabs fallen over, scattered stone blocks, smoke-blackened; "
          "the wreck of this level's own additions lies in it (broken spikes and chains, an overturned trough, the twisted "
          "gate, a fallen iron horn, whichever it has). No fire, no smoke. The stone base stays exactly where it is in "
          "base.png (same place, same size, same ground line); the wreck is about as wide as the building was and at most "
          "two thirds as tall as it was."),
}


def main(level, kind):
    job = FINAL / "jobs" / f"L{level}{kind}"
    job.mkdir(parents=True, exist_ok=True)
    body = Image.open(FINAL / "work" / f"body{level}@2x.png").convert("RGBA")       # the 340x660 frame
    big = resize_pm(body, (FW * UPB, FH * UPB))
    base = Image.new("RGBA", (CW, CH), (0, 255, 0, 255))
    base.alpha_composite(big, (CX - L3X * UPB, CY - L3Y * UPB))
    base.convert("RGB").save(job / "base.png")
    pics = [Image.open(B / "itownhall" / f"top.c3{s}@2x.webp").convert("RGBA") for s in ("", ".damaged", ".destroyed")]
    m = Image.new("RGBA", (sum(p.width for p in pics) * 2 + 160, max(p.height for p in pics) * 2 + 80), (0, 255, 0, 255))
    x = 40
    for p in pics:
        p2 = resize_pm(p, (p.width * 2, p.height * 2))
        m.alpha_composite(p2, (x, m.height - 40 - p2.height)); x += p2.width + 40
    m.convert("RGB").save(job / "manner.png")
    name, how = HOW[kind]
    (job / "prompt.txt").write_text(f"""Generate an image using your image generation tool (one image only, do not make variations or extra files). Do not write code.

The attached images:
- base.png (1024x1536): the UNDER HALL (the town hall of the Inferno, the monsters' underground lava world in the isometric game Backyard Monsters Revamped) at level {level}, whole, as it is in the game, enlarged, on green.
- manner.png: the approved level 3 Under Hall: whole (left), DAMAGED (middle) and DESTROYED (right). It shows the manner and the degree of breaking, and the finish. Level {level} is the same building with more parts.

Job: paint the {name} look of base.png: {how}

Same camera as base.png (the game's fixed isometric 3/4 view, not mirrored), the same materials, colours, brightness and finish as base.png and manner.png: crisp, polished, almost rendered hand-painted digital art, smooth shading, soft light from the upper left, clean edges, no thick black outline, no cel shading. Not gory.

Output: ONE image, 1024x1536, the building alone at the same place and scale as in base.png, complete and fully inside the image.
Background everywhere: flat pure green #00FF00, also between the parts. No ground, no lava pool, no shadow on the ground, no smoke, no flame, no grid lines, no text, no labels. The picture contains no bright pure green.
Save the final PNG as sheet.png in the current working directory.
""")
    print("ready", job)


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2])
