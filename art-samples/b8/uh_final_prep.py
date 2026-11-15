"""uh_final_prep.py <level> : set up the Codex job for the final Under Hall level 4, 5 or 6 body (direction B).

Writes underhall-levels/final/jobs/L<level>/: base.png (the level below, enlarged 3x on green, 1024x1536, standing at
a fixed spot: level 3 is the approved game picture, levels 4 and 5 are this pass's own finished stills), design.png
(the owner's chosen proposal for this level, from uB1/sheet.png) and prompt.txt. Then:
    bash $S/run_codex.sh underhall-levels/final/jobs/L<level> <job>/base.png <job>/design.png
The flame is NOT painted here (uh_final_build.py puts it on from the flame sheet, so it can move).
"""
import sys

from PIL import Image

from b8lib import B, HERE, resize_pm

FINAL = HERE / "underhall-levels" / "final"
CW, CH, UPB, FOOT = 1024, 1536, 3, 1430      # canvas, base blow-up from 2x, the y the picture's bottom stands on

ADD = {
    4: ("LEVEL 4 = base.png (level 3) plus ONLY these additions:\n"
        "- pointed black iron studs (small cones) along the three iron hoops of the cage;\n"
        "- a row of short sharp black iron spikes standing along the lower edge of the copper roof;\n"
        "- thin glowing lava cracks in the round blue-teal plinth band at the front;\n"
        "- the lava stones a little hotter (whiter-yellow centres);\n"
        "- the inside of the funnel mouth glowing hot orange, as if a fire burns down inside it."),
    5: ("LEVEL 5 = base.png (level 4) plus ONLY these additions:\n"
        "- the copper roof scorched: darker red-black panels with glowing orange seams between them (same shape, same size);\n"
        "- heavy black iron CHAINS hanging from the roof tips down to the two teal slabs;\n"
        "- black iron spearhead caps on top of the two teal slabs;\n"
        "- two thin bright streams of lava pouring from under the plinth band at the front into two small square "
        "black iron troughs standing on the ground in front of the plinth, full of glowing lava;\n"
        "- the funnel mouth glowing hotter inside."),
    6: ("LEVEL 6 = base.png (level 5) plus ONLY these additions:\n"
        "- the front of the lava core opened into a FURNACE MOUTH: an arched black iron gate with a spiked arch and "
        "fang-like bars pointing down and up, glaring white-hot fire inside, like the mouth of a demon; it covers the "
        "lower two thirds of the core's front, between the bone horns;\n"
        "- two big curved black iron HORNS on the sides of the funnel rim, curving up and inwards (a horned crown), "
        "staying INSIDE the width of the roof;\n"
        "- black iron armour plates with a few short spikes on the grey stone blocks of the base (the blocks keep "
        "their size and place; the spikes stay short, no wider than the base is now);\n"
        "- the funnel mouth glowing white-hot inside."),
}


def main(level):
    job = FINAL / "jobs" / f"L{level}"
    job.mkdir(parents=True, exist_ok=True)
    if level == 4:
        below = Image.open(B / "itownhall" / "top.c3@2x.webp").convert("RGBA")
    else:
        below = Image.open(FINAL / "work" / f"body{level - 1}@2x.png").convert("RGBA")
    below = below.crop(below.getbbox())
    big = resize_pm(below, (below.width * UPB, below.height * UPB))
    base = Image.new("RGBA", (CW, CH), (0, 255, 0, 255))
    base.alpha_composite(big, ((CW - big.width) // 2, FOOT - big.height))
    base.convert("RGB").save(job / "base.png")
    n = level - 4
    Image.open(HERE / "underhall-levels" / "uB1" / "sheet.png").convert("RGB").crop((n * 512, 0, (n + 1) * 512, 1024)).save(job / "design.png")
    (job / "prompt.txt").write_text(f"""Generate an image using your image generation tool (one image only, do not make variations or extra files). Do not write code.

The attached images:
- base.png (1024x1536): the UNDER HALL, the town hall of the Inferno (the monsters' underground lava world in the isometric game Backyard Monsters Revamped) at level {level - 1}, exactly as it is in the game, enlarged, on green. This picture is APPROVED.
- design.png: the rough approved design sketch for level {level}: it shows WHICH parts are added at level {level} and where. Its proportions, size, colours and contrast are WRONG (too tall, too dark, too contrasty, and it has a flame): take only the list of additions from it, never its body.

Job: this is an EDIT of base.png. Reproduce base.png and add the level {level} upgrades to it.

{ADD[level]}

RULES (most important):
- Everything that is in base.png stays EXACTLY as it is: the same size, at the same place in the canvas (the stone base stands on the same pixels, the same ground line, the building is not taller, not wider, not moved, not re-proportioned, not mirrored), the same colours, the same brightness, the same contrast, the same soft clean edges without any dark outline. If base.png and your picture were laid over each other, the stone base blocks, the teal slabs, the round plinth, the bone horns, the lava core, the iron cage, the copper roof, the brass funnel and the thin bone spikes must coincide.
- Only the additions listed above are new. Paint them in the same finish as base.png: crisp, polished, almost rendered hand-painted digital art, smooth shading, glossy highlights, small rivets, soft light from the upper left, ambient occlusion in gaps, clean sharp edges, no thick black outline, no cel shading. Black iron is dark grey-blue steel with soft highlights, not pure black, no heavier outlines than base.png has.
- NO FLAME, no fire, no embers and no smoke above the funnel: the top of the funnel is its open mouth, only glowing inside. (The flame is added later as a separate animation.)
- Do not add anything that is not in the list. Do not widen the building.

Output: ONE image, 1024x1536, the building alone, at the same place and scale as in base.png.
Background everywhere: flat pure green #00FF00, also between the feet, horns, chains and spikes. No ground, no lava pool, no shadow on the ground, no grid lines, no text, no labels. The building contains no bright pure green.
Save the final PNG as sheet.png in the current working directory.
""")
    print("ready", job)


if __name__ == "__main__":
    main(int(sys.argv[1]))
