# Map Room 2 fog of war

Status: design, 2026-10-07. Not built yet. Work packages: see section 11.

Every point is marked **[owner]** (decided by the owner, OWNER-QUESTIONS.md section 0j) or
**[suggested]** (this doc's proposal; the owner can overrule it). The open points raised in section 12
were all closed by the owner on 2026-10-07; see that section for the decisions.

Map Room 1 (and Map Room 3) are not touched. **[owner]** for Map Room 1, **[suggested]** for Map Room 3.

The cell look (yard/outpost hex icons, names inside the hex) is a separate piece of work with its own
mock-ups and is not covered here.

---

## 1. Summary

Today the Map Room 2 world map shows the whole 800 x 800 world to everyone: any 10 x 10 zone can be
fetched, and it carries owner names, avatars, levels, damage and protection for every base in it
(`server/src/controllers/maproom/v2/getArea.ts`, no range check). With fog of war, a player only
sees the cells their flingers reach, plus allies' sight and the bases of players who attacked them.
Everything else is dark. The server removes hidden cells from its answers, so the fog cannot be
peeled off by reading network traffic; the client only draws it.

## 2. What the player sees

- Inside sight: the map as today (terrain, wild monster camps, yards, outposts, names, levels,
  damage, locks, truces). **[owner]**
- Outside sight: fully dark / clouds. No terrain, no water, no camps, no bases, no names. **[owner]**
- No memory: a cell that leaves sight goes fully dark again; nothing explored is remembered. **[owner]**
- Other players' outposts and yards inside your sight show normally. Their own flinger ranges give
  you no extra sight. **[suggested]**
- The player's own cells (main yard and every outpost) are always visible, even with a flinger that
  reaches nothing. **[suggested]**

## 3. The sight rule

A cell is **visible** to player P when any of these holds:

1. **Own sight.** It is within reach of one of P's flingers, measured exactly as the attack range is
   measured: the shared rule `web/src/game/maproom/rules/range.ts` (copied byte-for-byte to
   `server/src/game-rules/maproom/range.ts`). **[owner]**
   - Main yard: `mainYardRange(flinger)` = 2 + 2 x level, max 10 (level 0 = 0, no level on the save = 10,
     as the attack rule already does).
   - Each outpost: `outpostRange(flinger)` = 1 per level, max 4, measured from the outpost's own cell.
   - Declare War: +2 on every flinger with reach above 0, only while P's alliance has it running
     (`withDeclareWar`, `services/alliance/powerups.ts` `runningPowerups`).
   - Distance is hex steps on the wrapping world (`hexDistance`), so sight crosses the world's edges
     the same way attacks do.
2. **Own cells.** It is one of P's own bases. **[suggested]**
3. **Alliance shared sight.** It is visible to any member of P's alliance under rules 1 and 2
   (members on the same world only). **[owner]** Only P's own alliance, not alliances it has marked
   friendly. **[owner]**
4. **Attackers.** It holds a base of a player who has ever attacked P. **[owner]**
   - "Attacked P" = any row in `bym.attack_logs` with `defender_userid = P` (written when an attack
     starts, `services/base/createAttackLog.ts`, called from `baseModeAttack.ts` and
     `infernoModeAttack.ts`; never pruned). Attacks on P's outposts count. **[suggested]**
   - Which cells: every base the attacker owns on P's world today (main yard and outposts), each as a
     single lit cell; the terrain around it stays dark. **[owner]**
   - Forever: it does not expire. Seeing an attacker does not put them in range; attacking still
     needs range. **[owner]**

Cells are hexes, so a cell is either in or out; there are no partly visible cells. Any softening at
the sight edge is drawing only (section 6). **[suggested]**

The rule goes into a new pure shared file, `web/src/game/maproom/rules/sight.ts`, synced to
`server/src/game-rules/maproom/` by `web/tools/sync-combat-rules.mjs` and listed in that folder's
`MANIFEST.json`, so the server's redaction and the client's fog edge can never disagree. It exports a
`SightSource = { x, y, reach }` list type and `isVisible(cell, sources, revealed)`. **[suggested]**

## 4. Where the data lives (facts)

| Input | Stored in |
|---|---|
| Main yard cell | `save.homebase` (`["x","y"]`) |
| Main yard flinger level | `save.flinger`, re-derived on save and catch-up (`services/yard/derivedLevels.ts`) |
| Outposts | `save.outposts` (`[x, y, baseid][]`); each outpost's level is `flinger` on its own save |
| Alliance | `user.alliance_id`; join/leave in `services/alliance/membership.ts` |
| Declare War | `alliance_powerup` rows (`active`, `end_time`), read by `runningPowerups` |
| Who attacked me | `bym.attack_logs` (`attacker_userid`, `defender_userid`, indexed on `(defender_userid, attacktime)`) |
| Bases on the map | `world_map_cell` (`world`, `x`, `y`, `uid`, `base_type` 2 = yard, 3 = outpost) |

## 5. Server enforcement

The fog is enforced on the server. The client is never sent anything about a hidden cell. **[owner]**

### 5.1 `POST /worldmapv2/getarea`

1. Load P's sight (section 9 cache).
2. If no sight source or revealed cell can touch the requested zone, answer at once with every cell
   as fog and skip all database work. **[suggested]**
3. Otherwise mark each of the zone's cells visible or hidden (coordinates wrapped to 0..799 before
   testing; the zone can run past the edge today).
4. Query `world_map_cell` as today, then drop rows on hidden cells **before** owners, online status,
   truces and invites are loaded, so nothing about them reaches the response or the logs.
5. Visible cells are built as today. Hidden cells are sent as `{ fog: 1 }` and nothing else (no `i`
   terrain height, no tribe, no owner). **[suggested]** A new `FogCell` joins `MapCell` in
   `web/src/api/types.ts`.
6. `alliancedata` is built only from the owners of visible cells (plus P's own alliance).
7. Every response carries `sv`, P's sight version (a short hash of the sight sources and revealed
   cells), so the client can tell when its sight changed. **[suggested]**

### 5.2 New `POST /worldmapv2/sight` **[suggested]**

Returns `{ sv, sources: [{ x, y, reach, kind: "own" | "ally" }], revealed: [{ x, y, uid }] }` for P.
Everything in it is already visible to P, so it leaks nothing. The client uses it to draw the fog
edge and the minimap without waiting for zones, and to skip zones that are entirely fog.

### 5.3 Other endpoints

| Endpoint | Today | With fog |
|---|---|---|
| `/base/load` view mode (`baseModeView.ts`) | any base id can be viewed | A Map Room 2 yard or outpost can be viewed only if its cell is visible to P. Own and alliance bases always pass. **[suggested]** |
| Attack, takeover quote, takeover, auto-attack | range-checked (`validateRange.ts`) | Unchanged: in range implies visible. **[owner]** (attacking still needs range) |
| `/worldmapv2/snapshot` (API key) | every base in a world | Switched off: this and any other bulk whole-world base feed for API consumers goes dark while fog is on. **[owner]** |
| `/worldmapv2/terrain` (API key) | whole terrain map, no bases | Unchanged: it carries no base data today, so it is not the "whole-world base data" the owner's shutoff covers. **[owner]** |
| `/worldmapv2/alliances` (API key) | alliances and member ids, no positions | Unchanged; it carries no locations. **[suggested]** |
| `/api/.../leaderboards` | names and outpost counts, no positions | Unchanged. **[suggested]** |
| Relocate (`/base/migrate`) | onto own outposts only | Unchanged. |

Bots live only in Map Room 1 (`docs/design/bot-neighbours.md`), so no bot feature reads the Map Room 2
map. **[suggested]** (fact)

## 6. Client drawing

- Fog cells draw as dark clouds; the outer ring of the sight edge gets a soft feather so the edge
  does not look like a hard hex staircase. Drawing only. **[owner]** dark/clouds, **[suggested]** feather.
- The client gets the sight from `/worldmapv2/sight` on entering the map, on Refresh, and whenever a
  getarea `sv` differs from what it holds. A new `sv` drops the cached zones (`ZoneStore`) and
  refetches the visible ones. **[suggested]**
- Zones entirely outside the sight are drawn as fog with no request. This also cuts getarea traffic
  well below the 120 a minute limit. **[suggested]**
- Zones inside the sight that have not loaded yet keep today's "not loaded yet" look, so fog never
  means "loading". **[suggested]**
- Clicking a fog cell: no hover card; the cell panel says "Covered in fog: outside your flingers'
  reach" with no actions except bookmarking. **[suggested]**
- If the selected cell turns to fog (sight shrank), the panel closes. **[suggested]**
- Revealed attacker bases draw as a lit single cell with the usual yard/outpost look. **[suggested]**
- The range overlay (`RangeOverlay.ts`, `RangeControl.ts`) stays: it shows what P can attack, which is
  smaller than what P can see once allies count. **[suggested]**

## 7. Navigation changes

- Remove the coordinate jump form from the Find panel (`NavPanel.ts`). **[owner]**
- Remove whole-world zoom-out: the "World" button (`NavPanel.ts`), the Fit / keyboard `0` action
  (`MapRoom2Scene.fitWorld`, `onZoomReset`) and its "The whole world" notice. **[owner]**
- No change to today's zoom range: `MIN_ZOOM` stays 0.0175 and the max is untouched. Only the World
  button / whole-world view controls above are removed; a player can still scroll or pinch all the
  way out, they just land on an ordinary (mostly fogged) view instead of the dedicated whole-world
  mode. **[owner]** The far raster level (`TerrainRaster.ts`) is still reachable this way and is not
  retired. **[suggested]**
- Keep: minimap click-to-jump, bookmarks (a bookmark out of sight just shows fog), Home, one button
  per own outpost, Refresh. **[owner]**
- Minimap: instead of "loaded zones", draw P's sight (own and alliance in two tints), dots for home,
  own outposts and revealed attackers; the rest dark. **[suggested]**
- Update the Find button's description (`FindControl.ts`), which still lists "a jump to coordinates"
  and "the world map". **[suggested]**

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Flinger reach 0 (no flinger, level 0) | Sees only own cells (rule 2). **[suggested]** |
| Flinger upgraded, outpost won, joined alliance, Declare War started | Sight grows on the next sight fetch; the map refetches when `sv` changes. **[suggested]** |
| Outpost lost, left alliance, Declare War ended | Those cells go dark again; no memory. **[owner]** |
| Attacker moves yard or loses outposts | Their bases show where they are now. **[suggested]** |
| Attacker leaves the world | Nothing to show. **[suggested]** |
| Ally on another world | Gives no sight on P's world. **[suggested]** |
| Sight across the world seam (x 799 to 0) | Visible, as range already wraps. **[suggested]** |
| Zone half in sight | Visible cells are real, the rest are `{ fog: 1 }`. **[suggested]** |
| Bookmark or minimap jump into fog | Camera goes there; everything shows fog. **[owner]** |
| End-of-attack / auto-attack return focus (`mapFocus.ts`) | Target was in range, so visible; after a takeover the sight grows and the map refetches. **[suggested]** |
| Player not on a world yet | `emptyAreaResponse` as today. |
| Testing | A server dev flag (in `devConfig`, off by default) turns fog off for local testing. **[suggested]** |

## 9. Performance and caching **[suggested]**

- Sight is a short list of sources (one per own base, plus allies' bases), not a cell set. The
  largest single source is reach 12 (469 cells). Testing a getarea zone's 121 cells against the few
  sources near it costs microseconds.
- Cache in Redis, per player: `sight:<uid>` = own sources + revealed attacker cells + `sv`; and per
  alliance: `sight:ally:<allianceId>` = members' own sources. TTL 30 seconds, and never past the end
  of a running Declare War.
- Clear the cache at the moments the player would notice: P's flinger level changes
  (`derivedLevels.ts` on save/catch-up), P wins or loses an outpost or moves (takeover, relocate,
  leave/join world), P joins or leaves an alliance (`membership.ts`; also clears that alliance's
  key), Declare War starts, a new attack log names P as defender. Changes on an ally ride on the
  30-second TTL.
- Building a cold entry: one query for P's save, one for outpost flinger levels, one for alliance
  members' saves on the same world, one `DISTINCT attacker_userid` on `attack_logs` (indexed), one
  `world_map_cell` lookup for those attackers' bases.
- Net effect on getarea: fully fogged zones become cheaper than today (no queries); partly visible
  zones cost the same as today plus the cache read.

## 10. Tests

- **Shared rule** (`sight.test.ts`, web; the server copy is covered by the existing `sync.test.ts`):
  main yard and outpost reach at each level, Declare War +2, reach 0 sees own cell only, wrap at the
  seam, alliance union, revealed cells.
- **Sight service** (server, DB test): attackers found from `attack_logs`, including outpost attacks;
  allies on another world ignored; cache cleared on alliance leave and on takeover; Declare War
  expiry respected.
- **getarea** (server): a hidden base's username, avatar and base id appear nowhere in the response
  JSON; hidden cells are exactly `{ fog: 1 }`; a fully fogged zone runs no `world_map_cell` query;
  `alliancedata` lists no alliance seen only on hidden cells; `sv` changes when sight changes.
- **View gate** (server): viewing a hidden Map Room 2 base is refused; own, ally and visible bases pass.
- **Client**: fully fogged zones are never requested; a new `sv` drops the cache; no World button,
  no coordinate form, `0` does nothing; zoom range unchanged from today; minimap draws the sight.
- **Live check** (playwright-cli, shared `bymr` session): two seeded accounts on one world, one
  outside the other's range: hidden until it attacks, then visible; join an alliance, see the ally's
  sight.

## 11. Work packages

Server first. Each is one GitHub issue, linked to this doc.

| WP | What | Depends on |
|---|---|---|
| WP1 | Shared sight rule and server sight service with cache (sections 3, 4, 9) | none |
| WP2 | Server enforcement: getarea redaction, `/worldmapv2/sight`, view gate, switch off API snapshot feed (section 5) | WP1 |
| WP3 | Client fog: drawing, sight fetch and `sv`, skip fogged zones, cell panel, minimap (sections 6, 7 minimap) | WP2 |
| WP4 | Navigation: remove coordinate jump and World / Fit; zoom range unchanged (section 7) | none (ship with WP3) |

## 12. Owner decisions (closed 2026-10-07)

All four open questions below were answered by the owner on 2026-10-07; nothing in this section is
still open.

1. **Outside map viewers.** `/worldmapv2/snapshot` hands any approved API key the position of every
   base in a world, for outside map websites. That shows the whole map and defeats the fog.
   **Decided: switched off** — this and any other bulk whole-world base feed for API consumers goes
   dark while fog is on (section 5.3). **[owner]**
2. **Attackers.** Show all of an attacker's bases (main yard and outposts), or only their main yard?
   **Decided: all of them**, each as one lit cell (section 3 rule 4). **[owner]**
3. **Friendly alliances.** Your alliance can mark other alliances friendly. Share sight with them too,
   or only within your own alliance? **Decided: own alliance only**, not friendly alliances (section 3
   rule 3). **[owner]**
4. **Zoom-out limit.** How far may the player pull back? **Decided: no change** to today's zoom range;
   only the World button / whole-world view controls are removed (section 7). **[owner]**

FYI, not a question: terrain and wild monster camps are generated from a seed by code anyone can
read, so a determined cheater could rebuild them. Players' bases are not derivable, and those are
what the server keeps secret.
