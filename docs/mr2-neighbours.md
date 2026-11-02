# Map Room 2 neighbour defence bonus

Beta 6 plan item 6. A Map Room 2 cell defends better the more friendly cells sit next to it.

- A player's cell (main yard or outpost) counts **that player's own** cells around it (0 to 6).
- A wild monster camp counts camps **of its own tribe** around it.

Built on branch `feat/mr2-neighbours` behind the switch `MR2_NEIGHBOUR_BONUS` (off by default).
Waiting for the owner. Not merged.

## Recommendation

1. **Boost both building health and tower damage, by the same amount.** Health alone does little
   against armies the towers cannot hurt much. Tower damage alone does nothing against flying armies.
   Both together work against every army. +8% of each makes an attacker bring about **13% more army**.
2. **Stack in shrinking steps: +8, +6, +4, +2, +2, +2.** That is +8 / 14 / 18 / 20 / 22 / 24% for 1 to 6
   neighbours. One neighbour matches the owner's x1.08 idea. A cell ringed by six friends needs about
   **30% more army**. That is tough, but nowhere near Map Room 3's 75% wall.
3. **Tribes: decide first.** With today's map, about **90% of camps have exactly one same-tribe
   neighbour, and none have more** (see "Tribes" below). So the tribe rule is really "+8% on almost
   every camp". Either accept that, or start with players only (`MR2_NEIGHBOUR_BONUS=players`).

## How the numbers were worked out

Every number comes from the real battle code (`web/tools/mr2-neighbours/study.ts`). Each fight was run with
5 different random seeds and averaged.

- **Defences:** the strongest camp of each MR2 tribe (Kozu, Legionnaire, Abunakki, Dreadnaut, from the
  game's tribe yard data), and a built-up player main yard (the test sandbox yard).
- **Armies:** one full level 6 Flinger load (4,000 space), monsters at academy level 6:
  - **Daves:** 25 Daves.
  - **Ground mix:** 20 Crabatrons, 40 Fangs, 50 Finks and 140 Pokeys.
  - **Air:** 40 Teratorns and 20 Zafreetis.
  - Each army lands in two halves from two sides.
- **"Army needed"** is the smallest army (in 5% steps of a full load) that destroys 90% of the yard on
  average. A bonus that raises it from 1.00 to 1.13 loads means the attacker needs 13% more monsters.

### Extra army needed, by bonus (average of 5 contested fights)

| Bonus | Abunakki vs Daves | Dreadnaut vs Daves | Dreadnaut vs ground mix | Player vs air | Kozu vs ground mix | **Average** |
|---|---|---|---|---|---|---|
| none (army needed) | 1.15 loads | 0.75 | 2.35 | 0.70 | 1.05 | |
| health +8% | +4% | 0 | +9% | +7% | 0 | **+4%** |
| tower damage +8% | +4% | +13% | +6% | +7% | 0 | **+6%** |
| both +8% | +13% | +13% | +11% | +29% | 0 | **+13%** |
| both +14% | +22% | +13% | +15% | +29% | +10% | **+18%** |
| both +18% | +26% | +27% | +17% | +29% | +10% | **+22%** |
| health +24% | +13% | +13% | +11% | +43% | +5% | **+17%** |
| tower damage +24% | +13% | +20% | +15% | +7% | +10% | **+13%** |
| both +24% | +30% | +40% | +17% | +43% | +19% | **+30%** |
| both +32% | +43% | +47% | +26% | +43% | +29% | **+37%** |
| both +48% | +65% | +60% | never wins* | +79% | +38% | **+60% or more** |

\* Even 3 full loads of the ground mix did not reach 90% on the Dreadnaut camp.

The two halves add up: health +24% (+17%) plus damage +24% (+13%) is about both +24% (+30%).

What else changes:

- **Attacks that win easily take longer.** Only the health part does this. Example: Dreadnaut camp
  against 60% of the air army, time to 90%: 235 s with no bonus, 250 s at +8%, 285 s at +24%,
  330 s at +48%. Tower damage did not change that time, because few flyers died.
- **Close attacks cost more monsters.** Example: Abunakki camp against 1.3 loads of Daves: monsters
  lost go from 71% (no bonus) to 96% at both +8%, and 100% from both +16%.
- **Huge armies barely notice.** 25 Daves still flatten the Kozu camp in about the same time at any bonus.

### Options: what it boosts x how it stacks x cap

Extra army needed at 1, 3 and 6 neighbours, from the table above (5% steps, so about ±5%).

| # | Boosts | Stacking | Cap | 1 neighbour | 3 neighbours | 6 neighbours |
|---|---|---|---|---|---|---|
| A | health only | +8% each | none (+48%) | +4% | +17% | HEALTH48 |
| B | tower damage only | +8% each | none (+48%) | +6% | +13% | DAMAGE48 |
| C | both | +8% each | none (+48%) | +13% | +30% | +60% or more |
| D | both | +8% each | 3 neighbours (+24%) | +13% | +30% | +30% |
| **E** | **both** | **+8, +6, +4, +2, +2, +2** | **+24% at 6** | **+13%** | **+22%** | **+30%** |
| F | both (sibling study, Design C) | +5% each | 3 neighbours (+15%) | about +8% | about +19% | about +19% |
| G | health only, Map Room 3 table | damage cut 7, 13, 23, 35, 50, 75% | 75% cut | +4% | about +20% | 4x health: a fortress |

Why E:

- A and B each leave one kind of army almost unaffected (A: armies that kill towers; B: flyers).
- C rewards packing six outposts around one cell far too much: a solo attacker cannot answer +60%.
- D is fine but makes the 4th to 6th neighbour worth nothing. E keeps every neighbour worth something,
  but less each time.
- F is gentle; a single neighbour (+5%) is hard for players to notice.
- G (Map Room 3) was built for a map where fortifications exist only to protect. On Map Room 2 it would
  make ringed main yards nearly unattackable.

## Tribes

A camp's tribe comes from its position: tribe = (x + y) mod 4. On Map Room 2's six-sided grid only one
of a cell's six neighbours has the same x + y, so **a camp can have at most one same-tribe neighbour**.
It loses it only when that cell is water or a player's cell. Sampled over two whole worlds, **about 90%
of land camps have it**.

So the tribe rule, as asked, is close to "every camp gets +8% health and damage". Average effect:
about 13% more army against nearly every camp. Choices:

1. Keep it: tribes get a little harder everywhere, except next to water and players (`MR2_NEIGHBOUR_BONUS=on`).
2. Players only for now (`MR2_NEIGHBOUR_BONUS=players`): camps play exactly as today.
3. Change the tribe rule, e.g. count any camp around it (0 to 6, fewer near water and players).
   That is a small change if wanted.

## How it works in the game

- **Switch:** `MR2_NEIGHBOUR_BONUS` in the server's `.env`: `on` (every Map Room 2 cell), `players`
  (players' cells only), anything else or missing is off. Restart the server after changing it.
- **Off = exactly today.** The attack load adds nothing, so every battle runs as before. Proven by
  tests: a battle with no bonus gives the same result fingerprint, and the stored defence replay
  test still replays to the same result.
- **On:** when an attack starts on Map Room 2, the server counts the friendly neighbours and stores the
  count with the attack. The player's game and the server's re-check both read that same count, so both
  fight the same battle.
- **Tower damage:** every tower shot is multiplied (on top of Tower Overdrive).
- **Building health:** each hit on a building is divided by the bonus (1.08 means each hit does 1/1.08).
  Health bars, stored health and loot stay as they are; the building just takes longer to destroy.
- **Not boosted:** traps, Monster Bunker monsters and caged champions.

## Not done yet

- Players cannot see the bonus anywhere. If the owner wants it, the Map Room 2 cell pop-up and the attack
  screen would need an icon with "+8%" (painted icon, per the icons rule).
- Not tried in a live game. The tests cover the battle, the count and the switch.

## Files

- `web/src/game/combat/rules/engine.ts`: the battle option `defenceBonus` (tower damage up, building damage down).
- `web/src/game/combat/rules/defence.ts`: the table `NEIGHBOUR_DEFENCE_BONUS` and the count in the stored defence.
- `server/src/services/maproom/v2/neighbourDefence.ts`: counting the friendly neighbours.
- `server/src/config/MapRoom2Config.ts`: the switch.
- `server/src/controllers/base/load/modes/baseModeAttack.ts`: adds the count when the switch is on.
- `web/tools/mr2-neighbours/study.ts`: the calculation. Run from `web/`: `bun tools/mr2-neighbours/study.ts need`.
