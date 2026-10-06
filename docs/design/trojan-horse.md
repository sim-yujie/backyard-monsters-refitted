# Trojan Horse — Design (issue #306)

Status: planning, 2026-10-06. Owner decisions of 2026-10-06 are final. Every point is marked with
its source: **[Flash]** (what the Flash game did, taken as is), **[owner]** (an owner decision that
differs from or adds to Flash), **[suggested]** (our proposal, taken unless the owner objects).

Flash research with citations: `agent-handoffs/trojan-horse-research.md` (not in the repo; the
facts below cite the Flash files directly where it matters). Raid system reused: `wild-raids.md`.

**Depends on** branch `fix/raid-levels-no-hit-limit` being merged into `revamp` first. That branch
changes wild raids to fight at the player's own Monster Academy levels and drops the per-raider hit
limit, both in one shared place. The horse reuses that shared code; it does not get its own copy.

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [When it appears](#2-when-it-appears)
3. [What the player sees](#3-what-the-player-sees)
4. [The army](#4-the-army)
5. [The fight](#5-the-fight)
6. [After the fight](#6-after-the-fight)
7. [Server rules](#7-server-rules)
8. [Edge cases](#8-edge-cases)
9. [Left out or changed vs Flash](#9-left-out-or-changed-vs-flash)
10. [Work packages](#10-work-packages)
11. [Open questions for the owner](#11-open-questions-for-the-owner)

---

## 1. In one paragraph

Once per account, when a player's main yard is strong enough, the wild monsters leave a big wooden
horse with a red bow at the far north edge of the yard, with a "peace" letter. Clicking the horse
opens the letter; both buttons spring the trap: "It was a trap!", and 51 monsters pour out of the
horse's belly door one after another, weakest first, over about 46 seconds. It is fought like a
wild raid (theft, damage, auto-repair) with no reward. Then the horse is gone for good. **[Flash]**

## 2. When it appears

| Rule | Source |
|---|---|
| Main yard only; never an outpost or an Inferno yard. | [Flash] `WMATTACK.as:291`, `CUSTOMATTACKS.as:33` |
| Map Room 1 or 2 main yards only (the same yards wild raids run on, `RAIDED_MAP_ROOMS`). | [suggested] — see §11 Q1 |
| `points + basevalue` is over **2,000,000** (partway through level 21). | [Flash] `WMATTACK.as:80`, `:295` |
| Checked when the player loads their own main yard in build mode, on the server. Flash checked once a few seconds after load; checking at load is the same in effect. | [Flash] timing, [suggested] server-side |
| **Once per account.** A new server-owned flag records it; once the horse has been placed it is never placed again. Flash's old `aiattacks.s1` is **ignored** (left untouched, never read): no Flash carry-over. | [owner] |
| No randomness, no timer. Protection, the Planner, special events do not stop the placing. | [Flash] `WMATTACK.as:290-302` |
| Bots never get a horse (they never load their yard as a player). | [suggested] |
| No raid needs to be "due"; the horse ignores the raid timer and the "nothing damaged or repairing" raid rule (placing it damages nothing). | [Flash] |

Placement: building type **27** at grid `X = -70, Y = -800`, centred at the far north edge, outside
the build plot. **[Flash]** `CUSTOMATTACKS.as:34-44`. If the revamp yard cannot hold a building
there, the nearest legal spot on the north edge is used. **[suggested]**

## 3. What the player sees

1. **It appears.** The camera pans to the horse once, the first time the yard loads with it. No
   popup, no sound. **[Flash]** `CUSTOMATTACKS.as:45`
2. **It waits.** The horse stays on the yard, across sessions, forever until clicked. No reminder.
   Normal wild raids carry on as usual meanwhile. **[Flash]**
3. **The letter.** Clicking the horse (build mode, own yard) opens a new letter popup in our own
   style (the Flash popup art was never extracted). **[suggested]** Text from Flash
   (`english.json:223-227`) **[Flash]**:
   - Headline: "Wild Monsters left you a note pinned to a large wooden structure."
   - Letter: "Dear *player name*, Too much needless blood has been spilled on our yards. It is time
     we let our monsters live out the rest of their days in peace. Let this be known as Armistice
     Day! As a token of our sincerity, please accept this wooden memorial."
   - Two buttons: **"Send Back"** and **"Accept Truce"**. **Both spring the trap** (the joke).
     **[Flash]** `BUILDING27.as:124-127`
   - No close button: Flash's frame close was never wired. **[Flash]**
4. **The trap.** The popup closes, the banner shows **"It was a trap! Who didn't see that coming?"**
   for a few seconds, then the usual raid-fight look: HUD hidden, "Don't Panic!", 1x/2x. Flash's
   bug hid the trap banner at once; we show it properly. **[owner, item 12]**
5. **The spill.** The belly door opens on each spawn and closes shortly after (two-frame
   `anim.1.png`, already in `server/public/assets/buildings/trojanhorse/`). **[Flash]**
   `BUILDING27.as:69-77`. No music or sounds until the web client has audio. **[suggested]**
6. **The result.** The raid result popup ("well defended" at 90%+ health, else "poor defence" with
   repair), naming **"the wild monsters"**, not a tribe. **[owner, item 12]** The horse is gone from
   the yard straight away (Flash left it drawn until the next load). **[suggested]**

Other players who view or attack the yard see the horse as a prop; it cannot be targeted.
**[Flash]** (it is in `buildingdata`; type 27 is already untargetable, `champions.ts:132`)

## 4. The army

- **51 monsters**, one at a time, all from the horse's door, weakest first. **[Flash]**
  `BUILDING27.as:51-81`
  - 6 Pokey (C1), then 5 each of Octo-ooze (C2), Bolt (C3), Fink (C4), Ichi (C6), Bandito (C7),
    Fang (C8), Brain (C9), Crabatron (C10), Projectix (C11). No Eye-ra (C5), no D.A.V.E. (C12).
  - Flash frame `f` = 1, 20, 40, …, 1100 at 24 fps; type `C⌈f/100⌉`, C5 skipped. Engine tick
    `t = round(f / 24 × TICKS_PER_SECOND)`: one every ~0.83 s, last at ~45.8 s.
  - Each spawn is one engine `raid` event `{t, x, y, r: 0, monsters: {Cn: 1}}` at the door point
    (Flash: screen `(horse.x − 80, horse.y + 108)`, converted to yard coordinates and pulled onto
    the pathing grid the way `raidLanding()` does). **[Flash]** point, **[suggested]** mapping
- **Levels:** the player's own Monster Academy levels (level 1 for a type never researched), using
  the shared raid-levels code from `fix/raid-levels-no-hit-limit`. **[owner, item 7 / R]**
- **Strength:** health and damage ×0.4, ×0.6 when `points + basevalue` is over 3M, ×0.8 over 5M,
  ×1.0 over 8M, read when the fight starts. **[Flash]** `BUILDING27.as:54-64` Wild raids dropped
  this scaling (wild-raids Q8); the horse keeps it, so the engine needs a per-event strength
  multiplier (default 1, so raids are unchanged). **[owner, item 6]**
- **No hit limit.** A monster fights until it dies, like a normal attack (normal wild raids lose the
  hit limit too, in the same shared code). **[owner, item 8]**
- Targeting, theft and defenders exactly as in a wild raid (bounce, nearest buildings, harvesters
  and storage looted, bunkers / champion / housing defend). **[Flash]**

## 5. The fight

- Fought as a wild raid: same server flow (`raidFlow.ts`), worker fight (`raidFight.ts`), yard lock
  (`raidLock.ts`), open-raid record in Redis (`raidStore.ts`), client replay (`web/src/game/raid/`).
  It skips the warning phase: it starts the moment the player springs the trap. **[suggested]**
- **End rule:** the fight ends when every spawn event has happened **and** no monster is left (or
  at `RAID_MAX_SECONDS`). Flash could end in a gap between spawns while the horse kept spewing; that
  bug is not kept. **[suggested]** Today's raid rule ("no raider left once one has come",
  `engine.ts` fidelity note 17) gets the "all events spawned" condition for every raid.
- **Quit mid-fight** (closing the game, reload, lost connection): cancelled as a raid is (wild-raids
  D5): nothing kept, and **the horse stays** to be sprung again. **[Flash, item 11]**

## 6. After the fight

- Theft and damage land as a raid's do (`landRaid()`), damaged buildings auto-repair. **[Flash, item 9]**
- **No reward:** no Shiny (even at 90%+ health, unlike a raid's 10), no resources, no achievement,
  no quest. It does not count for the "survive a tribe attack" goal. **[Flash, item 10]**
- The horse (building 27) is removed from `buildingdata` and the once-per-account flag is marked
  done. **[Flash]** `BUILDING27.as:144-150`
- **Raid timer:** sessions since last raid reset to 0 and any planned `nextAttack` dropped;
  `lastattack` untouched. Applied when the fight lands (a cancelled fight changes nothing).
  **[Flash]** `WMATTACK.as:964-972`
- **No frequency popup** after it. **[Flash]** (`_isAI` false)
- Logged in the raid history (`recent`) like a raid, tribe `"wild"`, Shiny 0. **[suggested]**

## 7. Server rules

The client never adds, moves or removes the horse, and never sends the army; the server does all of
it. **[suggested]** (the revamp server owns `aiattacks` and refuses buildings added by a save)

- **Flag:** a new field in the server-owned raid schedule (`aiattacks`), e.g.
  `trojan: { placedAt, doneAt? }`. Absent = may be placed. `placedAt` set = never placed again.
  `doneAt` set = sprung and landed. `s1` keeps being carried untouched and is never read. **[owner]**
- **Placing:** inside the main-yard load, in the same transaction as the save it writes; idempotent
  (two loads at once place one horse).
- **Save protection:** a client save cannot add, move, sell, recycle or drop building 27; the
  server keeps it as stored. The Planner's Apply and layout tools leave it alone.
- **Springing** (new route, e.g. `POST /bm/raid/trojan`): refused unless all hold: the caller's own
  main yard; the horse is in `buildingdata`; `placedAt` set and `doneAt` not; no raid open; yard not
  locked or under attack by a player; the player online on their yard (the raid presence check).
  The server builds the army itself and opens the fight at once; the reply carries the events the
  client replays (as `raid/start` does).
- **Finishing** reuses `raid/finish` and its checks (raid id, too-early finish refused using the
  fight length including the 46 s of spawns, applied once by `lastRaidId`).
- **Cancel** reuses the raid cancel-on-quit: the open raid drops, the horse and flag are unchanged.
- **DEV only** (never mounted in production): a route that places a horse now, ignoring the score
  and the flag, for testing (Flash had a console command `trojan`). **[suggested]**

## 8. Edge cases

| Case | Behaviour | Source |
|---|---|---|
| A wild raid is due while the horse sits there | The raid happens normally; the horse is untargetable and is ignored by raid route planning and the 90% health count. | [Flash] |
| Player clicks the horse while a raid warning or raid is open | Refused; the horse can be sprung after. | [suggested] |
| Player clicks while buildings are damaged or repairing | Allowed (only automatic raids wait for a healthy yard). | [Flash] |
| Player clicks the horse on a visit / attack of another yard | Nothing happens. | [Flash] |
| Score drops back below 2M before clicking | The horse stays; it is never taken back. | [Flash] |
| Two tabs spring it at once | One fight opens; the other is refused (open-raid record is set-if-absent). | [suggested] |
| Finish sent twice | Applied once (`lastRaidId`). | [suggested] |
| Every monster dies early, between spawns | The fight carries on until all 51 have come out (§5 end rule). | [suggested] |
| Player relocates or switches Map Room with the horse unsprung | The horse goes with the main yard's buildings like any other. | [suggested] |
| Info panel for building 27 | Not opened; a click opens the letter. (`trojanhorse_desc` has no text in Flash.) | [Flash] |

## 9. Left out or changed vs Flash

- Flash's `aiattacks.s1` flag and carry-over — ignored; new server flag instead. **[owner]**
- Hit limit (Flash: 50 hits then leave) — dropped. **[owner]**
- The old 2010 "replace a queued raid" path (`WMATTACK.as:530-568`, dead in the final client) —
  left out. **[Flash: dead code]**
- Bugs not kept: "It was a trap!" overwritten at once; fight ending in a spawn gap; result naming a
  leftover tribe; horse still drawn after the fight. **[owner / suggested]**
- Flash letter popup art (never extracted) — new popup in our style. **[owner, item 13]**
- Panic music and the door's `bankland` sound — until the web client has audio. **[suggested]**
- Map Room 3 main yards — no horse for now (§11 Q1). **[suggested]**

## 10. Work packages

Each is its own GitHub issue, linked to #306. Order: WP1 and WP2 in parallel (WP2 after the
raid-levels branch merges), then WP3, then WP4 (WP4's popup and art can start earlier against
WP3's route shape).

| WP | What | Needs |
|---|---|---|
| WP1 | Server: placing the horse, the once-per-account flag, save protection, DEV place route | — |
| WP2 | Engine + army: the 51-spawn schedule, door point, strength multiplier, all-events end rule | `fix/raid-levels-no-hit-limit` merged |
| WP3 | Server: spring route, fight and landing differences (remove horse, no Shiny, timer reset, no frequency popup, cancel keeps horse) | WP1, WP2 |
| WP4 | Web: clickable horse, letter popup, trap banner, door animation, camera pan, result text | WP3 |

## 11. Open questions for the owner

1. **Map Room 3:** Flash did not check the Map Room for the horse, but our wild raids only run on
   Map Room 1 and 2 main yards. Should Map Room 3 players get the horse too? (Suggested: no, same
   as raids, until Map Room 3 gets raids.)
