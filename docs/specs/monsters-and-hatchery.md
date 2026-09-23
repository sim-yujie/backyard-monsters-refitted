# Monsters and the Hatchery — Rules and Data Specification

Reverse-engineered from the Refitted client (ActionScript 3) and server (TypeScript). This document
describes the **rules and data** of monsters *outside combat*: unlocking, researching, hatching,
housing, garrisoning, champions, baiting and transferring. Combat behaviour itself is specified
separately in `docs/specs/combat.md`; stats appear here only as far as the locker, hatchery, lab and
academy need them.

All citations are `path:line` relative to the repository root. Endpoint and Save-model details are
not re-derived here — see `docs/server-api.md`.

Contents:

1. [Overview](#1-overview)
2. [Monster roster](#2-monster-roster)
3. [Monster Locker](#3-monster-locker)
4. [Monster Lab and Monster Academy](#4-monster-lab-and-monster-academy)
5. [Hatchery](#5-hatchery)
6. [Housing and bunkers](#6-housing-and-bunkers)
7. [Champions](#7-champions)
8. [Monster Baiter](#8-monster-baiter)
9. [Transfers between yards](#9-transfers-between-yards)
10. [Save data](#10-save-data)
11. [Open questions / UNVERIFIED](#11-open-questions--unverified)
12. [Redesign notes](#12-redesign-notes)

---

## 1. Overview

### The lifecycle

A monster passes through five states. Every one of them is computed and enforced on the client; the
server stores the result.

| Step | Building | What happens | Cost | Where the rule lives |
| --- | --- | --- | --- | --- |
| 1. Locked | — | Every monster except the first starts locked | — | `CREATURELOCKER.as:98`, `:65` |
| 2. Unlocking | Monster Locker | A single timed unlock per realm; when it finishes the monster becomes hatchable at level 1 | Putty (r3) | `CREATURELOCKER.as:961-1025`, `:885-959` |
| 3. Trained / powered up | Monster Academy, Monster Lab | Optional: raise the monster's level 1→6, and buy up to 3 ability ranks | Putty (r3) | `ACADEMY.as:54-131`, `MONSTERLAB.as:269-325` |
| 4. Hatching | Hatchery (or Hatchery Control Center) | Queued, then produced one at a time per hatchery | Goo (r4) | `HATCHERYPOPUP.as:234-292`, `BUILDING13.as:249-347` |
| 5. Housed | Housing | The finished monster is stored; housing space is the hard cap on army size | — | `HOUSING.as:92-125` |
| 6. Deployed | Flinger (attack), Monster Bunker (defence), Champion Cage (champion) | — | — | out of scope / see [§6](#6-housing-and-bunkers) |

A monster can also leave the pool by being juiced at the Monster Juicer, fed to a champion, placed in
a Monster Bunker, or transferred to another of the player's yards.

### Client versus server authority

**Almost everything in this system is client-authoritative.** The server stores the monster state as
opaque JSON and re-serves it.

| Concern | Authority | Evidence |
| --- | --- | --- |
| Monster stat tables (health, damage, hatch cost, hatch time, housing space) | **Client**. A server copy exists but no non-combat endpoint reads it. | `CREATURELOCKER.as:100-824` vs `server/src/game-data/stats/monsterStats.ts:39` |
| Unlock cost, unlock timer, locker-level prerequisite | **Client only** | `CREATURELOCKER.as:961-1025` |
| Academy training cost, duration, level cap | **Client**, except the level clamp | `ACADEMY.as:54-131`; server clamps `level` to 6 at `server/src/controllers/base/save/handlers/academyHandler.ts:24-26` |
| Lab powerup cost, duration, rank cap | **Client only** | `MONSTERLAB.as:51-73`, `:269-325` |
| Hatchery queue length, per-stack cap, production timer | **Client only** | `HATCHERYPOPUP.as:241`, `:255`; `BUILDING13.as:313-347` |
| Housing capacity and overflow | **Client only** | `HOUSING.as:55-86`, `:161-199` |
| Bunker capacity and contents | **Client only** | `BUILDING22.as:294-320` |
| Champion level, feeds, food bonus, power level | **Client**, except during an attack | `CHAMPIONCAGE.as:682-877`; attack-time clamp at `server/src/controllers/base/save/handlers/championHandler.ts:17-27` |
| Shiny spend | **Server**, via the purchase handler | `server/src/controllers/base/save/baseSave.ts:148` |
| Monster transfer between yards | **Server** checks ownership only | `server/src/controllers/maproom/v2/transferMonsters.ts:48-69` |

The only server-side monster logic outside combat is: the academy level clamp, the champion `hp`
clamp during an attack, the transfer ownership check, and the post-attack `monsterupdate` fan-out
(`server/src/services/base/updateMonsters.ts:15-35`). Everything else is read, stored and echoed.

### Realms

Every rule below exists twice: once for the surface yard (monster ids `C1`..`C19`, costs in Putty and
Goo) and once for the Inferno yard (ids `IC1`..`IC8`, costs in Sulfur and Magma). The code is shared
and branches on `BASE.isInfernoMainYardOrOutpost`. Resource slots are the same indices in both cases:
`BASE.Charge(3, …)` is Putty or Sulfur, `BASE.Charge(4, …)` is Goo or Magma
(`client/scripts/BRESOURCE.as:47-72`, `client/scripts/BASE.as:4414-4425`).

---

## 2. Monster roster

The single source of truth for the client is `CREATURELOCKER._mainCreatures`
(`client/scripts/CREATURELOCKER.as:100-824`). The server keeps a parallel copy in
`server/src/game-data/stats/monsterStats.ts:39-725` with the same numbers but **no `resource`,
`time`, `level`, `page` or `order` fields** — it cannot express unlock rules at all. The id list is
also duplicated at `server/src/game-data/stats/monsterKeys.ts:5-40`.

### 2.1 Identity and unlock

`resource` is the unlock price in Putty (Sulfur in the Inferno), `time` the unlock duration in
seconds, `level` the Monster Locker level required.

| Id | Name | Unlock cost | Unlock time | Locker level | Obtainable? | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `C1` | Pokey | free (pre-unlocked) | — | 1 | yes | `CREATURELOCKER.as:101-125`, `:65` |
| `C2` | Octo-Ooze | 8,000 | 1 h | 1 | yes | `:126-149` |
| `C3` | Bolt | 16,000 | 2 h | 1 | yes | `:150-174` |
| `C4` | Fink | 32,000 | 4 h | 1 | yes | `:175-199` |
| `C5` | Eye-Ra | 64,000 | 8 h | 2 | yes | `:200-225` |
| `C6` | Ichi | 128,000 | 16 h | 2 | yes | `:226-249` |
| `C7` | Bandito | 256,000 | 28 h | 2 | yes | `:250-274` |
| `C8` | Fang | 512,000 | 40 h | 2 | yes | `:275-299` |
| `C9` | Brain | 1,024,000 | 52 h | 3 | yes | `:300-324` |
| `C10` | Crabatron | 2,048,000 | 58 h | 3 | yes | `:325-348` |
| `C11` | Project X | 4,096,000 | 62 h | 3 | yes | `:349-373` |
| `C12` | D.A.V.E. | 8,192,000 | 72 h | 4 | yes | `:374-398` |
| `C13` | Wormzer | 4,096,000 | 62 h | 4 | yes | `:399-425` |
| `C14` | Teratorn | 4,096,000 | 60 h | 4 | yes | `:426-454` |
| `C15` | Zafreeti | 6,192,000 | 60 h | 3 | yes | `:455-484` |
| `C16` | Vorg | 384,000 | 36 h | 2 | **no — `blocked: true`** | `:485-516` |
| `C17` | Slimeattikus | 2,048,000 | 36 h | 3 | **no — `blocked: true`** | `:517-543` |
| `C18` | Slimeattikus Mini | (2,048,000) | (36 h) | 3 | **no — `blocked`, `fake: true`, `dependent: "C17"`** | `:544-569` |
| `C19` | Rezghul | 2,048,000 | 36 h | 3 | **no — `blocked: true`** | `:570-603` |
| `C200` | AILooter1 | — | — | — | **no — `blocked`, AI-only, excluded from every list** | `:809-823`, `:1095` |
| `IC1` | Spurtz | 2,400 | 1 h | 1 | yes (pre-unlocked in Inferno) | `:604-628`, `:59` |
| `IC2` | Zagnoid | 4,800 | 4 h | 1 | yes | `:629-652` |
| `IC3` | Malphus | 76,800 | 18 h | 2 | yes | `:679-703` |
| `IC4` | Valgos | 38,400 | 18 h | 2 | yes | `:653-678` |
| `IC5` | Balthazar | 614,400 | 24 h | 3 | yes | `:704-730` |
| `IC6` | Grokus | 1,228,800 | 24 h | 3 | yes | `:731-754` |
| `IC7` | Sabnox | 2,457,600 | 48 h | 3 | yes | `:755-780` |
| `IC8` | King Wormzer | 4,915,200 | 72 h | 4 | yes | `:781-808` |

`blocked` monsters are filtered out of the locker list (`CREATURELOCKER.as:115`), the hatchery grid
(`HATCHERYPOPUP.as:71-73`), the Hatchery Control Center grid (`HATCHERYCCPOPUP.as:87-89`) and the
housing list (`HOUSING.as:283`). **In this build only `C1`..`C15` and `IC1`..`IC8` can actually be
obtained — 23 monsters.** The four blocked surface monsters keep full stat tables and are still
handled by combat, the bunker and the Monster Baiter, so they are live content that has simply been
hidden from the acquisition UI.

`C1` and `IC1` are force-unlocked on every load: `Data()` writes `_lockerData[firstCreatureID] = {t:2}`
unconditionally (`CREATURELOCKER.as:65`).

### 2.2 Production cost, time and housing space

Arrays are indexed by the monster's **academy level minus one** and clamped to the last entry when
the level exceeds the array length (`CREATURES.GetProperty`, `client/scripts/CREATURES.as:75-81`).
`cResource` is Goo (Magma in the Inferno), `cTime` is seconds, `cStorage` is housing space.

| Id | `cResource` (goo per hatch, L1..L6) | `cTime` (seconds, L1..) | `cStorage` |
| --- | --- | --- | --- |
| `C1` | 250, 450, 675, 800, 1000, 1250 | 15, 10, 8, 7, 6, 5 | 10, 10, 10, 9, 8, 7 |
| `C2` | 500, 900, 1350, 1800, 2100, 2500 | 15, 16 | 10 |
| `C3` | 350, 675, 1015, 1400, 1800, 2400 | 23 | 15 |
| `C4` | 1500, 2250, 3375, 4800, 7200, 10000 | 100, 100, 100, 100, 90, 90 | 20 |
| `C5` | 5000, 15000, 30000, 45000, 60000, 80000 | 1500 | 60 |
| `C6` | 5000, 5625, 8440, 11200, 16000, 24000 | 100, 100, 90 | 20 |
| `C7` | 2500, 4500, 6750, 8750, 11200, 14400 | 225, 225, 225, 225, 180, 180 | 20 |
| `C8` | 18000, 27000, 40500, 60500, 80000, 100000 | 450, 350, 250, 225, 195, 195 | 30 |
| `C9` | 12000, 20250, 30375, 35000, 50000, 75000 | 342 | 30 |
| `C10` | 30000, 45000, 67500, 75000, 90000, 120000 | 750 | 40 |
| `C11` | 60000, 90000, 135000, 180000, 234000, 280000 | 1384 | 70 |
| `C12` | 150000, 225000, 337500, 440000, 600000, 800000 | 3600 | 160 |
| `C13` | 20000, 25000, 30000, 35000, 40000, 47500 | 1384 | 70 |
| `C14` | 70000, 95000, 145000, 200000, 300000, 400000 | 1800, 1920, 2040, 2160, 2280, 2400 | 70 |
| `C15` | 120000, 180000, 256000, 324000, 468000 | 2400 | 200 |
| `C16` | 16000, 25000, 38500, 62500, 75000, 90000 | 1200 | 60 |
| `C17` | 27000, 40500, 60750, 90000, 125000, 150000 | 500, 450, 400, 350, 300, 250 | 40 |
| `C18` | 27000, 40500, 60750, 90000, 125000, 150000 | 500, 450, 400, 350, 300, 250 | 40 |
| `C19` | 1000000 (written `3000000 / 3`) | 4500 | 250 |
| `C200` | 10 | 10 | 10 |
| `IC1` | 500, 1000, 2000, 4000, 6000, 10000 | 15, 10, 8, 7, 6, 5 | 15 |
| `IC2` | 2500, 4000, 8000, 12000, 16000, 20000 | 15, 16, 16, 16, 16, 16 | 15 |
| `IC3` | 3000, 3500, 4100, 4800, 5500, 7000 | 100, 100, 90, 90, 90, 90 | 15 |
| `IC4` | 31000, 35000, 39000, 44000, 50000, 55000 | 450, 350, 250, 225, 195, 195 | 30 |
| `IC5` | 88000, 104000, 161000, 249000, 327000, 487000 | 1800, 1920, 2040, 2160, 2280, 2400 | 40 |
| `IC6` | 80000, 105000, 135000, 175000, 210000, 325000 | 1800 | 50 |
| `IC7` | 60000, 90000, 145000, 200000, 330000, 450000 | 1384 | 80 |
| `IC8` | 425000, 476000, 580000, 700000, 910000, 1204000 | 2700 | 100 |

Source: `client/scripts/CREATURELOCKER.as:113-822`. The server's mirror is
`server/src/game-data/stats/monsterStats.ts:39-725`; the Map Room 3 variant
(`mr3MonsterStats`, `:727-1169`) triples `cResource` and `cTime`, which the client reproduces at
runtime instead of reading the table (`CREATURELOCKER.as:843-859`).

**`hTime` / `hResource`** also appear on every monster (e.g. `CREATURELOCKER.as:122-123`). They are
the Map Room 3 per-creep heal time and heal cost, consumed by
`client/scripts/com/monsters/player/Player.as:594-602` and `:694-703`. In Map Room 2 housed monsters
carry `health = int.MAX_VALUE` (`Player.as:290`), so nothing heals and these two arrays are inert.

### 2.3 Base combat stats

Only what the locker, hatchery and lab display. `damage` is negative for healers. `range` absent
means melee.

| Id | `health` (L1..L6) | `damage` (L1..L6) | `speed` | `range` | Movement / pathing | `targetGroup` | Special props |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `C1` | 200, 220, 240, 260, 280, 300 | 60, 65, 70, 75, 80, 85 | 1.2 | — | ground | 1 | — |
| `C2` | 1000, 1100, 1300, 1450, 1600, 1800 | 15, 15, 20, 25, 30, 35 | 1.4 | — | ground | 4 | — |
| `C3` | 150 | 15, 20, 25, 35, 45, 55 | 2.5, 2.55, 2.6, 2.8, 3, 3.2 | — | ground | 3 | — |
| `C4` | 200, 200, 200, 200, 220, 240 | 300, 330, 380, 430, 470, 520 | 1.3 | — | ground | 1 | — |
| `C5` | 600, 900, 1200, 1600, 2000, 2400 | 4000, 8000, 12000, 16000, 20000, 24000 | 2, 2.2, 2.4, 2.6, 2.8, 3 | — | ground | 2 | `explode: [1]` |
| `C6` | 2000, 2100, 2200, 2300, 2500, 2800 | 50, 60, 70, 80, 95, 110 | 1.2 | — | ground | 4 | — |
| `C7` | 500, 550, 600, 650, 750, 900 | 200, 250, 300, 350, 400, 450 | 1 | — | ground | 1 | — |
| `C8` | 400 | 600, 600, 620, 660, 720, 800 | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 | — | ground | 1 | — |
| `C9` | 600, 700, 750, 800, 1100, 1400 | 100, 100, 200, 250, 300, 350 | 2, 2, 2, 2, 2.1, 2.2 | — | ground | 3 | — |
| `C10` | 4000, 4000, 4300, 4400, 4600, 4800 | 100, 120, 130, 140, 150, 170 | 1, 1, 1, 1.2, 1.4, 1.5 | — | ground | 4 | — |
| `C11` | 800, 900, 950, 1000, 1100, 1200 | 1200, 1400, 1600, 1800, 2000, 2200 | 0.9, 0.9, 1, 1.2, 1.2, 1.3 | — | ground | 4 | — |
| `C12` | 8000, 9100, 10000, 12000, 16500, 21000 | 1500, 1500, 1600, 1700, 1800, 1900 | 0.8, 0.85, 0.9, 1, 1.1, 1.2 | — | ground | 1 | — |
| `C13` | 600, 800, 1100, 1300, 1500, 1700 | 300, 400, 550, 600, 650, 700 | 3, 4 | — | burrow / direct | 1 | — |
| `C14` | 1600, 1900, 2400, 3000, 3600, 4200 | 300, 350, 400, 500, 600, 700 | 2.5, 2.75, 3, 3.25, 3.5 | 150 | fly / direct | 1 | `attackDelay: [90]` |
| `C15` | 8000 | −400, −550, −700, −850, −1000 | 0.75, 0.8, 0.85, 0.9, 0.95 | 150 | fly / direct | 5 | `attackDelay: [20]`, `antiHeal: true` |
| `C16` | 750 | −60, −70, −80, −90, −100, −110 | 1.5, 1.75, 2, 2.25, 2.5 | 150 | fly / direct | 5 | `attackDelay: [10]`, `antiHeal: true` |
| `C17` | 700, 725, 750, 800, 900, 1000 | 850, 850, 900, 1000, 1200, 1400 | 1, 1.1, 1.2, 1.3, 1.4, 1.5 | — | ground | 1 | `splits: [2,2,3,3,4,5]` |
| `C18` | 250 | 310, 320, 330, 340, 350 | 1.5, 1.6, 1.7, 1.8, 1.9, 2 | — | ground | 1 | spawned by `C17` |
| `C19` | 7000, 7500, 8000, 8500, 9000, 10000 | 700, 800, 900, 1000, 1100, 1200 | 0.8, 0.9, 1, 1.1, 1.2, 1.3 | 200 | ground | 4 | `zombieSpeedMultiplier: [0.75]`, `zombieHealthMultiplier` / `zombieDamageMultiplier: [1,1.1,1.2,1.3,1.4,1.5]`, `resurrectCooldown: [7,7,6,6,5,4]` |
| `C200` | 200 | 20 | 3 | — | ground | 3 | `size: [32]` |
| `IC1` | 400, 425, 450, 475, 510, 550 | 160, 200, 200, 250, 300, 350 | 1.2 | — | ground | 1 | — |
| `IC2` | 1500, 1820, 2300, 2800, 3350, 3600 | 80, 85, 90, 95, 100, 110 | 1.8 | — | ground | 4 | — |
| `IC3` | 450, 470, 500, 540, 580, 620 | 100, 105, 110, 120, 130, 140 | 3.2 | — | jump | 3 | — |
| `IC4` | 2000, 2400, 2800, 3200, 3600, 4000 | 490, 530, 580, 645, 700, 775 | 2 | — | burrow / direct | 2 | — |
| `IC5` | 3200, 3600, 4000, 4500, 5000, 5600 | 600, 665, 730, 795, 860, 930 | 4.5 | — | fly / direct | 6 | — |
| `IC6` | 7600, 8750, 9900, 10100, 11300, 12500 | 400, 425, 450, 475, 500, 550 | 1.3, 1.3, 1.4, 1.4, 1.5, 1.6 | — | ground | 3 | — |
| `IC7` | 1120, 1260, 1400, 1650, 1900, 2200 | 700, 825, 950, 1075, 1200, 1350 | 1.7, 1.8, 1.9, 2, 2.1, 2.2 | 240 | ground | 4 | — |
| `IC8` | 6200, 7600, 8700, 10900, 13100, 16000 | 1200, 1360, 1630, 1920, 2220, 2500 | 2.5, 2.6, 2.7, 2.8, 2.9, 3 | — | burrow / direct | 1 | — |

Abilities bought at the Monster Lab are listed in [§4.2](#42-monster-lab).

---

## 3. Monster Locker

Building id **8** (`#b_monsterlocker#`, `client/scripts/YARD_PROPS.as:901-1000`, class `BUILDING8`).
The Inferno equivalent is the Strongbox, same class, different label
(`client/scripts/BUILDINGINFO.as:150-156`).

### Building

| Property | Value | Source |
| --- | --- | --- |
| Levels | 4 | `YARD_PROPS.as:913-940` (4 cost entries) |
| Build cost / time (L1) | 1,800 twigs + 2,300 pebbles, 600 s, needs Town Hall 2 | `:914-920` |
| Upgrade L2 | 28,800 + 18,400, 18,000 s, Town Hall 3 | `:920-927` |
| Upgrade L3 | 115,200 + 147,200, 72,000 s, Town Hall 4 | `:927-934` |
| Upgrade L4 | 460,800 + 588,800, 129,600 s, Town Hall 5 | `:934-940` |
| How many | `quantity` by Town Hall level `[0,0,1,1,1,1,1,1,1,1,1]` — one from Town Hall 2 | `:998` |
| Hit points | 4,000 / 16,000 / 32,000 / 64,000 | `:999` |

The locker's only function is to gate and run unlocks. Its **level is the only prerequisite tier**:
a monster with `level: N` needs locker level ≥ N (`CREATURELOCKER.as:975-981`). There is no tech
tree, no "unlock X before Y", and no Town Hall check beyond the one the locker itself needs.

### Unlock rules

`CREATURELOCKER.Start(creatureID)` (`:961-1025`), in order:

1. Already in `_lockerData` (unlocking or unlocked) → refuse silently (`:967-969`).
2. Another unlock already in progress in this realm → message plus a shiny speed-up offer (`:970-973`).
3. Locker level below `creature.level` → "upgrade your Monster Locker" (`:975-981`).
4. `BASE.Charge(3, creature.resource)` — the full Putty price is taken up front (`:982`). On failure
   the player is sent to the Putty store (`:1018-1023`).
5. Write `_lockerData[id] = { t: 1, s: <now>, e: <now + creature.time> }` and `BASE.Save()` (`:994-1000`).

**One unlock at a time per realm.** `Tick()` picks the first entry with `t == 1` whose id prefix
matches the current yard type (`:895-903`), so a surface unlock and an Inferno unlock can run
concurrently but two surface unlocks cannot.

`e` is an absolute unix timestamp, so an unlock **continues while the player is offline**. Completion
is detected client-side in `Tick()`: when `e - now <= 0`, `t` becomes `2`, `s` and `e` are deleted,
and `GLOBAL.player.m_upgrades[id] = { level: 1 }` is created (`:908-913`).

### Cancel

`CREATURELOCKER.Cancel()` deletes the locker entry and **refunds the full Putty price**
(`:1027-1035`). It is reached from a Yes/No confirmation (`CREATURELOCKERPOPUP.as:348-350`).

### Speed-ups

| Route | Cost | Source |
| --- | --- | --- |
| "Speed up" button | `STORE.SpeedUp("SP4")` — the generic Finish Now item, priced from the remaining time | `CREATURELOCKERPOPUP.as:352-354` |
| "Unlock instantly" button | `STORE.GetTimeCost(time) + ceil(sqrt(putty / 2) ^ 0.75)` shiny | `CREATURELOCKERPOPUP.as:326-331` |
| Monster Locker Overdrive (`CLOD`) | 60 shiny, 14,400 s duration, advertised as 4x | `server/src/game-data/store/storeItems.ts:111-118` |

`STORE.GetTimeCost(t, applyFreeFloor = true)` returns `0` when `t <= 300`, otherwise
`min(ceil(t * 20 / 3600), floor(sqrt(t * 0.8)))` (`client/scripts/STORE.as:162-171`).

Overdrive is applied as `_lockerData[_unlocking].e -= 4` **once per client tick**
(`CREATURELOCKER.as:905-907`), i.e. each real second removes 5 seconds of remaining time, and only
while the client is running. Instant unlock skips the timer entirely and sets `t: 2` directly
(`CREATURELOCKERPOPUP.as:365-443`), charging via `BASE.Purchase("IUN", …)`.

### Click flow (unlock a monster)

1. Click the Monster Locker building in the yard (`BFOUNDATION.as:2833-2838`).
2. Click **Open Locker** in the building info bar (`BUILDINGINFO.as:150-156`, `:468-470`).
3. Optionally click **Next** / **Previous** to reach the right page of four monsters
   (`CREATURELOCKERPOPUP.as:13`, `:72-84`).
4. Click the monster's row in the list (`CREATURELOCKERPOPUP.as:147`).
5. Click **Start Unlocking** (`:322-325`), or **Unlock Instantly** for shiny (`:42`, `:331`).
6. Dismiss the confirmation popup that reports the remaining time (`CREATURELOCKER.as:1002-1015`).

---

## 4. Monster Lab and Monster Academy

These are two separate buildings doing two separate jobs on the same `m_upgrades` record.

- **Monster Academy** raises a monster's **level** 1→6, which moves every stat one step along its
  array. Every unlockable monster can be trained.
- **Monster Lab** buys a monster's **ability rank** (`powerup`) 0→3. Only ten monsters have an
  ability.

Both write to the same per-monster object, `GLOBAL.player.m_upgrades[id]`, which is serialised as the
`academy` save field (`client/scripts/com/monsters/player/Player.as:193-211`).

### 4.1 Monster Academy

Building id **26** (`#b_monsteracademy#`, `YARD_PROPS.as:2923-3028`, class `BUILDING26`).

| Property | Value | Source |
| --- | --- | --- |
| Levels | 5 (Inferno academy: 4) | `YARD_PROPS.as:2934-2968`; `INFERNOYARDPROPS.as` id 26 has 4 cost entries |
| Build (L1) | 100,000 twigs + 100,000 pebbles, 10,800 s, Town Hall 3 + Monster Locker 2 | `YARD_PROPS.as:2934-2941` |
| L2 | 250,000 + 250,000, 21,600 s, Town Hall 4 + Locker 3 | `:2941-2948` |
| L3 | 400,000 + 400,000, 43,200 s, Town Hall 5 + Locker 3 | `:2948-2955` |
| L4 | 600,000 + 600,000, 86,400 s, Town Hall 6 + Locker 4 | `:2955-2962` |
| L5 | 900,000 + 900,000, 86,400 s, Town Hall 7 + Locker 4 | `:2962-2968` |
| How many | `[0,0,0,1,1,2,2,2,2,2,2]` by Town Hall level — one at TH3, two at TH5 | `:3025` |
| Hit points | 6,000 / 10,000 / 14,000 / 20,000 / 30,000 | `:3026` |

#### Rules

`ACADEMY.StartMonsterUpgrade(monsterID, testOnly)` (`client/scripts/ACADEMY.as:54-131`) checks, in
order:

| # | Condition | Failure message key | Line |
| --- | --- | --- | --- |
| 1 | This academy is not already training something | `acad_err_busy` | `:62`, `:118` |
| 2 | This monster is not already training (`m_upgrades[id].time` unset) | `acad_err_training` | `:63`, `:109` |
| 3 | The monster is unlocked (`lockerdata[id].t == 2`) | `acad_err_locked` | `:64`, `:103` |
| 4 | `level < trainingCosts.length + 1` | `acad_err_fullytrained` | `:65`, `:97` |
| 5 | `level <= academyLevel` | `acad_err_upgrade` | `:66`, `:86` |
| 6 | Enough Putty for `trainingCosts[level - 1][0]` | `acad_err_putty` (`acad_err_sulfur` in the Inferno) | `:68`, `:80` |

Rule 5 is the real gate: **going from level N to N+1 requires academy level ≥ N.** With five academy
levels the reachable maximum is level 6; in the Inferno, four academy levels cap monsters at level 5
(`ACADEMY.as:88-92`). The server independently clamps any reported level to 6
(`server/src/controllers/base/save/handlers/academyHandler.ts:24-26`).

Rule 1 is per building instance. Two academies (Town Hall 5+) therefore give **two concurrent
training slots**, one monster each.

On success the full Putty cost is taken, `m_upgrades[id].time` is set to `now + duration`,
`m_upgrades[id].duration` records the duration, and the academy records `_upgrading = monsterID`
(`ACADEMY.as:70-74`).

Completion runs from `ACADEMY.Tick()`, which scans every entry of `m_upgrades` for an expired `time`
(`:205-217`) and calls `FinishMonsterUpgrade` — deleting `time` and `duration`, incrementing `level`,
and clearing the academy's `_upgrading` (`:148-174`).

#### Training cost tables

`trainingCosts` is an array of `[putty, seconds]` pairs, entry `i` paying for level `i+1` → `i+2`.

| Id | L1→2 | L2→3 | L3→4 | L4→5 | L5→6 |
| --- | --- | --- | --- | --- | --- |
| `C1` | 4,000 / 2 h | 8,000 / 3 h | 12,000 / 5 h | 16,000 / 8 h | 22,000 / 12 h |
| `C2` | 8,000 / 4 h | 16,000 / 6 h | 24,000 / 10 h | 48,000 / 16 h | 64,000 / 24 h |
| `C3` | 16,000 / 4 h | 32,000 / 6 h | 48,000 / 8 h | 96,000 / 12 h | 144,000 / 16 h |
| `C4` | 32,000 / 8 h | 64,000 / 12 h | 96,000 / 18 h | 128,000 / 24 h | 160,000 / 30 h |
| `C5` | 64,000 / 5 h | 128,000 / 7 h | 192,000 / 12 h | 384,000 / 24 h | 512,000 / 36 h |
| `C6` | 128,000 / 12 h | 256,000 / 18 h | 409,600 / 24 h | 640,000 / 48 h | 820,000 / 72 h |
| `C7` | 256,000 / 12 h | 512,000 / 16 h | 756,000 / 24 h | 1,024,000 / 36 h | 1,440,000 / 48 h |
| `C8` | 512,000 / 12 h | 512,000 / 16 h | 756,000 / 24 h | 1,024,000 / 36 h | 1,440,000 / 48 h |
| `C9` | 1,024,000 / 12 h | 2,056,000 / 16 h | 2,870,000 / 20 h | 4,500,000 / 40 h | 6,000,000 / 60 h |
| `C10` | 2,048,000 / 12 h | 3,000,000 / 18 h | 4,400,000 / 24 h | 6,000,000 / 48 h | 7,500,000 / 72 h |
| `C11` | 4,096,000 / 24 h | 7,000,000 / 36 h | 12,000,000 / 48 h | 18,000,000 / 96 h | 24,000,000 / 128 h |
| `C12` | 8,192,000 / 48 h | 10,000,000 / 72 h | 12,200,000 / 96 h | 19,200,000 / 144 h | 28,000,000 / 192 h |
| `C13` | 4,096,000 / 24 h | 8,192,000 / 48 h | 8,192,000 / 72 h | 8,192,000 / 96 h | 12,800,000 / 128 h |
| `C14` | 4,096,000 / 36 h | 7,000,000 / 54 h | 10,000,000 / 80 h | 16,000,000 / 136 h | 24,000,000 / 180 h |
| `C15` | 6,192,000 / 36 h | 7,800,000 / 54 h | 12,000,000 / 80 h | 18,000,000 / 136 h | — (max level 5) |
| `C16` | 384,000 / 24 h | 384,000 / 36 h | 512,000 / 48 h | 768,000 / 60 h | 1,024,000 / 72 h |
| `C17`, `C18` | 2,560,000 / 24 h | 3,840,000 / 36 h | 4,096,000 / 48 h | 6,250,000 / 60 h | 8,500,000 / 80 h |
| `C19` | 16,000,000 / 24 h | 19,000,000 / 36 h | 22,000,000 / 48 h | 25,000,000 / 60 h | 28,000,000 / 72 h |
| `IC1` | 2,400 / 1 h | 4,800 / 2 h | 7,200 / 3 h | 9,600 / 4 h | 14,400 / 6 h |
| `IC2` | 4,800 / 4 h | 9,600 / 8 h | 14,400 / 12 h | 19,200 / 16 h | 28,800 / 24 h |
| `IC3` | 76,800 / 18 h | 153,600 / 36 h | 230,400 / 54 h | 307,200 / 72 h | 460,800 / 108 h |
| `IC4` | 38,400 / 18 h | 76,800 / 36 h | 115,200 / 54 h | 153,600 / 72 h | 230,400 / 108 h |
| `IC5` | 614,400 / 24 h | 1,228,800 / 48 h | 1,843,200 / 72 h | 2,457,600 / 96 h | 3,686,400 / 144 h |
| `IC6` | 1,228,800 / 24 h | 2,457,600 / 48 h | 3,686,400 / 72 h | 4,915,200 / 96 h | 7,372,800 / 144 h |
| `IC7` | 2,457,600 / 48 h | 4,915,200 / 96 h | 7,372,800 / 144 h | 9,830,400 / 192 h | 14,745,600 / 288 h |
| `IC8` | 4,915,200 / 72 h | 7,268,000 / 144 h | 9,296,000 / 216 h | 13,624,000 / 288 h | 19,248,000 / 432 h |

Source: `client/scripts/CREATURELOCKER.as:112-793`, mirrored on the server at
`server/src/game-data/stats/monsterStats.ts:44-724` (unused outside combat).

#### Cancel and speed-up

- **Cancel** deletes `time` and `duration`, clears the academy's `_upgrading` and **refunds the full
  Putty cost** (`ACADEMY.as:133-146`). It is behind a Yes/No confirmation
  (`ACADEMYPOPUP.as:426-428`).
- **Speed up** is the generic `STORE.SpeedUp("SP4")` (`ACADEMYPOPUP.as:435-438`).
- **Train instantly** costs `STORE.GetTimeCost(duration) + ceil(sqrt(putty / 2) ^ 0.75)` shiny,
  charged as `BASE.Purchase("ITR", …)`, and increments the level immediately without ever charging
  the Putty (`ACADEMYPOPUP.as:129-137`, `:365-424`).

#### Click flow (train a monster)

1. Click the Monster Academy building.
2. Click **Open Academy** (`BUILDINGINFO.as:222-226`, `:521-523`).
3. Click **Next** / **Previous** until the wanted monster is shown — the popup is a one-monster-per-page
   carousel that skips locked monsters (`ACADEMYPOPUP.as:55-58`, `:449-480`).
4. Click **Start Training** (`ACADEMYPOPUP.as:188-189`, `:360-363`), or **Use Shiny** for the instant
   version (`:187`).

There is no list view and no way to jump to a monster; reaching `C14` from `C1` is 13 clicks of
**Next**.

### 4.2 Monster Lab

Building id **116** (`#b_monsterlab#`, `YARD_PROPS.as:6225-6282`, class `MONSTERLAB`).

| Property | Value | Source |
| --- | --- | --- |
| Levels | 3 | `YARD_PROPS.as:6236-6266` (3 cost entries) |
| Build (L1) | 100,000 twigs + 100,000 pebbles, 10,800 s, Town Hall 5 + Locker 3 + Academy 2 | `:6237-6243` |
| L2 | 300,000 + 300,000, 43,200 s, Town Hall 6 + Locker 4 + Academy 3 | `:6243-6249` |
| L3 | 600,000 + 600,000, 86,400 s, Town Hall 7 + Locker 4 + Academy 4 | `:6249-6256` |
| How many | `[0,0,0,0,0,1,1,1,1,1,1]` — one from Town Hall 5 | `:6278` |
| Hit points | 9,000 / 16,000 / 24,000 / 32,000 | `:6279` |

#### Ability table

`MONSTERLAB._powerupProps` (`client/scripts/MONSTERLAB.as:77-188`). `costs[i]` is
`[putty, seconds]` for rank `i+1`; `effect[i]` is the value at that rank.

| Id | Ability | Rank 1 | Rank 2 | Rank 3 | Effect per rank | Line |
| --- | --- | --- | --- | --- | --- | --- |
| `C3` Bolt | Blink Range | 48,000 / 24 h | 72,000 / 24 h | 108,000 / 24 h | 150, 300, 450 | `:78-88` |
| `C4` Fink | Extra Target(s) | 96,000 / 30 h | 128,000 / 30 h | 144,000 / 30 h | 1, 2, 3 | `:89-99` |
| `C7` Bandito | Whirlwind | 1,000,000 / 32 h | 1,500,000 / 32 h | 2,000,000 / 32 h | 1x, 1.5x, 2x speed | `:100-110` |
| `C8` Fang | Venom Damage | 2,000,000 / 36 h | 3,000,000 / 36 h | 4,500,000 / 36 h | 0.1, 0.2, 0.3 × base damage | `:111-121` |
| `C5` Eye-Ra | Airburst Bonus | 3,560,000 / 48 h | 4,120,000 / 54 h | 5,120,000 / 60 h | 20%, 30%, 40% | `:122-132` |
| `C9` Brain | Cloak Delay (seconds) | 3,000,000 / 48 h | 4,500,000 / 48 h | 6,000,000 / 48 h | 0, 4, 8 | `:133-143` |
| `C11` Project X | Acid Damage | 8,000,000 / 72 h | 12,000,000 / 72 h | 18,000,000 / 72 h | 1, 2, 3 × base damage | `:144-154` |
| `C13` Wormzer | Splash Damage | 10,000,000 / 96 h | 15,000,000 / 96 h | 22,500,000 / 96 h | 1, 2, 3 × base damage | `:166-176` |
| `C14` Teratorn | Fireball Bounces | 12,000,000 / 120 h | 18,000,000 / 120 h | 27,000,000 / 120 h | 1, 2, 3 | `:177-187` |
| `C12` D.A.V.E. | Rocket Range | 15,000,000 / 144 h | 22,500,000 / 144 h | 33,750,000 / 144 h | 140, 180, 220 | `:155-165` |

Ten monsters have an ability. The nine others (and every Inferno monster) have none, so the lab list
has ten rows. Two of the ten (`C13`, `C14`) sit above the rank cap the lab can reach at level 3 only
in cost, not in gating — see below.

#### Rules

`MONSTERLAB.CanPowerup(monsterID, rank)` (`:269-313`), in order:

| # | Condition | Error string | Line |
| --- | --- | --- | --- |
| 1 | `m_upgrades[id]` exists | `Not Unlocked` | `:270-275` |
| 2 | Current `powerup != 3` | `Fully Powered Up` | `:276-281` |
| 3 | `rank <= labLevel` | `Upgrade Monster Lab` | `:282-287` |
| 4 | `lockerdata[id]` exists and `t >= 2` | `Not Unlocked` | `:288-299` |
| 5 | `m_upgrades[id].level >= rank + 1` | `Needs Training` | `:300-305` |
| 6 | Enough Putty | `acad_err_putty` | `:306-311` |

So **rank N needs lab level N and monster level N+1**. Lab level 3 is the cap, matching the three
ranks.

**One research at a time, globally** — the lab stores a single `_upgrading` / `_upgradeFinishTime` /
`_upgradeLevel` triple (`MONSTERLAB.as:315-325`), and only one lab can exist. The lab cannot be
upgraded or recycled while researching (`:241-257`).

Completion is polled in `MONSTERLAB.Tick()`: when `now >= _upgradeFinishTime`, `m_upgrades[id].powerup`
is set to the rank and `_upgrading` cleared (`:198-206`, `:327-368`).

#### Cancel and speed-up

- **Cancel** refunds the full Putty cost by charging a negative amount
  (`BASE.Charge(3, cost * -1)`, `MONSTERLAB.as:379-388`), behind a confirmation (`:370-377`).
- **Speed up** is `STORE.SpeedUp("SP4")` against the lab building (`MONSTERLABPOPUP.as:429-432`).
- **Instant** costs `GetShinyCost = STORE.GetTimeCost(seconds, false) + ceil(sqrt(putty / 2) ^ 0.75)`
  shiny, charged as `BASE.Purchase("IPU", …)`, and sets `powerup` directly
  (`MONSTERLAB.as:69-73`, `:390-431`).

#### Click flow (research an ability)

1. Click the Monster Lab building.
2. Click **Open Lab** (`BUILDINGINFO.as:234-236`, `:482-484`).
3. Click a monster in the scrolling ability list (`MONSTERLABPOPUP.as:483`).
4. Click **Start** (`MONSTERLABPOPUP.as:298-301`, `:415-418`), or the shiny button for instant
   (`:297`, `:420-423`).

---

## 5. Hatchery

Building id **13** (`#b_hatchery#`, `YARD_PROPS.as:1215-1297`, class `BUILDING13`). The Inferno
equivalent is the Incubator — same class, different label.

| Property | Value | Source |
| --- | --- | --- |
| Levels | 3 | `YARD_PROPS.as:1228-1248` |
| Build (L1) | 2,000 twigs + 2,000 pebbles, 900 s, Town Hall 1 + Housing 1 | `:1228-1234` |
| L2 | 21,227 + 49,529, 3,600 s, Town Hall 3 + Monster Locker 1 | `:1235-1241` |
| L3 | 93,600 + 218,427, 43,200 s, Town Hall 4 | `:1242-1247` |
| How many | `[0,1,2,3,4,5,5,5,5,5,5]` by Town Hall level — up to **5 hatcheries** from TH5 | `:1295` |
| Hit points | 4,000 / 16,000 / 32,000 | `:1296` |
| Footprint | 100 × 100 | `HatcheryBase.as:16` |

### 5.1 Queue capacity

| Quantity | Formula | Level 1 | Level 2 | Level 3 | Source |
| --- | --- | --- | --- | --- | --- |
| Visible slots (including the in-production slot) | `2 + level` | 3 | 4 | 5 | `HATCHERYPOPUP.as:331`, `:392` |
| Queue stacks | `1 + level` | 2 | 3 | 4 | `HATCHERYPOPUP.as:241` |
| Monsters per stack | fixed | 20 | 20 | 20 | `HATCHERYPOPUP.as:255`, `:264` |
| **Queued monsters, max** | `(1 + level) × 20` | 40 | 60 | **80** | derived |

Each hatchery also holds exactly one monster in production on top of the queue
(`BUILDING13.as:219-236`). The queue is **per hatchery**, so a Town Hall 5 player with five level-3
hatcheries can hold 5 × (80 + 1) = 405 monsters in flight — subject to housing space at the moment
each one finishes.

### 5.2 Adding monsters — the exact flow

This is the flow the redesign has to replace. It is `MOUSE_DOWN` on a monster icon, **one monster per
click, with no hold-to-repeat and no quantity entry**.

```
1.  Click the Hatchery sprite in the yard        -> BFOUNDATION.Click, BASE.BuildingSelect
                                                    (client/scripts/BFOUNDATION.as:2833-2838)
2.  Click "View Hatchery" in the info bar        -> HATCHERY.Show(building)
                                                    (client/scripts/BUILDINGINFO.as:193-197, :488-490)
    ... HATCHERYPOPUP opens: a scrolling 9-per-row grid of 65x50 monster icons
        (client/scripts/HATCHERYPOPUP.as:61-96)
3.  (optional) Hover an icon to read its stats   -> MonsterInfo / MonsterInfoB
                                                    (HATCHERYPOPUP.as:78, :114-224)
4.  (optional) Drag the scrollbar to reach icons below the fold
                                                    (HATCHERYPOPUP.as:50-60)
5.  Click a monster icon                         -> QueueAdd: adds exactly ONE
                                                    (HATCHERYPOPUP.as:85, :234-292)
6.  Repeat step 5 once per monster
7.  Click the popup's close button               -> HATCHERY.Hide
                                                    (client/scripts/HATCHERY.as:27-36)
```

**Click count.** Four clicks to queue one monster. Three fixed clicks plus one per monster after
that. **Filling a level-3 hatchery queue (80 monsters) takes 83 clicks**, 320 clicks across five
hatcheries, and each of the 80 clicks fires an independent `BASE.Save()`
(`HATCHERYPOPUP.as:294-298`) — 80 round trips to `/base/save`.

`QueueAdd` in detail (`HATCHERYPOPUP.as:234-292`):

1. Compute the queue-stack limit `1 + hatcheryLevel`.
2. Test-charge the goo cost; if short, show "not enough Goo" (or "Not enough Magma.") and stop.
3. Refuse if the monster is not unlocked (`lockerdata[id].t != 2`) — the icon is also drawn at
   `alpha 0.5` and has no click handler in that case (`:84-92`).
4. Scan the queue for **any** existing stack of that monster with count < 20 and increment it.
   Monsters merge into their first non-full stack rather than the last one.
5. Otherwise, if the last stack is the same monster and full, or the last stack is a different
   monster, push a new `[id, 1]` stack — provided the stack count is below the limit. If it is not,
   play `error1` and change nothing.
6. Charge the goo, spawn a resource-package animation, and `BASE.Save()`.
7. If nothing was in production, call `StartProduction()`.

Note the asymmetry in step 4: because the scan finds the *first* non-full stack, adding a second
monster type and then going back to the first fills the earlier stack instead of creating a new one.

### 5.3 Production

`BUILDING13.Tick(delta)` (`client/scripts/BUILDING13.as:249-347`) runs a five-state machine on
`_productionStage`:

| Stage | Meaning | Transition |
| --- | --- | --- |
| 0 | Idle, nothing in production | `StartProduction()` pulls the head of the queue → 3 |
| 3 | Just started | → 4 immediately, `_hasResources = true` (`:334-337`) |
| 4 | Charging | Sets `_countdownProduce = cTime` → 1 (`:338-344`) |
| 1 | Producing | `_countdownProduce` decreases by `delta`, or by `overdrivePower * delta` (`:321-326`); at ≤ 0 → 2 |
| 2 | Finished, waiting for housing | Calls `HOUSING.HousingStore`; on success → `StartProduction()` (`:328-333`) |

Consequences:

- **A hatchery stalls at stage 2 when housing is full.** Nothing is lost and nothing is refunded; the
  monster waits. The popup shows "needs housing" (`HATCHERYPOPUP.as:441-443`) and the building shows
  the same in its description (`BUILDING13.as:156-161`).
- **A hatchery below 50% health stops working.** `_canFunction` is false when
  `_countdownBuild > 0 || health < maxHealth * 0.5` (`BUILDING13.as:262-267`), and the popup shows
  "damaged" (`HATCHERYPOPUP.as:466`).
- Production continues while offline only through the catch-up tick; `_timeStamp` (the `saved`
  field) blocks ticking until real time has caught up (`BUILDING13.as:259-261`, `:470-475`).

`StartProduction()` also rewrites the legacy id `C100` to `C12` (`:225-227`, `:255-257`, `:481-484`).

### 5.4 Cancel and refund

| Action | Effect | Source |
| --- | --- | --- |
| Click queue slot *n* (n ≥ 1) | Removes **one** monster from stack *n*; **full goo refund** | `HATCHERYPOPUP.as:300-326` |
| Click slot 0 (in production) | Refunds the in-production monster in full and starts the next queued monster | `HATCHERYPOPUP.as:320-323` |
| Hatchery destroyed in an attack | Queue and in-production monster are cleared; **75% of the total goo is refunded**, rounded up, and spilled as resource packages | `BUILDING13.as:67-137`, refund at `:103` |
| Hatchery Control Center built | Every hatchery's own queue is emptied and **fully refunded** | `BUILDING16.as:238-255` |

Removal is one click per monster, the mirror image of the add flow. A hover reveals a small remove
badge over the slot (`HATCHERYPOPUP.as:396-397`, `:416-428`).

### 5.5 Speed-ups

**Finish Now** (`bFinish`) instantly houses everything that fits.

Cost: `STORE.GetTimeCost(totalSeconds, false) * 4` shiny, where `totalSeconds` is the remaining
production countdown plus `cTime × count` for every queued monster that fits into the remaining
housing space (`BUILDING13.as:268-311`, cost at `:307`). If the queue only partly fits, `_finishAll`
is false and the confirmation text changes from "finish queue" to "fill housing"
(`HATCHERYPOPUP.as:523-534`). If housing is already full the cost is 0 and the button reports
"housing full" instead (`HATCHERYPOPUP.as:540-542`).

`FinishNow()` then houses the in-production monster, walks the queue housing monsters until space
runs out, promotes the next queue entry to in-production, and charges `BASE.Purchase("FQ", cost)`
(`BUILDING13.as:349-413`).

**Hatchery Overdrive** multiplies the production countdown for every hatchery in the yard at once.

| Item | Multiplier | Duration | Shiny | Source |
| --- | --- | --- | --- | --- |
| `HOD` | 4x | 3,600 s | 30 | `server/src/game-data/store/storeItems.ts:119-126` |
| `HOD2` | 6x | 3,600 s | 50 | `:407-414` |
| `HOD3` | 10x | 3,600 s | 100 | `:415-422` |
| `HODI` / `HOD2I` / `HOD3I` | same, Inferno | — | — | `:1255-1278` |

The multiplier reaches the client as `GLOBAL._hatcheryOverdrivePower` (4, 6 or 10) with
`GLOBAL._hatcheryOverdrive` as the remaining seconds (`client/scripts/STORE.as:2388-2412`), and is
applied as `_countdownProduce.Add(-power * delta)` (`BUILDING13.as:321-323`). Overdrives do not
stack. The "Speed up" button in the hatchery popup simply opens the store on those three items
(`HATCHERYPOPUP.as:39-44`).

### 5.6 Hatchery Control Center

Building id **16** (`#b_hcc#`, `YARD_PROPS.as:1663-1709`, class `BUILDING16`). One per yard from Town
Hall 3, and it requires **three hatcheries at level 2** (`re: [[14,1,3],[13,3,2]]`, `:1682`). Cost
4,000,000 of twigs, pebbles and putty, 90,000 s. Single level, 64,000 hit points.

The HCC replaces the per-hatchery queue with **one shared queue that feeds every hatchery**:

- Building it empties and refunds every existing hatchery queue (`BUILDING16.as:238-255`).
- Its own `_monsterQueue` holds **7 stacks** of up to **20** each (`HATCHERYCCPOPUP.as:323`, `:329`,
  `:333`) — 140 monsters. A subscription reward raises the per-stack cap to 30
  (`client/scripts/com/monsters/subscriptions/rewards/ImprovedHCCReward.as:8`, `:19`), i.e. 210.
- Each tick it hands the head of the queue to the first idle, functional hatchery
  (`BUILDING16.as:96-137`).
- Clicking the Hatchery *or* the HCC opens the HCC popup once it exists
  (`BUILDINGINFO.as:192-194`, `:215-220`).

**The HCC add flow is press-and-hold, not click-per-monster.** `QueueAdd` starts an `ENTER_FRAME`
loop: one monster is added on the first frame, then one more every `queueLimit` (20) frames while the
button stays down, and then one per frame after that (`HATCHERYCCPOPUP.as:302-350`). Removal works
the same way (`:405-438`). Clicking one of the five hatchery tiles cancels that hatchery's current
production and refunds it (`:440-459`).

Its Finish Now cost uses the same `STORE.GetTimeCost(total, false) * 4` formula summed across all
hatcheries plus the shared queue (`BUILDING16.as:172-177`).

### 5.7 Moving hatched monsters into housing

`HOUSING.HousingStore(creatureID, point, testOnly, hackGuard)`
(`client/scripts/HOUSING.as:92-125`):

1. Refuse and log a cheat warning if `hackGuard > 0` (`:95-99`).
2. Recompute housing space.
3. Refuse when `_housingSpace < cStorage` — unless the yard is a "juice"-behaviour wild monster camp.
4. Pick the housing building with the **fewest creatures already assigned** (not the nearest, despite
   the field being named `dist`, `HOUSING.as:136-159`) and spawn the creep there.
5. Register the monster on `GLOBAL.player` (`:121`).

---

## 6. Housing and bunkers

### 6.1 Monster Housing

Building id **15** (`#b_housing#`, `YARD_PROPS.as:1553-1662`, class `BUILDING15`).

Map Room 2 overrides both the cost table and the capacity table at runtime
(`client/scripts/GLOBAL.as:615-714`), and `getEffectiveLevel()` caps the level at 6 in Map Room 2
(`client/scripts/BFOUNDATION.as:835-843`, `:852-860`).

| Level | Map Room 2 capacity | Map Room 2 build cost (twigs = pebbles) | Time | Requires | Map Room 3 capacity |
| --- | --- | --- | --- | --- | --- |
| 1 | 200 | 2,160 | 300 s | Town Hall 1 | 250 |
| 2 | 260 | 8,640 | 4,500 s | Town Hall 3 + Locker 1 | 425 |
| 3 | 320 | 34,560 | 10,800 s | Town Hall 4 + Locker 1 | 520 |
| 4 | 380 | 138,240 | 28,800 s | Town Hall 5 + Locker 1 | 670 |
| 5 | 450 | 552,960 | 72,000 s | Town Hall 6 + Locker 1 | 740 |
| 6 | 540 | 2,211,840 | 144,000 s | Town Hall 6 + Locker 1 | 870 |
| 7–10 | — (capped) | — | — | — | 1090, 1225, 1440, 1680 |

Map Room 2 values: `GLOBAL.as:639-682`. Map Room 3 values: `YARD_PROPS.as:1566-1634`, `:1659`.
Quantity by Town Hall level: `[0,1,1,2,2,3,3,3,4,4,4]` (`:1658`) — up to four housing buildings.
Hit points `[4000,14000,25000,43000,75000,130000,145000,160000,175000,190000]` (`:1660`).

**Total capacity** is the sum over every built, non-upgrading housing building with health > 10
(`HOUSING.as:66-78`). At Map Room 2 maximums that is 4 × 540 = 2,160 space. **Used** is
`sum(cStorage(monster) × count)` (`:79-85`). `_housingSpace = capacity - used` (`:85`).

The `EXH` store item ("Housing Expansion", 375 shiny, 86,400 s) multiplies each building's capacity
by 1.25 while active (`HOUSING.as:69-71`, `:88-90`;
`server/src/game-data/store/storeItems.ts:1007-1014`; power set at `client/scripts/STORE.as:2423-2431`).

**Overflow.** `HOUSING.Cull()` runs when capacity drops below usage — a housing building recycled,
destroyed, or the expansion powerup expiring. It repeatedly walks the monster list removing **one of
every type per pass** until usage fits (`HOUSING.as:161-199`). It does not remove the cheapest or the
newest; it thins every stack evenly, and there is no refund.

The Housing popup (`HOUSINGPOPUP.as`) is a read-only roster with two actions: send selected monsters
to the Monster Juicer to be recycled into goo (`:35-42`, `:302-361`), and Ascend monsters to the
Inferno (`:51-52`, `:395-399`).

### 6.2 Housing Bunker (Inferno Compound)

Building id **128** (`#b_housingbunker#`, class `HOUSINGBUNKER`, `client/scripts/HOUSINGBUNKER.as`).
On the surface it carries `"block": true` and `quantity: [0]`
(`YARD_PROPS.as:6857-6870`, flag at `:6868`, quantity at `:6870`) — **it cannot be built there.** It
is the Inferno yard's housing, and `HOUSING` swaps to it wherever
`BASE.isInfernoMainYardOrOutpost` is true (`HOUSING.as:65`, `:142`, `:169`, `:211`).

It extends `Bunker` rather than a plain foundation, so it is housing *and* a defensive structure with
its own range: `_range = _buildingProps.stats[level - 1].range` and
`_capacity = _buildingProps.capacity[level - 1]` (`HOUSINGBUNKER.as:82-87`). Its Inferno entry
(`INFERNOYARDPROPS.as:5995-6070`) gives 6 levels, capacity
`[200, 300, 520, 780, 1140, 1820]` (`:6067`), ranges `[500, 530, 560, 590, 620, 650]` (`:6006`) and
quantity `[0, 1, 1, 1, 1, 1, 1]` by Town Hall level (`:6066`). Recycling is blocked when it would
push housing usage over capacity (`HOUSINGBUNKER.as:70-74`).

`HousingPersistentPopup.as` is the Map Room 3 version of the housing screen, chosen by
`HOUSING.Show()` when `MapRoomManager.instance.isInMapRoom3` (`HOUSING.as:34-39`). "Persistent" here
means Map Room 3's model where each creep is an individual record with its own health that survives
between battles, rather than Map Room 2's plain counts.

### 6.3 Monster Bunker

Building id **22** (`#b_monsterbunker#`, `YARD_PROPS.as:2410-2486`, class `BUILDING22`).

| Level | MR2 capacity | MR3 capacity | Range | Build cost (twigs / pebbles / putty) | Time | Requires |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 380 | 190 | 300 | 250,000 / 187,500 / 62,500 | 21,600 s | Town Hall 3 + Housing 1 |
| 2 | 450 | 225 | 350 | 1,000,000 / 1,000,000 / 500,000 | 43,200 s | Town Hall 4 + Housing 2 |
| 3 | 540 | 270 | 400 | 2,000,000 / 2,000,000 / 1,000,000 | 86,400 s | Town Hall 5 + Housing 3 |
| 4 | 660 | 330 | 450 | 4,000,000 / 4,000,000 / 2,000,000 | 172,800 s | Town Hall 9 + Housing 3 |
| 5 | 800 | 400 | 500 | 8,000,000 / 8,000,000 / 4,000,000 | 345,600 s | Town Hall 10 + Housing 3 |

Map Room 2 capacities come from the runtime override `GLOBAL.as:683`; the base table
(`YARD_PROPS.as:2483`) is the Map Room 3 one. Ranges: `YARD_PROPS.as:2423`. Quantity by Town Hall
level `[0,0,0,1,1,2,2,3,4,4,4]` (`:2482`) — up to **four bunkers**. Hit points
`[10000,24500,52000,75000,105000]` (`:2484`).

Bunker space is **separate from housing space** and uses the same `cStorage` values
(`BUILDING22.as:313-320`).

#### Which monsters may go in

`BUNKERABLE_MONSTERS` (`client/scripts/MONSTERBUNKERPOPUP.as:48-69`) — `C1`–`C13`, `C17`, and
`IC1`–`IC8`. **`C14` Teratorn, `C15` Zafreeti, `C16` Vorg, `C18` and `C19` cannot be bunkered.**

A second list, `BUYABLE_MONSTERS` (`:30-46`), is the shiny price per monster for filling the bunker
straight from the store without owning the monster:

| Id | Shiny | Id | Shiny | Id | Shiny |
| --- | --- | --- | --- | --- | --- |
| `C2` | 2 | `C8` | 12 | `C12` | 65 |
| `IC1` | 3 | `C10` | 14 | `IC2` | 4 |
| `C6` | 5 | `C5` | 16 | `IC5` | 32 |
| `C7` | 8 | `C17` | 17 | `IC7` | 32 |
| `C11` | 24 | `C13` | 24 | `IC8` | 55 |

#### Filling the bunker

Two tabs, "From Housing" and "Buy" (`MONSTERBUNKERPOPUP.as:101-106`, `:156-177`).

| Tab | Cost | Requirement | Source |
| --- | --- | --- | --- |
| From Housing | `cResource × 0.5 × count` in **Putty** | You must already own the monsters, and they leave housing | `:464-476`, charge at `:521` |
| Buy | `BUYABLE_MONSTERS[id] × count` in **shiny** | The monster must be unlocked in the locker | `:543-556`, `:595-640` |

The click flow is `+` / `−` steppers per monster row, then one **>>** transfer button:

```
1. Click the Monster Bunker sprite
2. Click "Open Bunker"                      (BUILDINGINFO.as:213-215, :503-505)
3. Click the "From Housing" or "Buy" tab    (MONSTERBUNKERPOPUP.as:101-106)
4. Click "+" once per monster (or "-")      (:114-118, :477-501)
5. Click ">>"                               (:107-110, :503-558)
```

Capacity is checked per click: `CheckID` sums stored plus selected `cStorage` against the bunker
capacity and refuses the `+` when it would overflow (`:595-620`).

#### Taking monsters out

There is no "return to housing" on the Map Room 2 bunker. The right-hand column's button is **Juice**
when a Monster Juicer exists and is above 50% health, and **Remove** otherwise
(`MONSTERBUNKERPOPUP.as:122-132`). Either way the monster is decremented out of the bunker and is
gone — juiced into goo, or simply deleted (`:698-745`). The putty or shiny spent is not refunded.

`PersistentMonsterBunker.as` is the Map Room 3 version and behaves differently: `+` adds immediately
with **no cost**, and `bunkerRemove` **returns the creep to housing** intact
(`PersistentMonsterBunker.as:274-281`, `:316-362`, `:369-410`). It tracks individual `CreepInfo`
records rather than counts, which is what "persistent" means here.

#### How bunker monsters engage

Defence logic lives in `BUILDING22.FindTargets` and `TickAttack` and belongs to the combat spec. The
parts that constrain the out-of-combat design:

- Targets are found inside `stats[level - 1].range` of the bunker's centre, offset by half the
  footprint height (`BUILDING22.as:90`, `:123-124`). Ground targets and flying targets are tracked in
  two separate lists.
- A retarget runs every 10 frames while there are no targets, and every 60 frames regardless
  (`:340-341`).
- One monster is released every 30 ticks while targets exist (`:344`).
- Only four monster types can be released against **flyers**, and two of them need their lab ability:
  `C12` and `C5` require `m_upgrades[<id>].powerup` to be set; `IC5` and `IC7` need no ability
  (`:345-360`, and the same condition at `:123`).
- `_monstersDispatched` caps releases at the stored count, so a bunker empties over the course of one
  battle rather than respawning.
- When the bunker is destroyed, every stored monster's health is halved and the count is reset to
  whatever was dispatched (`:489-509`).

---

## 7. Champions

Champions are a separate roster from monsters: five "guardians" `G1`..`G5`, kept on the save's
`champion` column rather than in `monsters`.

### 7.1 Buildings

| Building | Id | Class | Levels | Cost | Time | Requires | Quantity | HP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Champion Cage | 114 | `CHAMPIONCAGE` | 1 | 500,000 twigs + 500,000 pebbles + 250,000 putty | 86,400 s | Town Hall 4 | `[0,0,0,0,1,…]` — one from TH4 | 10,000 |
| Champion Chamber | 119 | `CHAMPIONCHAMBER` | 1 | 500,000 + 500,000 + 250,000 | 86,400 s | Town Hall 4 **and a Champion Cage** | one from TH4 | 16,000 |

Sources: `YARD_PROPS.as:5993-6031` and `:6521-6562`. Footprints: cage 160 × 160
(`CHAMPIONCAGE.as:274`), chamber 100 × 100 (`CHAMPIONCHAMBER.as:25`).

**The cage is where a champion lives.** It cannot be recycled while any champion exists
(`CHAMPIONCAGE.as:897-905`), and the champion takes no damage from the cage being attacked
(`modifyHealth` returns 0, `:911-913`).

**The chamber is cold storage.** It holds champions the player is not using so a different one can
occupy the cage. It cannot be recycled while anything is frozen (`CHAMPIONCHAMBER.as:93-101`).

### 7.2 Acquiring a champion

Opening the cage with no active basic champion shows `CHAMPIONSELECTPOPUP`
(`CHAMPIONCAGE.as:328-332`). That popup lists every guardian for which
`CanTrainGuardian(n)` is true — `props.powerLevel > 0 && classType == CLASS_TYPE_BASIC`
(`CHAMPIONCAGE.as:459-461`, `CHAMPIONSELECTPOPUP.as:44`).

| Id | Name | `classType` | `powerLevel` | Selectable at the cage? |
| --- | --- | --- | --- | --- |
| `G1` | Gorgo | basic (1) | 1 | yes |
| `G2` | Drull | basic (1) | 1 | yes |
| `G3` | Fomor | basic (1) | 1 | yes |
| `G4` | Korath | basic (1) | 0 | **no** |
| `G5` | Krallen | special (2) | 0 | **no** |

Source: `CHAMPIONCAGE.as:44-269`. Picking one is free: `RaiseGuard` spawns it at level 1 with full
health and saves (`CHAMPIONSELECTPOPUP.as:72-90`). Only **one basic champion can be active at a
time**; `CREATURES._guardian` is a single slot (`client/scripts/CREATURES.as:219-239`). Krallen is a
`CLASS_TYPE_SPECIAL` guardian that sits alongside the basic one in `_guardianList`
(`CREATURES.as:241-257`) and is granted by the King of the Hill event reward
(`client/scripts/com/monsters/kingOfTheHill/rewards/KrallenReward.as:34-49`), with its power level
capped at 2 (`com/monsters/monsters/champions/Krallen.as:15`, `:25`).

### 7.3 Stats per evolution level

Champions have **six levels**. Arrays are indexed by level, clamped to the last entry
(`CHAMPIONCAGE.GetGuardianProperty`, `:401-416`).

| Id | `health` | `damage` | `speed` | `range` | `healtime` (s) | `buffs` |
| --- | --- | --- | --- | --- | --- | --- |
| `G1` Gorgo | 40000, 80000, 120000, 140000, 160000, 200000 | 1000, 1200, 1500, 2000, 2500, 3000 | 1, 1.2, 1.4, 1.6, 1.8, 2 | 35, 45, 55, 65, 70, 70 | 3600, 7200, 14400, 28800, 57600, 115200 | 0 |
| `G2` Drull | 12000, 20000, 36000, 42000, 52000, 60000 | 3000, 3600, 4200, 5500, 6500, 8000 | 2, 2.2, 2.5, 2.8, 3.2, 3.6 | 35, 45, 55, 65, 85, 90 | same | 0 |
| `G3` Fomor | 15000, 17500, 20000, 22500, 25000, 40000 | 70, 80, 90, 100, 110, 120 | 1.2, 1.4, 2, 2.1, 2.2, 2.3 | 140, 140, 180, 190, 200, 210 | same | 0.1, 0.2, 0.3, 0.4, 0.5, 0.6 |
| `G4` Korath | 28000, 62000, 96000, 120000, 144000, 175000 | 2000, 2400, 3000, 3800, 5000, 6500 | 1.4, 1.6, 1.8, 2, 2.3, 2.5 | 35, 45, 55, 60, 65, 65 | same | 0 |
| `G5` Krallen | 50000, 52000, 54000, 58000, 62000 | 800, 850, 900, 1000, 1200 | 2.2, 2.3, 2.4, 2.5, 2.6 | 35, 45, 55, 60, 65 | 7200, 14400, 28800, 57600, 115200 | 0.2, 0.22, 0.24, 0.27, 0.3; `buffRadius` 250, 275, 300, 325, 350 |

Source: `CHAMPIONCAGE.as:53-267`. Fomor gains flight at level 3 (`movement: ["ground","ground","fly"]`,
`:160`). Krallen gains `ProximityLootBuff` at power level 3 (`abilities: [null, null, ProximityLootBuff]`,
`:265`). Korath's power levels 2 and 3 are labelled fireball and stomp (`:185-186`). The server keeps
the same tables at `server/src/game-data/stats/championStats.ts:39-186` — with `feeds`, `bonusFeeds`,
`powerLevel`, `abilities`, `description` and `title` dropped.

### 7.4 Feeding and evolving

A champion must be fed on a timer or it starves.

| Constant | Value | Source |
| --- | --- | --- |
| Feed interval (`feedTime`) | 23 hours (`3600 * 23` = 82,800 s) for all five | `CHAMPIONCAGE.as:69`, `:112`, `:158`, `:203`, `:248` |
| Bonus feed interval (`bonusFeedTime`) | 24 hours | `:84`, `:127`, `:173`, `:218`, `:264` |
| Starve grace (`STARVETIMER`) | 24 hours after `feedTime` expires | `CHAMPIONCAGE.as:26` |
| Feeds needed per level (`feedCount`) | 3, 6, 9, 12, 15 | `:68`, `:111`, `:157`, `:202`, `:247` |

**Feeding with monsters.** Each feed consumes a fixed recipe of housed monsters, given by
`props.feeds[level - 1]`. Map Room 2 uses the doubled recipes installed by
`CHAMPIONCAGE.setFeedProps()` (`:537-575`); the Map Room 3 recipes are the smaller ones in the table
literal.

| Champion | Map Room 2 feed recipes, levels 1→5 | Bonus feed (level 6) | Source |
| --- | --- | --- | --- |
| `G1` Gorgo | 15 `C2`; 10 `C2` + 5 `C6`; 20 `C6`; 10 `C6` + 10 `C10`; 20 `C10` | 20 `C10` | `:539-546` |
| `G2` Drull | 30 `C1`; 20 `C1` + 15 `C4`; 50 `C7`; 10 `C7` + 15 `C8`; 30 `C8` | 30 `C8` | `:547-554` |
| `G3` Fomor | 20 `C3`; 20 `C3` + 2 `C9`; 40 `C3` + 5 `C9`; 30 `C3` + 10 `C9`; 20 `C9` | 20 `C9` | `:555-565` |
| `G4` Korath | 20 `IC1` + 10 `IC2`; 10 `IC2` + 2 `IC7`; 6 `IC7`; 10 `IC7`; 3 `IC8` | 3 `IC8` | `:566-573` |
| `G5` Krallen | 20 `IC1` + 10 `IC2`; 10 `IC2` + 2 `IC7`; 6 `IC7`; 10 `IC7`; 3 `IC8` | 3 `IC8` | `:238-244`, `:261` |

`FeedGuardian` (`CHAMPIONCAGE.as:682-877`) checks the player has enough **healthy housed** monsters
of each type, removes them, animates them walking to the cage, increments `_feeds`, and resets
`_feedTime` to `now + feedTime`. When `_feeds` reaches `feedCount` the champion evolves via
`levelSet(level + 1)` (`:849-863`). `levelSet` resets `_feeds` to 0, resets the feed timer, applies
the new stat row and heals to full (`com/monsters/monsters/champions/ChampionBase.as:731-773`).

**Feeding with shiny.** `feedShiny` buys one feed:

| Champion | `feedShiny` (levels 1–5) | `evolveShiny` | `bonusFeedShiny` |
| --- | --- | --- | --- |
| `G1` Gorgo | 26, 44, 75, 111, 136 | 158, 530, 1358, 2664, 4076 | 136 |
| `G2` Drull | 26, 44, 75, 105, 131 | 158, 530, 1358, 2530, 3918 | 131 |
| `G3` Fomor | 26, 45, 62, 76, 96 | 154, 537, 1116, 1822, 2891 | 96 |
| `G4` Korath | 26, 44, 75, 111, 136 | 158, 530, 1358, 2664, 4076 | 96 |
| `G5` Krallen | 26, 44, 75, 111, 136 | 158, 530, 1358, 2664 | 96 |

Source: `CHAMPIONCAGE.as:66-67`, `:109-110`, `:155-156`, `:200-201`, `:245-246`. A shiny feed is
charged as `BASE.Purchase("IFD", …)` (`:793`).

**The `evolveShiny` arrays are never read.** The instant-evolve button computes its own price:
`feedShiny[level] × 2 × (feedCount[level] − feedsSoFar)`, charged as `BASE.Purchase("IEV", …)`
(`CHAMPIONCAGEPOPUP.as:1208-1238`). Outside the feed window the shiny feed price is also doubled
(`CHAMPIONCAGEPOPUP.as:1240-1246` passing `param4 = true`, doubling at `CHAMPIONCAGE.as:707-709`).

**Starvation.** While below level 6, if `now > feedTime + STARVETIMER` the champion **loses one feed**
and the timer restarts (`ChampionBase.as:1062-1076`). At level 6 the same overrun instead drops the
food bonus by one (`:1091-1109`).

**Food bonus.** At level 6 feeding no longer evolves; it raises `_foodBonus` from 0 to a maximum of 3
(`CHAMPIONCAGE.as:697-786`). Each rank adds flat bonuses on top of the level-6 stats:

| Champion | `bonusHealth` | `bonusDamage` | `bonusSpeed` | `bonusRange` | `bonusBuffs` |
| --- | --- | --- | --- | --- | --- |
| `G1` Gorgo | 12500, 27500, 50000 | 150, 330, 600 | 0.1, 0.2, 0.4 | 0 | 0 |
| `G2` Drull | 2500, 5500, 10000 | 400, 880, 1600 | 0.1, 0.2, 0.4 | 0 | 0 |
| `G3` Fomor | 1000, 2200, 4000 | 3, 6, 10 | 0.1, 0.2, 0.4 | 3, 6, 10 | 0.03, 0.06, 0.15 |
| `G4` Korath | 1000, 2200, 4000 | 300, 600, 1000 | 0.1, 0.2, 0.4 | 0 | 0 |
| `G5` Krallen | 0 | 0 | 0 | 0 | 0 |

Source: `CHAMPIONCAGE.as:76-80`, `:119-123`, `:165-169`, `:210-214`, `:256-260`. Applied in
`ChampionBase.updateBuffs` (`:1244-1290`), where the bonus speed is **averaged** with the base speed
rather than added: `(speed + bonusSpeed) / 2`.

### 7.5 Healing

A champion regenerates passively in the cage: every 5 seconds it gains
`maxHealth * 5 / healtime` health (`ChampionBase.as:1044-1053`, `_regen` set from `healtime` at
`:135` and `:764`). Full recovery therefore takes `healtime` seconds — 1 hour at level 1 rising to
**32 hours at level 6**.

Instant healing costs shiny:

```
healCost = STORE.GetTimeCost( (maxHealth - health) / maxHealth * healtime[level] , false )
```

(`ChampionBase.as:1237-1241`), charged as `BASE.Purchase("IHE", …)` after a Yes/No confirmation
(`:1212-1235`). The Heal button is disabled at full health (`CHAMPIONCAGEPOPUP.as:434-442`).

### 7.6 Cage, chamber and deployment

**Freeze** (cage → chamber), `CHAMPIONCHAMBER.FreezeGuardian` (`:103-141`):

- Refused if the champion is below full health (`bdg_chamber_injured`, `:108-111`).
- Refused if the champion is hungry, i.e. `feedTime < now` (`bdg_chamber_hungry`, `:112-115`).
- On success the feed timer is converted to a **relative** offset (`ft -= now`, `:127`), status
  becomes `k_CHAMPION_STATUS_FROZEN` (1), the record is pushed onto `_frozen`, and
  `CREATURES._guardian` is cleared. A frozen champion does not starve, heal or defend.

**Thaw** (chamber → cage), `ThawGuardian(type)` (`:143-221`):

- Refused if the chamber is damaged (`bdg_chamber_damaged`, `:155-158`).
- Refused if a champion is already in the cage (`bdg_chamber_freeze`, `:159-162`).
- Restores `ft + now`, status back to `0`, and spawns the champion at the cage.

The chamber serialises `_frozen` as a JSON string under its building-data key `fz`
(`CHAMPIONCHAMBER.as:313-378`, parsed at `:232-303`).

**Deployment outside combat** is not a separate action. The champion in the cage is automatically:

- the yard's defender, spawned into `CREATURES._guardianList` on load (`CHAMPIONCAGE.as:589-602`);
- the attacker's champion, read from `GLOBAL._playerGuardianData` and flung with the attack
  (`client/scripts/ATTACK.as:532`);
- countable by the map for the "can I attack" check (`docs/specs/maproom2.md`, attack precondition 5).

A champion can also be **juiced** for goo from the Monster Juicer, behind a confirmation
(`CHAMPIONCAGE.as:299-307`), which sets status `2`.

`ChampionBase` statuses (`ChampionBase.as:26-36`): `0` normal, `1` frozen, `2` juiced, `3` destroyed,
`4` refund, `5` migrated.

### 7.7 Click flow (feed and evolve)

```
1. Click the Champion Cage sprite
2. Click "Open Cage"                              (BUILDINGINFO.as:231-233, :536-538)
   ... if no basic champion exists, CHAMPIONSELECTPOPUP opens instead:
   2a. Click "Raise <name>" on one of the three cards  (CHAMPIONSELECTPOPUP.as:50-52, :72-90)
3. Click the "Evolution" tab (called "Daily Feed" at level 6)
                                                  (CHAMPIONCAGEPOPUP.as:186-190)
4. Click "Feed Now"                               (CHAMPIONCAGEPOPUP.as:463-467, :175-178)
   or click the shiny button to buy the feed      (:458-462, :1240-1246)
   or click the shiny button to evolve outright   (:500-506, :1208-1238)
   ... each of these closes the whole popup on success (CHAMPIONCAGE.Hide)
5. Reopen the cage to check the result.
```

Healing is on the first tab: click **Champion**, then **Heal Champion**, then confirm
(`CHAMPIONCAGEPOPUP.as:184-185`, `:434-441`, `:1188-1196`; confirmation at `ChampionBase.as:1212-1220`).

---

## 8. Monster Baiter

Building id **19** (`#b_wildmonsterbaiter#`, `YARD_PROPS.as:1876-1968`, class `BUILDING19`, controller
`client/scripts/MONSTERBAITER.as`).

The Baiter lets the player **stage a fake attack on their own yard** with monsters of their choosing,
to test defences. It does not consume housed monsters; it spends **Musk**, the Baiter's own stored
resource.

| Level | Musk capacity | `produce` | Build/upgrade cost (twigs / pebbles / putty) | Time | Requires | HP |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 600 | 2 | 25,000 / 25,000 / 15,000 | 18,000 s | Town Hall 4 + Locker 1 | 1,000 |
| 2 | 900 | 2 | 1,000,000 / 1,000,000 / 500,000 | 36,000 s | Town Hall 4 + Locker 2 | 1,500 |
| 3 | 1,200 | 2 | 2,000,000 / 2,000,000 / 1,000,000 | 72,000 s | Town Hall 4 + Locker 3 | 2,250 |
| 4 | 1,500 | 2 | 4,000,000 / 4,000,000 / 2,000,000 | 144,000 s | Town Hall 5 + Locker 4 | 3,375 |
| 5 | 2,100 | 2 | 6,000,000 / 6,000,000 / 4,000,000 | 288,000 s | Town Hall 6 + Locker 4 | 5,000 |
| 6 | 3,200 | 2 | 10,000,000 / 10,000,000 / 6,000,000 | 576,000 s | Town Hall 7 + Locker 4 | 7,500 |
| 7 | 4,800 | 2 | 16,000,000 / 16,000,000 / 10,000,000 | 1,152,000 s | Town Hall 8 + Locker 4 | 12,000 |

Source: `YARD_PROPS.as:1888-1935`, `:1961-1964`. Quantity `[0,0,0,0,1,1,1,1,1,1,1]` (`:1960`) — one
from Town Hall 4.

### Rules

- **The cost of one monster is its `cStorage`**, the same number as its housing space
  (`client/scripts/MonsterBaiterItem.as:35`, `getCost()` at `:70-72`). The total must not exceed the
  current Musk.
- The roster offered is `C1`..`C14` — the popup builds items for `"C" + i`, `i` from 1 to 14
  (`MONSTERBAITERPOPUP.as:48-59`). A wider list is declared one line above but never used (`:45`).
- **Attack direction**: 4 arrows at Baiter levels 1–2, 8 arrows at level 3 and above
  (`MONSTERBAITERPOPUP.as:60-61`). The eight directions map to fixed spawn points at radius 400
  (`:113`).
- Sending runs a 4-tick countdown with a panic soundtrack, then spawns the chosen monsters as a
  `WMATTACK.TYPE_DAMAGE` custom attack with `_hitLimit = int.MAX_VALUE`
  (`MONSTERBAITER.as:37-91`).
- **Musk is never actually consumed.** `MONSTERBAITER.Tick()` sets `_musk = _muskLimit` on every tick
  while the Baiter exists (`MONSTERBAITER.as:43-44`), so the subtraction in `onSendDown`
  (`MONSTERBAITERPOPUP.as:185`) is overwritten on the next frame. The `produce` replenish rate is
  read into `_replenishRate` (`MONSTERBAITER.as:143`) and never used.
- Musk can also be topped up with the `MUSK` store item (`MONSTERBAITERPOPUP.as:85-87`;
  `server/src/game-data/store/storeItems.ts:399-406`), which is likewise redundant.
- State is persisted as `{ queue, attackDir, musk }` under the `monsterbaiter` save key
  (`MONSTERBAITER.as:154-160`, `client/scripts/BASE.as:3200`).

### Click flow

```
1. Click the Monster Baiter sprite
2. Click "Open Baiter"                      (BUILDINGINFO.as:210-212, :518-520)
3. Click a direction arrow                  (MONSTERBAITERPOPUP.as:68-71, :78-83)
4. Click "+" per monster, or press and hold (MonsterBaiterItem.as:38-40, :75-102)
5. Click "Send"                             (MONSTERBAITERPOPUP.as:41-42, :178-187)
```

---

## 9. Transfers between yards

Moving monsters between a main yard and an outpost is done **from the Map Room 2 map**, not from any
yard building. Map-side mechanics are covered in `docs/specs/maproom2.md`; this section covers the
monster rules.

### Client flow

Three steps (`client/scripts/com/monsters/maproom_advanced/MapRoom.as:661-936`):

1. **`TransferMonstersA`** — from `PopupInfoMine` on one of the player's own cells that has monsters,
   with at least one outpost owned (`PopupInfoMine.as:80-84`). Snapshots the source cell, opens
   `PopupMonstersA` with a `+` / `−` stepper per monster type, and after **Transfer** shows a
   "select target" bubble on the map (`MapRoom.as:661-692`, `PopupMonstersA.as:81-86`, `:216`).
2. **`TransferMonstersB`** — the next click on one of the player's own cells opens `PopupMonstersB`,
   a confirm dialog (`MapRoom.as:694-707`, `PopupMonstersB.as:29-34`).
3. **`TransferMonstersC`** — computes the real transfer and posts it (`MapRoom.as:709-936`).

### Clamping

`TransferMonstersC` starts from `spaceRemaining = targetCell.monsterData.space`, subtracts the target's
existing `count × cStorage`, then walks the requested monsters in object-key order
(`MapRoom.as:805-855`):

- If the whole stack fits, all of it moves.
- Otherwise `floor(spaceRemaining / cStorage)` of that type move, `_allMonstersTransferred` is set
  false, and the loop breaks once `spaceRemaining <= 0`.

So a partial transfer is normal and the player is told how many actually moved
(`newmap_tr_space`, `MapRoom.as:780-787`). The source must have monsters and the target must report
`space > 0`, otherwise the flow aborts with `newmap_tr_err1` / `err2` / `err3`.

### Request

`POST /worldmapv2/transferassets` with `frombaseid`, `tobaseid`, and `monsters` — a JSON string
containing a two-element array `[sourceMonsterData, targetMonsterData]`, each a **complete
replacement** `monsters` object (`MapRoom.as:861-888`). The client sends the whole hatchery/housing
blob for both yards, not a delta.

Ordering: the request is held back until no `getarea` covering either zone is in flight, retried on a
200 ms timer, and the affected zones are promoted to the front of the fetch queue
(`MapRoom.as:889-920`).

### Server validation

`server/src/controllers/maproom/v2/transferMonsters.ts`:

| Check | Line |
| --- | --- |
| Both `baseid`s resolve to a `Save` | `:44-52` |
| `fromBase.saveuserid === toBase.saveuserid` | `:55-59` |
| **`fromBase.saveuserid === currentUser.userid` and `toBase.saveuserid === currentUser.userid`** | `:64-69` |

The caller-ownership check at `:64-69` **is present in the current code**, with a comment explaining
that the shared-`saveuserid` test alone would let any authenticated player rewrite another player's
garrisons. The check was added on the revamp branch; `docs/specs/maproom2.md` (open question 8)
records the original gap as resolved.

What the server still does **not** check (`:71-72`): quantities, `cStorage` totals against the
target's housing capacity, whether the source ever had those monsters, or that the two blobs conserve
anything. It assigns `fromBase.monsters = fromMonsters` and `toBase.monsters = toMonsters` verbatim.
Monster duplication across two owned yards is a one-request operation.

### After an attack

A separate path moves monsters between the attacker's own yards when they fling from an outpost. The
post-battle `/base/save` carries `monsterupdate`, an array of `{ baseid, m }` cell updates; the entry
matching the attacker's own `baseid` overwrites `userSave.monsters`, the rest go to `updateMonsters`,
which is **scoped to `saveuserid`** so only the caller's own saves can be written
(`server/src/controllers/base/save/handlers/monsterUpdateHandler.ts:34-53`,
`server/src/services/base/updateMonsters.ts:15-35`). `updateMonsters` also sets `protected = 0` on
every yard it touches (`:31`).

---

## 10. Save data

Four columns on `save` carry the monster system. All four are `jsonb` and, apart from the two clamps
noted below, opaque to the server (`server/src/database/models/save.model.ts`). See
`docs/server-api.md:435-484` for the full model.

### `monsters` — housing and hatchery state

Written by `getHousingSaveData()` in Map Room 2 (`client/scripts/BASE.as:2656-2710`, called at
`:3174`) and by `Player.exportMonsters()` in Map Room 3 (`:3177`).

**Map Room 2 shape:**

```json
{
  "saved":          1710000000,
  "housed":         { "C1": 12, "C4": 3 },
  "space":          540,
  "hcount":         3,
  "hcc":            [["C1", 20], ["C4", 7]],
  "h":              [["C1", 9, [["C1", 20]]], ["", 0], ["C4", 300]],
  "hid":            [1041, 1042, 1055],
  "hstage":         [1, 0, 1],
  "overdrivepower": 4,
  "overdrivetime":  2870,
  "finishtime":     1710003600
}
```

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `saved` | unix seconds | When this snapshot was taken. Used to replay production forward and, in `BUILDING13.Setup`, to block ticking until real time catches up. | `BASE.as:2681`, `BUILDING13.as:470-475` |
| `housed` | `{creatureId: count}` | The housed army. Counts only — Map Room 2 has no per-creep health. | `BASE.as:2678`, `Player.as:362-368` |
| `space` | int | Total housing **capacity**, not free space. | `BASE.as:2683` (`HOUSING._housingCapacity`) |
| `hcount` | int | Number of hatchery buildings. | `BASE.as:2684` |
| `hcc` | array of `[creatureId, count]` | The Hatchery Control Center's shared queue; `[]` when no HCC exists. | `BASE.as:2685`, `:2700` |
| `h` | array, one per hatchery | `[inProduction, countdownProduce]`, with that hatchery's own `monsterQueue` appended as a third element when non-empty. | `BASE.as:2670-2675` |
| `hid` | int array | The building ids of the hatcheries, index-aligned with `h`. | `BASE.as:2672` |
| `hstage` | int array | `_productionStage` per hatchery: 0 idle, 1 producing, 2 waiting for housing, 3/4 starting. | `BASE.as:2671` |
| `overdrivepower` | 0, 4, 6 or 10 | Active hatchery overdrive multiplier. | `BASE.as:2689` |
| `overdrivetime` | seconds | Overdrive time remaining. | `BASE.as:2690` |
| `finishtime` | unix seconds | When the first worker's current build/upgrade/fortify task ends; the map uses it to draw the "worker busy" marker on outposts. | `BASE.as:2665-2667`, `maproom2.md:290` |

**Map Room 3 shape** is different: `{ creatureId: [{health, ownerID, q}, …], "Q": [creatureId, …] }`,
where `Q` is the heal queue (`Player.as:328-360`). `monsterUpdateHandler` branches on
`Array.isArray` to tell the two wire formats apart
(`server/src/controllers/base/save/handlers/monsterUpdateHandler.ts:36-39`).

The Map Room 2 `monsters` object is also what `getarea` republishes to the map as the cell's `m`
field, which is how the map can tick monster production locally (`maproom2.md:286-291`).

### `lockerdata` — unlock state

`{ [creatureId]: { t, s?, e? } }`, sent as a JSON string from `CREATURELOCKER._lockerData`
(`client/scripts/BASE.as:3193`).

| Field | Meaning |
| --- | --- |
| `t` | `1` = unlock in progress, `2` = unlocked |
| `s` | Unlock start, unix seconds; deleted on completion |
| `e` | Unlock end, unix seconds; deleted on completion |

Source: `CREATURELOCKER.as:994-998`, `:909-913`. A monster absent from the object is locked. `C1`
(or `IC1`) is force-inserted as `{t: 2}` on every load (`:65`). The legacy key `C100` is migrated to
`C12` (`:66-69`).

### `academy` — monster levels and lab ranks

`{ [creatureId]: { level, time?, duration?, powerup? } }`, exported from `GLOBAL.player.m_upgrades`
(`client/scripts/com/monsters/player/Player.as:193-211`, sent at `BASE.as:3191`).

| Field | Meaning | Written by |
| --- | --- | --- |
| `level` | Academy level, 1..6. **Clamped to 6 by the server.** | `ACADEMY.as:159`; clamp at `academyHandler.ts:24-26` |
| `time` | Absolute unix end time of the current training, absent when idle | `ACADEMY.as:71` |
| `duration` | Total seconds of the current training | `ACADEMY.as:72` |
| `powerup` | Monster Lab ability rank, 1..3, absent at rank 0 | `MONSTERLAB.as:336` |

On import the client applies a quirk: a `time` value of `60 * 60 * 162` (583,200) **or less** is
treated as a *relative* remainder and has `now` added to it; anything larger is treated as absolute
(`Player.as:170-177`). Any key not starting with `C` or `IC` is dropped (`:168`).

Despite the name, this single column carries both Academy levels and Lab ranks.

### `champion` — champion roster

A typed array, unlike the other three. Validated by
`server/src/schemas/ChampionSchema.ts:6-16`:

| Field | Type | Meaning |
| --- | --- | --- |
| `t` | int 1..5 | Champion type (`G1`..`G5`) |
| `hp` | number ≥ 0 | Current health |
| `l` | number | Evolution level 1..6 |
| `ft` | number | Feed time; absolute while active, **relative** while frozen |
| `fd` | number | Feeds accumulated at the current level |
| `fb` | number | Food bonus rank 0..3 |
| `pl` | number | Power level |
| `status` | number | 0 active, 1 frozen, 2 juiced, 3 destroyed, 4 refund, 5 migrated |
| `nm` | string, optional | Player-given name |

Built client-side by `getChampionSaveData()` (`client/scripts/BASE.as:2772-2858`) from
`BASE._guardianData`, which `ChampionBase.export()` keeps current (`ChampionBase.as:1149-1210`).
Entries that fail validation are dropped rather than rejecting the save, and an empty result is
reported as `undefined` so stored champions are left alone (`ChampionSchema.ts:47-60`). During an
attack only a **lower** `hp` is accepted (`championHandler.ts:17-27`).

The Champion Chamber stores its frozen list separately, as a JSON string under the chamber's own
building-data key `fz` (`CHAMPIONCHAMBER.as:376`), so a frozen champion appears both in `champion`
with `status: 1` and inside `buildingdata`.

### `monsterbaiter`

`{ queue: {creatureId: count}, attackDir: int, musk: int }`
(`MONSTERBAITER.as:154-160`, sent at `BASE.as:3200`).

### `monsterupdate`

Attack-only. Map Room 2 sends `[{ baseid, m }, …]` where `m` is a `monsters` object; Map Room 3 sends
a bare `monsters` object. See [§9](#9-transfers-between-yards).

### Which yard owns what

`buildSaveData` serves `lockerdata` and `academy` **from the player's main save** whenever they view a
base they own, so an outpost reports the same unlock and training progress as the main yard rather
than a stale copy (`server/src/services/base/mapSaveData.ts:18-31`, `:66-70`). `monsters` and
`champion` are **per yard** and are not remapped.

---

## 11. Open questions / UNVERIFIED

1. **Anti-cheat coverage.** `validateSave` dynamically imports `./priv/anticheat.private.js` in
   production and silently falls back to a stub otherwise
   (`server/src/scripts/anticheat/anticheat.ts:11-27`). The private module is not in the repository.
   UNVERIFIED which monster, hatchery or champion values the production build actually validates, and
   therefore whether any of the client-authoritative numbers in this document are checked anywhere.
2. **Blocked monsters.** `C16` Vorg, `C17` Slimeattikus, `C18` Slimeattikus Mini and `C19` Rezghul
   carry `blocked: true` (`CREATURELOCKER.as:493`, `:529`, `:552`, `:582`) and are filtered out of the
   locker, hatchery, HCC and housing lists, yet they keep full unlock prices, training tables and
   stats, and `C17` is in `BUNKERABLE_MONSTERS` and `BUYABLE_MONSTERS`. UNVERIFIED whether they are
   deliberately retired, event-only, or awaiting re-enablement.
3. **How `C18` enters play.** It is `fake: true` with `dependent: "C17"`, so `CREATURES.GetProperty`
   reads `C17`'s academy level for it (`CREATURES.as:53-55`). Presumably it is spawned by
   Slimeattikus' `splits`. UNVERIFIED — that is combat-side.
4. **Korath acquisition.** `G4` has `powerLevel: 0`, so `CanTrainGuardian` excludes it from the
   selection popup (`CHAMPIONCAGE.as:459-461`). The only paths that spawn it are the `UPDATES`
   champion-refund message (`client/scripts/UPDATES.as:332`) and the debug console
   (`com/monsters/debug/ConsoleCommands.as:230`). A front-page promo exists
   (`Promo06RecapturedKorath.as`) but only opens the cage. UNVERIFIED how a player obtains Korath on
   this server.
5. **`evolveShiny`.** Present on all five champions and mirrored on the server
   (`championStats.ts:50`), but no code reads it — the instant-evolve price is recomputed as
   `feedShiny × 2 × feedsRemaining` (`CHAMPIONCAGEPOPUP.as:1223-1230`). UNVERIFIED whether the arrays
   are the intended prices and the recomputation is a regression.
6. **Monster Baiter Musk.** `MONSTERBAITER.Tick()` sets `_musk = _muskLimit` unconditionally
   (`:43-44`), so Musk is effectively infinite, `_replenishRate` is dead, and the `MUSK` store item
   has nothing to do. UNVERIFIED whether this is a deliberate simplification or a bug.
7. **Lab entry for `C2`.** `MONSTERLABPOPUP.Update` has a `case "C2"` branch reading
   `_powerupProps["C2"].effect` (`:218-220`), but `_powerupProps` has no `C2` key
   (`MONSTERLAB.as:77-188`). Dead branch, or a removed Octo-Ooze ability. UNVERIFIED.
8. **Hatchery grid bound.** `HATCHERYPOPUP` iterates `maxCreatures("above")` entries over the array
   returned by `GetSortedCreatures(true)` (`:66-69`), but that array can also contain Inferno monsters
   when the Descent is passed and a subscription is active (`CREATURELOCKER.as:1243-1253`). The loop
   would then silently truncate the list. UNVERIFIED whether this combination is reachable in
   practice.
9. **Duplicate sort index.** `C9` Brain and `C17` Slimeattikus both have `index: 10`
   (`CREATURELOCKER.as:301`, `:518`), so `sortOn(["index"])` gives them an unstable relative order in
   the hatchery and housing grids. UNVERIFIED whether any UI depends on the order.
10. **`C15` Zafreeti level cap.** It has only four `trainingCosts` entries (`CREATURELOCKER.as:466`),
    capping it at level 5, while its `speed` and `damage` arrays have five entries and `health` one.
    UNVERIFIED whether the missing fifth training step is intentional.
11. **Server stat tables.** `server/src/game-data/stats/monsterStats.ts` and `championStats.ts`
    duplicate the client numbers but are not read by any endpoint in this document's scope.
    UNVERIFIED whether anything outside combat is meant to consume them.
12. **`hTime` / `hResource` in Map Room 2.** They are populated for every monster but only the Map
    Room 3 heal path reads them, and Map Room 2 housed monsters are stored at
    `health = int.MAX_VALUE` (`Player.as:290`). UNVERIFIED whether monster healing was ever meant to
    apply in Map Room 2.
13. **`C19` Rezghul heal stats.** The `hTime: [1125]` / `hResource: [250000]` entries carry an inline
    comment saying the original values are unknown (`CREATURELOCKER.as:597-601`). Explicitly
    UNVERIFIED in the source itself.
14. **Map Room 2 bunker capacity override.** `GLOBAL.as:683` sets `[380,450,540,660,800]`, exactly
    double the Map Room 3 table, but no corresponding `costs` override exists, so the Map Room 2
    bunker has five levels at Map Room 3 prices. UNVERIFIED whether the doubling is intended balance
    or a leftover.

---

## 12. Redesign notes

### 12.1 Rules that must be preserved

These are load-bearing. Changing them changes the game.

1. **Housing space is the army cap, and `cStorage` is the unit.** Every other system — hatchery
   finish-now, bunkers, transfers, the Monster Baiter — prices itself in `cStorage`. Map Room 2 tops
   out at 4 × 540 = 2,160 space.
2. **One unlock at a time per realm**, paid up front in Putty, cancellable for a full refund, running
   on wall-clock time so it continues offline.
3. **Locker level gates which monsters exist at all** (`creature.level` ≤ locker level), and that is
   the only prerequisite tier. There is no tech tree.
4. **Academy level N unlocks monster level N+1**, capping at 6 on the surface and 5 in the Inferno.
   Training is one monster per academy, cancellable for a full refund.
5. **Lab rank N needs lab level N and monster level N+1**, capping at rank 3. One research at a time,
   globally.
6. **The hatchery queue is per building**, `(1 + level)` stacks of 20, plus one in production. The
   Hatchery Control Center replaces all of them with one shared queue of 7 × 20.
7. **A finished monster waits in the hatchery when housing is full.** Nothing is destroyed, nothing
   is refunded, production stalls. This is what makes housing upgrades matter.
8. **A hatchery below 50% health stops producing.**
9. **Cancelling a queued or in-production monster refunds 100% of the goo. A destroyed hatchery
   refunds 75%.**
10. **Housing overflow thins every monster stack evenly with no refund** (`HOUSING.Cull`). It is the
    penalty for losing housing buildings.
11. **Bunker monsters are consumed.** Once placed they cannot return to housing in Map Room 2, only be
    juiced or deleted, and they are released once each per battle.
12. **Only `C12`, `C5` (both requiring their lab ability), `IC5` and `IC7` can be sent at flyers from a
    bunker.** This is the main reason to buy a lab ability.
13. **Champions starve.** A 23-hour feed window plus a 24-hour grace, then a lost feed (or a lost food
    bonus rank at level 6). Feeding costs housed monsters by a fixed recipe.
14. **Champion healing is slow and scales with level** — up to 32 hours at level 6 — and the chamber
    refuses to freeze an injured or hungry champion.
15. **One basic champion in the cage at a time**; the chamber is the only way to swap.
16. **Transfers are clamped by the target's free housing space**, and partial transfers are normal.

### 12.2 Flash-era constraints that can be dropped

1. **One click equals one monster in the Hatchery.** There is no reason for this beyond the original
   UI. See the click-by-click list in [§12.4](#124-current-hatchery-flow-click-by-click).
2. **One `BASE.Save()` per queued monster** (`HATCHERYPOPUP.as:294-298`). Eighty clicks means eighty
   full save round trips, each carrying the entire yard.
3. **The Academy's one-monster-per-page carousel** (`ACADEMYPOPUP.as:449-500`). It has no list view,
   no search and no way to see which monsters are trainable now. Reaching `C14` is 13 clicks of Next.
4. **The Monster Locker's four-monsters-per-page pagination** (`CREATURELOCKERPOPUP.as:13`,
   `:72-84`).
5. **Popups that close themselves on success.** Feeding a champion, evolving it, and buying a bunker
   fill all call `CHAMPIONCAGE.Hide()` / `MONSTERBUNKER.Hide()` and dump the player back to the yard
   (`CHAMPIONCAGEPOPUP.as:177`, `:1236`, `:1244`). Every repeat action needs the whole open sequence
   again.
6. **Two clicks to open anything.** Select the building, then pick an action from the info bar
   (`BFOUNDATION.as:2833-2838` → `BUILDINGINFO.as:145-240`). A monster-management screen reachable
   from the HUD would remove this for every building in this document.
7. **`SecNum` obfuscation and the `Check()` shadow-copy comparison** on monster counts, resources and
   champion fields. Anti-tamper theatre in a client the user controls; the server must validate
   instead.
8. **Frame-counted press-and-hold** in the HCC and the Monster Baiter (`HATCHERYCCPOPUP.as:316-321`,
   `MonsterBaiterItem.as:75-127`). A quantity field or a slider is both faster and accessible.
9. **`C100` → `C12` legacy id rewriting**, repeated in seven places
   (`CREATURELOCKER.as:66-69`, `CREATURES.as:42-44`, `BUILDING13.as:225`, `:255`, `:481`,
   `HOUSING.as:100-102`, `MONSTERBUNKER.as:35-38`, `Player.as:187-190`). Migrate the data once.
10. **The duplicated monster tables.** The client defines the roster in `CREATURELOCKER.as`, the
    server in `monsterStats.ts`, and Map Room 3 scaling is applied by mutating the client table in
    place at runtime (`CREATURELOCKER.as:836-883`). One table, served once, would remove a whole
    class of drift.
11. **Musk.** The resource is reset to full every tick and the store item that refills it does
    nothing. Either implement it or remove it and its seven Baiter levels of capacity.
12. **Facebook "brag" buttons** on every unlock, upgrade, evolve and thaw popup
    (`CREATURELOCKER.as:920-947`, `ACADEMY.as:175-202`, `MONSTERLAB.as:339-362`,
    `CHAMPIONCHAMBER.as:197-214`). They call `GLOBAL.CallJS("sendFeed", …)` into a host that no
    longer exists.

### 12.3 Things the data already supports

- **A single "Monsters" screen.** Roster, unlock progress, training, ability ranks, hatch queues,
  housing usage and bunker contents are all readable from one save load. Nothing forces them to be
  five buildings.
- **Batch queueing.** The hatchery queue is `[[id, count], …]`; a quantity picker writes it directly.
  The "add N" case is already the stored representation.
- **A housing budget preview.** `space`, `housed` and `cStorage` are enough to show "this queue needs
  340 of your 540 space" before the player commits.
- **Server-side validation.** Every number needed to check a hatch, a training, an unlock or a
  transfer already exists server-side in `monsterStats.ts` and `championStats.ts`; only the unlock
  fields (`resource`, `time`, `level`) are missing, and they are three columns.

### 12.4 Current hatchery flow, click by click

The flow to replace, for one hatchery with no Hatchery Control Center.

| # | Click | Result | Source |
| --- | --- | --- | --- |
| 1 | Hatchery sprite in the yard | Building selected, info bar opens | `BFOUNDATION.as:2833-2838` |
| 2 | **View Hatchery** in the info bar | `HATCHERYPOPUP` opens | `BUILDINGINFO.as:196`, `:488-490`; `HATCHERY.as:16-25` |
| 3 | *(optional)* Drag the scrollbar | Reveals monster icons below the fold | `HATCHERYPOPUP.as:50-60` |
| 4 | *(optional)* Hover a monster icon | Shows its stat panel | `HATCHERYPOPUP.as:78`, `:114-224` |
| 5 | Monster icon | **Adds exactly one**, charges goo, saves | `HATCHERYPOPUP.as:85`, `:234-298` |
| 6 | Repeat 5, once per monster | — | — |
| 7 | *(optional)* Queue slot | **Removes exactly one**, refunds goo, saves | `HATCHERYPOPUP.as:395`, `:300-326` |
| 8 | Close button | Popup closes | `HATCHERY.as:27-36` |

**Totals**

| Goal | Clicks |
| --- | --- |
| Queue 1 monster | 4 |
| Queue N monsters of one type | 3 + N |
| Fill a level-1 hatchery (40) | 43 |
| Fill a level-2 hatchery (60) | 63 |
| **Fill a level-3 hatchery (80)** | **83** |
| Fill five level-3 hatcheries (400) | 415, across 5 open/close cycles |

Each of the N adds also triggers a separate `/base/save`.

With a Hatchery Control Center the same job is 2 clicks to open plus one press-and-hold per monster
type, because `QueueAddTick` repeats on `ENTER_FRAME` (`HATCHERYCCPOPUP.as:302-350`). The HCC is
therefore the existing proof that the interaction model was already recognised as the problem — it
just arrives at Town Hall 3 behind three level-2 hatcheries and a 4,000,000 × 3 resource cost.

**What the redesign needs from the rules:** a quantity input clamped to
`(1 + level) × 20 − currentQueueCount` per stack and `1 + level` stacks, priced at
`cResource(monsterLevel) × quantity` in goo, with a single save at the end. Everything else in
[§5](#5-hatchery) stays as it is.
