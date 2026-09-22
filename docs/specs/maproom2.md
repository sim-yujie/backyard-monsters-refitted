# Map Room 2 — Rules and Data Specification

Reverse-engineered from the Refitted client (ActionScript 3) and server (TypeScript). This document
describes the **rules and data** of Map Room 2, not its Flash rendering. It is written for a rebuild
of the map as a web client.

All citations are `path:line` relative to the repository root.

Contents:

1. [What Map Room 2 is](#1-what-map-room-2-is)
2. [Map structure](#2-map-structure)
3. [Cell / yard data model](#3-cell--yard-data-model)
4. [Actions and their rules](#4-actions-and-their-rules)
5. [State refresh behaviour](#5-state-refresh-behaviour)
6. [Viewport and navigation](#6-viewport-and-navigation)
7. [Timers and protection](#7-timers-and-protection)
8. [Server-side rules](#8-server-side-rules)
9. [Open questions / UNVERIFIED](#9-open-questions--unverified)
10. [Redesign notes](#10-redesign-notes)

---

## 1. What Map Room 2 is

Map Room 2 is the shared persistent world map. Every player who has upgraded is placed into a
**world** (a 800 x 800 hexagonal cell grid, up to 2500 players per world) at a randomly chosen land
cell. From the map the player sees their own main yard, their own outposts, other players' main
yards and outposts, wild monster (NPC tribe) camps, and empty terrain. From a cell they can open
their own yards, view or attack foreign yards and wild monster camps, take over a destroyed cell as
a new outpost, move their main yard onto one of their outposts, transfer monsters between their own
yards, bookmark a location and jump to coordinates.

**Confirmed implementation: `client/scripts/com/monsters/maproom_advanced/`.** `MapRoomManager`
instantiates `com.monsters.maproom_advanced.MapRoom` for anything that is not Map Room 3
(`client/scripts/com/monsters/maproom_manager/MapRoomManager.as:107`), and the version flag is set
to 2 whenever the loaded save reports `usemap` and the current map room is not a `MapRoom3`
(`client/scripts/BASE.as:837-843`).

`client/scripts/com/monsters/maproom/` is **Map Room 1**, not shared code. It is imported only by
`client/scripts/MAPROOM.as:5` and instantiated at `client/scripts/MAPROOM.as:107`, on the branch
taken when `save.usemap` is unset. Map Room 2 imports nothing from it. `MAP.as` / `MAPBG.as` are the
in-yard base grid, unrelated to the world map.

Server entry points live under `server/src/controllers/maproom/v2/`, routed at
`server/src/app.routes.ts:136-142`.

---

## 2. Map structure

### World and grid

| Property | Value | Source |
| --- | --- | --- |
| World width | 800 cells | `server/src/enums/MapRoom.ts:7` |
| World height | 800 cells | `server/src/enums/MapRoom.ts:8` |
| Max players per world | 2500 | `server/src/enums/MapRoom.ts:9` |
| Grid type | Hexagonal, odd-q offset (flat-top columns) | `client/scripts/com/monsters/maproom_advanced/MapRoomPopup.as:986-1000` |
| Coordinate range | `x` 0..799, `y` 0..799 | `server/src/controllers/maproom/v2/getArea.ts:22-23` |
| Worlds | Multiple; each is a `World` row with a uuid seed | `server/src/database/models/world.model.ts:13-14` |

The world size reaches the client in the `/base/load` response as `worldsize`
(`server/src/controllers/base/load/baseLoad.ts:315`, value `WORLD_SIZE = [HEIGHT, WIDTH]` from
`server/src/config/MapRoom2Config.ts:7`) and is assigned to `mapWidth` / `mapHeight`
(`client/scripts/BASE.as:834-835`). The client's compiled-in defaults are 100 x 100
(`client/scripts/com/monsters/maproom_advanced/MapRoom.as:32-34`) and are always overwritten.

The map **wraps toroidally on the client**: a cell scrolled past the right edge reappears at `x - 800`
(`client/scripts/com/monsters/maproom_advanced/MapRoomPopup.as:808-861`) and lookups wrap both axes
(`MapRoomPopup.as:1061-1073`). The server also wraps for range checks
(`server/src/services/maproom/v2/validateRange.ts:117-118`, `:166-167`).

Hex neighbour maths is done in axial coordinates. Offset to axial:
`q = x`, `r = y - (x - (x & 1)) / 2`; distance is
`max(|dq|, |dr|, |-dq-dr|)` (`MapRoomPopup.as:1034-1046`).

### Terrain

Terrain height is a pure function of `(worldUuid, x, y)` — simplex noise seeded by the world uuid,
smoothed against two neighbours, with a linear blend near the world edges.

| Constant | Value | Source |
| --- | --- | --- |
| `NOISE_SCALE` | 12 | `server/src/config/MapRoom2Config.ts:14` |
| `TERRAIN_SCALE` | 95 | `server/src/config/MapRoom2Config.ts:21` |
| `EDGE_TRANSITION_WIDTH` | 3 cells | `server/src/config/MapRoom2Config.ts:27` |

Height formula: `round((smoothedNoise + 1) * 95) + 18`, then `100 -> 105`, otherwise `+10`
(`server/src/services/maproom/v2/generateMap.ts:105-111`). Height 100 (`Terrain.RESERVED`) therefore
never occurs.

Terrain bands (`server/src/enums/MapRoom.ts:50-63`, mirrored client-side at
`client/scripts/com/monsters/maproom_advanced/MapRoomCell.as:476-523`):

| Height | Band | Client terrain string |
| --- | --- | --- |
| `< 80` | water1 | (water) |
| `80..89` | water2 | (water) |
| `90..99` | water3 | (water) |
| `100..104` | sand1 | `sand` |
| `105..109` | sand2 | `sand` |
| `110..119` | land1 | `grass` |
| `120..139` | land2 | `grass` |
| `140..159` | land3 | `grass` |
| `160..169` | land4 | `grass` |
| `170..174` | land5 | `rock` |
| `>= 175` | land6 | `rock` |

**A cell is water when height <= 99.** The server short-circuits water cells to `{ i: height }` with
no other fields (`server/src/services/maproom/v2/createCellData.ts:25`); the client derives
`_water = _height < 100` (`MapRoomCell.as:323`). Water cells cannot be occupied
(`server/src/services/maproom/v2/findFreeCell.ts:42-45`) and are skipped by range highlighting
(`MapRoomPopup.as:1004`).

Terrain height also drives two yard bonuses, computed client-side against a fixed average altitude of
125 (`client/scripts/GLOBAL.as:398`):

- Tower range bonus `= height * 100 / 125 - 100` percent
- Resource production bonus `= 100 * 125 / height - 100` percent

(`client/scripts/com/monsters/maproom_advanced/PopupInfoEnemy.as:276-300`,
`PopupInfoMine.as:114-138`). Both are forced to 0 when the cell is the player's own main yard
(`_base == 2`).

### What a cell can contain

`base_type` on the cell row (`server/src/enums/MapRoom.ts:27-31`):

| Value | Name | Meaning |
| --- | --- | --- |
| 0 | (absent) | Empty land or water; not stored in the database |
| 1 | `WM` | Wild monster / NPC tribe camp |
| 2 | `HOMECELL` | A player's main yard |
| 3 | `OUTPOST` | A player's outpost |

There are no resource outposts, roads, or special structures in Map Room 2. Cell (0,0) is reserved:
`findFreeCell` never places a player there (`server/src/services/maproom/v2/findFreeCell.ts:35`), and
whoever takes it over renames the world to `<username> Server`
(`server/src/controllers/maproom/v2/takeoverCell.ts:120-121`).

Only **occupied** cells exist as `world_map_cell` rows. Every other cell is generated in memory per
request (`server/src/controllers/maproom/v2/getArea.ts:156-173`). A wild monster cell becomes a row
the first time it is attacked (`server/src/controllers/base/load/modes/baseModeAttack.ts:99-132`).

### The "area" request and viewport

The client divides the world into **zones of 10 x 10 cells** aligned to multiples of 10
(`client/scripts/com/monsters/maproom_advanced/MapRoom.as:28-30`, `:1050-1058`). The zone id is
`zoneX * 10000 + zoneY` (`MapRoom.as:1052`).

A zone is fetched with `POST /worldmapv2/getarea`
(`MapRoom.as:506`, `GLOBAL._mapURL` = `<server>/worldmapv2/`, `client/scripts/GAME.as:59`).

Request parameters (`MapRoom.as:618-622`):

| Param | Type | Meaning |
| --- | --- | --- |
| `x` | int | Zone origin x (multiple of 10) |
| `y` | int | Zone origin y (multiple of 10) |
| `width` | int | Always 10. **Ignored by the server.** |
| `height` | int | Always 10. **Ignored by the server.** |
| `sendresources` | 0 or 1 | 1 asks the server to include the player's own resources |
| `worldid` | int | Only in view-only (migration invite preview) mode |

The server hardcodes `width = height = 10` and iterates `cellX <= x + 10` inclusive
(`server/src/controllers/maproom/v2/getArea.ts:106-107`, `:157-161`), so a response actually contains
**11 x 11 = 121 cells**, and adjacent zones overlap by one row and one column.

The client requests a zone lazily: any cell whose data it needs calls `GetCell(x, y)`, which resolves
the zone and calls `RequestData` (`MapRoom.as:643-650`). Requests are serialised through a FIFO queue
`_pendingMapCellDataRequests`, one in flight at a time (`MapRoom.as:600-639`). Zones containing a
cell in an active monster transfer are deferred by a 200 ms retry timer (`MapRoom.as:601-616`), and
zones needed for a pending transfer can be promoted to the front of the queue
(`_priorityMapCellsToRequest`, `MapRoom.as:583-598`).

The visible viewport is a fixed grid of cell sprites, not a variable window:

| Mode | Columns | Rows | Cells |
| --- | --- | --- | --- |
| Windowed | 16 | 14 | 224 |
| Fullscreen | 18 | 15 | 270 |

(`MapRoomPopup.as:647-654`.) Cell art is 150 x 75 px with a 0.75 horizontal step (112.5 px) and a
half-height stagger on even columns (`MapRoomPopup.as:44-45`, `:659-668`). Panning does not create
sprites; it recycles them by wrapping their logical coordinates
(`MapRoomPopup.as:808-873`). A viewport of 224 cells spans roughly 4 to 6 zones, so opening the map
issues several `getarea` requests back to back.

---

## 3. Cell / yard data model

The `getarea` response body (`server/src/controllers/maproom/v2/getArea.ts:180-191`):

```
{
  error: 0,
  x: <zone origin x>,
  y: <zone origin y>,
  data: { "<x>": { "<y>": <cell>, ... }, ... },
  alliancedata: [ ... ],
  resources?: { r1, r1max, r2, ... },   // only when sendresources=1
  credits?: <number>                    // only when sendresources=1
}
```

The client stores `serverData.data` verbatim as `_zones[zoneId].data` and indexes it
`data[cellX][cellY]` (`MapRoom.as:539`, `:646-648`).

### Water cell

| Field | Type | Meaning |
| --- | --- | --- |
| `i` | int | Terrain height (<= 99) |

Source: `server/src/services/maproom/v2/createCellData.ts:25`. All other fields are absent, so the
client reads `_base = undefined -> 0`, `_water = true`.

### Empty land cell

Same shape as a wild monster cell (every non-water unoccupied cell is served as a wild monster camp).
There is no distinct "empty land" cell type in Map Room 2.

### Wild monster cell (`b == 1`)

Built by `server/src/controllers/maproom/v2/cells/wildMonsterCell.ts:22-31`.

| Wire field | Type | Meaning | Client field |
| --- | --- | --- | --- |
| `uid` | int | Always `0` | `_userID` |
| `b` | int | Always `1` (`MapRoomCell.WM`) | `_base` |
| `i` | int | Terrain height | `_height` |
| `bid` | string | Deterministic base id, see below | `_baseID` (read as `Number`) |
| `n` | string | Tribe name: `Legionnaire`, `Kozu`, `Abunakki`, `Dreadnaut` | `_name` |
| `l` | int | Camp level, 25..44 | `_level` |
| `dm` | int | Damage percent 0..100, `0` when never attacked | `_damage` |
| `d` | int | Destroyed flag, `0` when never attacked | `_destroyed` |

`bid` format for Map Room 2 is `[worldHash: 8 digits][x: 3 digits][y: 3 digits]` = 14 digits
(`server/src/utils/generateBaseId.ts:38-45`). The last six digits are always the coordinates, which is
how the server recovers `x` and `y` from a base id
(`server/src/services/maproom/v2/tribeSaveV2.ts:21-22`).

### Player cell (`b == 2` main yard, `b == 3` outpost)

Built by `server/src/controllers/maproom/v2/cells/userCell.ts:70-92`.

| Wire field | Type | Meaning | Client field |
| --- | --- | --- | --- |
| `uid` | int | Owner user id | `_userID` |
| `b` | int | `2` main yard, `3` outpost | `_base` |
| `pi` | int | Pending migration-invite thread id. **Always `0` from this endpoint.** | `_invitePendingID` |
| `bid` | string | Base id of the yard | `_baseID` |
| `aid` | int \| null | Owner's alliance id | `_allianceID` |
| `i` | int | Terrain height | `_height` |
| `v` | number | Empire value of that yard | `_value` |
| `mine` | 0 or 1 | 1 when the cell belongs to the requesting player | `_mine` |
| `f` | int | Flinger level 0..4 | `_flingerLevel`, `_flingerRange` |
| `c` | int | Catapult level 0..3 | `_catapult` |
| `t` | int \| undefined | Truce expiry unix seconds with the requesting player | `_truce` |
| `n` | string | Owner username | `_name` |
| `fr` | int | Friend flag. **Always `0`.** | `_friend` |
| `p` | 0 or 1 | 1 while damage protection is active | `_protected` |
| `r` | object | Resources `{ r1..r4, r1max..r4max }` | `_resources`, `_hpResources` |
| `m` | object | Monster/hatchery data (see below) | `_monsterData`, `_monsters` |
| `l` | int | Owner's base level | `_level` |
| `d` | 0 or 1 | 1 when effective damage >= 90 (takeover-eligible) | `_destroyed` |
| `lo` | int | Lock owner user id; non-zero means the yard is busy | `_locked` |
| `dm` | int | Effective damage percent 0..100 | `_damage` |
| `pic_square` | string \| null | Avatar URL | `_pic_square` |

Client reader: `client/scripts/com/monsters/maproom_advanced/MapRoomCell.as:288-473`.

Derived server-side rules inside `userCell`:

- `locked` is the stored `save.locked`, forced to `1` when the owner was seen within the last 60
  seconds or the yard is under an active attack, and forced to `0` for the player's own cells
  (`userCell.ts:52-57`). Online presence is read from Redis keys `last-seen:main:<uid>`
  (`server/src/services/maproom/getLastSeen.ts:17`).
- `damage` is reported as `0` once `protected` has elapsed, i.e. expired protection also clears the
  displayed damage (`userCell.ts:63-66`).
- `d` is `damage >= 90 ? 1 : 0` (`userCell.ts:88`), so it is a derived flag, not stored state.
- `t` is omitted for the player's own cells (`userCell.ts:68`).

The `m` (monster) object carries hatchery state so the map can tick monster production locally:
`{ hcc, h, hstage, hid, overdrivepower, overdrivetime, saved, housed, space, hcount, finishtime }`
(`MapRoomCell.as:397-432`, `:910-979`). `housed` is a map of creature id to count. The client
simulates production forward from `saved` to now on every `Setup`
(`MapRoomCell.as:461-471`, `:653-873`) and uses `finishtime` to show the outpost "worker busy"
marker (`MapRoomCell.as:623-636`).

### Fields the client reads that the server never sends

`serverData.on` (`_online`), `serverData.fbid` (`_facebookID`), `serverData.im` (alternate avatar).
These are Facebook-era leftovers (`MapRoomCell.as:340`, `:344`, `:456-458`). Online state now reaches
the client only indirectly, folded into `lo`.

### Persisted cell row

`server/src/database/models/worldmapcell.model.ts`:

| Column | Type | Meaning |
| --- | --- | --- |
| `cellid` | int PK | Row id |
| `baseid` | string, indexed | Base id of the yard on this cell |
| `map_version` | int, default 2 | 2 for Map Room 2, 3 for Map Room 3 |
| `uid` | int, indexed | Owner user id; `0`/unset for wild monster cells |
| `x`, `y` | int | Coordinates |
| `base_type` | int | 1 / 2 / 3 |
| `terrainHeight` | int | Cached noise height |
| `destroyed_at` | timestamp, nullable | **Map Room 3 only**; never written for V2 |
| `world` | FK | Owning world |
| `save` | 1:1 | The `save` row for the yard on this cell |

Composite index on `(world, map_version, x, y)` (`worldmapcell.model.ts:13-16`).

---

## 4. Actions and their rules

All map actions are initiated from one of three popups opened by clicking a cell
(`MapRoomCell.as:1003-1013`):

- own cell (`mine`) -> `PopupInfoMine`
- foreign cell or wild monster camp -> `PopupInfoEnemy`
- any occupied cell while in view-only invite mode -> `PopupInfoViewOnly`

Clicking a cell with `_base == 0` does nothing. Clicks are suppressed while the map is being dragged
(`MapRoomCell.as:983-985`).

### Open own yard

| | |
| --- | --- |
| Who | Owner of the cell (`_mine`) |
| Precondition | `_locked == 0` or `_locked == own player id`; otherwise "yard is being attacked" message |
| Request | `POST /base/load` with `type=build`, `baseid`, `mapversion=2` |
| Client effect | Hides the map, clears the zone cache, loads the yard |

`client/scripts/com/monsters/maproom_advanced/PopupInfoMine.as:220-234`;
`client/scripts/BASE.as:613-620`.

### View / scout a foreign yard or wild monster camp

| | |
| --- | --- |
| Who | Anyone |
| Precondition | None checked client-side |
| Request | `POST /base/load` with `type=wmview` for wild monster camps, `type=view` for player yards, or `type=help` when `_friend` is set (dead path, `fr` is always 0) |
| Server | `baseModeView` (see [Root cause](#root-cause-of-the-stale-npc-yard-bug)) |
| Client effect | Leaves the map and loads the yard read-only |

`PopupInfoEnemy.as:619-639`.

This is the "check the yard" action players use to force a stale wild monster camp to refresh.

### Attack

| | |
| --- | --- |
| Who | Anyone with monsters in flinger range of the target |
| Request | `POST /base/load` with `type=attack` (player yard) or `type=wmattack` (wild monster camp), plus `attackData` |

Client-side preconditions, checked in order:

1. `GLOBAL._flags.attacking != 0`, else "attacking disabled" (`PopupInfoEnemy.as:493-495`).
2. Not `_protected`, else "damage protection" message (`PopupInfoEnemy.as:531-533`,
   `MapRoomPopup.as:1196-1206`).
3. No active truce: `_truce <= now` (`PopupInfoEnemy.as:534-536`).
4. `MapRoom._flingerInRange` — at least one cell the player owns within the computed hex range has a
   flinger whose range covers the distance to the target (`PopupAttackA.as:215-239`).
5. At least one monster or a healthy champion available across those in-range cells
   (`PopupAttackA.as:220-232`, `:251-257`).
6. Confirmation prompts, not blocks, for: target in the player's own alliance, target in a friendly
   alliance, or target flagged as a friend (`PopupInfoEnemy.as:537-545`).
7. A second confirmation when any of the *attacker's own* source cells are themselves under damage
   protection (`_protectedInRange`, `PopupAttackA.as:112-116`) — attacking clears the attacker's own
   protection.

On confirm the client stores `GLOBAL._attackerMapResources` and `GLOBAL._attackerCellsInRange`,
**hides the map and calls `MapRoom.ClearCells()`**, then loads the base in attack mode
(`PopupAttackA.as:117-128`).

Server validation in `baseModeAttack` (`server/src/controllers/base/load/modes/baseModeAttack.ts`),
skipped entirely for `save.type === TRIBE` (wild monster camps):

| Check | Error | Line |
| --- | --- | --- |
| `save.protected > now` | base protected | `:64` |
| `isAttackActive(save)` | base already under attack | `:66` |
| Main yards: defender seen within 60 s | user online | `:68-71` |
| Active truce between the two users | truce active | `:73-75` |
| Range (after the attack is recorded) | out of range, logged as a report | `:167` |

Side effects of a successful attack start:

- The attacker's own damage protection is cleared (`damageProtection(userSave, BaseMode.ATTACK)`,
  `baseModeAttack.ts:93-95`; `server/src/services/maproom/v2/damageProtection.ts:34-36`).
- An `attackid` is assigned to the defender save, and the attack is appended to `save.attacks`
  (capped to the last 3 entries) for non-tribe targets (`baseModeAttack.ts:78-97`).
- For a wild monster camp with no `world_map_cell` row yet, one is created with `base_type = WM` and
  the terrain height recomputed from noise (`baseModeAttack.ts:118-127`).
- An attack log is written for non-tribe targets (`baseModeAttack.ts:156-165`).

After the battle the client posts `/base/save` with the result. `damage` and `destroyed` fall through
the default branch of the save-key switch onto the defender save
(`server/src/controllers/base/save/baseSave.ts:144-152`), `savetime` is set to now
(`baseSave.ts:219`), and for main yards and outposts (not tribes) `damageProtection` is applied
(`baseSave.ts:200-204`). The end-of-attack popup offers "Open Map" and, on success, sets
`GLOBAL._currentCell.destroyed = 1` locally before reopening the map
(`client/scripts/com/monsters/maproom_advanced/popup_attackend.as:92-98`).

### Wild monster camp rules

- **Tribe** is a pure function of the coordinates: `Tribes[(x + y) % 4]` over
  `[Legionnaire, Kozu, Abunakki, Dreadnaut]`
  (`server/src/controllers/maproom/v2/cells/wildMonsterCell.ts:15-16`,
  `server/src/enums/Tribes.ts:41-46`).
- **Level** is also a pure function of the coordinates:
  `((x + y) % (45 - minLevel)) + minLevel`, with per-tribe minimums Legionnaire 25, Kozu 29,
  Abunakki 25, Dreadnaut 25 and a shared upper bound of 45
  (`server/src/services/maproom/v2/calculateTribeLevel.ts:7-37`). Effective levels are therefore
  25..44 (Kozu 29..44).
- **Yard layout** comes from per-tribe fixture data bucketed by level
  (`server/src/services/maproom/v2/tribeSaveV2.ts:49-76`, data in
  `server/src/game-data/tribes/v2/`). `wmid = tribeIndex * 10 + 1`.
- **Damage persistence**: a `save` row is created lazily the first time the camp is viewed or
  attacked (`server/src/services/maproom/tribeSaveHandler.ts:32-33`). From then on `damage` and
  `destroyed` persist, and the map reads them directly.
- **Respawn / regeneration**: a wild monster save older than **12 hours**
  (`WILD_MONSTER_EXPIRATION = 43200` seconds) is deleted and regenerated — but **only inside
  `baseModeView`**, that is, only when someone loads the yard
  (`server/src/controllers/base/load/modes/baseModeView.ts:13`, `:32-40`). There is no scheduled job
  and no check in `getarea`.
- **Loot**: handled by the generic attack loot path (`attackLootHandler` / `defenderLootHandler` in
  `baseSave.ts:160-178`), not by anything map-specific. Wild monster camps are not looted onto a
  defender column because `save.type === TRIBE` has no owner.
- **Protection**: wild monster camps never receive damage protection. `damageProtection` is only
  applied to `MAIN`, `OUTPOST` and `INFERNO` types (`baseSave.ts:200-204`,
  `damageProtection.ts:38-123`).
- **Takeover**: a destroyed camp (`d == 1`) can be taken over as an outpost, converting the tribe
  save into an outpost save (`takeoverCell.ts:107-111`).

### Take over a cell (build an outpost)

| | |
| --- | --- |
| Who | Any player |
| Request | `POST /worldmapv2/takeovercell` with `baseid` and either `resources` (JSON `{r1..r4}`) or `shiny` |

Client preconditions (`PopupInfoEnemy.as:160-163`, `:497-521`) — all must hold for the Attack button
to become a Takeover button:

- `_base != 2` — main yards can never be taken over, only outposts and wild monster camps.
- `_destroyed` is truthy (server-side: `damage >= 90`).
- `!_protected`.
- `_locked == 0` or `_locked == own player id`.
- `MapRoom._flingerInRange`.
- Outpost count below `GLOBAL.k_MAX_NUMBER_OF_OUTPOSTS` = 3500 (`client/scripts/GLOBAL.as:440`).

Cost, computed client-side in `PopupTakeover`
(`client/scripts/com/monsters/maproom_advanced/PopupTakeover.as:50-80`):

| Target | Formula |
| --- | --- |
| Wild monster camp | `max(round((level * 562500 - 14750000) / 250000) * 250000, 1000000)` |
| Player outpost | `min(max(round((ln(empireValue) * 15820570.7 - 227080916.9) / 250000) * 250000, 1000000), 65000000)` |

Then halved when the target is adjacent to the player's main yard
(`PopupTakeover.as:62-75`), then reduced by the `ALLIANCE_CONQUEST` powerup
(`PopupTakeover.as:77-79`). The same amount is charged for each of r1..r4. The shiny alternative is
`ceil((sqrt(cost / 2)) ^ 0.75 * 4)` (`PopupTakeover.as:80`).

There is a second, unused cost path in `PopupInfoEnemy.TakeOverConfirm` based on outpost count
(2,000,000 minimum; 5,000,000 x count for 1..4 outposts; 20,000,000 + 2,000,000 x (count - 4) beyond),
`PopupInfoEnemy.as:498-513`. It only runs when the computed cost is exactly zero
(`PopupInfoEnemy.as:514-521`), which the `PopupTakeover` path prevents.

Server (`server/src/controllers/maproom/v2/takeoverCell.ts`):

| Rule | Line |
| --- | --- |
| Cell must exist in the caller's world and have a save | `:41-49` |
| Target must not be a `MAIN` yard | `:47` |
| `cellSave.damage >= 90` | `:53` |
| Must be within flinger range of the caller's main yard or an outpost | `:57` |
| Shiny-locked accounts cannot pay with shiny | `:33-35` |

The cost is **not validated** — whatever `resources` / `shiny` the client sends is subtracted
(`takeoverCell.ts:59-65`).

State changes on success:

- Previous owner: the cell is removed from `save.outposts` and its `buildingresources` entry deleted
  (`:74-85`).
- The existing save row is transferred to the new owner: `saveuserid`, `userid`, `homebaseid`,
  `mapversion`, `name`, `worldid` reassigned; `createtime` reset; `protected` set to now + 12 hours;
  `attacks`, `resources`, `monsters` cleared; `tutorialstage = 205`; `takeoverDate` stamped (`:92-105`).
- A tribe save additionally becomes `type = OUTPOST`, with `buildingdata` cleared and `wmid = 0`
  (`:107-111`). **A taken-over wild monster camp keeps none of its layout.**
- Cell: `uid` reassigned, `base_type = OUTPOST` (`:114-115`).
- New owner: `[x, y, baseid]` pushed onto `save.outposts` (`:118`).
- Taking cell (0,0) renames the world and invalidates the world cache (`:120-126`).

Client after success (`PopupTakeover.as:141-159`, same logic duplicated at
`PopupInfoEnemy.as:559-579`): force-refreshes that one cell, appends the coordinate to
`GLOBAL._mapOutpost`, raises the four resource caps by `GLOBAL._outpostCapacity`, clears the whole
zone cache, closes the map, and loads the new outpost in build mode.

### Migrate main base onto an outpost ("move main yard here")

| | |
| --- | --- |
| Who | Owner, from `PopupInfoMine` on one of their own outposts (`_base == 3` only) |
| Request | `POST /base/migrate` with `type=outpost`, `baseid`, and `resources` or `shiny` |
| Cost | 30,000,000 of each resource, or 1500 shiny (`PopupRelocateMe.as:65-66`) |

Server (`server/src/controllers/maproom/v2/migrateBase.ts`):

- If `save.cantmovetill > now`, the call succeeds with `{ error: 0, cantMoveTill, currenttime }` and
  does nothing (`:52-60`). The client shows the remaining time.
- The home cell's `x`, `y` and `terrainHeight` are overwritten with the outpost's (`:103-105`).
- `save.homebase` is updated, the outpost is removed from `save.outposts`, and its
  `buildingresources` entry is deleted (`:108-121`).
- A **24-hour cooldown** is written to `save.cantmovetill` (`:23`, `:111`).
- The outpost cell and its save row are deleted inside a transaction (`:127-131`).
- Response: `{ error: 0, coords: [x, y] }`.

Client after success (`PopupRelocateMe.as:118-166`): lowers the resource caps, updates
`GLOBAL._mapHome`, clears bookmarks, shifts `GLOBAL._mapOutpost`, clears the zone cache, and closes
the map room.

### Relocate to a random cell (empire destroyed)

| | |
| --- | --- |
| Who | A player whose main yard is below 10% health with no outposts, or with `empiredestroyed == 1` |
| Request | `POST /base/migrate` with `type=random`, `baseid=0`, `shiny=0` |
| Cost | Free |

Trigger: `client/scripts/BASE.as:2341-2343` opens `PopupLostMainBase`. Server: `migrateBase` with
`type === RANDOM` refuses if the player still owns any outpost
(`migrateBase.ts:63-64`), otherwise calls `leaveWorld` then `joinOrCreateWorld(..., relocate = true)`
(`:66-67`).

`leaveWorld` (`server/src/services/maproom/v2/leaveWorld.ts`) decrements the world player count,
deletes every outpost save and every `world_map_cell` row owned by the user, nulls `worldid`,
`homebase`, `cell`, `outposts` and `buildingresources`, clears `user.bookmarks`, and nulls the
inferno save's `worldid`.

### Migrate to a friend's world (invite)

A separate flow reached from the mailbox, not from the map itself. The recipient can preview the
inviter's location in **view-only** map mode (`MapRoom._viewOnly`), which hides Home, Jump and the
resource panel, shows a Yes/No prompt on the invite cell, and adds `worldid` to `getarea` requests
(`MapRoom.as:140-165`, `MapRoomPopup.as:177-190`, `MapRoomCell.as:643-650`, `MapRoom.as:620-622`).

Accepting posts to `/base/migratetofriend` with `baseid` and `threadid`, costing 1200 shiny or
10,000,000 of each resource (`MapRoom.as:263-290`). Rejecting posts to
`/base/rejectmigratetofriend` (`MapRoom.as:337-338`). Both are blocked while the player is in an
alliance (`MapRoom.as:220-223`).

### Transfer monsters between own yards

Three-step flow, all client-driven:

1. `TransferMonstersA` — from `PopupInfoMine` on a cell with monsters, with at least one outpost
   owned. Snapshots the source cell and shows a "select target" bubble
   (`MapRoom.as:661-692`, `PopupInfoMine.as:80-84`).
2. `TransferMonstersB` — the next click on one of the player's own cells opens the quantity dialog
   (`MapRoom.as:694-707`).
3. `TransferMonstersC` — computes the actual transfer, clamped by the target's remaining housing
   space (`space` minus the sum of `count * cStorage` for monsters already housed), and posts
   `POST /worldmapv2/transferassets` with `frombaseid`, `tobaseid`, and `monsters` (a JSON array
   `[sourceMonsterData, targetMonsterData]`) (`MapRoom.as:709-936`, endpoint at `:900`).

Ordering guarantee: the transfer is held back until no `getarea` request covering either zone is
pending, and those zones are promoted to the front of the request queue
(`MapRoom.as:889-920`). Conversely, `getarea` for a zone containing a cell in a pending transfer is
deferred (`MapRoom.as:601-616`).

Server (`server/src/controllers/maproom/v2/transferMonsters.ts`): loads both saves by `baseid`,
requires `fromBase.saveuserid === toBase.saveuserid` (`:51-55`), and **overwrites `monsters` on both
saves with whatever the client sent** (`:57-58`). No quantity, capacity or ownership-by-caller check.

On success the client patches both cells in memory and writes the new `housed` maps back into the
cached zone data, avoiding a refetch (`MapRoom.as:750-788`).

### Bookmarks

Up to **8** bookmarks (`MapRoom.as:462-467`), names trimmed and capped at 20 characters
(`MapRoom.as:442-455`), duplicates by coordinate rejected (`MapRoom.as:469-478`).

Storage is a flat key-value blob keyed by index (`MapRoom.as:479-483`):

| Key | Value |
| --- | --- |
| `mbms` | Bookmark count |
| `mbm<i>` | Packed location `x * 10000 + y` |
| `mbmn<i>` | Name string |

Saved with `POST /api/<v>/player/savebookmarks`, body `bookmarks` = the JSON blob
(`MapRoom.as:435-437`). The server parses it and stores it on `user.bookmarks` with no validation
(`server/src/controllers/maproom/v2/saveBookmarks.ts:22`). It is returned at login and unpacked on
map open (`client/scripts/LOGIN.as:170`, `MapRoomPopup.as:563-591`).

### Jump to coordinates

Accepts numeric x and y, valid when `0 <= x < mapWidth` and `0 <= y <= mapHeight` (note the
inconsistent bound on y), then re-generates the whole sprite grid centred on that point
(`MapRoomPopup.as:1277-1293`, `:593-608`). "Home" jumps to `GLOBAL._mapHome`
(`MapRoomPopup.as:157-160`).

### Buffs

Alliance powerups are shown as icons in the map HUD with remaining time
(`MapRoomPopup.as:1368-1474`). Two affect map rules:

- `ALLIANCE_DECLAREWAR` adds bonus attack range (`PopupAttackA.as:187-189`,
  server counterpart `DECLARE_WAR_RANGE = 2` in `validateRange.ts:11`).
- `ALLIANCE_CONQUEST` reduces takeover cost (`PopupTakeover.as:77-79`).

### Other cell actions

From `PopupInfoEnemy` on a player cell (`_base >= 2`): send message
(`POST /api/<v>/player/sendmessage` via the `Message` UI, `PopupInfoEnemy.as:641-663`), request truce
(same UI with `requestType = trucerequest`, `:665-688`), invite to alliance (`:690-696`). All three
are disabled for wild monster camps (`:248-251`).

From `PopupInfoMine` on an own outpost: invite a friend to migrate onto it, or revoke a pending
invite (`PopupInfoMine.as:312-343`, `:243-278`).

---

## 5. State refresh behaviour

There are **three independent staleness layers** between the database and a rendered cell.

### Layer 1 — the zone cache (`MapRoom._zones`)

`_zones` is a plain object keyed by `zoneX * 10000 + zoneY`, holding `{ updated, data }`
(`MapRoom.as:60`, `client/scripts/com/monsters/maproom_advanced/objZone.as`).

`RequestData` sends a `getarea` only when
`force == true || now - zone.updated > 30` (`MapRoom.as:521`). On dispatch, `updated` is set to
`now + random(0..9)` seconds of jitter so zones do not all expire together (`MapRoom.as:634`).

So a zone refreshes **at most once every 30 to 40 seconds** unless forced.

`force` is set when:

- `GetCell(x, y, true)` is called explicitly — on map open for the current cell
  (`MapRoom.as:1134`), after a takeover (`PopupTakeover.as:145`), after an invite is sent or revoked
  (`PopupInfoMine.as:240`, `:260`), and from `BASE.LoadNext` when walking to the next outpost
  (`client/scripts/BASE.as:4676`).
- More than 20 seconds have elapsed since the last resource sync, in which case the request also sets
  `sendresources = 1` and is forced (`MapRoom.as:509-513`).

The cache is **wiped entirely** (`ClearCells()`, `MapRoom.as:185-187`) when the map is hidden
(`MapRoom.as:1175`), when an attack is launched (`PopupAttackA.as:120`), when an own yard is opened
(`PopupInfoMine.as:226`), after a takeover (`PopupTakeover.as:151`), after a relocation
(`PopupRelocateMe.as:158`), after accepting a migration invite (`MapRoom.as:250`), and in
`MapRoomPopup.Cleanup` (`MapRoomPopup.as:559`).

### Layer 2 — per-cell `_dataAge`

Each cell sprite sets `_dataAge = 10` when it reads data (`MapRoomCell.as:292`) and decrements it
once per tick (`MapRoomCell.as:685`). `MapRoomPopup.Update` only re-reads a cell from the zone cache
when `(!cell._updated || force) && cell._dataAge <= 0` (`MapRoomPopup.as:874-879`).

So even when fresh zone data arrives, a cell that was refreshed less than 10 ticks (~10 seconds) ago
keeps rendering the old values.

`_dataAge` is reset to 0 and `_updated` to false whenever a sprite is recycled onto a new coordinate
by panning (`MapRoomPopup.as:862-873`), which is why scrolling a cell off screen and back makes it
update immediately.

### Layer 3 — the server's own staleness

`getarea` reads `cell.save.damage` and `cell.save.destroyed` straight out of the database with no
freshness logic (`server/src/controllers/maproom/v2/cells/wildMonsterCell.ts:29-30`). Nothing on the
`getarea` path regenerates a wild monster camp.

### When the client fetches

| Trigger | Effect |
| --- | --- |
| Map opened (`ShowDelayed`) | Rebuilds the sprite grid, force-fetches the current cell's zone, jumps to it (`MapRoom.as:1116-1144`) |
| Sprite grid generated or jumped | Every visible cell calls `GetCell`, queuing a `getarea` per uncached zone (`MapRoomPopup.as:874-879`) |
| Panning | Recycled sprites request their new zones on the same path (`MapRoomPopup.as:720-738` -> `Update`) |
| Game tick (1 Hz) | `MapRoom.Tick` -> `MapRoomPopup.Tick` -> `Update()` (non-forced), which re-reads cells whose `_dataAge` hit 0 and re-requests zones older than 30 s (`MapRoom.as:1202-1205`, `MapRoomPopup.as:747-754`) |
| `getarea` response arrives | `MapRoom._mc.Update(true)` forces a re-read of every cell whose `_dataAge <= 0` (`MapRoom.as:554-556`) |
| Returning from an attack | The map was closed and `_zones` cleared, so everything is refetched from scratch (`PopupAttackA.as:119-120`, `popup_attackend.as:92-98`) |

### Root cause of the stale NPC yard bug

**The regeneration rule for wild monster camps lives on the `/base/load` view path and nowhere else.
The map endpoint reads the stored damage verbatim.**

The chain:

1. Attacking a wild monster camp creates (or reuses) a `save` row of `type = TRIBE`
   (`server/src/services/maproom/tribeSaveHandler.ts:32-33` via
   `server/src/controllers/base/load/modes/baseModeAttack.ts:57-58`) and a `world_map_cell` row with
   `base_type = 1` (`baseModeAttack.ts:118-127`).
2. The post-battle `/base/save` writes `damage` and `destroyed` onto that save through the default
   branch of the key switch (`server/src/controllers/base/save/baseSave.ts:144-152`) and sets
   `savetime = now` (`baseSave.ts:219`). Tribe saves are excluded from `damageProtection`
   (`baseSave.ts:200-204`).
3. `getarea` -> `createCellData` -> `wildMonsterCell` returns `dm: cell.save.damage` and
   `d: cell.save.destroyed` with **no expiry check at all**
   (`server/src/controllers/maproom/v2/cells/wildMonsterCell.ts:29-30`;
   `server/src/services/maproom/v2/createCellData.ts:25-31`). The 11 x 11 in-memory fill only applies
   to cells with no database row (`getArea.ts:156-173`).
4. The **only** code that expires a wild monster save is `baseModeView`:

   ```ts
   const WILD_MONSTER_EXPIRATION = 43200;               // baseModeView.ts:13
   ...
   if (mapversion !== MapRoomVersion.V3 && save && save.wmid !== 0) {
     const currentTimestamp = getCurrentDateTime();
     if (currentTimestamp - save.savetime > WILD_MONSTER_EXPIRATION) {
       postgres.em.remove(save);
       await postgres.em.flush();
       save = await tribeSaveHandler(baseid, mapversion, worldid, user);
     }
   }
   ```
   (`server/src/controllers/base/load/modes/baseModeView.ts:32-40`)

   `baseModeView` runs only for `/base/load` with `type` of `view`, `iview` or `wmview`
   (`server/src/controllers/base/load/baseLoad.ts:71-74`, `:109-111`) — that is, only when the player
   clicks **View** on the camp. That click is the "check the yard" step.
5. There is no scheduled job. Map Room 1 and the Inferno map do have timed tribe respawn
   (`server/src/services/maproom/v1/createMR1Tribes.ts:32`,
   `server/src/services/maproom/inferno/createInfernoTribes.ts:27`) and Map Room 3 uses
   `world_map_cell.destroyed_at` with a 3-day regeneration window
   (`server/src/config/MapRoom3Config.ts:140`), but `destroyed_at` is never written for map version 2
   (`baseSave.ts:190-196` is guarded on `map_version: MapRoomVersion.V3`).

**Consequence.** A camp the player destroyed twelve hours ago is fully regenerated in the database
sense — the save is eligible for deletion — but the map keeps showing `dm: 100, d: 1` (a red,
"destroyed" camp) indefinitely. Opening the yard deletes the expired save, creates a fresh one, and
the *next* `getarea` finally reports `dm: 0, d: 0`. Clearing the client zone cache does not help,
because the server response itself is stale.

A secondary, much shorter staleness also exists for all cell types: the 30-second zone TTL
(`MapRoom.as:521`) stacked on the 10-tick `_dataAge` gate (`MapRoomPopup.as:874`), so a cell can lag
reality by up to roughly 40 seconds even when the server is correct.

**What a fix needs.**

Server, and this is where it belongs:

- Apply the same 12-hour expiry inside the map read path. The cleanest form is to move the expiry
  test into a shared helper and call it from `wildMonsterCell`: when
  `now - save.savetime > WILD_MONSTER_EXPIRATION`, report `dm: 0, d: 0` rather than the stored
  values. This alone fixes the display without any write on a read request.
- Optionally reclaim the rows too, either by deleting expired tribe saves lazily during `getarea`
  (a write on a read path, so it needs care under the 120 req/min rate limit) or by a periodic job
  that deletes `save` rows with `wmid != 0`, `type = TRIBE` and `savetime` older than 12 hours,
  together with their `world_map_cell` rows.
- Whichever route is taken, `getarea`, `/worldmapv2/snapshot` and `baseModeView` must agree on the
  same rule, since the snapshot endpoint reads `damage` and `destroyed` the same way
  (`server/src/services/maproom/v2/bulk/worldSnapshot.ts:43-69`).

Client, for the new web map:

- Do not gate re-rendering on a per-sprite countdown. Render from a single cell store and re-render
  whenever that store changes.
- Invalidate the affected cell explicitly when returning from an attack or a takeover, rather than
  relying on the whole cache having been dropped.

---

## 6. Viewport and navigation

### Panning

Drag-to-pan only. `MOUSE_DOWN` on the cell container records the anchor points
(`MapRoomPopup.as:712-718`), `MOUSE_MOVE` translates the container and calls `Update()` on every
move (`MapRoomPopup.as:720-738`), `MOUSE_UP` on the stage ends the drag
(`MapRoomPopup.as:740-745`). A movement of more than 10 pixels sets `_dragged`, which suppresses the
click that would otherwise open a cell popup (`MapRoomPopup.as:733-736`, `MapRoomCell.as:983-985`).

There is no momentum, no keyboard panning, and no edge-scroll.

Wrapping is implemented by recycling sprites across the four viewport bounds
(`MapRoomPopup.as:808-861`), so the container position grows without bound while logical coordinates
stay in `[0, 800)`.

### Zoom

**Map Room 2 has no zoom, in any form.** There is no `scaleX`/`scaleY` manipulation, no
`MOUSE_WHEEL` handler, and no zoom button anywhere in
`client/scripts/com/monsters/maproom_advanced/`. Nothing is commented out either.

The zoom assets do exist but belong to other systems:

- `server/public/assets/worldmap/hud/options/button_zoom_in.png` and `button_zoom_out.png` are
  **Map Room 3** HUD assets, referenced at
  `client/scripts/com/monsters/maproom3/MapRoom3AssetCache.as:76`, `:78`, `:132`. Map Room 3 has real
  zoom: `MapRoom3Window.Zoom(scale)` tweens `scrollingCanvas.scaleX/scaleY`
  (`client/scripts/com/monsters/maproom3/MapRoom3Window.as:651-675`) and `IsZoomedOut()` is
  `scaleX < 1` (`:647-648`), used to drop detail when zoomed out
  (`MapRoom3CellGraphic.as:473`, `:679`).
- `server/public/assets/ui/btn_zoom_in.png` and `btn_zoom_out.png` are not referenced by any `.as`
  or `.ts` file in the repository.
- `client/scripts/buttonZoom.as:20` calls `GLOBAL.Zoom()`, which is the in-yard camera zoom
  (`client/scripts/GLOBAL.as:1029-1049`), not the map.

Map Room 3 is the only working reference for what zoom should feel like here.

### Fullscreen

Fullscreen enlarges the viewport from 16 x 14 to 18 x 15 cells and repositions the frame, but does
not change cell size (`MapRoomPopup.as:100-114`, `:647-654`). Toggling fullscreen tears down and
rebuilds the entire map room (`MapRoom.as:1222-1230`).

### Minimap

**There is no minimap in Map Room 2.** `com/monsters/maproom/MiniMap.as` belongs to Map Room 1.

### Navigation controls present

| Control | Behaviour | Source |
| --- | --- | --- |
| Home | Jump to `GLOBAL._mapHome` | `MapRoomPopup.as:157-160` |
| Jump | Coordinate entry dialog | `MapRoomPopup.as:218-251`, `:1277-1293` |
| Bookmarks | Dropdown list, select jumps, delete removes | `MapRoomPopup.as:1217-1275`, `:1295-1329` |
| Hover info panel | Owner, alliance, status, location for the hovered cell | `MapRoomPopup.as:281-375` |
| Resource panel | r1..r4 with fill bars, plus outpost count | `MapRoomPopup.as:262-279` |
| Buff icons | Active alliance powerups with remaining time | `MapRoomPopup.as:1368-1474` |

Range highlighting: every own cell with a flinger and every own yard gets its reachable hexes glowed.
Cells within the base flinger range glow at alpha 0.5, cells in the `ALLIANCE_DECLAREWAR` bonus band
at 0.35 (`MapRoomPopup.as:975-1012`). The home cell is highlighted optimistically from the locally
known flinger level before its zone data arrives (`MapRoomPopup.as:917-931`).

---

## 7. Timers and protection

### Damage protection

Granted at the end of an attack by `damageProtection`
(`server/src/services/maproom/v2/damageProtection.ts`), called from `baseSave.ts:200-204` for `MAIN`
and `OUTPOST` types only.

| Base type | Condition | Duration |
| --- | --- | --- |
| Main yard | 4 or more attacks within the last hour | 1 hour (`:59-60`) |
| Main yard | `damage >= 50` and at least one attack in the last 36 hours | 36 hours (`:62-65`) |
| Outpost | `damage >= 25` and at least one attack in the last 8 hours | 8 hours (`:85-88`) |
| Inferno yard | Same as main yard | 1 h / 36 h (`:92-120`) |

Protection is never extended while already active (`:50-52`, `:76-78`, `:103-105`), and an expired
timestamp is reset to 0 on the next evaluation. **Launching any attack clears the attacker's own
protection** (`:34-36`).

A newly taken-over cell receives a flat **12 hours** of protection
(`server/src/controllers/maproom/v2/takeoverCell.ts:89`, `:99`).

On the wire, protection appears as `p` (boolean 0/1). The expiry timestamp is never sent, so the map
cannot show a countdown — only "protected" or not (`userCell.ts:63`, `:84`). `Update()` renders a
distinct `main-protected` / `outpost-protected` sprite state (`MapRoomCell.as:548-555`).

### Truce

Truces are per-pair rows with a status and an `expires_at`. `getarea` batch-loads truces that are
`REQUESTED`, or `ACCEPTED` and not yet expired, between the caller and every cell owner in the zone
(`server/src/services/maproom/getTruces.ts:28-43`). The expiry timestamp is sent as `t`, omitted for
the caller's own cells (`userCell.ts:68`, `:81`).

The client blocks attacks while `_truce > now` (`PopupInfoEnemy.as:534-536`,
`MapRoomPopup.as:1196-1206`, `PopupAttackA.as:112`) and shows a truce marker on the cell
(`MapRoomCell.as:591`). The server independently rejects the attack (`baseModeAttack.ts:73-75`).

Note the client compares `_truce > GLOBAL.Timestamp()` but does not itself expire the value, so the
marker disappears only on the next data refresh.

### Online / locked

A main yard whose owner was seen within 60 seconds, or which is under an active attack, is reported
as locked (`userCell.ts:52-56`). An attack counts as active while `attackid != 0` and the last attack
started less than **7 minutes** ago (`server/src/services/base/isAttackActive.ts:12`, `:32`).

The client treats `_locked != 0 && _locked != own player id` as locked
(`MapRoomCell.as:268-270`), blocks opening one's own locked yard
(`PopupInfoMine.as:222-233`), and blocks takeover of a locked cell (`PopupInfoEnemy.as:160`).

### Migration cooldown

24 hours between main-yard migrations, stored on `save.cantmovetill`
(`server/src/controllers/maproom/v2/migrateBase.ts:23`, `:111`). When it is active the endpoint
returns `cantMoveTill` and `currenttime` and the client formats the difference into a message
(`PopupRelocateMe.as:121-124`).

### Client-side ticking

The map runs at 1 Hz. Each tick decrements `_dataAge` on every cell, refreshes glow state, and
advances monster production on the player's own cells
(`MapRoomCell.as:653-873`, `MapRoomPopup.as:747-754`). Production is simulated second by second from
the cell's `saved` timestamp up to now on first load (`MapRoomCell.as:461-471`), with an integrity
check (`Check()`, `MapRoomCell.as:1016-1097`) that logs any divergence between the secured and plain
copies of the data.

---

## 8. Server-side rules

### Routes

`server/src/app.routes.ts:136-142`:

| Method | Path | Auth | Rate limit | Controller |
| --- | --- | --- | --- | --- |
| POST | `/worldmapv2/getarea` | user + account status | 120/min per user | `getArea` |
| GET | `/worldmapv2/terrain` | API key | 10/min per consumer | `getTerrain` |
| GET | `/worldmapv2/snapshot` | API key | 10/min per consumer | `getSnapshot` |
| GET | `/worldmapv2/alliances` | API key | 10/min per consumer | `getAlliances` |
| POST | `/worldmapv2/setmapversion` | user | none | `setMapVersion` |
| POST | `/worldmapv2/takeoverCell` | user + account status | none | `takeoverCell` |
| POST | `/worldmapv2/transferassets` | user + account status | none | `transferMonsters` |
| POST | `/api/:v/player/savebookmarks` | user + account status | none | `saveBookmarks` |
| POST | `/base/migrate` | user | none | `migrateBase` |
| POST | `/api/:v/bm/getnewmap` | user | none | `getNewMap` |

Limiters at `server/src/middleware/rateLimiters.ts:23-32` (getarea), `:68-107` (bulk endpoints).

### `getArea`

`server/src/controllers/maproom/v2/getArea.ts`.

1. Refuses when `devConfig.maproom` is false (`:83`, config at `server/src/config/GameConfig.ts:11`).
2. Validates `x` and `y` as integers in `[0, 799]`; `sendresources` defaults to 0 (`:21-25`).
3. Loads the caller's save (`:91`) and requires a `worldid` (`:98`).
4. Queries `world_map_cell` for `world = worldid`, `map_version = 2`, `x` in `[x, x+10]`,
   `y` in `[y, y+10]` (`:113-127`).
5. Batch-loads the distinct cell owners, their last-seen timestamps, and truces against the caller in
   one parallel round (`:130-142`).
6. Builds the alliance roster for the caller's alliance plus every owner's alliance (`:146-155`).
7. Renders each stored cell with `createCellData`, then fills every remaining coordinate in the
   11 x 11 block with an in-memory `WorldMapCell` carrying only its noise height (`:157-173`).
8. Returns the nested `data` map plus `alliancedata`, and the caller's resources and shiny when
   `sendresources === 1` (`:180-191`).

Ownership is not checked — any authenticated player can read any zone of their own world. The
`worldid` parameter the client sends in view-only mode is **ignored**; the zone always comes from the
caller's own save.

Cost note: `createCellData` is awaited in a loop (`:152`, `:170`), so a response builds 121 cells
sequentially.

### `takeoverCell`

See [Take over a cell](#take-over-a-cell-build-an-outpost). Validation is: cell exists in the
caller's world, has a save, is not a `MAIN` yard, `damage >= 90`, passes `validateRange`, and the
caller is not shiny-locked when paying with shiny. **The price is not verified**, and there is no
server-side outpost cap.

### `transferMonsters`

See [Transfer monsters](#transfer-monsters-between-own-yards). The only check is that both saves have
the same `saveuserid`. Note that it does **not** verify the caller is that user, so any authenticated
player can rewrite the monster contents of any two yards belonging to one owner
(`server/src/controllers/maproom/v2/transferMonsters.ts:51-58`).

### `migrateBase`

See [Migrate main base](#migrate-main-base-onto-an-outpost-move-main-yard-here) and
[Relocate](#relocate-to-a-random-cell-empire-destroyed). Cooldown 24 hours; the `RANDOM` path
requires zero outposts; the outpost path does not verify that the caller owns the target cell beyond
looking it up by `baseid`. Cost is not verified.

### `validateRange` (Map Room 2 branch)

`server/src/services/maproom/v2/validateRange.ts:81-150`.

1. Compute the distance from the caller's main yard to the target as a **Chebyshev distance with
   toroidal wrap**: `max(min(|dx|, 800-|dx|), min(|dy|, 800-|dy|))` (`:155-171`). The code notes this
   makes a square rather than a hex or diamond range.
2. Main-yard flinger range by level: 0 -> 0, 1 -> 4, 2 -> 6, 3 -> 8, 4+ -> 10 (`:173-188`).
3. Add `DECLARE_WAR_RANGE = 2` when the range is non-zero (`:11`, `:21`). The bonus is added
   unconditionally, without checking the powerup is active.
4. If in range, allow. Otherwise, if the caller owns no outposts, reject (`:106-107`).
5. Sweep a square of `MAX_OUTPOST_RANGE + DECLARE_WAR_RANGE = 6` around the target for the caller's
   outposts (`:113-123`), load their flinger levels, and allow if any covers the offset
   (`:135-144`). Outpost flinger range by level: 0 -> 0, 1 -> 1, 2 -> 2, 3 -> 3, 4+ -> 4 (`:190-204`).
6. Otherwise write a report (`logReport`) and throw (`:146-149`).

The outpost lookup key is the string concatenation `` `${x}${y}` `` (`:109`, `:120`), which is
ambiguous: cell (1, 23) and cell (12, 3) both key to `"123"`. On an 800 x 800 map this can grant or
deny outpost range incorrectly.

### `getNewMap`

`server/src/controllers/maproom/getNewMap.ts`. Returns `{ newmap: true, mapheaderurl, width, height }`
when the player's cell is on map version 3, and `{ newmap: false }` otherwise — which is the Map Room
2 answer. It carries **no Map Room 2 configuration**; world size for Map Room 2 arrives through
`/base/load` as `worldsize`.

### `setMapVersion`

`server/src/controllers/maproom/setMapVersion.ts`. Version 2 requires a Town Hall of level 6 unless
`save.mr2upgraded` is already set (`:83`), requires the player not to be in an alliance (`:77`),
requires the Discord age check (`:50`), clears pending alliance invites, calls `joinOrCreateWorld`,
sets `mr2upgraded` and `mapversion = 2`, and deletes the Map Room 1 record (`:74-93`). Version 0
leaves the world and falls back to Map Room 1 (`:53-68`).

`joinOrCreateWorld` (`server/src/services/maproom/v2/joinOrCreateWorld.ts`) picks a random world with
`playerCount < 2500` or creates one, then `findFreeCell` tries up to 10 random coordinates, skipping
(0,0), water, and occupied cells (`findFreeCell.ts:26-60`), and creates the home cell.

### Bulk endpoints (API consumers only)

These are **not used by the game client**. They exist for third-party tools and are gated on an
`X-API-Key`.

| Endpoint | Content | Cache |
| --- | --- | --- |
| `GET /worldmapv2/terrain?worldid=` | 640,000 raw bytes, one height per cell, indexed `x * 800 + y` | `max-age=31536000, immutable`, strong ETag (`getTerrain.ts:22-35`) |
| `GET /worldmapv2/snapshot?worldid=` | Every occupied cell as a positional array `[x, y, base_type, uid, baseid, empirevalue, flinger, catapult, damage, protected, destroyed]`, plus a `players` sidecar of `{ name, avatar }` | Rebuilt at most every 5 minutes per world, `max-age` to match, strong ETag (`getSnapshot.ts:26-57`, `worldSnapshot.ts:80`) |
| `GET /worldmapv2/alliances` | Every Map Room 2 alliance across all worlds, with members and relationship flags (`-1` hostile, `1` friendly, absent neutral) | Rebuilt at most every 5 minutes (`getAlliances.ts:22-56`) |

All three negotiate brotli, gzip or identity from `Accept-Encoding`, set `Vary: Accept-Encoding`, and
honour `If-None-Match` with a 304. The snapshot deliberately omits resources, monsters, truce and
protection state, because those are per-viewer or change every tick.

Note that the snapshot carries the same stale `damage` and `destroyed` for wild monster camps as
`getarea` does, so a fix must cover both.

### `getNeighbours`

`server/src/controllers/maproom/getNeighbours.ts` serves Map Room 1 and the Inferno map only. Map Room
2 has no neighbour list; targets are found by looking at the map.

---

## 9. Open questions / UNVERIFIED

1. **Seam behaviour at x = 790 or y = 790.** `getarea` accepts `x` up to 799 and iterates to
   `x + 10`, so a request at `x = 790` generates a column at `x = 800`, which is outside the world
   (`getArea.ts:157`). The client wraps 800 to 0 (`MapRoomPopup.as:1062-1064`). UNVERIFIED whether
   the duplicated column is ever rendered or whether the zone alignment makes it unreachable in
   practice; it would need a live world to confirm.
2. **`GLOBAL._outpostCapacity`.** The client raises and lowers the four resource caps by this value
   on takeover and migration (`PopupTakeover.as:147-150`, `PopupRelocateMe.as:126-129`), but the
   value's source was not traced. UNVERIFIED where it is set and whether the server agrees.
3. **`pi` (pending migration invite).** `userCell` hardcodes `pi: 0` (`userCell.ts:73`), yet the
   client maintains invite state through it and force-refreshes the cell after sending or revoking an
   invite (`PopupInfoMine.as:236-241`, `:256-261`). UNVERIFIED whether the invite marker can ever
   appear on the map in the current server, or whether this is a regression from the original game.
4. **`fr` (friend flag).** Always 0 (`userCell.ts:83`). The Help-instead-of-View and
   "attack a friend" confirmation paths (`PopupInfoEnemy.as:301-306`, `:543-545`) are therefore
   unreachable. UNVERIFIED whether a friends system is intended to return.
5. **`lo` semantics.** `userCell` sets `locked = 1` for online or under-attack yards
   (`userCell.ts:56`) rather than a user id, but the client compares `_locked` against
   `LOGIN._playerID` (`MapRoomCell.as:269`). UNVERIFIED whether user id 1 exists and would
   accidentally see its own yards as unlocked.
6. **`empiredestroyed`.** The column exists on `save` (`save.model.ts:183`) and the client reads it
   from `/base/load` (`BASE.as:871`), but no Map Room 2 server code was found that sets it. It
   appears set only in Inferno fixture data. UNVERIFIED how a Map Room 2 player's empire is flagged as
   destroyed; the `PopupLostMainBase` trigger also fires purely on local health and outpost count
   (`BASE.as:2341`).
7. **Takeover cost authority.** The cost formulas live entirely in the client
   (`PopupTakeover.as:50-80`) and the server subtracts whatever it is sent
   (`takeoverCell.ts:59-65`). UNVERIFIED whether an anti-cheat pass elsewhere covers this.
8. **Monster transfer authorisation.** `transferMonsters` never checks the caller owns the two saves
   (`transferMonsters.ts:51-55`). UNVERIFIED whether a middleware before the controller does.
9. **Outpost cap.** 3500 client-side (`GLOBAL.as:440`); no server-side cap was found. UNVERIFIED
   whether the number is intentional or vestigial — the takeover cost tiers in
   `PopupInfoEnemy.as:505-510` suggest a design around single-digit outpost counts.
10. **`worldsize` axis order.** `WORLD_SIZE = [HEIGHT, WIDTH]`
    (`server/src/config/MapRoom2Config.ts:7`) is assigned to `[mapWidth, mapHeight]`
    (`BASE.as:834-835`). Harmless while both are 800; UNVERIFIED which order is intended.
11. **`_averageAltitude = 125`.** The terrain bonus divisor is a client constant
    (`GLOBAL.as:398`) with no server counterpart. UNVERIFIED whether the server applies the same
    bonus to production and tower range, or whether the map display is cosmetic.

---

## 10. Redesign notes

### Must be preserved

These are load-bearing game rules. Changing them changes the game.

1. **800 x 800 toroidal hex grid, odd-q offset.** Cell identity is the coordinate pair, and base ids
   encode the coordinates in their last six digits (`generateBaseId.ts:38-45`). Both client and
   server already assume wrap-around.
2. **Terrain is deterministic from `(worldUuid, x, y)`.** A rebuilt client can generate or cache the
   entire height map without asking per zone — that is exactly what `/worldmapv2/terrain` exists for.
   Water (height <= 99) is unoccupiable.
3. **Tribe and level are pure functions of the coordinates.** `Tribes[(x+y) % 4]` and
   `((x+y) % (45 - minLevel)) + minLevel`. A client can compute both offline; the server need only
   send the mutable part (damage, destroyed).
4. **Only occupied cells are stored.** Everything else is derived. This is what keeps a 640,000-cell
   world cheap, and the new client should keep it.
5. **Flinger range determines what can be attacked.** Main yard 0/4/6/8/10 by level, outpost
   0/1/2/3/4, plus 2 for Declare War, measured as wrapped Chebyshev distance. This is the core
   constraint that makes outposts matter.
6. **Damage protection windows.** 1 h after 4 attacks in an hour; 36 h at 50% damage on a main yard;
   8 h at 25% damage on an outpost; 12 h on a freshly taken cell; attacking clears your own
   protection.
7. **Takeover requires >= 90% damage and a non-main-yard target.** Main yards can never be taken.
8. **A taken-over wild monster camp is wiped to an empty outpost** (`buildingdata = {}`,
   `wmid = 0`, `monsters = {}`, `resources = {}`, `tutorialstage = 205`).
9. **24-hour main-yard migration cooldown**, and relocating to a random cell requires owning no
   outposts.
10. **Truce and online/under-attack locking block attacks**, enforced on both sides.
11. **Wild monster camps regenerate 12 hours after their last save.** Keep the rule, move it so the
    map honours it (see [Root cause](#root-cause-of-the-stale-npc-yard-bug)).
12. **Bookmarks cap at 8**, and the map is the only place to create them.
13. **Alliance relationships colour the map** (`-1` hostile, `1` friendly, `4` ally, `5` leader in
    the client's flag states, `MapRoomCell.as:1141-1161`).

### Flash-era constraints that can be dropped

1. **Fixed 760 x 670 / 760 x 520 stage and the 1024 x 768 clamp**
   (`MapRoomPopup.as:91-129`, `:617-623`). Pure layout.
2. **Fixed 16 x 14 / 18 x 15 sprite grid.** The viewport should follow the window and the zoom level.
3. **150 x 75 px cells with a hardcoded 0.75 column step.** Make it a scale-derived constant.
4. **10 x 10 zone batching with one request in flight.** Chosen for Flash's single-threaded loader.
   A modern client should issue parallel requests, use larger tiles, and ideally bootstrap from
   `/worldmapv2/terrain` plus `/worldmapv2/snapshot` and only poll `getarea` for the mutable
   per-viewer fields.
5. **The 11 x 11 off-by-one in `getarea`.** An artefact of `<=` against `x + width`. Fix it or make
   the batch size a real parameter — the client already sends `width` and `height`, which the server
   ignores.
6. **The 30-second zone TTL and 10-tick `_dataAge` gate.** Both are frame-budget hacks. Replace with
   a single reactive cell store plus explicit invalidation.
7. **1 Hz client-side monster production simulation in the map room.** The map replicates hatchery
   maths (`MapRoomCell.as:653-873`) purely so the Flash client could show live counts without
   polling. A new client can request the numbers or compute them from `saved` on render.
8. **`SecNum` value obfuscation and the `Check()` shadow-copy comparison.** Anti-tamper theatre in a
   client the user controls; the server must validate instead.
9. **`cacheAsBitmap`, depth sorting by `y * 1000 + x`, and the smoke particle system**
   (`MapRoomPopup.as:196-208`, `MapRoom.as:955-1012`). Rendering only.
10. **Facebook-era fields**: `fbid`, `im`, `on`, `fr`, `pi`, and the `graph.facebook.com` avatar
    fallbacks. Drop from the wire format.
11. **View-only invite mode as a separate map mode.** The `worldid` parameter it sends is already
    ignored by the server; the whole mode could be a normal map with a target marker.
12. **Fullscreen as a teardown-and-rebuild.** `ResizeHandler` destroys and recreates the map room
    (`MapRoom.as:1222-1230`). A resize should be a layout change.

### Things to add that the data already supports

- **Zoom.** Map Room 3 shows the pattern: scale a canvas, drop cell detail below scale 1
  (`MapRoom3Window.as:647-675`, `MapRoom3CellGraphic.as:679`). The zoom-out data need is already
  served whole by `/worldmapv2/terrain` and `/worldmapv2/snapshot`.
- **A protection countdown.** The server knows `save.protected` as a timestamp but sends only a
  boolean `p`. Sending the expiry would let the map show time remaining, as it already does for
  truces via `t`.
- **Push or targeted invalidation after an attack.** The attack result is known server-side; the
  client currently discovers it by refetching everything.
