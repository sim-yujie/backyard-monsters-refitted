#!/bin/bash
# Constellation star art (owner 12 Nov: "stars, not just yellow dots"). Run from this folder.
# 1. Reference sheet of the game's real painted icons + Wormzer's card.
python refs.py
# 2. One Codex call: 3 designs (rows A faceted medal star, B twinkle sparkle, C puffy star) x lit / unlit / next.
bash C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts/run_codex.sh s1 refs/ref-icons.png
# 3. Cut: 80x80 2x pictures (40 px star + baked glow) and 24x24 small ones, per option.
python make_stars.py s1/sheet.png out1
# 4. Option sheets: Wormzer card at real size (all options) and 3x (one per option), at the in-game sizes.
python compose.py out1 . --lit-size 32 --dim-size 26 --next-size 34
# 5. Chosen: option A -> web/public/ui/stars/star-{lit,dim,next,lit-small,dim-small}@2x.webp (lossless).
