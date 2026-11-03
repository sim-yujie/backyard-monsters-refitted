# Map Room 2 as a Civilization V-style hex map: study

Status: desk only, nothing built. Branch `docs/mr2-civ-study`. Written 2 Nov 2026 by helper mr2-civ-study.

The owner wants Map Room 2 (MR2) to feel like Civilization V's hex map, at much higher fidelity, with
terrain that changes four things: **income, tower range, tower damage and building HP** (the new third
stat). This study gives today's rules, a short Civ V summary, three designs with numbers, a
recommendation, open questions, and mock-up pictures from Codex and Claude (Antigravity was blocked;
see "Mock-ups").

Icon key used in all tables and mock-ups (in-game text stays icons + numbers):
crosshair = tower range, flame = tower damage, shield = building HP, resource pile = income.

---

## 1. Today's rules (one cell = one number: its height)

- Each MR2 cell has one stored height, `world_map_cell.terrainHeight`, made from simplex noise
  (`server/src/services/maproom/v2/generateMap.ts`, `TERRAIN_SCALE = 95`, `NOISE_SCALE = 12`).
  99 and below is water (nobody can stand there), 100-109 sand, 110-169 four grass shades,
  170+ rock (`server/src/enums/MapRoom.ts`, `web/src/game/maproom/cellVisuals.ts` `TERRAIN_BANDS`).
- 125 is neutral (`AVERAGE_ALTITUDE`).
- **Tower range** = `int(height * range / 125)`, only on a player's outpost and only at height 100 and up
  (`web/src/game/combat/rules/stats.ts` `towerRange`). Wild tribe camps load as main yards, so their
  towers ignore height.
- **Outpost income** per harvester = `max(int(produce * 125 / height), 1)`
  (`server/src/services/maproom/v2/autobank.ts` `outpostRate`).
- **Damage and building HP: no terrain effect today.**
- The map is drawn as Flash did: each cell a little hex column standing at its height, one ground tile
  per band (`web/src/game/maproom/ground.ts`, `groundArt.ts`); the far zoom is one texel per cell
  (`TerrainRaster.ts`).

What height does today (from `heightBonus.ts`, the numbers the info popup shows):

| Height | Shown as | Tower range | Income |
|---|---|---|---|
| 100 (sand) | +0 m | -20% | +25% |
| 110 | +10 m | -12% | +14% |
| 125 | +25 m | 0 | 0 |
| 150 | +50 m | +20% | -17% |
| 175 (rock) | +75 m | +40% | -29% |
| 196 (highest seen) | +96 m | +57% | -36% |

Share of cells by band, from one sample world (800 x 800, `getTerrainHeight`, seed "study-seed-1"):
water 26.5% (unusable), sand 10.9%, grass 57.7% (8.8 / 20.0 / 20.1 / 8.8), high grass 1.8%, rock 3.0%.
So almost every outpost sits between 100 and 170: range between -20% and +36%, income between +25% and
-26%. It is one trade-off on one slider; nothing else about a cell matters.

## 2. Civilization V in short (own summary)

Civ V's hex map works because every tile is a **stack of small, readable parts**, each with a fixed,
small number, and the player sees all of it at a glance:

- **Base terrain** sets yields: grassland is food, plains food + production, desert almost nothing,
  coast and ocean food + gold. Flat ground is "open" and gives no defence.
- **Hills** (a layer on any land): production, about **+25% defence** for a unit standing there, cost
  extra movement, and let you **see and shoot over** things in the way (+1 sight).
- **Mountains**: nobody can enter; they block sight. Good only as a wall and for buildings next to them.
- **Features** sit on top: **forest and jungle** give about **+25% defence** and block sight; forest adds
  production. **Marsh** is poor ground (slow, a defence penalty, low yields). Oases and floodplains add
  food.
- **Rivers run along hex edges**, not through tiles. Tiles touching a river get extra gold and fresh water;
  **attacking across a river costs the attacker about 20%**.
- **Resources** are icons on a tile: *bonus* (more of one yield), *strategic* (unlocks units), *luxury*
  (gold and happiness). They are why you settle one spot over another.
- **Combat modifiers stack** and are always listed as short +/- percentages: terrain defence,
  fortifying (+25%, then +50%), flanking (+10% per friendly unit next to the target), a Great General
  nearby (+15%), forts and citadels (+50%). Cities get tougher on hills and with walls.
- **Look**: tilted camera, terrain textures that blend at hex edges, 3D trees and peaks, rivers drawn on
  edges, glowing coloured territory borders, an optional yield-icon overlay, cloud/parchment fog of war,
  and a flat "strategic view" with symbols for the zoomed-out map.

(Numbers are the commonly quoted Brave New World values; I could not open the Civ wiki pages tonight, so
treat the exact percentages as approximate. They are only a guide for scale.)

**How Civ maps onto MR2**

| Civ V | MR2 stat |
|---|---|
| Food / production / gold yields | Income: Twigs, Pebbles, Putty, Goo (per-resource multipliers) |
| Hills: see and shoot over obstacles | Tower range (today's height rule already does this) |
| Defence % on hills, forest | Building HP (the third stat) |
| Ranged attack from high ground, general's bonus | Tower damage |
| Bonus resources on a tile | A cell that pays +50% of one resource |
| Rivers on hex edges, attacker penalty | Optional: income bonus, attack penalty across a river |
| Flanking / adjacent support | Bonus from your own neighbouring outposts (ties to plan item 6) |

---

## 3. Three designs

All numbers apply to a **player's outpost** on that cell (as today's height rule does). Income
multipliers act per harvester like today's `125 / height` and multiply with it. HP applies to every
building in the outpost yard. Range, damage and HP parts add up, then hit the caps in each design.

### Design A: "Height + one feature" (keep Flash's slider, add a feature layer)

Keep today's height rule exactly (range and income). Add **one feature per land cell**, made from a
second noise from the world seed (so no new database column and every client can work it out).
The feature carries the new numbers: building HP, tower damage and a bonus for one resource.

| Feature | Share of land | Shield HP | Flame damage | Crosshair range | Income |
|---|---|---|---|---|---|
| Open (grass, sand) | 55% | 0 | 0 | 0 | 0 |
| Forest | 20% | +20% | 0 | -10% | Twigs +50% |
| Rocks (boulders) | 10% | +10% | +10% | 0 | Pebbles +50% |
| Marsh (goo puddles) | 10% | -10% | 0 | 0 | Goo +50%, Putty +25% |
| Resource node (rare) | 5% | 0 | 0 | 0 | one resource x2 |

Plus height as today: range -20% .. +57%, income +25% .. -36%.

Caps: HP -10% .. +20%, damage 0 .. +10% (the feature alone sets them).

Example: an outpost on a forest cell of height 160 (+60 m): range +28% -10% = **+18%**, income -22% (Twigs +50% on top:
Twigs about +17%), HP **+20%**. A marsh cell of height 105: range -16%, income +19% (Goo about +79%), HP -10%.

- Defender: picks a forested hill for a fortress or a low marsh for a goo farm. The choice is now two
  questions (how high, what grows there) instead of one.
- Attacker: sees the feature icon before attacking; forests are tougher, marshes are soft targets.
- Risks: small. Existing outposts gain or lose a little HP overnight (max +/-20%). The HP number must be
  used by both the client fight and the server's attack checks.

### Design B: "Civ terrain types" (replace the height bands with real terrain)

Each land cell gets **one terrain type** (from height + moisture noise) and the type sets all four stats.
Height stops being a free slider: only Hills carry the range bonus. Mountains become walls.

| Terrain | Share of land | Income | Crosshair range | Flame damage | Shield HP |
|---|---|---|---|---|---|
| Grassland | 25% | +25% all | -10% | 0 | 0 |
| Plains | 20% | +10% all | 0 | 0 | 0 |
| Sand (desert) | 10% | -20% all | +10% | 0 | -10% |
| Forest | 15% | Twigs +50% | -15% | 0 | +25% |
| Hills | 15% | -20% all | +25% | +10% | +15% |
| Marsh | 10% | Goo +50% | -10% | -10% | -15% |
| Mountain | 5% | nobody can settle | outposts next to one: +10% range | | |
| River (on hex edges) | | +15% for cells touching it | | optional: monsters attacking across it -20% | |

Caps: range -15% .. +35%, damage -10% .. +20%, HP -15% .. +25%, income -20% .. +50%.

- Defender: real places to go: hills for towers, forests for walls, grassland or marsh to farm, river
  banks for both.
- Attacker: reads the map like Civ: avoid forest hills, raid grassland farms, mind the river.
- Risks: large. It **replaces** a Flash rule players remember (range from height up to +57%), so every
  existing outpost changes value; the top range drops from +57% to +35%. Needs the world map regenerated
  or a terrain type stored per cell, and new ground art for six types. The river-attack penalty needs a
  rule for which cell an attack comes from, which MR2 does not track today.

### Design C: "Stack like Civ" (height + feature + neighbours + high ground)

Design A, plus two Civ combat ideas, for the most depth:

1. **Support from your own neighbours** (Civ's flanking / Great General): each of your outposts on the
   six cells around this one adds **+5% HP and +5% damage**, at most +15% each. This is the same idea
   as plan item 6 ("MR2 neighbour defence bonus"); C would fold it in.
2. **High ground**: the defender's towers get **+1% damage per 5 m** the outpost stands above the
   attacker's nearest own cell, between -15% and +15%.

| Part | Crosshair range | Flame damage | Shield HP | Income |
|---|---|---|---|---|
| Height (today) | -20% .. +57% | | | +25% .. -36% |
| Feature (Design A) | -10% .. 0 | 0 .. +10% | -10% .. +20% | one resource +50% |
| Own neighbours (0-3+) | | 0 .. +15% | 0 .. +15% | |
| High ground vs attacker | | -15% .. +15% | | |
| **Cap** | +60% | +30% | +30% | -40% .. +60% |

Example: a rocks outpost at height 160 with two of your outposts next to it, attacked from a cell at height 120:
damage +10% (rocks) +10% (two neighbours) +8% (40 m higher) = **+28%**; HP +10% +10% = **+20%**;
range +28%.

- Defender: clusters of outposts on high ground become real strongholds; alliances matter.
- Attacker: wants to attack from high cells and pick off lone outposts first.
- Risks: the most to tune and to explain. A tooltip has 4 icons, each from up to 4 sources. High ground
  needs "where the attack comes from", which MR2 does not record today. Clusters may become too tough
  for solo players; the caps are there to hold that.

### Side by side

| | A: height + feature | B: Civ terrain types | C: stack like Civ |
|---|---|---|---|
| Keeps Flash's height rule | yes | no | yes |
| New stats | HP, damage, per-resource income | all four from terrain | all four, several sources |
| Change to existing outposts | small (+/-20% HP) | large | small, plus neighbour bonus |
| Server work | feature lookup in combat and autobank | terrain type per cell, new rules | A + neighbour count + attack source |
| New art | 3 features on today's ground | 6 terrain types + rivers + mountains | as A |
| Tooltip | 4 icons, 1-2 sources each | 4 icons, 1 source | 4 icons, up to 4 sources |

---

## 4. Recommendation

**Design A now, with C's neighbour part when plan item 6 lands.**

- A keeps the Flash height rule players remember and adds the third stat (HP) and tower damage through
  a feature layer that needs no new database column (it comes from the world seed, like the height does).
- It gives the Civ look the owner wants without new rules: forests, rocks, marsh, rivers drawn on hex
  edges, glowing borders, resource nodes and fog. All of that is art on top of today's cells.
- C's neighbour support is the same idea as item 6, so adding it later costs little. C's high-ground part
  needs an "attack comes from" rule first; leave it until that exists.
- B is the most Civ-like on paper but throws away a Flash rule and re-prices every outpost. Not worth it.

For the art, the Codex mock-ups are far ahead (see below). If the owner wants this look, the realistic
path is painted tiles and feature sprites from Codex, cut to hexes, plus a strategic-view symbol set for
the far zoom (today one texel per cell).

## 5. Open questions for the owner

1. A, B or C (or A now, C's neighbour bonus later)?
2. Should the feature also apply to **wild tribe camps** (today their towers ignore height)?
3. HP and damage changes: new outposts only, or **all existing outposts** at once?
4. Mountains you cannot settle (Civ style): yes or no? (Today rock cells are settleable.)
5. Rivers: art only, or also +income / an attack penalty?
6. Hex card: is the single word (e.g. "Hills" or "Forest") OK, or icons and numbers only?
7. Which AI's style to pursue: Codex (painted, detailed), or should Antigravity be run first for a
   fair three-way comparison (needs your permission, see below)?

---

## 6. Mock-ups (clearly mock-ups, not the game)

Same brief to every AI: three pictures (1 close view, 2 hex info card, 3 zoomed-out strategic view).
Pictures are in the worktree (git-ignored `shots/`), at full size:

| | Codex | Antigravity (agy) | Claude |
|---|---|---|---|
| 1 Close view | `shots/mr2-civ-study/codex/codex-1.png` | blocked | `shots/mr2-civ-study/claude/claude-1.png` |
| 2 Hex info card | `shots/mr2-civ-study/codex/codex-2.png` | blocked | `shots/mr2-civ-study/claude/claude-2.png` |
| 3 Strategic view | `shots/mr2-civ-study/codex/codex-3.png` | blocked | `shots/mr2-civ-study/claude/claude-3.png` |

Comparison sheets: `shots/mr2-civ-study/compare-all.png` (all three columns, 2480 x 1652) and
`compare-1.png` .. `compare-3.png` (Codex beside Claude, large, one picture each).

The numbers in the pictures are Design B's Hills row (+25% range, +10% damage, +15% HP, -20% income);
they are there to test how icons + numbers read, not as final values.

Quick read of the results:
- **Codex**: painted, detailed, close to a modern mobile 4X: real hills with cliffs, rivers with
  waterfalls, glowing borders, the requested icon strips and an "info card" that looks ready to ship.
  It followed the brief closely (icons, numbers, single word). Each picture took about 90 s.
- **Claude** (drawn by a Python/Pillow script, `shots/mr2-civ-study/claude/draw_mockups.py`): clean,
  flat, readable, exact to the numbers, but it is a diagram rather than game art. Useful for layout and
  for checking that icons + numbers read at size, not for the final look.
- **Antigravity**: **blocked (needs owner permission)**. Picture generation in headless agy needs the
  "skip permissions" switch (`--yolo`), which the session's safety check refused for a background helper.
  Without it agy replied that it was generating but saved nothing (three tries, no file).

### How each AI was called, and the prompts

Shared brief: `shots/mr2-civ-study/style.txt` plus `shot1.txt` / `shot2.txt` / `shot3.txt`
(committed). Each call's full prompt is saved next to its picture: `codex/prompt-N.txt`,
`agy/prompt-N.txt`. The brief:

> CONTEXT: concept mock-up (not a screenshot) for the world map of a cartoon base-building strategy game
> about monsters in a backyard. The world map is a hex grid; every hex is a patch of ground at some
> height, and some hexes hold a small outpost (a little cluster of chunky cartoon huts, one resource
> harvester, one or two defence towers and a wooden fence). The goal is to show how the map could feel
> like Civilization V's hex map, at high fidelity: textured terrain that blends between hexes, real hills
> that rise, 3D trees, rivers along hex edges, glowing coloured territory borders, soft fog of war.
> ART STYLE: bright, painted, toy-like cartoon (2010s Flash-era casual strategy game, chunky outlines,
> warm sunlight from the top-left, saturated greens and sandy yellows), seen from a Civilization V style
> tilted top-down camera (about 45 degrees). Clean and readable, not photo-real, no people.
> TEXT RULE: no words, no logos, no watermark. Only short numbers next to small painted icons (like
> "+25%" or "-20%"), plus at most ONE word where stated.
> ICON KEY (draw icons as small painted game icons, not line icons): crosshair = tower range, flame =
> tower damage, shield = building HP, gold pile of twigs/pebbles = income.
>
> PICTURE 1 - CLOSE VIEW, 16:9 landscape (about 1600x900). About 9 x 6 hexes fill the frame. Terrain,
> left to right: deep blue water with a sandy shoreline hex row; flat green grass meadow hexes; a raised
> hill hex (clearly higher, grassy slopes with a little cliff); a forest hex packed with round cartoon
> trees; a marsh hex with bright green goo puddles and reeds; one tall grey rocky mountain peak hex
> (nobody can stand on it); a blue river running along hex edges (between hexes, not through them) from
> the mountain to the sea. Three outposts: one on the hill with a glowing CYAN territory border around it
> and its 2 neighbour hexes ("yours"); one on the grass with a RED border (enemy player); one in the
> forest with a PURPLE border (wild monster tribe). Under each outpost hex, a small dark rounded strip
> with 2-3 icons and numbers: hill = crosshair +25%, shield +10%, pile -20%. Grass = pile +25%. Forest =
> shield +25%, crosshair -10%. Soft white fog-of-war clouds along the right edge. Thin subtle hex
> outlines everywhere.
>
> PICTURE 2 - HEX INFO CARD, 16:9 landscape (about 1600x900). Camera zoomed in on ONE raised hill hex
> holding the cyan-bordered outpost (huts, harvester, a tall tower, fence), with its six neighbour hexes
> visible around it (grass, forest, river edge, water corner). To the right of the hex, a chunky painted
> game panel (wood-and-steel frame, dark inside) with the single word "Hills" at the top, then four rows,
> each one painted icon + number only: crosshair +25% / flame +10% / shield +15% / pile of
> twigs/pebbles -20%. Also a small height badge on the hex: a mountain-arrow icon with "+48m". Nothing
> else written.
>
> PICTURE 3 - ZOOMED-OUT STRATEGIC VIEW, 16:9 landscape (about 1600x900). About 40 x 22 small hexes. A
> continent with coasts, a long river, a mountain range, forests, marshes, plains and hills, drawn with
> small painted terrain symbols on each hex (little trees, peaks, waves, reeds). Five territories with
> glowing coloured borders (cyan, red, orange, green, purple), each a blob of 5-15 hexes around small
> outpost icons. The outer quarter of the map is covered by soft painted fog-of-war clouds. A few
> bonus-resource hexes stand out with a small glowing resource icon (a twig bundle, a pebble heap, a
> putty blob, a goo drop). No words.

- **Codex** (codex-cli 0.166.0), one call per picture, run in an empty folder; the image is copied from
  `~/.codex/generated_images/<session id>/` (same method as `web/tools/champ-l2-kit/run.sh`):
  first line of the prompt "Use your image generation tool (one call) to create ONE new image and save
  it as mockup.png in the current folder. Do not write code, do not draw with scripts." then the brief.
  Command: `codex exec --skip-git-repo-check --sandbox workspace-write - < prompt.txt`
- **Antigravity** (not run): first line "Use your image generation tool to create ONE new image and
  save it as <folder>/mockupN.png (Windows path; create nothing else). Do not write code and do not
  draw with scripts." then the brief. The command that works for pictures in this project
  (`web/tools/bolt-kit/run.sh`) needs owner permission because of `--yolo`:
  `bash ~/.claude/scripts/agy-delegate.sh --write --yolo --timeout 15m --dir "<empty folder>" -- "$(cat prompt-N.txt)"`
- **Claude**: the brief was turned into `shots/mr2-civ-study/claude/draw_mockups.py` (Pillow + numpy,
  about 1.5 min for all three). Run `python draw_mockups.py` in that folder.

No "before" screenshot of today's Map Room 2 (optional): the shared test browser was busy while the
pictures were made, and when it freed up, taking the shot would have meant a full server and web install
in this docs-only worktree, so I left it out.

---

## 7. Built: design A (branch `feat/mr2-land`)

The owner approved design A ("Go with A"; 3 Nov: "Start on map room 2, and the different types of land").

- **Switch:** `MR2_LAND_FEATURES=on` in the server's `.env`. Off (the default) = exactly today: no `lf` on the
  map, no `land` in any attack's defence, income unchanged, no map art (the art only draws a cell's `lf`).
- **Which feature:** `server/src/services/maproom/v2/landFeature.ts`, from a second simplex noise seeded
  with the world id + `#land`, plus a cell hash for the rare resource nodes. Water has none. Measured on
  sample worlds: 55% open, 20% forest, 10% rocks, 10% marsh, 5% nodes (1.25% each resource). Rocks lean
  to high ground, marsh to low ground. No database column; every server and client gets the same answer.
- **What it does** (`web/src/game/combat/rules/landFeatures.ts`, shared with the server):
  Forest +20% building health, -10% tower range, Twigs +50%. Rocks +10% health, +10% tower damage,
  Pebbles +50%. Marsh -10% health, Putty +25%, Goo +50%. Node: one resource x2.
- **Who gets it:** a player's outpost and a wild monster camp; not a main yard (the study's table, as the
  height rule).
- **Stacking:** range = height rule, then `int(range * (100 + pct) / 100)`. Income = height rule, then the
  same per resource (never below 1). Health and damage multiply with the neighbour bonus:
  `(1 + neighbour) x (1 + feature)`.
- **Battle path:** the attack load adds `land` to the defence it freezes into the attack session
  (`baseModeAttack.ts`), so the player's game and the server's re-check fight the same battle; the engine
  reads it through `defenceBonus` (with a new `range` part). `landfeature` on the load feeds the yard's
  range rings.
- **Pop-up:** `web/src/ui/maproom/landFeatureRow.ts`: the feature's painted picture, then icons + numbers.
