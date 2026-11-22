#!/bin/bash
# The Classic tier plates (beta 9, desk card b9-tier-look A): how plate.t1-3@2x.png were made (22 Nov 2026).
# Codex call p2 (p1 was the first try: tiers 1 and 2 both had dark faces), cut row 2 (the thicker bars), pad to 52x34.
set -e
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
W=$(cd "$(dirname "$0")/../.." && pwd)
cd "$(dirname "$0")"
mkdir -p refs p2
cat > refs/towers.txt <<'LIST'
Cannon Tower=assets/buildings/cannontower/top.3.png
Sniper Tower=assets/buildings/snipertower/top.3.png
Tesla Tower=assets/buildings/lightningtower/top.3.png
Laser Tower=assets/buildings/lasertower/top.1.png
Railgun=assets/buildings/railguntower/top.3.png
Aerial Defense=assets/buildings/flaktower/top.3.png
Monster Bunker=assets/buildings/bunker/top.1.damaged.png
Magma Tower=assets/buildings/imagmatower/top.1.v2.png
LIST
python3 $S/ref_sheet.py --repo $W --zoom 3 --cols 4 --list refs/towers.txt --out refs/ref-flash-towers-3x.png
cat > p2/prompt.txt <<'PROMPT'
Generate an image using your image generation tool (one image only, do not make variations or extra files).

The attached image ref-flash-towers-3x.png shows REAL defence towers of the 2009 Flash game Backyard Monsters, enlarged 3x from their tiny in-game size. Study their materials closely: worn painted steel, dull brushed metal, brass/bronze fittings, red-and-white hazard paint, small bolts.

Job: small RANK PLATES that will be bolted onto these towers to show the tower's tier (1, 2 or 3). They must look made by the same artists with the same 3D software as the towers, so they read as part of the game world, not as a modern UI badge.

Style (follow every point):
1. Not flat cartoon or vector art: small PRE-RENDERED 3D objects (late-2000s CG, like a 3ds Max render) with soft grain, slightly worn and dusty metal, gentle scuffs on the edges.
2. Each plate faces the viewer almost straight on (only a slight tilt), so its rank marks read clearly.
3. No outline. Light from the upper left: the top-left bevel catches a soft highlight, the lower and right edges fall into deep near-black shadow. Gentle ambient occlusion around the bolts and rank marks.
4. Muted, dusty palette, fairly dark overall; no neon, no glow, no glossy mobile-game shine.
5. No text, no letters, no digits. The rank is shown ONLY by 1, 2 or 3 raised vertical bars (thick, upright, evenly spaced rectangular slats embossed out of the plate, like military rank insignia, so they read as I / II / III).
6. Shape: a small wide rectangular metal tab with clipped (chamfered) corners, about 3 units wide by 2 units tall, a thick raised rim, and one tiny bolt in each corner. The bars must be big and high-contrast against the plate so they still read when the plate is shrunk to 26 x 18 pixels.

Canvas 1536x1024 split into 3 columns x 2 rows of equal cells (512x512 each). One plate centred in each cell, about 60% of the cell width, generous margins, nothing touching a cell edge:
- Row 1, column 1: TIER 1: the WHOLE plate face is plain mid-grey worn steel (clearly lighter than the tier 3 plate), 1 bar in pale cream/bone colour.
- Row 1, column 2: TIER 2: the WHOLE plate face, rim AND centre, is warm old bronze / brass (a mid brown-orange metal, clearly warmer and brighter than tier 1 and tier 3), 2 bars in bright pale gold that stand out against the bronze.
- Row 1, column 3: TIER 3: the whole plate face is dark gunmetal / charcoal iron with a thin bright gold inner rim line, 3 bars in bright gold.
- Row 2: the same three plates again (tier 1, tier 2, tier 3, left to right), identical in shape and colours, but the bars are a little thicker and the rim a little thinner, so the bars fill more of the plate.
All six share the exact same size, angle and lighting.

The whole sheet on a flat solid magenta (#FF00FF) background, no grid lines, no text, no labels, no frame, no drop shadows.
Save the final PNG as sheet.png in the current working directory.
PROMPT
bash $S/run_codex.sh p2 refs/ref-flash-towers-3x.png
python3 $S/cut_sheet.py p2/sheet.png --cols 3 --rows 2 --out out2 --names a1,a2,a3,t1,t2,t3 --height 17,17,17,17,17,17
for t in 1 2 3; do python3 -c "
from PIL import Image; import sys
im = Image.open(\"out2/t$t@2x.png\").convert(\"RGBA\"); c = Image.new(\"RGBA\", (52, 34), (0, 0, 0, 0)); c.paste(im, (0, 0))
c.save(\"$W/server/public/assets/buildings/tierplates/plate.t$t@2x.png\", optimize=True)"; done
