# Wild Monster Raids on Player Yards — Design (issue #226)

Status: planning, 2026-10-05. Owner decisions of 2026-10-05 are final (§1). The §10 questions were
answered by the owner on 2026-10-05; the answers are in §10 and the sections below follow them.

## Contents

1. [Owner decisions](#1-owner-decisions-2026-10-05)
2. [How Flash did it](#2-how-flash-did-it-facts-with-citations)
3. [Who decides what](#3-who-decides-what)
4. [The flow, end to end](#4-the-flow-end-to-end)
5. [The army: tribe, direction, size, strength](#5-the-army-tribe-direction-size-strength)
6. [The fight and its outcome](#6-the-fight-and-its-outcome)
7. [Cancel on quit, online, other players](#7-cancel-on-quit-online-and-other-players)
8. [Where state lives](#8-where-state-lives)
9. [Work packages](#9-work-packages)
10. [Owner questions (answered)](#10-owner-questions-answered-2026-10-05)

---

## 1. Owner decisions (2026-10-05)

| # | Decision |
|---|---|
| D1 | **Online only, live, as in Flash.** A raid starts only while the player is online, on their own yard in build mode, with the Planner closed. They watch the fight on their yard. |
| D2 | **Flash's timing and size.** Level 9 and up; at least 4 sessions since the last raid; due 2, 3 or 4 days after the last raid by the player's more / same / less choice. The same choice scales the army (x1.3 / x1 / x0.5) and the hits each raider makes before leaving (50 / 30 / 20). After each raid the frequency-choice popup appears. |
| D3 | **Theft as in Flash.** Raiders steal from unbanked harvesters, silos and the Town Hall. Damaged buildings repair themselves afterwards. |
| D4 | **New, not Flash:** a good defence (the yard at least 90% healthy at the end) gives **10 Shiny**. |
| D5 | **Quit = cancel.** If the player closes the game or loses connection mid-raid, the raid is cancelled: no theft kept, no reward, and it comes back at the next due time. The owner accepts that a losing player can dodge this way. |
| D6 | **The warning works as in Flash.** A "WILD MONSTER ALERT" offers "Engage now" or "Prepare defences" (a 5-minute countdown in the top bar). No skip. |
| D7 | **Later, separate issue (Backlog):** the Trojan Horse and the special events (WMI1/WMI2, Monster Blitzkrieg). |
| D8 | **Already in #226:** the tutorial's staged raid becomes a named tribe attack (still harmless), and the later defence goal becomes "survive a tribe attack". |

Later owner decisions (2026-10-06):

| # | Decision |
|---|---|
| D9 | **Raiders use the defending player's own Monster Academy levels** per monster type, not level 0/1 — an untrained type still spawns at level 1. |
| D10 | **The hit limit is dropped entirely.** A raider now fights exactly like a normal attacker: it leaves only when it dies or has nothing left to attack, never on a swing count. |

The owner's answers to the §10 questions (2026-10-05) are just as final. In short: a cancelled raid
comes back on the next yard visit; quitting during the warning is a cancel; the tribe is random; the
raid comes in on the least-defended side, with tanks, as Flash meant it to; no raid while anything
is damaged or repairing; protection does not stop raids; the goal counts only a 90%+ defence; plain
monster stats, no strength scaling. A raid counts as an attack on a **normal yard**, never as a
wild-camp attack.

---

## 2. How Flash did it (facts, with citations)

All paths are under `client/scripts/`. Flash ran the whole thing on the client; the server only
stored the client's `aiattacks` JSON.

### 2.1 Timing and gates

- **State** is `_history`, saved as the base's `aiattacks`: `lastattack`, `nextAttack`,
  `sessionsSinceLastAttack`, `attackPreference`, `queued`, and `s1` for the Trojan Horse
  (`WMATTACK.as:135-202`, loaded from `BASE.as:1066`).
- **A session** is one own-yard load in build mode: `Setup` adds 1 to `sessionsSinceLastAttack` each
  time (`WMATTACK.as:155`).
- **Long gap or first raid:** if the last raid was more than 4 days ago (345,600 s), `nextAttack` is
  set to 60 s from now (`WMATTACK.as:190-199`).
- **The frequency choice** sets `nextAttack = lastattack + 2 / 3 / 4 days`, the army amplifier
  1.3 / 1 / 0.5 and the hit limit 50 / 30 / 20 (`WMATTACK.as:978-1008`). The popup's buttons are at
  `WMATTACK.as:378-424`; closing it keeps the old choice.
- **The trigger** runs every tick in build mode and needs all of (`WMATTACK.as:326-330`):
  `sessionsSinceLastAttack >= 4` (`:72`), `now > nextAttack`, base level >= 9, no Trojan running,
  no bought protection (`BASE._isSanctuary`), the Planner closed, no special event running, and no
  Inferno emergence event.
- **The damaged-yard check never worked.** `baseIsRepairing` was meant to stop raids while
  buildings were damaged, but its filter `!(x is BTRAP === false || x is BTOWER === false)` is only
  true for a building that is both a trap and a tower, so it never counts anything on a main yard
  (`WMATTACK.as:271-287`). On an outpost the same code always reads "repairing", which is why
  outposts were never raided.
- **No randomness in timing.** The only randomness is the fallback tribe (§5.1).

### 2.2 Warning and countdown

- `Trigger` builds the army (§5) and `Queue` stores it with `attackTime = now + 300` and
  `warned: 0` (`WMATTACK.as:512-540`). The 5 minutes start when the raid is queued, not when the
  player answers.
- The "WILD MONSTER ALERT" popup (`AIATTACKPOPUP.as`, title key `ai_popupwarning_title`, `:48`)
  shows the tribe and up to three monster types (`:62-105`). "Engage now" calls `WMATTACK.Attack`,
  which sets `attackTime = now` (`AIATTACKPOPUP.as:139-143`, `WMATTACK.as:604-606`, `:542-547`). "Prepare
  defences" sets `warned = 1` and saves (`AIATTACKPOPUP.as:53-60`); the top bar then shows "WILD
  MONSTERS SPOTTED!" with the time left (`WMATTACK.as:307-324`).
- When `attackTime` passes, the raid launches if the player is in build mode with the Planner closed
  (`WMATTACK.as:317-321`). The queued raid was saved, so a player who left and came back later met
  it at once.

### 2.3 The fight

- `AttackB` hides the top and bottom HUD, shows "Don't Panic!" (`msg_dontpanic`), closes the
  Planner, Store and Hatcheries, and blocks saves (`WMATTACK.as:777-791`). Panic music plays
  (`:574-579`).
- One wave: every monster type is spawned at the chosen bearing, scattered in a disc
  (`SpawnA`/`SpawnB`, `WMATTACK.as:678-775`). Kozu's swarm comes as groups of three every 8 degrees
  (`:691-708`). Each raider's hit limit is set to the current hits setting (`:593-597`).
- **Strength:** every raider's health and damage are multiplied by 0.4, rising to 0.5 / 0.6 / 0.7 /
  0.8 / 0.9 once points + base value pass 1M / 3M / 6M / 15M / 50M (`WMATTACK.as:729-753`, used
  by `CreepBase.as:88` and `:93`). Raiders are spawned at level 0 (`CREEPS.as:243-255`).
- **Leaving:** a raider that has hit buildings more than its limit leaves the yard
  (`CreepBase.as:926-941`; hits on monsters do not count, `:928-930`).
- **The end:** when no raider is left, or none is still attacking, looting or hunting
  (`WMATTACK.as:331-347`). There is no countdown.
- The champion cage opens and bunkers send defenders, as in any defence (facts file; the engine
  already models both, §6.1).

### 2.4 Theft

- Every hit on a building loots `damage x lootingMultiplier` from it (`BFOUNDATION.as:528-534`).
- A **harvester** gives up to what it holds unbanked (`BRESOURCE.as:93-127`); at 0 it stops.
- A **silo or the Town Hall** (`BUILDING6`, `BUILDING14` extend `BSTORAGE`) takes
  `ceil(damage x lootingMultiplier)` of **one random banked resource** the player has, from the
  bank itself (`BSTORAGE.as:30-91`). There is no cap other than the hits.

### 2.5 After the fight

- `CleanUp` (`WMATTACK.as:806-870`): shows the HUD, sums health over every building except walls
  and traps, and **starts a repair on every damaged building** (`:829-840`). It resets the wait:
  `sessionsSinceLastAttack = 0`, `nextAttack` and `queued` deleted (`ResetWait`, `:964-972`).
  `lastattack` was set when the raid launched (`:572`).
- At 90% of total health or more: the "well defended" popup with a Brag button
  (`ATTACK.as:1006-1047`). Below: the "poor defence" popup with "Repair all" and "Repair now"
  (`ATTACK.as:1049-1090`). **No reward.**
- Then the frequency popup (`WMATTACK.as:867-871`).

### 2.6 Things Flash did that we leave out or change

- Trojan Horse and events: later (D7).
- Flash only applied the amplifier and hit limit when the frequency setter ran, so after a reload
  they silently fell back to x1 and 30 (`WMATTACK.as:197-199`, `:978-1008`). D2 applies the choice
  every time.
- Flash had no reward (D4 adds 10 Shiny) and kept a queued raid across reloads (D5 cancels).
- Flash's two broken checks work as they were meant to here: the damaged-yard check (Q5) and the
  least-defended-side check (Q4).
- Flash's strength scaling (x0.4 to x0.9) is dropped: raiders fight with plain stats (Q8).

---

## 3. Who decides what

**The server decides everything that matters. The client only shows it and says "I'm here".**

| What | Who | How |
|---|---|---|
| Is a raid due? | Server | §4.1 rule, on the presence ping |
| Which tribe, which direction, which monsters, how many, hits before leaving | Server | §5, from the saved yard |
| The seed | Server | fresh random 31-bit number per raid |
| When the fight starts | Server | `attackAt` it stored; the client can only bring it forward ("Engage now") |
| The fight | Server | runs the shared engine once, at fight start, on the frozen yard (§6) |
| Damage, theft, bunker and champion losses | Server | the engine's outcome; nothing from the client |
| Good defence and 10 Shiny | Server | from the outcome's health (§6.3) |
| Repairs, schedule reset, frequency | Server | at finish; the frequency is the one thing the player chooses |
| Showing it | Client | plays the same engine with the same seed on the same yard, as auto-attack's Watch does |
| Being there | Client | presence pings, the screen it is on, and the finish call |

The client's word is trusted for one thing only: that it is on the yard screen with the Planner
closed. Lying about that can only avoid a raid, which D5 already allows.

---

## 4. The flow, end to end

### 4.1 Due rule (server)

A raid is due for a player when all hold:

1. Main yard, Map Room 1 or 2 (not an outpost, not Inferno; Flash never raided outposts, §2.1).
2. Player level (`playerLevelOf`) >= 9.
3. `sessionsSinceLastAttack >= 4`.
4. `now >= nextAttack`. When the last raid was over 4 days ago, or there never was one, `nextAttack`
   is 60 s after the session began (§2.1).
5. Online by #271's rule with the attack load's 60 s window (`isPlayerOnline`,
   `services/user/online.ts`), and no in-game check pending (#273).
6. The latest presence ping said "yard, Planner closed" (§7.3).
7. The yard is not under attack (`isAttackActive`) and no raid is already open.
8. Protection does **not** stop raids (Q6): bought or earned, the timer is ignored.
9. No building in the yard is damaged or repairing (Q5), as Flash's `baseIsRepairing` was meant
   to work (§2.1). A raid that is due waits until the yard is whole again.

### 4.2 Steps

```
 client (yard, Planner closed)                 server
 ──────────────────────────────                ──────────────────────────────────────────
 POST /presence {where:"yard",planner:false} ─▶ due? roll tribe, army, bearing, seed
                                             ◀─ raid {id, phase:"warning", tribe, monsters, attackAt}
 show WILD MONSTER ALERT
   "Engage now"     ─ POST /raid/engage ──────▶ attackAt = now
   "Prepare"        ─ POST /raid/prepare ─────▶ warned = 1   (top bar countdown)
 at attackAt (still yard, Planner closed)
 POST /raid/start ──────────────────────────▶ freeze yard, run engine in a worker,
                                               keep outcome, phase "fighting", lock yard
                                             ◀─ {seed, events, options} (no outcome)
 play the fight (HUD hidden, "Don't Panic!")
 POST /raid/finish ─────────────────────────▶ checks (§7.1); apply outcome; reset wait
                                             ◀─ result {defended, stolen, shiny, damaged}
 result popup, then frequency popup
 POST /raid/frequency {more|same|less} ─────▶ preference, nextAttack
```

- Every `/raid/*` call is a real game action (`realActions.ts`), so watching a raid keeps the player
  online by #271's rule.
- The army, bearing and seed are rolled when the warning is shown and do not change. The yard the
  fight runs on is the yard **at fight start**, so building, repairing, hatching or filling bunkers
  during the 5 minutes counts, as in Flash.
- If `attackAt` passes while the player is elsewhere (map, attack, Planner open), the raid waits.
  It launches as soon as they are back on the yard with the Planner closed (Flash, §2.2), unless it
  was cancelled first (§7.1).
- The frequency popup: no answer keeps the previous choice (Flash's close button, §2.1).
- `/raid/start` and `/raid/finish` take the save's row lock, as other yard actions do.

### 4.3 What the player sees (client)

- **Alert popup:** tribe name and picture, up to three monster types with names, "Engage now" and
  "Prepare defences", no close-to-skip (D6).
- **Top bar:** "WILD MONSTERS SPOTTED!" with the countdown to `attackAt`.
- **Fight:** the attack scene in a raid mode (a fourth variant next to attack, practice and watch,
  `AttackScene.ts:86-100`; a HUD-hidden flag is new, none exists today), showing the player's own yard (as Watch shows a camp):
  no army panel, no input, HUD hidden, "Don't Panic!" banner, 1x/2x kept. Back to the yard after.
- **Result popup:** "well defended" (+10 Shiny shown) or "poor defence" with what was stolen and
  "Repair now" (the existing `FIX`). Repairs have already started (D3).
- **Frequency popup:** more / same / less, the tribe's taunt.

---

## 5. The army: tribe, direction, size, strength

All of this is computed on the server from the saved yard, by pure functions (WP1).

### 5.1 Tribe

- **Flash:** the first camp, by level ascending, that is not destroyed and has
  `level >= player level - 10` (`WMATTACK.as:465-480`; `WMBASE.as:82-97` sorts by level). With no
  Map Room 1 camps loaded, a random one of the four (base id 10/20/30/40, `WMATTACK.as:481-500`);
  failing that, Legionnaire (`:502-506`).
- **Tribe to plan** (`TRIBES.as:43-99`): Legionnaire = `PROCESS3`, towers; Kozu = `PROCESS4`, swarm;
  Abunakki = `PROCESS5`, kamikaze; Dreadnaut = `PROCESS7`, looters.
- **Here:** a Map Room 1 player's camps are `save.wmstatus` `[baseid, level, destroyed]`
  (`services/maproom/v1/mr1TribeRules.ts:74-85`). The four camps sit at player level -1, +0, +1,
  +2 (`MR1_TRIBE_LEVEL_OFFSETS`, `:67`), so Flash's rule picks the Legionnaire camp unless it is
  down (10 minutes, `MR1_TRIBE_RESPAWN_SECONDS`). A Map Room 2 player has no camps.
- **Decided (Q3):** the tribe is random, one of the four, for every player (Map Room 1 or 2),
  rolled from the raid's seed. Flash's camp rule is not used.

### 5.2 Direction

- **Flash:** 16 entry points on a circle, every 22.5 degrees, at radius 800 (the main yard's
  `_mapWidth`, `GLOBAL.as:802`; `Solution.as:44-48`; `WMATTACK.as:30`). For each, a path to the
  plan's first target: the nearest tower for Legionnaire (`PROCESS3.as:40-61`), the nearest
  harvester, silo or Town Hall for the others (`PROCESS4.as:45`, `PROCESS5.as:38-60`,
  `PROCESS7.as:45`). Along the path, every third step adds tower damage per second
  (`ProcessB`, `PROCESS3.as:90-99`; `dpsAtPoint`, `WMATTACK.as:1011-1030`). Sorted by damage, then
  path length, both descending, and the last one taken (`PROCESS3.as:75-88`, intelligence 1): the
  least-defended way in, the shortest on a tie.
- **Flash's bug:** `dpsAtPoint` only counts a tower whose fortify countdown is running
  (`WMATTACK.as:1020`), so on almost every yard every direction scores 0 and the raid takes **the
  shortest path to its first target**. It also changes the armies of Abunakki and Dreadnaut, which
  read the damage (§5.3). Decided in **Q4** below: we do what Flash meant.
- **Decided (Q4): as Flash meant it, not as it behaved.** The damage along each path counts every
  tower in range, not only the ones with a fortify countdown running, so the raid comes in on the
  least-defended side (the shortest way on a tie), and Abunakki and Dreadnaut bring tanks when
  that way still takes damage (§5.3).
- **Here:** the server floods the engine's grid (`game-rules/combat/grid.ts`) from each entry point
  to the target, which is what the engine already does for creeps.

### 5.3 Size and make-up

Every plan counts the yard's harvesters, towers, "special" buildings, traps and walls, each with a
weight, times the amplifier (1.3 / 1 / 0.5), then truncates (intelligence is always 1, so its
`x(0.5 + 0.5 x 1)` is x1). The monster tier is `f = min(1, level / 40)`.

| Tribe | Weight (building / trap or wall) | Make-up | Monsters by tier | Source |
|---|---|---|---|---|
| Legionnaire | 1 / 0.13 | tanks `N/3`, damage dealers `N/6` | tank `[C2,C6,C10,C12][int(3f)]`, damage `[C1,C4,C7,C8,C11,C11][int(5f)]`; C12 halved, rounded up | `PROCESS3.as:116-173` |
| Kozu | 1.4 / 0.2 | three neighbouring "fodder" types, `int(0.33N)` each | `[C1,C1,C1,C3,C8,C9]` at `int(5f)` and the slots either side | `PROCESS4.as:108-153` |
| Abunakki | 0.3 / 0.01 | if the path takes damage: looters `0.2N`, tanks `0.8N/1.3`, kamikaze `tanks/0.3`; else all kamikaze; kamikaze over 5 become looters | looter `[C3,C9][int(f)]`, tank as above, kamikaze C5 | `PROCESS5.as:120-196` |
| Dreadnaut | 1 / 0.15 | looter share = loot / (damage + loot), at least 0.5, rest tanks; no damage: all looters | looter `[C9,C14][int(f)]` (C14 divided by 2.5, rounded up), tank as above | `PROCESS7.as:110-170` |

Worked example (same choice, Legionnaire): 30 buildings and 100 walls and traps give
`N = int(30 + 13) = 43`: 14 Octo-oozes (C2) and 7 of C4 at level 9.

**Spawn distance per type** (`distances`): `200 / speed(first type)` seconds of walking, so every
type starts the same walking time out and they arrive together; damage dealers add 25, kamikaze 40,
looters 80 (`PROCESS3.as:138-155`, `PROCESS5.as:166-187`). Each type lands in a disc centred
`800 + d/2` out, radius `d/2` (`WMATTACK.as:710-718`, `:755-768`).

**The exact formulas, as built** (WP1, `server/src/services/raids/raidArmy.ts` and
`raidDirection.ts`, copied from Flash's `ProcessC` and `ProcessB` with every `int` and `ceil`):

- **Size:** `N = trunc(sum over buildings of w x A)`, added one building at a time in id order (so
  the float rounds as Flash's loop did). `w` is the tribe's building weight for a harvester, tower
  or "special" building, its trap-or-wall weight for a trap or wall, 0 for anything else; `A` is
  1.3 / 1 / 0.5. Damaged buildings count too (none are, Q5).
- **Tier:** `f = min(1, max(0, level / 40))`. Tank `RAID_TANKS[trunc(3f)]` (C2, C6 from level 14,
  C10 from 27, C12 at 40); damage dealer `[C1,C4,C7,C8,C11,C11][trunc(5f)]` (a step every 8
  levels); Abunakki's looter `[C3,C9][trunc(f)]`; Dreadnaut's `[C9,C14][trunc(f)]`.
- **Legionnaire:** `tanks = N/3`, `dealers = tanks/2`; C12 tanks become `ceil(tanks/2)`; both
  truncated.
- **Kozu:** slots `m = trunc(5f)`, `m-1` and `m+1` (held at the table's ends) of
  `[C1,C1,C1,C3,C8,C9]`, `trunc(0.33N)` each (the same type twice adds up).
- **Abunakki:** with fire on the way in, `looters = 0.2N`, `tanks = (N - looters)/1.3`,
  `kamikaze = tanks/0.3`; with none, `looters = tanks = 0`, `kamikaze = N` (1 when `N < 1`). Each is
  then rounded up; kamikaze above 5 become looters (kamikaze = 5); C12 tanks `ceil(/2)`; all
  truncated.
- **Dreadnaut:** with fire, `share = max(0.5, loot / (fire + loot))`, `looters = share x N`,
  `tanks = N - looters`; with none, all looters. C12 tanks `ceil(/2)`, C14 looters `ceil(/2.5)`;
  truncated.
- **Walk:** `walk = 200`, plus `100 - distance` when the target is nearer than 100 to the way in.
  The first type present (tank, else the next) sets `time = walk / speed`; each type's distance is
  `time x its speed`, plus 25 (damage dealers), 40 (kamikaze) or 80 (Abunakki's looters). Kozu's
  time comes from its low slot. Speeds are level-0 `speed`.
- **Way in:** 16 bearings `22.5 x i`, entry `800 x (cos, sin)` with Flash's degrees constant
  `0.0174532925`. Target: the nearest candidate (by anchor) to the entry, lower id on a tie;
  Legionnaire's candidates are shooting towers, the others' (and Legionnaire's with no shooting
  tower) harvesters, silos and the Town Hall not looted out, and failing those any harvester,
  tower or special building. Route: the engine grid's path from the entry. Fire:
  `200 x 3 x sum(damage / rate)` of every shooting tower whose range reaches every third waypoint,
  range measured from the tower's middle. Loot worth: `min(10000, 0.04 x twigs bank)` for a silo or
  Town Hall, else `min(10000, 0.1 x the harvester's unbanked amount)`. Pick: sort by fire, then
  route length, both descending (Abunakki: then worth ascending), stable, and take the last.
- **Landing:** one disc per type at `800 + d/2` out, radius `d/2`, pulled in (and only if that is
  not enough, shrunk) to stay a cell inside the pathing grid (±1300). Kozu lands in threes, each
  three 8 degrees further round, a remainder with the last three; its count is exact.

**Defaults decided in WP1** (orchestrator, owner told; not owner questions):

1. Kozu comes in its exact planned number. Flash spawned a whole three while any were left, then
   the leftovers again, so a count not divisible by 3 came with 3 extra; that is not copied.
2. Abunakki can target the Town Hall. Flash's `in BUILDING14` (for `is`) was a typo.
3. Tower range is measured from the tower's middle (Flash meant to and threw the sum away).
4. Dreadnaut's loot figure (its looter share) uses Abunakki's estimate (`worth` above).
5. A Legionnaire raid on a yard with no shooting tower heads for loot instead of stalling.

**Two outcomes checked in WP5** (both follow from the rules above; nothing changed):

- **An Abunakki raid can do nothing to a tiny open yard.** A Town Hall, four harvesters and a silo
  give `N = trunc(6 x 0.3) = 1`, and with no tower fire on the way in that is one Eye-ra (C5). With
  no walls it heads for the nearest building, the silo, and stops at the silo's far corner. Its
  blast (radius 60) is measured to the building's anchor corner, not its middle (Flash's
  `CreepBase.as:797` throws the middle offset away; the engine copies it), and that corner is
  113 away across an 80-wide silo, so the blast touches nothing. From the opposite side
  (bearing 225, the same yard turned round) the same Eye-ra levels the silo and its fall takes 4%
  of the bank. On the sandbox yard the same seed brings 24 Bolts and 5 Eye-ras (fire on the way in)
  and the walls take the blasts.
- **A Dreadnaut raid can empty a full bank while the yard stays 84% healthy.** On the sandbox yard
  (81 buildings, 493 walls and traps) `N = trunc(81 + 0.15 x 493) = 154`, and with no fire on the
  way in all 154 are Brains (C9). Each storage hit takes `damage x 2` (a looter's multiplier) of one
  random banked resource: 100 x 2 = 200, and each Brain makes 31 hits (limit 30) before it leaves,
  so the raid can take up to 154 x 31 x 200 = 954,800. The 100k of each resource (400k) is gone
  after about 2,000 hits, 11 seconds in; Brains do little building damage, so the yard keeps 84%.
  This is Flash's theft rule (§2.4) at plain stats (Q8): Flash's x0.4 strength would make it 80 a
  hit, 154 x 31 x 80 = 381,920 at most (x0.9: 180 a hit, enough to empty it again).

### 5.4 Strength and hits

- **Plain stats (Q8):** no strength scaling at all. Flash's x0.4 to x0.9 (§2.3) is dropped, so
  the engine gets no strength multiplier (as for the Baiter).
- **No hit limit (D10, 2026-10-06):** the 50 / 30 / 20 hits-before-leaving from D2 were built then
  dropped. A raider fights until it dies or has nothing left to attack, exactly like a plain
  attacker (the existing "nothing left to attack" retreat rule every battle already has) — never
  because of a swing count.
- **Raiders use the defender's own Academy levels (D9, 2026-10-06):** not level 0/1 flat. Each
  raider spawns at the level the raided player has trained that monster type to in their own
  Monster Academy; an untrained type still spawns at level 1. This reuses `BattleOptions.defenderLevels`,
  the same field the yard's bunker defenders already read (`server/src/game-rules/combat/defence.ts`),
  so the lookup lives in one shared place — the Trojan Horse feature is expected to reuse it.

---

## 6. The fight and its outcome

### 6.1 The engine already has most of it

The shared engine (`server/src/game-rules/combat/engine.ts`, mirrored in
`web/src/game/combat/rules/`) is deterministic from a seed (`engine.ts:170-180`), runs on the server
in a worker (`services/base/combat/replayRunner.ts`, `docs/design/server-combat.md` §3.5), and a
client can play back a battle the server fought (`AttackSession.playScript`, used by auto-attack's
Watch, `web/src/game/autoAttack/watchRun.ts`). It models loot out of harvesters and storage hit by
hit, bunkers, the caged champion, traps and towers (`engine.ts:186-197`, note 9).

### 6.2 What the engine needs (WP0)

1. **A raid spawn.** A new event kind, `{ kind: "raid", t, x, y, r, monsters }`, placed outside
   the yard, which the fling validator only accepts in a raid log. The server builds the log; there
   is no client log to check.
2. ~~**Strength.**~~ **Dropped (Q8):** raiders fight with plain stats, so the engine gets no
   strength multiplier, as for the Baiter (`docs/design/yard-buildings.md:1147-1150`).
3. ~~**Hit limit.**~~ **Built, then dropped (D10, 2026-10-06).** A battle option was added so a
   raider that had hit buildings more than N times would leave (`CreepBase.as:926-941`), but the
   owner later decided raiders should have no hit limit at all — they fight until they die or have
   nothing left to attack, reusing the "nothing left to attack" retreat rule every battle already
   has. `BattleOptions.raid` is now a plain boolean flag (was an object carrying the limit); `_hitLimit`
   stays "not modelled" (`engine.ts`, note 8), now for raids too.
4. **No countdown.** A raid ends when no raider is left on the yard (`WMATTACK.as:331-347`), with
   a safety cap of 10 minutes of game time.
5. **Defender side only, as a main yard.** The raid runs with target kind `main`, not `wild`:
   `wild` and `tribe` apply the camp rules (the camp storage scalar and the divide-by-5,
   `stats.ts:855-877`, `engine.ts:1063`, `:1212`), which belong to attacking a camp. No attacker
   storage; the "attacker loot" figure is ignored. Everywhere (engine, landing, stats, goals) a
   raid counts as an attack on a **normal yard**, never as a wild-camp attack.
6. Golden fixtures for a raid log on Node and Bun (`replay.test.ts` pattern), and the sync script
   with both `MANIFEST.json` files.

### 6.3 Applying the outcome (at finish)

On the caught-up save, under the row lock, the defender half of an attack landing
(`finaliseAttack.ts`, `services/base/afterYardDefended.ts` for the shape):

- **Health:** the outcome's health map into `buildinghealthdata` and each building's `hp`.
- **Repair (D3):** `rE: 1` on every damaged building not already repairing, as Flash's `CleanUp`
  and the "Repair all" button do (`services/yard/repair.ts:19-26`); the catch-up heals them.
- **Theft (D3):** the bank loses the outcome's `defenderDelta`, clamped at 0. Harvesters lose what
  the engine took from their unbanked amount (`buildingdata.st`, `game-rules/combat/yard.ts:505-533`),
  clamped at what they hold now (they kept producing during the fight). The PvP landing does not
  write drained `st` back today (`defenderLootHandler.ts` touches `resources` only), so harvester
  theft needs **new code, in WP3** (not WP0: the engine already reports what it took).
- **Bunkers and champion:** garrisons and champion health as the outcome left them.
- **Housing (as built, WP3):** a Housing that falls takes its share of the housed monsters, as
  in any defence (Flash's `BUILDING15`, `services/base/combat/housingLoss.ts`).
- **Damage:** the stored `damage` percentage is set from the outcome, as an attack sets it.
- **Good defence (D4):** what is left of the yard at least 90%: `credits += 10`. Flash
  (`WMATTACK.as:829-835`, `:860-865`) summed health over every building except walls and traps.
  **As built (WP3):** the share counts the same buildings as an attack's damage percentage, by
  reusing that rule (`countsTowardDamage` in `game-rules/combat/damagePercent.ts`, Flash's
  `BFOUNDATION.as:433-468`), so it is `1 - damage / 100`: mushrooms, walls, fired traps and types
  with no health are left out; traps not yet fired and decorations with health count, as they do
  in an attack's percentage. One rule for both, so a raid and an attack read a yard alike.
- **Schedule:** `lastattack = start time`, `sessionsSinceLastAttack = 0`, `nextAttack` from the
  preference (§2.1).
- **Goal counter** for "survive a tribe attack" (WP5): only a good defence (90%+) counts (Q7).
- A `wild-raid` server log line with the plan, seed and outcome, so any raid can be reproduced.

---

## 7. Cancel on quit, online, and other players

### 7.1 Cancel on quit (D5)

The server learns the outcome only when the client says the fight is over, so "quit" is "no finish
in time". Nothing is applied before finish, so a cancel undoes nothing.

A raid is **cancelled** when any of these happens first:

1. **No finish in time:** `/raid/finish` not received within the fight's length at 1x plus 2
   minutes after `/raid/start`. The Redis key expires (§8.2).
2. **Presence lost:** at finish, the last presence mark is older than 120 s (the ping's TTL,
   `controllers/maproom/presence.ts`), meaning the game was closed or offline during the fight.
3. **Reload or new session:** an own-yard build load while a raid is open (warning or fight)
   cancels it. A reload is closing the game.
4. **Warning never answered and never launched:** the warning key lives `attackAt` plus 15 minutes;
   after that it is gone.

A finish is **refused** (and the raid stays open until it times out) when it comes sooner than
the fight's length at 2x minus 5 seconds after start, so a script cannot collect the Shiny without
watching.

After a cancel nothing changes in the schedule, so the raid is still due. **Decided (Q1):** it comes
back on the player's next yard visit (Flash's effect), with no fresh wait. **Decided (Q2):** quitting
during the 5-minute warning is a cancel too, exactly like quitting mid-fight (rules 3 and 4 above).

### 7.2 Other players during a raid

- An online player's main yard already cannot be attacked (`baseModeAttack.ts:100-104`,
  `userOnlineErr`), and every `/raid/*` call is a real action, so the player stays online.
- As a second guard, while a raid is in its fight phase the attack load refuses the yard as
  `baseUnderAttackErr` (the #275 lock others see). We do **not** set `attackid`: that would also
  lock the owner out of their own yard (`baseModeBuild.ts:32`).
- A raid never starts while the yard is under attack (`isAttackActive`).
- Outposts are untouched by raids and keep their own rules.

### 7.3 Online, build mode and Planner closed, server-side

- **Online:** #271's rule, unchanged (`isPlayerOnline`, presence mark within 60 s and a real action
  within 600 s).
- **Build mode and Planner closed:** the server cannot see the screen, so the presence ping says it:
  `POST /presence { where: "yard" | "other", planner: boolean }`. The web yard scene sends
  `where: "yard"` and `planner: this.planner !== null` (`web/src/app/scenes/YardScene.ts:266`). The
  server keeps the last answer for 120 s in Redis. A ping with no body (older clients, Flash) never
  gets a raid.
- **Yard actions during the fight** are refused with `raidInProgress` (409), next to the PvP
  attack's `yardUnderAttackErr` in `controllers/yard/yardAction.ts:268`, `:327`, `:384`
  (client side `web/src/game/presence/yardAttack.ts`), so the frozen yard stays the yard the fight ran on.
  The client has no way to act anyway (HUD hidden).

---

## 8. Where state lives

### 8.1 The schedule: `save.aiattacks` (existing jsonb, no migration)

The column already exists (`database/models/save.model.ts:292`) and holds Flash's `_history`. It
becomes server-owned:

```jsonc
{
  "v": 2,
  "lastattack": 1791100000,          // unix s, start of the last finished raid
  "nextAttack": 1791359200,          // unix s, or absent = 60 s after the session began
  "sessionsSinceLastAttack": 5,
  "attackPreference": 0,             // -1 less, 0 same, 1 more
  "lastRaidId": "r_…",              // makes finish idempotent
  "recent": [ { "id": "r_…", "at": 1791100000, "tribe": "Kozu", "health": 0.93, "stolen": {...}, "shiny": 10 } ],  // newest 10
  "fight": { "id": "r_…", "until": 1791100300 }   // only while a raid is fought (WP3)
}
```

- **`fight` (added in WP3)** is the yard's lock while a raid is fought (`services/raids/raidLock.ts`):
  the raid's id and the unix second the lock lapses by itself (the fight's length plus the 2-minute
  grace, the open raid's own TTL). `/raid/start` writes it under the row lock, in two short
  transactions with the fight run between them outside any: first a provisional lock (the
  worker's deadline plus a margin) on the yard it copies for the fight, then the fight's own, once
  it has checked the provisional one is still there (a load in between lifts it and cancels the
  raid; a second start of the same raid finds it and is refused `notWarning`). The finish, a
  finish that finds the raid cancelled, and the owner's next build-mode load remove it. While it
  holds, every yard action is refused `409 raidInProgress` and an attack load on the yard as
  under attack (§7.2). It lives on the row rather than only in Redis (§8.2), so the yard actions
  read it under the row lock they already take and `yardAction.ts` stays free of Redis; the open
  raid in Redis (§8.2) still says whether the raid is alive.

- Flash's names kept, so a Flash-era value still reads. `queued` is dropped; `s1` (Trojan) is left
  untouched for D7.
- **`aiattacks` leaves `Save.saveKeys`** (`save.model.ts:475`), so `/base/save` can no longer
  write it, like `protected` (issue #182). A Flash-era value is normalised on first read.
- The session count goes up by 1 on each own-main-yard build load (`controllers/base/load/baseLoad.ts`).

### 8.2 The open raid: Redis

- `wild-raid:<userid>` → JSON `{ id, phase, tribe, plan, seed, attackAt, warned, startedAt,
  outcome, fightSeconds }`. TTL: warning `attackAt - now + 15 min`; fight `fightSeconds + 2 min`.
  Losing Redis loses only open raids, which is a cancel (D5).
- `raid-screen:<userid>` → the last ping's `{ where, planner }`, TTL 120 s.
- Finish reads and deletes the raid key atomically (`GETDEL`), then applies under the row lock;
  `lastRaidId` refuses a second apply.

No new table and no schema migration.

---

## 9. Work packages

```
WP0 engine ──▶ WP1 army ──┐
WP2 schedule ─────────────┼──▶ WP3 routes ──▶ WP4 web ──▶ WP5 goal + tutorial
```

WP0 and WP2 can start together. WP4 can start against WP3's contract (§4.2) with a stub.

### WP0: Engine support for raids (shared rules) (#300)

**Goal:** the shared engine can fight a wild raid: an off-yard raid spawn, a per-raider hit limit,
and an end with no countdown. No strength multiplier (Q8: plain stats).

**Scope:** §6.2 items 1 and 3-6. New event kind `raid`, battle option `raid: { hitLimit }`, target kind `main`,
end when no raider is left (10-minute cap), fidelity notes updated. Sync to the web mirror.

**Files:** `server/src/game-rules/combat/{types,engine,replay,stats}.ts`, the web mirror
`web/src/game/combat/rules/`, both `MANIFEST.json`, `replay.test.ts` and a raid golden fixture.

**Tests:** a raider leaves after N building hits (monster hits
not counted); the battle ends when the last raider leaves or dies; the same raid log gives the same
digests on Bun and Node; existing fixtures unchanged.

**Depends on:** none. **Size:** M.

### WP1: Raid planner (server, pure) (#301)

**Goal:** from a saved yard and the schedule, the raid Flash would have sent: tribe, bearing, army,
spawn discs, hit limit, as a raid log for the engine.

**Scope:** §5. Tribe pick (random for everyone, Q3); 16 entry points, path to
the first target over the engine grid, damage along the path counting every tower (Q4); the four
make-ups with the tier tables (Abunakki and Dreadnaut mixed when the path takes damage); spawn
distances; Kozu's groups of three every 8 degrees; hits by preference. No strength (Q8).

**Files:** new `server/src/services/raids/{raidTribe,raidDirection,raidArmy,raidPlan}.ts` and tests.

**Tests:** each tribe's army against hand-worked Flash numbers (the §5.3 example among them); the
tier switches (tanks at levels 14, 27 and 40, damage dealers every 8 levels); C12 halving and C14 / 2.5; Abunakki's kamikaze cap of 5;
amplifier 1.3 / 1 / 0.5; direction picks the cheapest entry point and the
shortest on a tie, with every tower counted; deterministic for a given seed.

**Depends on:** WP0 #300 (event shape, grid). **Size:** M.

### WP2: Raid schedule and state (server) (#302)

**Goal:** the server owns `aiattacks` and can say, for a player, "a raid is due now".

**Scope:** §4.1 and §8. Remove `aiattacks` from `Save.saveKeys`; normalise Flash-era values;
count sessions on own-main-yard build loads; the due rule (level, sessions, `nextAttack`, the
4-day rule, online, screen, not under attack, nothing damaged or repairing (Q5); protection
ignored (Q6)); the Redis open-raid store with its
TTLs, `GETDEL` and cancel rules (§7.1); frequency setter (§2.1).

**Files:** new `server/src/services/raids/{raidSchedule,raidStore}.ts`;
`database/models/save.model.ts`; `controllers/base/load/baseLoad.ts`.

**Tests:** due / not due for each gate (a damaged or repairing building blocks, protection does
not); 4-day and first-raid rule gives `now + 60`; preference sets
2 / 3 / 4 days; a reload cancels an open raid and leaves the schedule; a Flash save cannot write
`aiattacks`; store TTLs and `GETDEL` exactly once.

**Depends on:** none. **Size:** M.

### WP3: Raid routes and landing (server) (#303)

**Goal:** the whole server flow of §4.2: warning, engage / prepare, start, finish, frequency, with
the outcome computed and applied by the server only.

**Scope:** presence ping body `{ where, planner }` and answer field `raid`; `POST
/bm/raid/{engage,prepare,start,finish,frequency}` as real actions; start freezes the yard and runs
the engine in a worker (`replayRunner.ts`), keeps the outcome; finish checks timing and presence
(§7.1) and applies health, repairs, theft, bunkers, champion, 10 Shiny, schedule, log (§6.3); the
fight-phase lock: yard actions refused with `raidInProgress`, the attack load refuses with
`baseUnderAttackErr` (§7.2); error codes; `docs/server-api.md`.

**Files:** new `server/src/controllers/raid/*.ts`, `server/src/services/raids/raidLanding.ts`;
`controllers/maproom/presence.ts`, `services/user/presenceAnswer.ts`, `middleware/realAction.ts`
list, `controllers/base/load/modes/baseModeAttack.ts`, `app.routes.ts`, `errors/errors.ts`.

**Tests:** full happy path on a db test yard (warning, engage, start, finish, frequency); no raid
for a ping without `planner: false`; finish too early refused; finish after presence lost cancels;
finish twice applies once; good defence gives exactly 10 Shiny, poor gives 0; theft never takes the
bank below 0; every damaged building gets `rE`; another player's attack load is refused during the
fight; yard actions refused during the fight; the outcome equals a fresh replay of the logged raid.

**Depends on:** WP0 #300, WP1 #301, WP2 #302. **Size:** L.

### WP4: Raid screens (web) (#304)

**Goal:** the player sees a Flash-style raid on their own yard.

**Scope:** §4.3. Presence ping sends `{ where, planner }` from the yard scene; the alert popup
(tribe picture, up to three monsters, Engage / Prepare, no skip); top bar "WILD MONSTERS SPOTTED!"
countdown; the attack scene in raid mode (own yard, server events and seed via `playScript`, no
army panel or input, HUD hidden, "Don't Panic!", 1x/2x), then back to the yard; result popups
(defended with +10 Shiny, poor defence with stolen amounts and "Repair now"); frequency popup; yard
locked with a banner if a raid is fighting. Uses the original tribe splash art and monster sprites.

**Files:** new `web/src/game/raid/*` (state, popups), `web/src/api/raid.ts`;
`web/src/app/scenes/YardScene.ts`, `web/src/app/scenes/AttackScene.ts`, `web/src/ui/Hud.ts`,
`web/src/ui/Popup.ts`, `web/src/game/presence/presencePing.ts`.

**Tests:** vitest for the raid state machine (warning → engage / prepare → fight → result →
frequency), countdown text, ping body with the Planner open and closed; a browser check on
`agenttester` with a forced-due raid (a dev-only way to make one due, WP3).

**Depends on:** WP3 #303 (can start on its contract). **Size:** L.

### WP5: "Survive a tribe attack" goal and the staged raid (#305)

**Goal:** D8. Goal N1 becomes "survive a tribe attack"; the tutorial's staged raid is presented as
a named tribe attack.

**Scope:** N1's condition from `baiterRuns >= 1` to a new counter `raidsSurvived >= 1`, counted
by WP3's landing for a good defence (90%+) only (Q7); goal text; the staged raid already shows "Legionnaire scouts are
attacking!" (`web/src/game/guide/steps.ts:217`), so check it names the tribe after, as
`docs/design/tutorial.md` §4 says, and update §4 and §6.1 there.

**Files:** `server/src/game-data/goals.ts`, `server/src/services/raids/raidLanding.ts`,
`web/src/api/goals.ts`, `web/src/game/guide/steps.ts`, `docs/design/tutorial.md`.

**Tests:** N1 completes after a good defence and not after a poor one; a player who already finished N1
keeps it.

**Depends on:** WP3 #303. **Size:** S.

**As built:** `counters.raidsSurvived` (`services/onboarding/state.ts`), +1 in `landRaid` only when
`defended` (`countRaidSurvived`, `services/goals/counters.ts`); N1 is "Survive a Tribe Attack" on
`raidsSurvived >= 1`. A finish sent twice lands once, so it counts once. `baiterRuns` is still
counted but no goal reads it. A player whose N1 was already marked done keeps it (done is sticky);
one who ran the Baiter but never opened Goals afterwards has no done mark and now needs a raid.
The staged raid already names the tribe before ("Legionnaire scouts are attacking!") and after
("Those were Legionnaire scouts."), so `steps.ts` is unchanged; `tutorial.md` §4, §6.1 and §6.2
say so.

### Backlog (separate issue, #306): Trojan Horse and wild-monster events

The Trojan Horse (`CUSTOMATTACKS.TrojanHorse`, `BUILDING27.as`, `WMATTACK.as:288-296`, `s1` in
`aiattacks`) and the special events WMI1 / WMI2 and Monster Blitzkrieg (`SPECIALEVENT`). Not
designed here (D7).

---

## 10. Owner questions (answered 2026-10-05)

All eight were answered by the owner on 2026-10-05 (also recorded as a comment on #226). The
sections above follow the answers.

1. **After a cancelled raid, when does it come back?** Flash's effect was "the very next time you're
   in your yard" (the timer had already run out). Or should it wait a fresh 2 to 4 days?
   **Answered:** on the player's next yard visit (no fresh wait). §7.1.
2. **Quitting during the 5-minute warning** (before the fight starts): treat it the same as quitting
   mid-fight (cancelled, comes back per Q1)?
   **Answered:** yes, it counts as a cancel. §7.1.
3. **Which tribe comes?** Flash sends your weakest Map Room 1 camp. In our Map Room 1 the
   Legionnaire camp is always one level below you, so almost every raid would be Legionnaire. Map
   Room 2 players have no camps, so Flash picked at random. Keep Flash's rule, or pick one of the
   four at random for everyone?
   **Answered:** random, one of the four, for everyone. §5.1.
4. **Flash's "find the weakest side" check was broken.** In practice raids came the shortest way to
   their first target, and Abunakki and Dreadnaut never brought tanks. Copy what Flash really did,
   or what it was meant to do (come in where your towers are weakest, with mixed armies)?
   **Answered:** what Flash meant: the least-defended side, with tanks. §5.2, §5.3.
5. **Raid a damaged yard?** Flash meant to skip raids while buildings were still damaged or
   repairing, but that check never worked, so it raided anyway. Raid anyway, or wait until the yard
   is repaired?
   **Answered:** no raid starts while anything in the yard is damaged or repairing. §4.1 rule 9.
6. **Does protection stop raids?** In Flash only bought protection did. Here bought and earned
   protection are one timer. Should any protection stop raids, or none?
   **Answered:** none. Damage protection does not stop raids. §4.1 rule 8.
7. **"Survive a tribe attack" goal:** does any finished raid count, or only a good defence (90%+)?
   Raids start at level 9, so a player who reaches that goal earlier waits until level 9. OK?
   **Answered:** only a 90%+ defence counts. §6.3, WP5.
8. **Raider strength.** Flash made raiders weaker than normal (x0.4 to x0.9 health and damage, by
   how big your yard is). For the Baiter you chose plain stats and no multiplier in the engine. For
   raids: keep Flash's weaker raiders (needs that multiplier), or plain stats (raids about 1.1 to
   2.5 times tougher than in Flash)?
   **Answered:** plain monster stats, no strength scaling at all; dropped from WP0. §5.4, §6.2.

Two further notes from the owner's review:

- A raid must count as an attack on a **normal yard**, not a wild-camp attack (§6.2 item 5).
- Harvester theft (writing the drained unbanked amount back) needs new code. That is WP3's, not
  WP0's (§6.3).
