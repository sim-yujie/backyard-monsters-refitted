# Painted monster and champion portraits

The web client shows painted portraits for monsters and champions wherever a portrait appears (issue #34). Battle and yard sprites are still the original sprite sheets ([monster-sprites.md](monster-sprites.md)).

**Credit:** the portraits were generated with Google Gemini (through Antigravity's image tool), using the original Kixeye Backyard Monsters art as the reference image for each one. The prompt asked Gemini to keep each creature's shape, pose, camera angle, colours and feature counts and only sharpen the painting. The owner reviewed and approved every one before it went in. The original art remains Kixeye's and stays in `server/public/assets/monsters/`, unchanged.

## What exists

| Set | Source painting | Published files (`web/public/portraits/`) |
| --- | --- | --- |
| 26 monsters: C1-C17, C19, IC1-IC8 | 1264x848 on a painted grey ground | `<id>.webp` card, 360x240; `<id>-icon.webp`, 112 px square around the creature |
| Champions G1-G4, levels 1-6 | 1024 square, background cut out | `G<n>-L<l>.webp`, 176 px, whole frame; `G<n>-L<l>-icon.webp`, 72 px, trimmed to the creature |
| Krallen (G5) | one painting | `G5.webp` and `G5-icon.webp`, used at every level |

Sizes are twice what the UI draws, for sharp displays. A monster card is drawn up to 96 px tall, icons at 24-56 px, a champion at 56-88 px and its icon at 36 px. The champion files keep the whole frame, so the creature grows with its level as it does in the original `G<n>_L<l>-150.png` art. The set is 100 WebP files, about 630 KB.

Korath (G4) level 6 is not painted yet, so that level shows the original art.

## How the game picks one

`web/src/game/portraits.ts` lists which paintings exist (`PAINTED_MONSTERS`, `PAINTED_CHAMPION_LEVELS`). It returns the painted file plus the original as a fallback, and `showPortrait` switches an image to the original if the painting fails to load. A monster or champion level with no painting gets the original directly. The Monsters button on the yard dock keeps its original Pokey cut-out, because it is a button glyph on a dome rather than a portrait.

## Adding or replacing a painting

1. Put the approved files in the source folder, named as `web/tools/gen-portraits.py` describes (`<id>-new2.png` for a monster, `G<n>-L<l>-new2-cut.png` for a champion level, `G<n>-new2-cut.png` for level 3).
2. From the repo root: `python web/tools/gen-portraits.py <source folder>`. It rewrites `web/public/portraits/` and names any champion level it could not find.
3. Add the new id or level to `web/src/game/portraits.ts`, and update the count in `portraits.test.ts`.
4. Run `cd web && npx vitest run src/game/portraits.test.ts`. It checks that every listed file exists.
