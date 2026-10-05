# Monster Baiter as a Defence Simulator — Design

A design document for issue #22. The Wild Monster Baiter already brings a simple practice attack on
the player's own yard (#126, #195). This design turns it into the full what-if tool the owner asked
for: any monster at any level, champions, drops anywhere, a replay and a per-tower report, free and
unlimited, with nothing saved.

All citations are `path:line` or `path` relative to the repository root. Claims about current
behaviour cite the web client, the server or the Flash client (`client/scripts`, through the spec);
anything new is marked as a proposal. The owner answered the open questions on 2026-10-05; the
answers are in §9.

Contents:

1. [The owner's decisions](#1-the-owners-decisions)
2. [Flash facts](#2-flash-facts)
3. [What already exists](#3-what-already-exists)
4. [Does the server need to be involved?](#4-does-the-server-need-to-be-involved)
5. [How it works](#5-how-it-works)
6. [Click by click](#6-click-by-click)
7. [The report](#7-the-report)
8. [What the wild raids (#226) can share](#8-what-the-wild-raids-226-can-share)
9. [The owner's answers](#9-the-owners-answers-2026-10-05)
10. [Work packages](#10-work-packages)

---

## 1. The owner's decisions

| # | Decision | When |
| --- | --- | --- |
| 1 | The Baiter becomes the defence simulator and keeps its 7 levels; Musk is dropped as a resource (D18). | 2026-09-23/27, `docs/design/yard-buildings.md:50`, §8.1 |
| 2 | Attackers fight at plain stats: no Flash wild-monster weakening multiplier. | 2026-09-29, yard-buildings §8.1 |
| 3 | The attack scene's 5-minute clock and its automatic ends apply; Stop ends a test early. | 2026-09-29, yard-buildings §8.1 |
| 4 | The yard starts as it is now: damaged buildings stay damaged, spent traps stay spent. | 2026-09-29, yard-buildings §8.1 |
| 5 | The yard defends itself as in a real attack: bunker garrisons and the caged champion fight. | #195 |
| 6 | **Full roster and champions.** | #22 |
| 7 | **Any drop point**, not fixed arrows. | #22 |
| 8 | **Monster levels the player chooses.** | #22 |
| 9 | **A replay.** | #22 |
| 10 | **A per-tower results report.** | #22 |
| 11 | **No lasting damage.** Nothing of a test is saved. | #22 |
| 12 | **Tests are free and unlimited**: no Musk, no cooldown. | 2026-10-05 |
| 13 | **Any monster at any level**, including monsters the player has not unlocked: a pure what-if tool. | 2026-10-05 |

Decision 8 replaces the "Level 1 / My academy levels" switch of Q5 (yard-buildings `:1283`) with a
level per monster. Decision 7 replaces the 4 or 8 direction arrows.

## 2. Flash facts

From `docs/specs/monsters-and-hatchery.md` §8 (`:1024-1076`) unless stated otherwise.

- **What it was.** Building 19, `MONSTERBAITER.as`. It staged a wild-monster attack on the player's
  own yard with monsters of the player's choosing (`:1029-1031`).
- **Roster: C1 to C14 only.** The popup builds items for `"C" + i`, `i` 1 to 14
  (`MONSTERBAITERPOPUP.as:48-59`); a longer list one line above is never used (`:45`).
- **Cost: a monster's `cStorage`** (its housing space), and the army had to fit in the current Musk
  (`MonsterBaiterItem.as:35`, `:70-72`).
- **Musk never actually ran out.** `MONSTERBAITER.Tick()` set Musk back to the level's capacity every
  tick (`MONSTERBAITER.as:43-44`), so the only real limit was one attack's size: 600, 900, 1,200,
  1,500, 2,100, 3,200 or 4,800 by level (`YARD_PROPS.as:1962`). The replenish rate was never used
  (`MONSTERBAITER.as:143`), and the `MUSK` store item was redundant (`MONSTERBAITERPOPUP.as:85-87`).
- **Directions.** 4 corner arrows at levels 1-2, 8 from level 3 (`MONSTERBAITERPOPUP.as:60-61`);
  every monster spawned at one fixed point (`:113`; `WMATTACK.as:711`).
- **Strength.** Spawned as a wild custom attack at level 1 stats (`MONSTERBAITER.as:55-60`), weakened
  to 0.4-0.9 by the yard's value (`WMATTACK.as:729-752`); owner decision 2 drops the weakening.
- **No clock, no report, no replay.** It ran until the monsters died or were scared off
  (`MONSTERBAITER.End`), and its damage was real and saved.
- **Saved state** `{ queue, attackDir, musk }` under the `monsterbaiter` save key
  (`MONSTERBAITER.as:154-160`); the revamp keeps the key and ignores it
  (`docs/design/yard-buildings.md:241`).

What the whole game's roster is, for "full roster": the Flash locker lists C1-C19, C200 and
IC1-IC8 (spec §2.1, `:93-123`). C18 (Slimeattikus Mini, spawned by C17) and C200 (an AI-only looter)
are not monsters anyone flings. The web client's catalogue lists **18 surface monsters a player can
hatch: C1-C17 and C19** (`web/src/game/monsters/monsterCatalogue.ts:88-424`, C18 `blocked`). The
**8 Inferno monsters** (IC1-IC8) have combat stats (`web/src/game/combat/rules/combatStatsData.ts`)
and sprites and portraits, but no catalogue entry (no housing space ladder) and no way to get them
in the revamp yet. Owner answer Q2: they are not in the test roster.

## 3. What already exists

The simulator is mostly built from parts that are already in the web client.

| Part | Where | What it gives us |
| --- | --- | --- |
| Today's Baiter | `web/src/game/baiter/baiterSession.ts`, `baiterPlugin.ts`, `baiterRecord.ts`; `web/src/ui/yard/BaiterPanel.ts`; `web/src/ui/attack/BaiterSummary.ts` | Budget per level (`baiterSession.ts:34`), roster C1-C14 (`:41`), 4/8 directions (`:83`), a level 1 / academy switch (`:103`), the own-yard attack target with its defenders (`:181`), one fling far out (`baiterPlugin.ts:54`), a summary listing towers that fired (`:29`, `:86`) |
| The Baiter scene | `web/src/app/App.ts:220`, `web/src/app/scenes/AttackScene.ts:86-100`, `:163-165`, `:423-431` | The attack scene in practice mode: own yard handed over already loaded, no attack load, no checkpoint, no save, Stop and leave ask nothing, own traps shown (`:368`) |
| Attack screen plugins | `web/src/game/attack/attackPlugins.ts`, `web/src/game/attack/plugins/` | The army panel over the bucket (`army.ts`), tap-to-drop anywhere a real attack may drop (`drop.ts`, `AttackInput.ts`), the battle drawing (`battle.ts`). Each registers itself with `ATTACK_PLUGINS.push` (`army.ts:44`, `drop.ts:318`), so the Baiter scene cannot pick them yet |
| Shared combat engine | `web/src/game/combat/rules/`, mirrored at `server/src/game-rules/combat` | Every monster in the catalogue and IC1-IC8, champions G1-G5 with evolution level, power level and Mode, bunkers and the caged champion. **It already counts a per-tower report**: `TowerReport { id, type, level, damageDealt, shots, kills }` (`engine.ts:402-411`), in `battle.state().towers` (`:3724`), added for this issue (`docs/design/server-combat.md:1004`) |
| Playback | `AttackSession.playScript` (`web/src/game/attack/AttackSession.ts:485`), the watch scene (`web/src/game/autoAttack/watchPlugin.ts`, `watchRun.ts`) | A battle is fully decided by the yard, the army, the seed and the drop log, so it can be played again exactly. The auto-attack Watch (#221) does this today |
| Goals record | `web/src/game/baiter/baiterRecord.ts`, `server/src/services/goals/baiterRun.ts` | The one server contact: a token at the start, handed back at a real finish, to count goal N1 "Test Your Defences" |

What is missing:

1. The roster, the levels and champions in the setup (C1-C14 and a two-way switch today).
2. Dropping: the army lands in one fling at a fixed point; the army and drop controls are not mounted.
3. A replay.
4. The report counts only towers; traps, bunkers and the caged champion, when a tower first fired
   and when it fell are not counted, and today's summary shows only which towers fired.
5. Monster Lab abilities are not in the combat engine at all (`engine.ts:242-247`), so a test can
   only choose academy levels, not lab ranks. This design does not change that.

## 4. Does the server need to be involved?

**No new server work.** A test is a client simulation that changes nothing, so the server has nothing
to check, store or protect:

- No new route, no database change, no save key. The `monsterbaiter` key stays ignored.
- The yard comes from the load the client already holds; the army is made up on the client; the
  combat engine runs on the client; the replay and the report live in the browser's memory.
- **One existing contact is kept as it is:** the Goals record (`baiterRecord.ts`), so a finished test
  still counts for goal N1. It is two small calls that never get in the way (a refusal only means the
  run is not counted). The only change is when the token is asked for: at the first drop rather than
  when the scene opens, because the test now starts with the player dropping (WP3). The server's
  5-second minimum (`server/src/services/goals/baiterRun.ts:31`) still makes sense.
- Free and unlimited needs nothing either: nothing is spent, so there is nothing to meter.

Cheating is not a concern: nothing a test does reaches the player's save, resources or rankings.

## 5. How it works

### 5.1 The test army (WP1)

A **test army** is made up on the client, not taken from housing:

- **Monsters.** Every monster in the roster (the 18 surface monsters, C1-C17 and C19; owner answer
  Q2), each with a count and its own level from 1 to its highest academy level
  (`maxTrainingLevel`, `monsterCatalogue.ts:605`). Locked monsters are offered like any other, with a
  small "Not unlocked" tag so the player knows (decision 13).
- **Default level per row:** the player's own academy level for that monster, level 1 for one they
  have never trained. Three shortcuts set every row: **My levels**, **All level 1**, **All max**.
- **Champions.** Any of the five (Gorgo, Drull, Fomor, Korath, Krallen) at any evolution level (1-6,
  Krallen 1-5) and power level (0-3, Krallen 0-2), with a Mode. The attack's own rule still applies:
  one ordinary champion plus Krallen (`AttackSession.championBlock`). Each pick becomes a made-up
  champion entry in the roster (`ChampionSaveEntry`: `t`, `l`, `pl`, full `hp`, `status: 0`). Its
  learned brain: none. A test champion is always a fresh one at the chosen level (owner answer Q6).
- **Size.** Monsters count their housing space at the chosen level, as Flash did
  (`MonsterBaiterItem.as:35`). The cap is set by the Baiter's level, 600 to 4,800 (owner answer Q1). Champions take no
  space.
- **Shortcut: My army.** Copies the monsters housed in the yard right now at the player's own levels,
  so "will my real army get through my own defences?" is one click.

The army, levels and champion picks are kept for the session, as today (`BaiterPanel.ts:48-59`).

The attack target is built as today's `baiterTarget` is (`baiterSession.ts:181-207`): the own yard's
load with its `defenderforces`, the test army as the roster, no Catapult, no siege weapons, no
resources (owner answer Q7). That function moves to a neutral module so the wild raids can use it (§8).

### 5.2 The test screen (WP3)

The Baiter scene mounts the real attack's **army panel** and **tap-to-drop** on top of the battle
drawing, so a test plays exactly like a real attack: pick monsters in the dock, tap anywhere a real
attack may drop, as many drops as the army allows, the champion from its row, 1x/2x. The clock starts
at the first drop. **Stop** replaces Retreat and asks nothing. The far-out single fling and the
direction arrows go.

Not mounted, so nothing on this screen reaches the server: the attack's end package (the save), the
checkpoint package, the tutorial's practice-camp package.

Two things the army panel does on a real attack must not happen in a test:

- it saves the "last army" per player in `localStorage` (`bucket.ts:87-110`, `:387`); a test must not
  overwrite the real attack's last army;
- changing a champion's Mode saves it on the champion (`army.ts`, `onStanceChange`); a test champion
  is made up, so nothing is saved.

### 5.3 Replay (WP5)

Every finished test is kept in memory as a **recorded run**: a frozen copy of the yard as it was, the
test army, the seed and the drop log, and the tick it ended. Because the engine is deterministic, the
replay is the same battle, frame for frame, even after the player has changed the yard since.

**Watch replay** plays a recorded run on the Baiter scene with the army and drop controls left out
(as the auto-attack Watch does, `watchPlugin.ts`), with 1x/2x, and ends on the same report. The
last 5 tests are kept, gone on page reload (owner answer Q3). The Baiter panel lists them under
**Recent tests** with their result line, **Watch** and **Report**.

A replay does not ask for a Goals token: it is not a new test.

### 5.4 The report (WP0, WP4)

See §7. The engine's existing per-tower counters are extended (WP0) and the client turns them into
the report panel (WP4).

## 6. Click by click

The representative test: a player tries 20 level 3 Bandito and a level 4 Korath against their yard.

```
1. Tap the Monster Baiter in the yard.          Building panel opens, Test section showing last army
2. Set Bandito to 20 (stepper, or type it).     Size bar updates against the cap
3. Set Bandito's level to 3 (its level picker).
4. Champion: pick Korath, level 4.              Power level and Mode default to 0 and Hybrid
5. Press Start test.                            Baiter scene: own yard, army panel in the dock,
                                                clock not running
6. Tap the yard where the drop should land.     First drop: clock starts, Goals token asked for
7. (Optional) more drops; tap Korath's row,     As a real attack
   tap again to send him; 2x.
8. The test ends by itself (army beaten, yard   Report opens on the Summary tab
   flattened, clock out) or press Stop.
9. Towers tab: rows sorted by damage dealt.     Tap a row: the camera centres on that tower and
                                                rings it
10. Watch replay, Test again (same army,        Test again opens a fresh test screen; Change army
    fresh screen), Change army (back to the     reopens the Baiter panel in the yard
    Baiter panel), or Back to yard.
```

Five clicks from the yard to the first drop (1, 2, 3, 5, 6), plus the champion. A repeat test is
one click (Test again) plus the drops.

Phone: the setup lives in the building panel's bottom sheet, rows scroll; the test screen is the
attack screen's phone layout (`docs/design/attack-flow.md` §4.3); the report is a full-width modal
with tabs.

## 7. The report

The report opens when a test ends and after a replay. Three tabs.

**Summary**

- The result in one line: "Your yard held" (army beaten), "Flattened" (every building down), "Time
  ran out", or "Stopped".
- Damage %, buildings destroyed out of the total, time taken.
- Attackers beaten out of sent; champion: survived with N health, or fell at m:ss.
- One plain hint when it applies, read off the numbers, for example "3 towers never fired" or "Your
  Sniper Towers can't hit flying monsters, and this army flew" (ground-only tower types against an
  all-flying army, from the tower stats).

**Towers** (one row per defence)

| Column | Meaning | Source |
| --- | --- | --- |
| Tower | Name and level, e.g. "Cannon Tower L5" | `TowerReport.type`, `level` |
| Damage | Health it took off attackers | `TowerReport.damageDealt` (exists) |
| Kills | Attackers it finished off | `TowerReport.kills` (exists) |
| Shots | Shots fired | `TowerReport.shots` (exists) |
| First shot | m:ss of its first shot, or "Never fired" | new, WP0 |
| Fate | "Standing, 72%" or "Destroyed at 2:14" | building health (exists); destroyed tick new, WP0 |

Sorted by damage, most first; towers that never fired at the bottom. Tapping a row centres the camera
on that tower and rings it. The same tab lists, under their own headings:

- **Traps:** each trap that went off, its damage and kills (new, WP0; today only which traps fired,
  `engine.ts:419`).
- **Bunkers:** each bunker's garrison, monsters sent out, damage and kills, and losses (damage and
  kills new, WP0; losses exist as `bunkerLosses`).
- **Caged champion:** damage, kills, health left (damage and kills new, WP0; health exists as
  `defenderChampionHp`).

**Attackers** (one row per monster type, then the champions)

| Column | Meaning |
| --- | --- |
| Monster | Name and level |
| Sent / lost | Count dropped, count killed |
| Building damage | Health they took off buildings (new, WP0) |

Nothing in the report is sent anywhere.

## 8. What the wild raids (#226) can share

`docs/design/wild-raids.md` (branch `docs/226-wild-raids`) did not exist when this was written, so
this is what the raids will most likely need from this work, written so that it can be shared
without waiting:

- **An army on the player's own yard.** WP1 moves `baiterTarget` into a neutral
  `web/src/game/attack/ownYardTarget.ts`: own yard load plus defenders plus any roster. A raid on
  the client (a staged tutorial raid, or watching a raid) can build its target the same way.
- **The defence report.** WP4's report is about the defender's side (towers, traps, bunkers, caged
  champion). A raid's "how your defences did" screen can reuse the panel and the pure report builder.
- **Replay.** A server-fought raid saved as seed plus drop log can be watched with the playback path
  WP5 uses, as the auto-attack Watch already does.
- **Not shared:** a real raid saves damage and is fought by the server; the simulator never saves.

## 9. The owner's answers (2026-10-05)

The seven open questions, answered by the owner on 2026-10-05. The rest of the document is built to
these answers.

| # | Question (plain language) | Answer | What it means for the work |
| --- | --- | --- | --- |
| Q1 | **How big can a test army be?** | **The Baiter's level sets it:** 600 housing space at level 1 up to 4,800 at level 7 (600, 900, 1,200, 1,500, 2,100, 3,200, 4,800). | One cap per level in WP1; Baiter upgrades keep a purpose |
| Q2 | **Should the 8 Inferno monsters (Spurtz to King Wormzer) be testable?** | **No:** the 18 surface monsters (C1-C17, C19) plus the champions. | `TEST_ROSTER` in WP1 is the 18 surface monsters |
| Q3 | **How many replays are kept, and do they survive a page reload?** | **The last 5 tests, gone on page reload** (the proposal; the owner did not object). | WP5 keeps 5 recorded runs in memory only |
| Q4 | **Offer a "full health, traps re-armed" switch?** | **No.** A test always uses the yard as it is right now (decision 4). | No `fullHealthYard` in WP1, no switch in WP2 |
| Q5 | **Test a saved planner layout** instead of the current yard? | **Later:** a backlog idea, #307. | Nothing in WP0-WP6 |
| Q6 | **A test champion's battle habits:** your own learned champion (#219), or a fresh one? | **Always a fresh champion at the chosen level**, never the player's own learned one. | WP1's made-up champion entries carry no learned brain |
| Q7 | **Catapult bombs and siege weapons in tests?** | **No:** monsters and champions only (the proposal). | No Catapult picker; the target carries no Catapult, siege or resources |

## 10. Work packages

Order: WP0 and WP1 can start at once; WP2 and WP3 after WP1, in parallel; WP4 after WP0 and WP3;
WP5 after WP3 (its report screen after WP4, its Recent tests list after WP2); WP6 last.

### WP0 — Engine: a fuller battle report

**Goal:** the engine counts everything the report shows (§7), without changing any battle.

**Scope:**

- `TowerReport` gains `firstShotTick` (null until it fires) and `destroyedTick` (null while
  standing), set where `shots` is counted (`engine.ts:3022`, `:3099`, `:3144`) and in `destroy`
  (`:1254`).
- `BattleState` gains `traps` (per trap that went off: id, type, damage, kills; counted at the trap
  hits, `:3307`, `:3314`), `bunkers` (per bunker: damage and kills by its garrison, through the
  defender creep's `homeBunker`), `defenderChampion` (damage, kills), and `attackers` (per monster id
  and per champion: sent, lost, building damage, counted in the building-damage path, `:1280-1295`).
- Outputs only: nothing a battle decides reads them, they are not in the checkpoint or the digest.
- Edit in `web/src/game/combat/rules/`, run the sync script and commit both trees and both
  `MANIFEST.json` files.

**Tests:** new cases in `engine.test.ts` (a tower's first shot and fall ticks; a trap's damage; a
bunker garrison's kills; attackers' building damage adds up to the buildings' health lost); the
golden fixtures, `digest.test.ts`, `replay.test.ts`, `sync.test.ts` and the server's
`bun test` replay unchanged.

**Depends on:** none. **Size:** S.

### WP1 — The test army and the own-yard target

**Goal:** the pure model of a test: any monster at any level, champions, a size cap, and the attack
target built from it (§5.1).

**Scope:**

- `web/src/game/baiter/baiterSession.ts`: replace `BAITER_ROSTER` (C1-C14), `BaiterDirection`,
  `directionsOf`, `spawnPointOf` and the `BaiterLevels` switch with: `TEST_ROSTER` (18 monsters, Q2), a test army
  `{ monsters: {id: {count, level}}, champions: [{t, l, pl, s}] }`, `defaultLevelOf` (own academy
  level, else 1), the shortcuts (`myLevels`, `allLevel1`, `allMax`, `myArmy` from the housed
  monsters), size and `maxOf` at each row's level, the cap (by Baiter level, Q1), `clampArmy`.
- Made-up champion entries for the roster (`ChampionSaveEntry` with full health and `status: 0`),
  always fresh, with no learned brain (Q6).
- Move `baiterTarget` to `web/src/game/attack/ownYardTarget.ts` (`ownYardTarget(save, roster)`), kept
  general for #226; the Baiter builds its roster and calls it.
- `BaiterRun` becomes `{ save, army, baiterLevel }`.
- No `fullHealthYard`: the owner said no to Q4, so a test always uses the yard as it is.

**Tests:** `baiterSession.test.ts` rewritten: locked monsters allowed; levels clamp to each monster's
range; size counts each row's level; cap and `clampArmy`; one ordinary champion plus Krallen; My army
copies housing; `ownYardTarget` carries `defenderforces` and no Catapult, siege or resources.

**Depends on:** none. **Size:** M.

### WP2 — The setup panel

**Goal:** the Baiter's building panel sets up a test as §5.1 and §6 steps 1-5 describe.

**Scope:**

- `web/src/ui/yard/BaiterPanel.ts` rewritten: the compass and the level switch go; a size bar against
  the cap; one row per monster (portrait, name, "Not unlocked" tag, level picker, `QuantityStepper`
  with Fill), unlocked monsters first; shortcut buttons My army, My levels, All level 1, All max;
  a champion section (type, level, power level, Mode; Krallen as a second pick); Clear and
  **Start test**. Keep `TutTarget.BAITER_RUN` on the start button (`BaiterPanel.ts:194`) and the
  Baiter tip (`web/src/game/guide/tipsCatalogue.ts:180-183`) working.
- Keep the "why not now" refusals (damaged or busy Baiter, `web/src/ui/yard/buildingActions.ts:574-580`).
- No full-health switch (owner answer Q4).
- `web/src/ui/styles/baiter.css`.

**Tests:** `BaiterPanel.test.ts` rewritten: every roster row present, locked ones tagged; level
picker changes the size; Fill respects the cap; shortcuts; champion picks; Start hands the scene a
`BaiterRun` with the army; the panel remembers the army for the session.

**Depends on:** WP1. **Size:** M.

**As built (#308, after the owner tried it).** The setup is no longer in the building panel: **Test attack** opens a large window in the middle of the screen (about 90% wide, up to 1240 x 800 px) on the overlay's modal layer, the yard dimmed behind it. Title "Baiter: test attack" with a close button; the size bar and the four shortcuts along the top; the 18 monsters as a grid of cards (portrait, name, "Not unlocked" tag, level picker, stepper with Fill), all visible without scrolling on a desktop; the champion row (type, Level, Power, Mode, "Krallen as well") with Clear and **Start test** along the foot. Recent tests is a second tab ("Recent tests (n)") once a test has finished. On a phone the window is a full-screen sheet with two cards a row that scrolls. The refusals now read "Repair the Baiter to run a test attack." and "The Baiter can run a test attack once its job is done."; the Krallen row no longer shows empty Level and Power boxes before it is ticked.

### WP3 — Drop anywhere on the test screen

**Goal:** the Baiter scene plays like a real attack with the test army (§5.2, §6 steps 5-8).

**Scope:**

- Export the army and drop plugins from `web/src/game/attack/plugins/army.ts` and `drop.ts` (they
  still push onto `ATTACK_PLUGINS`), and mount them in `BAITER_PLUGINS`
  (`web/src/game/baiter/baiterPlugin.ts:113`) in a test flavour: the bucket keeps no last army
  (inject a null store, `bucket.ts:87-110`) and a Mode change saves nothing (`onStanceChange` off).
- `baiterPlugin.ts`: drop the one far-out fling (`:54`) and the camera turn; ask for the Goals token
  at the first drop instead of at mount (`:46`); the dock names the test ("Test attack: nothing is
  saved").
- `AttackScene.ts`: no change expected; the strip already reads **Stop** in practice and asks
  nothing (`:581`, `:86-92`).
- `web/src/ui/attack/BaiterSummary.ts`: the dock panel changes to the test army; the summary stays
  until WP4 replaces it.

**Tests:** `baiterPlugin.test.ts`: a full test with every request stubbed to fail makes no request
except the two Goals calls, and those only after the first drop; drops land where tapped; the army
panel offers exactly the test army at its levels; a champion can be sent; no `localStorage` write
under the last-army key; Stop ends the test with reason `retreat`.

**Depends on:** WP1. **Size:** M.

### WP4 — The report

**Goal:** the report panel of §7.

**Scope:**

- A pure builder, `web/src/game/baiter/testReport.ts`: battle state (with WP0's fields) plus the yard
  and the army in, report rows out: the result line, totals, the hints, tower rows sorted, traps,
  bunkers, caged champion, attacker rows. Names from `typeName` and `MONSTER_NAMES`.
- `web/src/ui/attack/TestReport.ts` replacing `BaiterSummaryPanel`: Summary, Towers, Attackers tabs;
  tapping a tower row centres the camera on it and rings it (`mounts.camera.centreOn`,
  `mounts.renderer.yardToWorld`); buttons Watch replay (shown once WP5 lands), Test again, Change
  army, Back to yard. Phone: full width, tabs at the top.
- "Change army": back to the yard with the Baiter's panel opened.

**Tests:** `testReport.test.ts` against a headless battle (`createBattle` on a small fixture yard):
rows match the engine's counters, sort order, "Never fired", the flying-army hint, result lines for
each end reason. A panel test for the tabs and the row tap.

**Depends on:** WP0, WP3. **Size:** M.

**As built.** A champion's "fell at m:ss" is read off the scene's quarter-second notifications (the engine keeps no death tick). On a wide screen the report stands at the right over a clear backdrop, so a tapped tower is centred in the yard left of it; on a phone it is a bottom sheet and the tower is centred above it. "Change army" goes back through a yard intent (`yardIntent.ts`, kind `baiter`) that selects the Baiter and opens its test panel.

**As built (#308).** The report is now the same large centre window as the setup, the yard dimmed behind it, and a full-screen sheet on a phone. Tapping a tower, trap or bunker row steps the window aside: the scrim lifts, the camera centres on the building and outlines it, and a small bar at the foot says "Showing Cannon Tower L5" with **Back to report** (Escape works too), which brings the window back and drops the outline.

**As built (#308, the "frozen" end).** The engine stops on the tick a test ends, so its last frame (a champion mid-step, a laser mid-sweep, a bullet in the air) used to stand behind the report as if the game had hung, while the yard's own life (Housing monsters) kept moving. As the report opens, the Baiter package now asks `AttackPresentation.settle()`, which the battle layer answers (`AttackBattleLayer.settle`): every attacker and champion goes, every gun stands down (a Tesla back to idle, beams and bullets gone), and each building shows the engine's own health; splats, smoke and numbers already made fade out on the wall clock. The report's scrim dims the yard. A replay's end does the same. A real attack's end screen never calls it and is unchanged.

### WP5 — Replay and Recent tests

**Goal:** every finished test can be watched again and its report reopened (§5.3).

**Scope:**

- `web/src/game/baiter/testHistory.ts`: a recorded run `{ save copy, army, seed, events, endTick,
  summary line }` taken from the session at the end (`session.flingLog()`, `session.seed`); keep the
  last 5 in memory, gone on reload (Q3).
- Playback: the Baiter scene in replay mode mounts the battle layer and the Baiter package only,
  hands the engine the recorded seed and plays the drops with `session.playScript`
  (`AttackSession.ts:485`), as the auto-attack Watch does (`AttackScene.ts:378-382`). Ends on the
  report with Watch again and Back to yard. No Goals token.
- Watch replay on the report; **Recent tests** list in the Baiter panel (result line, Watch, Report).

**Tests:** a replay of a recorded run ends with the same battle state (damage, destroyed ids, tower
counters) as the original; the history keeps the last N; a replay makes no request; editing the yard
after a test does not change its replay.

**Depends on:** WP3; WP4 for the report screen, WP2 for the Recent tests list. **Size:** M.

**As built.** A replay is its own scene, `baiter-replay` (`SceneName.BAITER_REPLAY`), mounting `BAITER_REPLAY_PLUGINS` (the battle layer and the Baiter package); the recorded run travels as a `BaiterRun` with a `replay` field (seed, drops, end tick, report). A test stopped before its first drop is not kept. The yard is copied when the test is recorded. The replay ends on the recorded report with **Watch again** and **Back to yard**. **Report** in Recent tests opens that report over the yard with **Watch replay** and **Close**; its rows do not show a tower, because the yard may have changed since. The test clock now waits for the first drop (`AttackSessionOptions.clockFromFirstDrop`), so a recorded test's first drop is at tick 0.

### WP6 — Wrap-up

**Goal:** the docs say what was built and the whole flow is checked in the browser.

**Scope:** `docs/design/yard-buildings.md` §8.1 "As built" rewritten for the simulator (roster,
levels, drops, report, replay); a note under `docs/specs/monsters-and-hatchery.md` §8 pointing here;
the Baiter tip's text if it names arrows; a browser walkthrough as `agenttester`: set up a test with
a locked monster and a champion, drop twice, read the report, tap a tower row, watch the replay,
Test again, confirm the yard is unchanged afterwards. Close #22.

**Depends on:** WP0-WP5. **Size:** S.

**As built.** `docs/design/yard-buildings.md` §8.1 "As built" now describes the simulator, and
`docs/specs/monsters-and-hatchery.md` §8 points here; the Baiter tip named no arrows, so it stayed. The
browser walkthrough (2026-10-05, `agenttester`, desktop and phone) passed. Two layout fixes came out of
it: a champion on the field no longer squeezes its name to an ellipsis beside Retreat (the army panel,
real attacks too), and a Recent tests row keeps Watch and Report together under its result line.
