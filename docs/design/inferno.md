# Inferno — Design

A design document for beta.5+ "Inferno": the underground second yard from Flash, with its own
economy, monsters, map, PvP, quests, and the surface Quake/Magma Towers and siege that it unlocks.
The owner's answers I1-I16 and R1-R12 (2026-10-24, `OWNER-QUESTIONS.md` "Recently answered") set
the scope: the full Flash Inferno, Flash prices and times, with four owner changes (buyable
workers, a real Descent burn, bunker attack size, a few Shiny quest prizes).

All citations are `path:line` relative to the repository root; Flash code is under
`client/scripts` (written as `X.as:line`). Anything new is a proposal. Owner changes to Flash are
marked **[OWNER]**. Numbers not yet playtested are marked `[PLACEHOLDER]`.

Contents:

1. [Summary for the owner](#1-summary-for-the-owner)
2. [Rules (exact to Flash)](#2-rules-exact-to-flash)
3. [Server design](#3-server-design)
4. [Screens and art](#4-screens-and-art)
5. [Slices and work packages](#5-slices-and-work-packages)
6. [Open questions](#6-open-questions)
7. [Later ideas](#7-later-ideas)

---

## 1. Summary for the owner

- **How you get in (as in Flash).** At Town Hall 5 a cave appears on your yard. Over five
  earthquakes, at least 12 hours apart, Moloch's monsters burst out and raid you. Win or lose, each
  raid counts. After the fifth, you can go down: the **Descent** is 13 Moloch yards in a row; beat
  each one (90% damage) to reach the next. After the 13th you capture your own **Inferno yard**.
- **The Inferno yard.** A second yard on lava with its own four resources (Bone, Coal, Sulfur,
  Magma), its own buildings (Under Hall instead of Town Hall), one worker (up to 5 with Shiny:
  250/500/1,000/2,000; Flash allowed only 1), and its own eight monsters. Shiny is shared with the
  surface.
- **Prices and times.** Exactly Flash: costs (Juicer included), build/upgrade and training times
  (King Wormzer 48 days), entry raids 12 h apart with no reward, Descent prizes, Moloch yard loot,
  full-strength Quake Towers in the Descent ("weak armies shouldn't start the Inferno").
- **Owner changes to Flash.** From Descent yard 7 the toxicity is a real **burn** that hurts
  surface monsters only (Inferno monsters and Korath are immune), shown with the new status icons;
  attack size from the Inferno yard = what the Housing Bunkers hold; a few small Shiny prizes in
  Inferno quests; buyable workers (above).
- **What you can do there.** Build and upgrade, unlock and train Inferno monsters, attack Moloch
  tribes and real players on the Inferno map, do 38 Inferno quests, earn 4 achievements.
- **What it gives the surface.** Moving Inferno monsters up to your main yard (one way, free);
  Quake and Magma Towers and the Siege Factory/Lab on your main yard (unlocked by the Descent,
  limited by your Under Hall level); Korath, the fourth champion, unlocked once you own an
  Inferno yard.
- **Safety.** The server decides everything (when a raid is due, who won, what you looted, what
  you can afford). The old Flash Inferno routes stay closed; new checked routes replace them.
- **Phones.** Every new screen works on phones from day one.
- **Not now.** Korath's three extra powers (no events shop yet), computer-run neighbours on the
  Inferno map (#383), outposts and conquering (long-term goal, section 7).
- **Build order.** 7 slices, 54 work packages (each about half a day for one helper) plus an art
  track. Slice 1 (getting in and owning the yard) is the biggest: 23 packages.
- **Biggest risks.** The fight engine has no Quake or Magma Tower yet and the Descent yards use
  them from the 3rd base on; the burn waits for the status-icon job (`feat/status-icons`); siege
  weapons are a whole new system; lots of new art (portraits, icons, build pictures, map art) needs
  your approval.
- **Questions for you:** none open (all answered 2026-10-24, 2.1). The burn strength and the
  Shiny quest amounts are suggestions to check in play tests.

---

## 2. Rules (exact to Flash)

### 2.1 Owner decisions (2026-10-24)

First round (I1-I12):

| # | Decision | Effect on the build |
|---|---|---|
| I1 | The full Flash Inferno | Everything in this section |
| I2 | Keep all 3 entry steps (TH5, 5 emergence raids, 13-base Descent) | Slice 1 |
| I3 | Separate economy, shared Shiny; Inferno workers buyable | **[OWNER]** Flash gives 1 worker, none buyable (`QUEUE.as:31-41`; a main player complaint). Own ladder like the surface BEW: 250/500/1,000/2,000 Shiny, max 5 (`server/src/controllers/yard/shopBuy.ts:60`). Confirmed |
| I4 | Monster transfer as in Flash | 2.7 |
| I5 | Inferno PvP with real players | Slice 3 |
| I6 | Quake/Magma Towers and siege as in Flash | Slice 6; siege panel comes back (hidden since 2026-10-10) |
| I7 | Inferno quests and achievements as in Flash | Slice 4 |
| I8 | Restart Inferno monster repaints, after champion art | Art track A4 |
| I9 | No Inferno outposts or conquering for now | Long-term goal, section 7 |
| I10 | Korath unlocks on the surface once the player has an Inferno yard; message on the next surface visit; hatch in the champion cage | **[OWNER]** Slice 5 |
| I11 | Old routes closed (done in beta.4) | Replaced in 3.4, deleted in S7 |
| I12 | Inferno screens work on phones from day one | Every screen WP |

Second round (I13-I16, R1-R12). Anything not listed is exact Flash:

| # | Decision | Effect on the build |
|---|---|---|
| I13 | Korath's Burn, Breath of Fire, Fists of Doom: leave out for now (no events shop) | Not built; section 7 |
| I14 | The five emergence raids use Flash rules, not our wild-raid rules | 2.3; WP 1.8-1.9 |
| I15, R8 | Descent toxicity becomes a real **burn**, surface monsters only; Inferno monsters and Korath immune; uses the status-icon system | **[OWNER]** 2.4; WP 1.21 |
| I16, R1, R2 | All Inferno prices exact Flash, Juicer L1 1M/1M/1M included | 2.5 |
| R3, R4 | Build/upgrade and academy times exact Flash (King Wormzer 48 days) | 2.5, 2.6 |
| R5 | Entry raids exact Flash: 12 h apart, no reward | 2.2, 2.3 |
| R6 | Descent rewards exact Flash (no extra per-yard or milestone prizes) | 2.4 |
| R7 | Moloch map yard loot exact Flash | 2.7; smooth loot + daily bonus in section 7 |
| R9 | Quake Towers in the Descent at full Flash strength | WP 1.3, 1.6 (no softening) |
| R10 | No computer-run neighbours on the Inferno map now | Ticket #383; WP 3.1 real players only |
| R11 | Attack size from the Inferno yard = what the Housing Bunkers hold | **[OWNER]** 2.5; WP 2.8, 3.2 |
| R12 | A few small Shiny prizes in Inferno quests | **[OWNER]** 2.8 (amounts are a suggestion); WP 4.2 |

### 2.2 The cave and the emergence

| Rule | Value | Cite |
|---|---|---|
| Cave shows | Town Hall >= 5 or emergence level > 0; tutorial done (`TUTORIAL._stage > 200`) | `INFERNO_EMERGENCE_EVENT.as:13`, `:212` |
| Below TH5 | Cave answers with an RSVP note (`cavern_pop1/2`) | `INFERNO_EMERGENCE_POPUPS.as` |
| Cave building | id 127, fixed grid point (-1200,-150), 190x160, not movable/exported; level = emergence level | `INFERNOPORTAL.as:200-215` |
| Levels | 5 (one per raid) | `INFERNO_EMERGENCE_EVENT.as:53-55` |
| Gap | 12 h (43,200 s) since the last level-up, checked on a main-yard load | `:49-51`, `:111-119` |
| Yard health | Must be > 10% for a raid (`isBaseReadyForAttack`, `:197-210`). Raids 2-5: checked with the 12 h before the cave grows, so a yard at 10% or less keeps its cave as it is until a later load finds it mended (`SetupPortal`, `:98`). First raise (level 0): no check before it, so the cave goes up to 1 and its time is saved, and only then is the raid skipped (`UpgradePortal`, `:172-176`): no earthquake, no warning, no "stage passed" (only `ATTACK.as:1026`, `:1053` show it, after a fight), and the stage counts, so the next raid (12 h on) is raid 2 | `:91-101`, `:166-181` |
| Level 0 | Moloch intro dialogue, then level 1 and raid at once | `ai_moloch_intro` |
| Order | Level and time are **saved before** the raid starts | `UpgradePortal` |
| Warning | "EARTHQUAKE !" text + screen shake 100 | same file |
| Result | Each raid counts, win or lose -> "stage passed" popup; after level 5 "entercavern_popup" | `ATTACK.as:1026`, `:1053`, `english.json:2608` |
| Taunts | `ai_moloch_taunt1-5` | `INFERNO_EMERGENCE_POPUPS.as:66-127` |
| Wild raids | Paused while the emergence is running | `docs/design/wild-raids.md:66-70` |
| Cave at level 5 | Click: Enter (Descent, later "go to Inferno yard") / "Transfer Monsters"; unblocks Magma Tower, Quake Tower, Siege Factory, Siege Lab on the main yard | `INFERNOPORTAL.as:249-256` |

### 2.3 Emergence raid armies

Index = cave level - 1. Scale `f` from the player's base level L: L <= 30: `max(0.01, L/60 - 0.25)`;
L > 30: `clamp((L-30)/16 + 0.25, 0.25, 1)`. All waves from bearing 186 degrees; the 4th field is the
spread. Spawned through `WMATTACK.SpawnA/SpawnB`, so Flash's raid strength 0.4-0.9 (by points and
base value) applies (`WMATTACK.as:723-753`). Source: `INFERNO_PORTAL_ATTACK.as:8-49`.

| Raid | Monsters (type x count) |
|---|---|
| 1 | IC1 ceil(25f) x 2 groups, IC2 floor(50f), IC3 floor(15f) |
| 2 | IC1 ceil(45f), IC2 ceil(60f), IC3 floor(25f), IC5 floor(10f) |
| 3 | IC1 ceil(65f), IC2 ceil(60f), IC7 floor(15f), IC5 floor(15f), IC4 ceil(10f) |
| 4 | IC2 ceil(65f), IC6 floor(30f), IC3 ceil(40f), IC5 floor(20f), IC7 floor(20f) |
| 5 | IC2 ceil(70f), IC7 floor(30f), IC5 ceil(20f), IC6 ceil(30f), IC8 floor(25f) |

**[OWNER I14, R5]** These raids keep the Flash rules: 12 h gap, each raid counts win or lose
(quitting does not cancel it), Flash raid strength 0.4-0.9, no reward, only needs 10% yard health
(the first raise grows the cave even below it and only skips the raid, as Flash did; see 2.2).
Before the fight Flash shows Moloch's warning, "INFERNO MONSTER ALERT", with his portrait, one card
per group (monster picture, name, "x count", its `emerge_mondesc_*` line under the cards for the one pointed at, focused or tapped; Flash showed it on mouse-over) and one button,
"Engage Attack" (`INFERNO_EMERGENCE_ATTACKPOPUP.as`, after `INFERNO_EMERGENCE_POPUPS.ShowWarning`);
it has no close and no "prepare" (WP 1.9).
Our wild-raid rules (`docs/design/wild-raids.md:21-49`: 10 Shiny for 90%+ defence, quit = cancel,
plain stats, no raid while damaged, 3 h gap) do **not** apply to them.

### 2.4 The Descent

| Rule | Value | Cite |
|---|---|---|
| Bases | 13 Moloch yards, ids 201-213; only the next one can be attacked | `maproom_inferno/DescentLayer.as:299-311` |
| Counter | 1 + bases cleared; passed at >= 14 | `MAPROOM_DESCENT.as:24`, `:415-426`, `WMBASE.as:101-123` |
| Win | Damage >= 90% | `ATTACK.as:970`, `BYMConfig.as:30` |
| Army | From the main yard, surface flinger capacity; no catapult, no siege | `ATTACK.as:589-591`, `UI_TOP.as:964-966`, `:289`, `:296` |
| Loot | Inferno resources, running total in the report (`descent_battlereport`); exact Flash, no extra prizes (R6) | `english.json:2730` |
| Kept between attacks | **Flash keeps the yard as the fight left it.** Checked 25 Oct: the save that ends an attack on a tribe yard sends that yard's `buildingdata` and `buildinghealthdata` (`BASE.as:3159-3170`; Descent yards included, only Map Room 3 attacks leave `buildingdata` out), and the yard loads from the server again for the next attack (`BASE.as:613-673`). A tribe yard that loads with damaged buildings starts repairing them 2 hours into the visit (`WMBASE.as:24`, `:46-58`, `:140-153`), which only happens because the damage was stored between attacks. So a lost Descent attack leaves the yard damaged and short of what it gave; the next attack goes on from there and cannot loot it again from full. Stored in `inferno_progress.descent_yards` (health and what was looted), as Map Room 1 tribes keep `tribeHealthData` + `looted`; a win clears it. Defenders refill each attack from the data file (a destroyed Housing Bunker stays destroyed through its health) | `BASE.as:3159-3170`, `WMBASE.as:24`, `:46-58`, `:140-153` |
| Popups | Taunt before (shown on return to the main yard), whimper + report on a win, gloat on a loss; Facebook brag at 1/4/7 (**dropped**, no Facebook) | `INFERNO_DESCENT_POPUPS.as`, `BASE.as:2146` |
| Capture | After the 13th win: capture popup, counter set to 14, Inferno yard loads | `INFERNO_DESCENT_POPUPS.as:121-133` |
| Toxicity | Flash: bar from depth 7, text "monsters lose health", but no combat code applies it | `DescentDebuffPopup.as`, `UI_TOP.as:1175`, `english.json:2915-2922` |
| Burn **[OWNER I15, R8]** | Made real, as a burn (not poison): from Descent yard 7, every **surface** monster in the fight loses health over time; Inferno monsters (IC1-IC8) and Korath are immune. Suggested strength `[PLACEHOLDER]`: 2% of full health every 10 s at yard 7, rising evenly to 5% at yard 13. Computed in the shared fight rules (server re-simulates). Shown with the "burning" icon from the status-icon system (`feat/status-icons`, beta.5): adding the effect and its icon should be one line. Toxicity bar and popup stay as the warning | — |
| Yards | Server data exists: `server/src/game-data/tribes/inferno/molochTribes.ts`; state shape in `server/src/controllers/base/load/modes/infernoModeDescent.ts` | — |
| Defences used | Quake (129) from base 203, Magma (132) from 204, Housing Bunker (128) from 206, Inferno Cannon 130, Sniper 21, walls 17; all at full Flash strength (R9) | `molochTribes.ts` |
| Yard kind | A Descent yard is fought as an **Inferno yard**: yard kind `"inferno"`, Inferno building numbers (`INFERNOYARDPROPS`, e.g. Quake Tower 48,000 health), and its Housing Bunkers filled from the yard's housed `monsters` at its `academy` levels (`defenderForcesOf` with `monsters` + `buildinghealthdata`). Flash attacks a Descent base through the Inferno map's handler, which loads it as `EnumYardType.INFERNO_YARD`; `SetBuildingProps` then picks the Inferno table and `HOUSING.Populate` the Housing Bunkers. Decided 25 Oct (exact to Flash, R9); supersedes WP 1.2's "main table" note | `maproom_inferno/DescentMonsterBase.as:111`, `maproom_inferno/PlayerHandler.as:333`, `BASE.as:559-564`, `GLOBAL.as:716-719`, `HOUSING.as:201-235` |

So Quake, Magma and Housing defenders, the IC monsters and the burn must work in the engine **in
slice 1**.

### 2.5 The Inferno yard

| Topic | Rule | Cite |
|---|---|---|
| Start layout | Under Hall L1 (-100,0), Bone L1 (60,0), Coal L1 (60,70), Silo L3 (130,0) and (130,80); points 0 | `BASE.as:1616-1656` |
| Resources | r1 Bone, r2 Coal, r3 Sulfur, r4 Magma; caps from Inferno silos | `GLOBAL.as:192` |
| Spending | Unlock + academy pay Sulfur; hatching pays Magma; juicing an IC on the main yard pays Magma into the Inferno purse | `CREATURELOCKER.as:982`, `ACADEMY.as:68`, `BUILDING13.as:103`, `BUILDING9.as:65`, `BASE.as:4476-4488` |
| Level gate | Under Hall level (`re [14,1,L]`); building counts indexed by Under Hall level | `INFERNOYARDPROPS.as` |
| Workers | Flash: 1, no BEW. **[OWNER I3]** 1 free + buy up to 4 more with Shiny 250/500/1,000/2,000 (max 5) | `QUEUE.as:31-41` |
| Map | Map button opens the Inferno map (no Map Room). Flash attack size table `[200,300,520,640,1140,1820]` (640 at L4 vs housing 780: a slip). **[OWNER R11]** attack size = what the Housing Bunkers hold: `[200,300,520,780,1140,1820]` | `GLOBAL.as:1362-1367`, `:836-838`, `ATTACK.as:588` |
| Prices and times | Exact Flash (I16, R1-R4) | `INFERNOYARDPROPS.as` |
| Other | Lava ground; tutorial skipped; no planner | `BASE.as:1493`, `:1072` |
| Shop | Groups ENLI, BLK2I, BLK3I, BR11I-BR43I, BIP, SP1-4, FIX, HODI.., EXHI, TODI; main yard sells BR..I top-ups after the Descent; price `ceil((sqrt(10% cap / 2))^0.75)` | `STORE.as:202-261` |

Buildable in the Inferno (`INFERNOYARDPROPS.as`, 135 ids; counts per Under Hall level 0..6):

| id | Building | Levels | Count / gate |
|---|---|---|---|
| 14 | Under Hall | 6 | 1; L2 7,000 Bone/Coal 600 s, L3 42,000 / 14,400 s, L4 240,000 / 57,600 s, L5 1.4M / 172,800 s, L6 7.56M / 345,600 s; 160x160 (`BUILDING14.as:18`) |
| 1-4 | Bone, Coal, Sulfur, Magma harvesters | 10 | [0,1,2,4,5,6] |
| 6 | Silo | 10 | [0,2,2,3,4,5] |
| 8 | Monster Locker | 4 | needs incubator |
| 9 | Juicer | 3 | from UH3; L1 costs 1M/1M/1M (kept as Flash, I16/R2) |
| 13 | Incubator (hatchery) | 3 | [0,1,2,3,4,5]; needs Housing Bunker L1 |
| 17 | Walls | 3 | from UH2 [..30,60,120,200,220] |
| 21 | Sniper | 7 | [0,2,3,3,4,4,6] |
| 24 | Booby trap | — | from UH2 [..8,15,20,28,35] |
| 26 | Academy | 4 | UH3 + locker L2 |
| 128 | Housing Bunker | 6 | capacity 200/300/520/780/1140/1820, range 500-650 |
| 129 | Quake Tower | 6 | from UH3 [0,0,0,2,2,4,4] |
| 130 | Inferno Cannon | 7 | as Sniper |
| 132 | Magma Tower | 6 | from UH3 [0,0,0,1,2,2,3] |
| 127 | Inferno entrance | — | exit, not built |

Blocked in the Inferno: flinger, map room, planner, store building, cage/chamber, catapult, bunker,
laser, tesla and the other surface-only ids.

### 2.6 Inferno monsters (`CREATURELOCKER.as:604-810`)

| Monster | Unlock Sulfur | Unlock time | Locker lv | Housing | Special (`com/monsters/monsters/creeps/inferno/*.as`) |
|---|---|---|---|---|---|
| IC1 Spurtz | 2,400 | 3,600 s | 1 (always unlocked, `:58-66`) | 15 | Spurtz: burn mark on death (looks only, `EFFECTS.as:107`) |
| IC2 Zagnoid | 4,800 | 14,400 s | 1 | 15 | — |
| IC3 Malphus | 76,800 | 64,800 s | 2 | 15 | — |
| IC4 Valgos | 38,400 | 64,800 s | 2 | 30 | — |
| IC5 Balthazar | 614,400 | 86,400 s | 3 | 40 | Balthazar: strips flying/ground defence flags, powered target mode |
| IC6 Grokus | 1,228,800 | 86,400 s | 3 | 50 | — |
| IC7 Sabnox | 2,457,600 | 172,800 s | 3 | 80 | Sabnox: magma fireball x2 vs towers |
| IC8 King Wormzer | 4,915,200 | 259,200 s | 4 | 100 | King Wormzer: area hit 100, once per target |

Names and classes per `CREATURELOCKER.as` (`name`, `classType`); corrected 2026-10-25, the
first draft had the specials one or two rows low.

Training: 5 academy steps each, Flash times kept (King Wormzer about 48 days in all, R4); hatch
cost/time per level in the same file. The engine has no
Quake/Magma Tower code today (only Korath's quake), `server/src/game-rules/combat/engine.ts`.

### 2.7 Transfer, map, tribes, PvP

| Topic | Rule | Cite |
|---|---|---|
| Transfer | From the cave on the main yard; only IC, only healthy ones; limited by main housing; free; one way | `INFERNOPORTAL.as:65-145`, `INFERNO_ASCENSION_POPUP.as:90-140` |
| Moloch tribes | 7 tribes by Inferno level (<= 10: ids 214-220; <= 20: 221-227; else 228-234); level pattern -2,-1,0,0,0,+1,+3; respawn 1 h; win = Under Hall destroyed; loot exact Flash (R7) | `createInfernoTribes.ts`, `ATTACK.as:958-967` |
| PvP neighbours | +-7 levels, 150 newest, max 25, all worlds; real players only, no computer-run neighbours for now (R10, #383) | `findInfernoNeighbours.ts` |
| Protection | 4 attacks in 1 h -> 1 h; >= 50% damage with an attack in 36 h -> 36 h | `damageProtection.ts:104-131` |
| Storage | Table `maproom_inferno` | — |

### 2.8 Quests and achievements

| Topic | Rule | Cite |
|---|---|---|
| Quests | 38; rewards Bone/Coal/Sulfur/Magma (totals 358,000/298,000/248,000/239,000), no Shiny; checks `bNlvl`, `UNLOCK`, `singleclickbank`; paid into the Inferno purse | `INFERNO_QUESTS.as`, `QUESTS.as:1784-1792` |
| Monster rewards | e.g. IUC2 10 IC2, IUC3 10 IC3, IUC5 2 IC4, IUC6 15 IC6, IC15 20 IC4, IUC10 20 IC5, IUC11 5 IC7, IC16 5 IC7, IUC12 2 IC8; need free housing | `QUESTS.as:1759-1768` |
| Shiny prizes **[OWNER R12]** | Flash gives none. Add a few small ones on top of the resource prizes. Suggested `[PLACEHOLDER]` (the five biggest resource quests): IQT1 10, IT3 10, IS5 15, IUT3 25, IQT3 25 = 85 Shiny in all. Paid to the shared Shiny | `INFERNO_QUESTS.as` |
| Flash quirks kept | `prereq` is never read (no gating); IUC10 repeats IC5 | `QUESTS.as` |
| Achievements | ids 18-21 (now `available:false`): Descent level 1 (granted after the first Descent attack, win or lose), Descent level 14, Under Hall level 5, 10 Inferno quests | `server/src/game-data/achievements.ts:255-300`, `ACHIEVEMENTS.as:51`, `ATTACK.as:975`, `QUESTS.as:1651` |
| Surface siege quests | SW4-SW12 dropped from `server/src/game-data/goals.ts`; return with siege | — |

### 2.9 Surface towers, siege, Korath

| Topic | Rule | Cite |
|---|---|---|
| Quake Tower 129 (surface) | 6 lv, from 312,500/187,500/125,000, 18,000 s; count by Under Hall level [0,1,1,2,2,4..] | `YARD_PROPS.as` ~6900-7360 |
| Magma Tower 132 (surface) | 6 lv, from 187,500/250,000/62,500, 18,000 s; [0,1,1,1,2,2..] | same |
| Siege Factory 133 | 1.5M/1.5M, 86,400 s; needs UH1 + Siege Lab | same |
| Siege Lab 134 | 10 lv, 600k..9M | same |
| Gate | Only after the Descent; else "inferno_building_requirement" | `GLOBAL.as:2149-2156`, `BASE.as:3697-3705` |
| Weapons | Decoy, Vacuum, Jars: 10 levels (damage, range, duration, durability, loot bonus, costs) | `com/monsters/siege/weapons/*.as` |
| Today | Engine ignores siege (`docs/design/attack-flow.md:434-436`); art exists in `server/public/assets/siegebuttons`, `siegeimages` | — |
| Korath | Catalogue G4, feeds IC1/IC2/IC7/IC8 (`server/src/game-data/championCatalogue.ts:162-185`); raise free + 1-day egg like the others (`server/src/services/yard/champion.ts`); one basic champion at a time. **[OWNER I10]** unlock = owning an Inferno yard. Flash's Burn/Breath of Fire/Fists of Doom were event prizes (`EventStorePrizeData.as:84-107`, `server/src/enums/Rewards.ts:22-29`): **left out for now** (I13, no events shop yet; section 7) | — |

---

## 3. Server design

Principle: the client only asks; the server decides, using the same rule tables and the same fight
engine (`server/src/game-rules/combat/` mirrored to `web/src/game/combat/rules/`, MANIFEST + sync
test; those dirs are pinned LF).

### 3.1 Data

| What | Where | Notes |
|---|---|---|
| Progress | New table `inferno_progress` (userid PK): `emergence_level` 0-5, `emergence_last_at`, `descent_destroyed` (13 flags) + best damage, `descent_passed_at`, `inferno_baseid`, `korath_unlocked_at`, `korath_notice_at`, `popups_seen` (json) | Server-only; replaces the Descent part of main `wmstatus` (`infernoModeDescent.ts`) |
| Inferno yard | Existing `save` row, type inferno, **created by the server at capture** with the Flash start layout | Today `server/src/game-data/getDefaultBaseData.ts` makes an empty yard |
| Purse | Main save `iresources` (Bone/Coal/Sulfur/Magma), server-owned; caps from Inferno silos (today 10,000 each) | Shared Shiny stays on the user |
| Yard kind | `YardKind` gets `"inferno"` (`server/src/game-data/buildingCosts.ts:846`) | Costs/limits generated from `INFERNOYARDPROPS.as` by `web/tools/gen-building-costs.mjs` |
| Monsters | IC entries in the shared monster tables, both sides | Sync test covers them |
| Switch | New `infernoConfig.enabled` (default off), separate from `legacyRoutesOpen:false` | `server/src/services/inferno/infernoGate.ts`, `config/InfernoConfig.ts` |

### 3.2 Routes (all behind `infernoConfig.enabled`, all session-checked)

| Route | Does | Checks on the server |
|---|---|---|
| `GET /bm/inferno/state` | Cave level, next raid due, Descent progress, has-yard, Korath notice | — |
| main-yard load hook | Decides "emergence raid due" and runs it through `services/raids/raidFlow.ts` | TH5, tutorial, level < 5, 12 h gap, yard health > 10%; saves level + time first |
| `GET /bm/inferno/descent` | 13 bases, which is next | — |
| `POST /bm/inferno/attack/start` | kind `descent` / `tribe` / `player`; mints the attack session (`docs/server-api.md:336+`) | Target allowed (next Descent base only; tribe in the player's 7; neighbour in range, not protected); army from the right yard and within capacity |
| landing | Existing replay + `finaliseAttack.ts` / `replayWorker.ts` | Re-simulated on the server; loot, Descent progress, capture, protection, achievements written only from the server result |
| `POST /bm/inferno/load` | Loads the Inferno yard with harvester catch-up | Own yard only |
| `/bm/yard/<action>` (existing) | Build/upgrade/move/recycle/collect/bank/repair/speed-up/fortify, with the Inferno baseid | `lockOwnYard` (`yardAction.ts`) learns the inferno kind; `poolView` (:300-380) gets an Inferno purse branch; costs/limits by Under Hall level |
| `POST /bm/inferno/transfer` | Moves IC from Inferno housing to main housing | IC only, healthy only, fits main housing |
| `GET /bm/inferno/map`, `/neighbours` | Moloch tribes (`createInfernoTribes.ts`) and PvP list (`findInfernoNeighbours.ts`) | Level range, protection |
| quests / achievements | Existing goal + achievement services, Inferno goal set | Rules checked against server state |

### 3.3 Fight engine additions

Quake Tower, Magma Tower, Housing Bunker defenders, Inferno Cannon, the four IC specials, and the
Descent burn (2.4: a timed health loss on surface monsters only, strength by Descent yard), in the
shared rules (both sides, sync test). The burn is a status effect on the status-icon system
(`feat/status-icons`), so the client shows the "burning" icon over each burning monster with no
extra drawing code. Slice 6 adds siege weapons to the same engine.

**Housing Bunker defenders (WP 1.6, `HOUSINGBUNKER.as:149-353`, `HOUSING.as:201-235`).** An
Inferno yard's housed monsters (`monsters` on the save) are its Housing Bunkers' defenders: the
engine deals them out in turn over the standing bunkers (Flash draws a bunker at random for each;
`housedGarrisons`). Every 30 ticks a bunker looks at the nearest 4 walking attackers in its range,
and the nearest 4 flyers while it holds a Balthazar (IC5) or Sabnox (IC7); it sends one of those
after each flyer, then every monster it still holds at the nearest walker. It sends nothing while
upgrading. When it falls, every monster it houses dies, out or in, and counts as lost. The Monster
Bunker (22) keeps its own rule (one random defender every 30 ticks). **Flash bug, our reading:**
the "send the rest" loop reads `_loc1_[_loc3_]`, where `_loc3_` is still the flyer count from an
earlier loop, so in Flash, after interceptors go, the first few remaining monsters stay home (an
index past the end is skipped, so it does not crash). We take the plain reading: every remaining
monster goes. **Descent yard kind:** Flash loads a Descent yard as an Inferno yard
(`maproom_inferno/PlayerHandler.as:333`, `EnumYardType.INFERNO_YARD`), so it reads
`INFERNOYARDPROPS` and its Housing Bunkers hold its housed monsters. Decided (main, 25 Oct, by
the owner's "exact to Flash" rule, R9): a Descent yard is an Inferno yard (see 2.4); WP 1.2's
"the Descent reads the main table" is superseded.

### 3.4 Old routes

The closed Flash routes (baseLoad i-modes, baseSave Inferno types, updateSaved, infernoMonsters,
infernoSave) stay 403 behind `legacyRoutesOpen:false` until slice 7, which deletes them and their
tests. Nothing in the new design calls them.

---

## 4. Screens and art

Every screen: phone and desktop from day one (I12); screenshots on the Review Desk and owner OK
before merge.

| Screen | Phone | Desktop | Slice |
|---|---|---|---|
| Cave on the main yard + tap menu (Enter / Transfer) | tap sheet | click menu | S1 |
| Emergence: earthquake banner + shake, Moloch intro/taunt, stage passed, complete | full-width popup | centred popup | S1 |
| Descent map (13 bases, next target, progress) | vertical scroll list over map | map | S1 |
| Descent popups (taunt, whimper + report, gloat, capture) | full-width | centred | S1 |
| Descent attack from yard 7: toxicity bar + "burning" status icon over surface monsters | existing attack screen | same | S1 |
| Inferno yard (lava, HUD with 4 resources, build menu, worker, shop, yard switch) | existing yard HUD layout | same | S1 |
| Monsters: locker, academy, incubator, housing (Inferno) | existing monster screens | same | S2 |
| Transfer dialog | list + count steppers | same | S2 |
| Inferno map: Moloch tribes + PvP tab | tabs, list | tabs, list | S2/S3 |
| Attack screen Inferno pass ("Monster limit", no catapult/siege) | existing | existing | S2 |
| Defence notice / view for Inferno PvP | existing reports | same | S3 |
| Inferno quests panel | existing quests | same | S4 |
| Korath unlocked message | popup | popup | S5 |
| Surface: Quake/Magma in build menu, Siege Lab/Factory screens, siege picker in attack | sheets | panels | S6 |

Art (new art goes to the Review Desk for approval before merge):

| Art | Status | Track |
|---|---|---|
| Inferno buildings (`server/public/assets/buildings/i*`), lava ground (`yardbg/lava/`, `ui/lava1-4.png`), IC monsters, `korath_1..6.png`, `popup_emergecomplete(.v2).jpg`, `ui/descent_maproom2.jpg`, `ui/inferno_maproom1.jpg`, `portrait_moloch.png`, siege buttons/images, sounds | exists | — |
| Descent map (`ui/descent_maproom2.jpg`, 700x1842, Flash's own; scrolls on a phone, no redraw needed) and Moloch gloat + whimper portraits (`popups/portrait_muloch_gloat.png`, `portrait_muloch_whimper.png`) | exists | — |
| Descent yard pictures (`descentBase_images_355` frames base1..base7, each with `_dark` and `_destroyed`; vector in `assets.swf`; numbered discs meanwhile) | missing | A1 |
| Descent fog (`MapViewDescent_Fog_Shroud`), yard card frame and depth bar (`DescentBasePopup_CLIP`), battle report frame (`popup_infernodescent_battle_report`), Descent minimap (vector in `assets.swf`; CSS stand-ins meanwhile) | missing | A1 |
| 4 Inferno resource icons (only in `assets.swf`) | missing | A2 |
| 16 Inferno build-menu pictures (`buildingbuttons/i*`, Flash's own) | exists | — |
| 11 Inferno build-menu silhouettes (`bone_crusher.v2`, `coal_producer.v2`, `sulfur.v2`, `magma_producer.v2`, `sillo.v2`, `monster_locker.v2`, `hatchery.v2`, `coal_wall.v3`, `sniper_tower.v2`, `booby_trap.v2`, `inferno_monster_academy`, each `<name>.silhouette.jpg`, 120x160; drawn dark by CSS meanwhile) | missing | A2 |
| Inferno map background, minimap, list frames (vector in `assets.swf`); Moloch tribe portrait | missing | A3 |
| IC repaints | after champion art (I8) | A4 |
| Korath redraw | from the champion redraw plan | — |

---

## 5. Slices and work packages

Size: S = under half a day, M = about half a day, L = a full day (split if it grows). Every WP:
unit tests on the server, shared-rules sync test where rules change, typecheck, and the listed
check. Owner screenshots before merge for any screen.

### S1 — Getting in and owning the yard (23)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 1.1 | Generate Inferno building tables from `INFERNOYARDPROPS.as` (costs, counts by Under Hall, blocked ids); `YardKind "inferno"` | golden test vs Flash numbers in 2.5 | — | M |
| 1.2 | Combat tables for 128/129/130/132 and IC1-IC8 stats, both sides | sync test | 1.1 | M |
| 1.3 | Engine: Quake Tower, full Flash strength everywhere incl. the Descent (R9) | engine unit tests (range, damage, timing vs Flash) | 1.2 | M |
| 1.4 | Engine: Magma Tower | same | 1.2 | M |
| 1.5 | Engine: IC specials audit + fill (Spurtz, Balthazar, Sabnox, Wormzer) | per-monster unit tests | 1.2 | L |
| 1.6 | Engine: Housing Bunker defenders; replay smoke over the 13 Descent yards + Moloch tribe yards | every yard simulates without error | 1.3-1.5 | M |
| 1.7 | `inferno_progress` migration + entity, `infernoConfig.enabled`, `GET /bm/inferno/state` | route tests incl. switch off | — | S |
| 1.8 | Emergence "due" rule on main-yard load (2.2, Flash rules I14: 12 h, 10% health) + pause wild raids | unit tests for each gate | 1.7 | M |
| 1.9 | Emergence raid army (2.3) + run through `raidFlow`, stage counts win or lose, quit does not cancel, no reward | army snapshot per level/L; flow test | 1.8, 1.5 | M |
| 1.10 | Client: cave sprite, tap menu, emergence popups + earthquake | screenshots phone/desktop | 1.7 | M |
| 1.11 | Descent state + `attack/start` kind descent (next base only, main army, flinger capacity); the Descent yard is fought as yard kind `"inferno"` with its housed monsters defending from its Housing Bunkers (2.4 "Yard kind", `PlayerHandler.as:333`) | route tests (wrong base refused; Descent fight uses Inferno numbers and Housing Bunker defenders) | 1.7, 1.6 | M |
| 1.12 | Descent landing: 90% win, Inferno loot, progress, capture creates the Inferno yard with the start layout, achievements 18/19 | landing tests incl. forged client result ignored | 1.11 | M |
| 1.13 | Client: Descent map + popups (done 26 Oct: Enter Cavern opens Flash's map `ui/descent_maproom2.jpg` with the 13 yards, beaten ones gone, later ones dark, fog below the next; its card has the depth bar and Attack; Moloch's taunt as the yard opens (Flash `BASE.as:2146`, not on return home); Return Home after the fight; whimper + battle report or gloat over the end panel; the 13th win's capture and Start Building! open the Inferno yard; stand-ins for the art below) | screenshots | 1.11, A1 | M |
| 1.14 | `POST /bm/inferno/load` + harvester catch-up into `iresources` (decided 25 Oct, exact to Flash: each harvester fills its own buffer at the Inferno rates and stops when full; it reaches `iresources` only when banked, WP 1.16; the load answers the purse with the Inferno cap) | load tests, caps | 1.12 | M |
| 1.15 | Yard actions pt 1: build/upgrade/move/recycle with Inferno baseid, Under Hall gating, `lockOwnYard` + `poolView` (done 25 Oct: the Inferno `baseid` locks main then Inferno row (`infernoView`: purse = main `iresources`, Shiny shared, the rest the Inferno row's); routes refuse `notInInferno` unless they allow it (`state`, `build`, `build/cancel`, `upgrade`, `upgrade/cancel`, `recycle`, new `move`); the planner refuses it. Improved Packing Skills and More Yardage (`ENLI`) read from the Inferno row's own `storedata`, as Flash reads the loaded yard's (`BASE.as:1082`). The combat engine uses the Inferno Under Hall 160 / Academy 80 footprints and the Under Hall's 160/140 pathing rectangles in Inferno fights (fixed in WP 1.20).) | action tests per rule | 1.14, 1.1 | M |
| 1.16 | Yard actions pt 2: collect/bank/repair/speed-up/fortify/walls/traps (done 25 Oct: `bank`, `repair`, `repair/instant`, `speedup`, `upgrade/instant`, `build/instant`, `fortify`, `fortify/cancel` allow the Inferno `baseid`; bank fills the Inferno purse up to the Inferno cap, half points (tutorial end stage, `BASE.as:1072-1074`), not counted for BK1-BK4; repairs heal at the Inferno `repairTime` (`INFERNO_REPAIR_TIMES`); Shiny finishes award the Inferno table's points; walls/traps built finished from UH2, a wall upgrades on its own (no planner); nothing fortifies (`400 notFortifiable`). Event free speed-ups not usable there; trap re-arm and batch wall upgrade stay planner-only, so closed. Fixed in WP 1.18: the web client now sends an Inferno wall's upgrade straight to the server (`YardStore.upgradeRefusal`).) | action tests | 1.15 | M |
| 1.17 | Workers (1 free + buy up to 4 more: 250/500/1,000/2,000 Shiny, I3) + Inferno shop items (done 26 Oct: `shop/buy` allows the Inferno `baseid` and sells Flash's Inferno store (`STORE.as:210`) plus `BEW`: `ENLI`, `BIP`, `BLK2I`/`BLK3I` (as `BLK2`/`BLK3`, Under Hall 3/4), `HODI`/`HOD2I`/`HOD3I`, `EXHI`, `TODI`, `PRO1`-`PRO3`; everything else `400 notForSale`, and the Inferno-only codes are refused on the main yard. Purchases land in the Inferno row's `storedata` (its own ladders; the worker count reads it, max 5); Shiny is shared. `TODI` is read as Tower Overdrive by the defence, `HODI`.. as hatchery overdrives by the monster catch-up. Speed-ups and `FIX` are the `speedup`/`repair/instant` routes'; resource packs `BR..I` dropped as on the surface. Open: the Inferno catch-up does not run hatching yet (WP 2.3), so `HODI`.. have no effect until then; Inferno protection is the Inferno row's `protected`, which WP 3.2/3.3 must check and end on attack.) | shop tests (ladder, max 5, Shiny shared with the surface) | 1.15 | M |
| 1.18 | Client: Inferno yard scene (lava, buildings art, main/Inferno switch) (done 26 Oct: `POST /bm/inferno/load` loads the yard; Enter Cavern / Exit Cavern switch yards; Flash's 4 lava tiles; the Inferno art table and names; Under Hall 160 and Academy 80 footprints; ENL + ENLI yardage; no planner in the Inferno, Inferno walls upgrade on their own) | screenshots | 1.14 | M |
| 1.19 | Client: HUD 4 resources, Inferno build menu, building panels (done 26 Oct: the HUD shows Bone/Coal/Sulfur/Magma with the Inferno purse and cap (`resourceIcon.ts` realm; the 4 icons are placeholders in `INFERNO_ART` until A2); the build menu is Flash's Inferno groups and order with Flash's own 16 button pictures, Under Hall gating and Inferno names and blurbs; building panels say Under Hall and list the Under Hall's unlocks from the Inferno table; the Shop window on the Inferno yard is the Inferno store (WP 1.17 items through `shop/buy` with the Inferno `baseid`: workers, More Yardage, Granite/Forged Steel Blocks behind Under Hall 3/4, Improved Packing, the three Inferno Hatchery Overdrives, Housing Expansion, Tower Overdrive, protection; no "Coming later" decorations); the HUD's "+N/h" line shows the Inferno harvesters' rate (Flash's resource bubble gave the Inferno's `r{n}Rate`, `UI_TOP.as:716-719`). Open: the 11 silhouettes and 4 icons (A2); decorations from storage are not offered on the Inferno) | screenshots | 1.18, A2 | M |
| 1.20 | End-to-end: TH5 account -> 5 raids -> Descent (burn on from yard 7) -> yard; owner screenshots (done 26 Oct: a fresh account set to TH5 played the 5 emergence raids, Descent yards 1-13 (burn icon and ticks from yard 7, video), the capture and Start Building!, built and collected on the Inferno yard, and built a Magma Tower and a Siege Works on the main yard from the Inferno purse. Fixed on the way: the Under Hall 160 / Academy 80 fight footprints, the Inferno full-storage words (Resource Pods, not silos). Flash also ran the attack clock under the taunt. Report `agent-handoffs/reports/inferno-wp120.md`, pictures `shots-wp120/`) | scripted run on dev server | all S1 | M |
| 1.21 | Descent burn (2.4, I15/R8): status effect in the shared rules, surface monsters only (IC + Korath immune), strength by Descent yard from 7; "burning" icon via the status-icon system | engine tests (immune types, yards 1-6 none, server/client match); screenshot | 1.6, `feat/status-icons` merged | S |
| A1 | Art: Moloch gloat/whimper portraits, Descent map | owner approval | — | M |
| A2 | Art: 4 resource icons, 11 build-menu silhouettes (the 16 build-menu pictures are Flash's own, on disk) | owner approval | — | L |

### S2 — Inferno monsters and Moloch tribes (11)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 2.1 | IC unlock/train/hatch data both sides (2.6) (done 26 Oct: `gen-monster-catalogue.mjs` writes IC1-IC8 into both catalogue copies; golden test against 2.6 on the web side, economy cross-check on the server. Report `agent-handoffs/reports/inferno-s2.md`) | golden + sync tests | 1.2 | S |
| 2.2 | Locker + academy in the Inferno (Sulfur) (done 26 Oct: the Inferno yard unlocks and trains only IC monsters, paid in Sulfur from the purse; Spurtz (IC1) always unlocked; the Inferno Academy stops at level 5 as in Flash, so King Wormzer takes 30 days, not 48 (owner to confirm)) | action tests | 2.1, 1.15 | M |
| 2.3 | Incubator + housing + juicer (Magma; IC juiced on main pays Magma) (done 26 Oct: Incubators hatch IC for Magma into the Housing Bunkers (200 at L1), EXHI the expansion; the Juicer pays Magma on the Inferno yard and, for an IC, into the purse on the main yard (Flash's screens refused it; the design allows it); outposts refuse IC; IC juiced do not count for goals BL1-BL4) | action tests | 2.1 | M |
| 2.4 | Client: Inferno monster screens (done 26 Oct: on the Inferno yard the Monsters screen has Unlock, Hatch, Compound and Train (no Lab), lists only IC1-IC8, prices hatching in Magma and unlocks/training in Sulfur, sells the Incubator Overdrives HODI/HOD2I/HOD3I and no Locker Overdrive, and uses Flash's Inferno names: Strongbox, Incubator, Compound, Infernal Academy. Pictures `shots-s2b/`; report `agent-handoffs/reports/inferno-s2.md`) | screenshots | 2.2, 2.3 | M |
| 2.5 | Transfer route (2.7) (done 26 Oct: `POST /bm/inferno/transfer` moves Inferno monsters from the Compound into the main yard's Housing, free; refuses a non-IC (`notInferno`), more than the Compound holds (`notEnough`), more than the Housing holds, EXH counted (`noRoom`), no Inferno yard, and Map Room 3 main yards (`mapRoom3`) for now; the Compound counts every monster healthy, as the server keeps them as counts. Dev seed `bun run inferno:seed <user> --db <copy> [--monsters IC1=6]` gives an account a won Descent and a starter Inferno yard. Report `agent-handoffs/reports/inferno-s2.md`) | tests: non-IC, hurt, over housing refused | 2.3 | S |
| 2.6 | Client: transfer dialog from the cave (done 26 Oct: the cave menu shows Transfer Monsters once the player owns an Inferno yard (`BUILDINGINFO.as:302-306`); the dialog uses Flash's words, a -/+/Fill stepper per Compound monster and the main yard's Housing bar with the picks; an Inferno monster juiced on the main yard now shows Magma, not goo. Pictures `shots-s2c/`) | screenshots | 2.5 | S |
| 2.7 | Moloch tribes list (`createInfernoTribes.ts`, respawn 1 h) (done 26 Oct: `GET /bm/inferno/map` gives the 7 Moloch tribes for the Inferno yard's level (up to 10: bases 214-220, up to 20: 221-227, above: 228-234) at levels -2, -1, 0, 0, 0, +1, +3 of it (at least 1), each with its damage, whether it is destroyed and when it comes back (1 h); the Inferno yard's level is its points plus its building value at Inferno prices. `409 noInfernoYard` without an Inferno yard. Report `agent-handoffs/reports/inferno-s2.md`) | tests | 1.14 | S |
| 2.8 | Tribe `attack/start` + landing (Under Hall win, Flash loot, Inferno army; attack size = Housing Bunker capacity, R11) (done 26 Oct: `POST /bm/inferno/attack/start` kind `tribe` attacks with the Inferno yard's Housing Bunker monsters only, at Infernal Academy levels, no champions, catapult or siege; fling room is the best finished Housing Bunker's (L4 780), +25% with Declare War. Refusals `notInfernoTribe`, `notYourTribe`, `tribeDestroyed` (+respawnAt), `noMonsters`, `noInfernoYard`, `underAttack`. The landing replays the fight; the win is the Under Hall destroyed; the monsters that fought leave the Inferno yard; the loot (Flash's, capped by what the tribe holds) goes into the Inferno purse up to its caps. The tribe keeps its damage until it respawns. Inferno monsters moved to the main yard can also go into main-yard Monster Bunkers (from housing, deleted when taken out) and surface attacks, as in Flash. Report `agent-handoffs/reports/inferno-s2.md`) | landing tests (L4 bunker allows 780) | 2.7, 1.12 | M |
| 2.9 | Client: Inferno map screen (done 26 Oct: on the Inferno yard the Map button opens the 7 Moloch tribes on Flash's map picture and in a list (the list first on a phone), with Flash's names and spots; a wrecked tribe is shown dark with "Back in m:ss" and Attack off (Flash hid it; owner to confirm); a tribe's card or list row starts the tribe attack and opens the attack screen, checked in a browser through to a saved win. No View button or minimap; stand-in portrait until A3. Also fixed: the save no longer sends `destroyed` for a tribe, which the server refused. Report `agent-handoffs/reports/inferno-s2.md`) | screenshots | 2.7, A3 | M |
| 2.10 | Attack screen Inferno pass ("Monster limit", no catapult/siege) (done 26 Oct: a tribe attack's army panel is "Attack Force" and flings what the server's Housing Bunker room allows (1,140 in the check); the top bar shows the Inferno purse; the result window uses Flash's Inferno words ("Base Destroyed!" when the Under Hall falls, "Attack Ended" otherwise), says when the tribe is back and when the full Inferno storage turned loot away; Return to map opens the Inferno map, Return Home the Inferno yard. Also: a Descent fling carries the server's Descent flinger room (1,500 at flinger level 3, was 2,250). Checked in a browser on desktop and phone: a loss, two wins, both ways back. Report `agent-handoffs/reports/inferno-s2.md`) | screenshots + fight smoke | 2.8 | S |
| A3 | Art: Inferno map art, Moloch tribe portrait | owner approval | — | M |

### S3 — Inferno PvP (5)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 3.1 | Neighbours route (`findInfernoNeighbours.ts`), real players only (R10; bots later, #383) (done 27 Oct: `GET /bm/inferno/neighbours` lists real players' Inferno yards within 7 levels of the player's, from the 150 most recently changed, at most 25, all worlds, never a bot's and only the yard the owner plays; kept in `maproom_inferno` and searched again by the Map Room 1 rules (2 weeks, or 30 minutes while thin), keeping the attack counters and everyone with revenge left; each one's level, protection, attack in progress, online (the main yard's rule, owner to confirm) and friend flag read fresh, with Flash's attack codes. Also: a player's Inferno yard now defends with the monsters it keeps under `housed`. Report `agent-handoffs/reports/inferno-s2.md` # Slice 3) | tests | 2.7 | S |
| 3.2 | `attack/start` kind player + defender forces from the Inferno yard; same bunker attack size as 2.8 (done 27 Oct: kind `player` attacks another real player's live Inferno yard with the Housing Bunker army as 2.8; refused before anything is written as `notInfernoPlayer` (own, none, not the yard the owner plays, a bot's), `protected` (+protectedUntil), `targetUnderAttack` (+attacker), `outOfRange` unless revenge is left, `ownerOnline` (the main yard's rule, owner to confirm), `noMonsters`; the yard is caught up and marked attacked under its lock, its housed monsters defend from its Housing Bunkers at its own academy, the loot is the defender's Inferno purse frozen in the session; attacking ends the attacker's Inferno protection) | tests (protected, out of range refused) | 3.1, 2.8 | M |
| 3.3 | Landing: Inferno loot, protection (`damageProtection.ts`), revenge | tests | 3.2 | M |
| 3.4 | Defender notice + view | screenshots | 3.3 | S |
| 3.5 | Client: PvP tab on the Inferno map | screenshots | 3.1, 2.9 | S |

### S4 — Quests and achievements (3)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 4.1 | 38 Inferno quests data + rule checks | per-rule tests | 1.16 | M |
| 4.2 | Quest rewards into the purse; monster rewards need housing; small Shiny prizes on 5 quests (2.8, R12) | tests (Shiny paid once, to the shared Shiny) | 4.1, 2.3 | S |
| 4.3 | Achievements 18-21 on; client Inferno quests panel | tests + screenshots | 4.1, 1.12 | S |

### S5 — Korath (2)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 5.1 | Korath raisable once `inferno_baseid` exists; `korath_notice_at` | tests | 1.12 | S |
| 5.2 | Client: "Korath unlocked" message on the next surface visit + cage entry | screenshots | 5.1 | S |

### S6 — Surface Quake/Magma Towers and siege (8)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 6.1 | Quake/Magma on the main yard (costs, counts by Under Hall, Descent gate) + build menu (done 26 Oct: the Quake Tower, Magma Tower, Siege Factory and Siege Lab are in the main build menu once the cave is at level 5, locked until the Descent is passed (`409 infernoLocked`), counted by the Inferno Under Hall (`409 underHall`, `infernostate.underHall`) and paid from the Inferno purse (`shortfall` with `purse: "inferno"`, reports carry `purse`); the upgrade panel follows the same rules; Spurtz Cannons left out, fortify unchanged, the Yard Planner skips them; report `agent-handoffs/reports/inferno-wp61.md`) | tests + screenshots | 1.3, 1.4, 1.12 | M |
| 6.2 | Siege weapon data both sides (Decoy, Vacuum, Jars, 10 levels) | golden + sync tests | — | S |
| 6.3 | Siege Lab + Factory server (build, research, make weapons) | action tests | 6.2, 6.1 | M |
| 6.4 | Client: Siege Lab/Factory screens | screenshots | 6.3 | M |
| 6.5 | Engine: Decoy | engine tests | 6.2 | M |
| 6.6 | Engine: Vacuum (loot bonus) | engine tests | 6.2 | M |
| 6.7 | Engine: Jars | engine tests | 6.2 | M |
| 6.8 | Siege picker in the attack screen (un-hide) + session/landing use; SW4-SW12 quests back (done 26 Oct: the Siege button shows in an attack when a weapon is held, not on Descent or Inferno yards; Flash's one-weapon popup (Fire, then Cancel and a hint for the Decoy and Jars, the Vacuum fires at once and needs a Town Hall standing), time left or health after firing; the Decoy, Vacuum hose and loot stream, and Jars drawn on the field; the abandoned-attack replay fights the held weapon and spends it. SW4-SW12 are back as Flash had them (unlock each weapon after C16, then Levels 5 and 10), shown only with `INFERNO_ENABLED` on; each pays one weapon made in the Chaos Factory, refused (`409 siegeRoom`, Flash's `msg_quest_noroomsiegeweapon`) unless a Factory is built, idle and empty; report `agent-handoffs/reports/inferno-wp68.md`) | tests + screenshots | 6.5-6.7 | M |

### S7 — Wrap-up (2)

| WP | Work | Test | Depends | Size |
|---|---|---|---|---|
| 7.1 | Delete old Inferno routes, `legacyRoutesOpen`, their tests | full test run | S1-S6 | S |
| 7.2 | Inferno music/sounds hook (when the sound system exists) | manual | sound plan | S |

Totals: S1 23, S2 11, S3 5, S4 3, S5 2, S6 8, S7 2 = **54**, plus art track A4 (IC repaints) and
the Korath redraw from the champion plan. S3-S6 can run in parallel after S1 (S6 only needs
1.3/1.4/1.12). WP 1.21 waits for the status-icon job (`feat/status-icons`) to merge.

---

## 6. Open questions

None. I13-I16 and R1-R12 were answered on 2026-10-24 (2.1). Two numbers are suggestions to settle in
play tests: the burn strength (2.4) and the Shiny quest prizes (2.8).

## 7. Later ideas

Recorded, not planned for this build:

| Idea | From |
|---|---|
| **Inferno conquering (Map Room 2 style)**: outposts on the Inferno map. Long-term goal | I9 |
| Moloch map yards: loot that grows smoothly with level, plus a daily bonus for the first 3 wins | R7 |
| Computer-run neighbours on the Inferno map so PvP has targets | R10, #383 |
| Korath's Burn, Breath of Fire, Fists of Doom, once an events shop exists | I13 |
