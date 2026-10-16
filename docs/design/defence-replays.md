# Defence replays (Map Room 2) — Design

Status: planning, 2026-10-16. Owner decisions of 2026-10-16 are final (§1, and §12 answered later
the same day). Points are marked **[owner]**
(decided), **[fact]** (checked in code on `revamp` db87084b) or **[suggested]** (our proposal, taken
unless the owner objects). Facts gathered in `agent-handoffs/reports/facts-defence-replays.md`.
Parent issue #357.

## 1. Owner decisions (verbatim)

1. Defence replays only for real-player attacks on your MAIN base on Map Room 2. Not MR1 (later
   version, same viewer; see #246 and docs/design/bot-neighbours.md decision 3), not outposts, not
   your own attacks.
2. Keep the last 20 replays per defender; older ones are deleted.
3. Viewer controls: speed 1x / 2x / 4x and Skip to end (shows the result). No pause, no revenge button.
4. Opened from a NEW 'Defences' log screen: the last 20 attacks on you, with attacker name, time,
   damage %, loot lost, and a Watch button. Also add an "X attacked your base" message for MR2 main
   yards (MR1 already has these; match their style). It should also show in "While you were away".
5. Replays recorded under older battle rules: store a rules/engine version with each replay; if it
   no longer matches, hide Watch and show "Replay not available after a game update".

Reuse what exists: the deterministic engine and `AttackSession.playScript` used by the MR2
auto-attack Watch.

## 2. In one paragraph

When another player's attack on your Map Room 2 main yard lands, the server keeps one record of it:
who, when, the damage it did, the loot you lost, and (compressed) everything needed to play the
battle again: the yard as the battle found it, the attacker's drops, the seed, both sides' levels and
the rules version. The newest 20 per defender are kept. You get the same "X attacked your yard"
notice MR1 players get. A new Defences screen lists the 20 with a Watch button; Watch opens the attack
scene in playback (as auto-attack's Watch does) with 1x/2x/4x and Skip to end, and nothing on that
screen talks to the server.

## 3. What is stored, and where

**Today [fact]:** `attack_logs` gets one row at attack START (no outcome, never updated). The replay
inputs live only while the attack runs: the attack session and checkpoint in Redis
(`attack-session:` / `attack-checkpoint:<basesaveid>`), deleted at landing (`discardCheckpoint`).
The server fights the battle from an `AbandonedInput` (`battleReplayInput`, `combat/battle.ts:76`)
built from the defender's row at landing, the session's frozen facts and the attacker's row.

**New table `bym.defence_replay` [suggested]** (one row per landed attack, Postgres, on the game
server's DB):

| Column | Meaning |
|---|---|
| `id` bigserial PK | |
| `defender_userid`, `baseid` | the defender and their main yard |
| `map_version` smallint | 2 now; 1 when #246 turns MR1 on |
| `attacker_userid`, `attacker_username`, `attacker_pic_square` | frozen at landing, as `attack_logs` |
| `attacked_at`, `landed_at` timestamptz | session start; when it landed (the list sorts by this) |
| `damage_before`, `damage_after` int | the yard's whole % damage before and after; the screens show `after - before`, the damage THIS attack did [owner, §12.5] |
| `loot` jsonb | what the defender lost (`defenderDelta`) |
| `housed_lost` int | housed monsters lost (`lostCount(housingLoss)`) |
| `left` boolean | the attacker left / tab closed (finaliser landing) |
| `rules_version` varchar(32) | see §4 |
| `replay` bytea NULL | gzip of the payload below; NULL when inputs were missing (§9) |
| `replay_bytes` int | size, for monitoring |

Index `(defender_userid, landed_at DESC)`.

**Payload (gzip JSON, `v: 1`):** `load` (the attack load as served to the attacker, allow-listed to
the fields the attack scene's load parser reads, e.g. buildingdata, buildinghealthdata, resources,
defenderforces, the caged champion, cellheight, attpowerups, attackerlevel, attackeracademy,
attackerranks, attackerbrains; WP2 lists them exactly; never credits, chat, store, quest or
notification fields), with `buildingdata` and
`buildinghealthdata` REPLACED by the ones the server fought (`AbandonedInput.defender`), so the yard
is exactly the battle's even if something moved between load and landing; `seed`, `events` (the
fightable log, `LandedAttack.fought`), `tick`, attacker `levels`/`ranks`, attacker `champion` + brains
and `siege` as fought, `declareWar`, `report` (the attack report text).

**Size [fact + estimate]:** a full yard load is ~54 KB raw, 8.5 KB gzipped (measured on
`web/test/fixtures/baseload-sandbox-yard.json`); a fling log is at most 500 small events (a golden
fixture: 3.3 KB raw, 1 KB gzipped). So ~10-15 KB per replay, ≤ 300 KB per defender at 20, ~300 MB
for 1,000 defenders all at the cap (upper bound). Uncompressed would be ~6x that, so gzip.

**Pruning to 20 [owner]:** in the same transaction as the insert, delete that defender's rows beyond
the newest 20 (`ORDER BY landed_at DESC, id DESC OFFSET 20`). Attacks on one base cannot overlap, so
no race. No time-based retention needed.

**Migration [suggested]:** `CreateDefenceReplayTable` (create table + index, `IF NOT EXISTS`), entity
registered in `mikro-orm.config.ts`. No backfill: older attacks have no inputs left.

**Account deletion [suggested]** (`services/privacy/deleteAccount.ts`): a deleted defender's rows are
deleted; a deleted attacker's rows keep the replay with the name replaced by `DELETED_PLAYER_NAME`
and pic cleared, as `attack_logs` does today. New Redis key added to `accountRedisKeys.ts`.

## 4. Rules version

- `rules_version` = first 16 hex of a SHA-256 over the combat rules `MANIFEST.json` file hashes.
  `web/tools/sync-combat-rules.mjs` writes it into MANIFEST.json as `version`, so the web bundle and
  the server read the same string with no runtime hashing. [suggested]
- A `REPLAY_FORMAT = 1` constant lives in `rules/replay.ts`; bumping it (when playback or the
  load-to-battle conversion OUTSIDE the rules folder changes) changes the hash, so old replays hide.
- **The client decides** whether Watch is offered, comparing the row's version with its OWN bundled
  version: it is the client's engine that will play it, and web (Vercel) and server can deploy at
  different moments. The server also sends `playable` from its own version, for a client that has
  not reloaded since a server update; Watch needs both.
- Trade-off: any edit to any rules file, even one that does not change behaviour, hides all older
  replays. Owner: OK (§12.4).

## 5. Recording: how the attacker's final save feeds it

1. **At attack load** (`baseLoad.ts`, attack branch) when the target is an MR2 main yard
   (`type MAIN`, defender save `mapversion` 2) of another account: keep the allow-listed load in
   Redis `defence-replay-load:<basesaveid>`, same TTL as the checkpoint (7 days), discarded with it.
2. **At landing**, one helper `recordDefenceReplay(em, { yard, attacker, input, landed, notice })`
   is called from both landing points, next to `afterYardDefended`:
   - the attacker's final save (`controllers/base/save/baseSave.ts`, after the flush, where
     `recordAttackPlan` runs: `battleInput` + `battle` + `defenderDelta` + `housingLoss`);
   - the finaliser (`services/base/finaliseAttack.ts` `finaliseLocked`, around line 333: tab closed,
     timeout, server restart; `left: true`).
3. Gate: `saveData.over` (or a finaliser landing), yard is MAIN on MR2, `yard.saveuserid !==
   attacker.userid`, the session carries a roster (a server-fought battle). It never checks whether
   either side is a bot (§9).
4. It never fails the landing: any error is logged (`defence-replay-failed`) and the attack lands.
5. Inserted after the landing's flush, so a replay exists only for an attack that really landed.

## 6. API [suggested]

- `GET /api/:v/defences` → `{ defences: [{ id, attacker: { name, pic }, attackedAt, landedAt,
  damageDone, damageAfter, loot, housedLost, left, rulesVersion, hasReplay, playable }] }`: the caller's newest 20,
  MR2 main yard only. Small (no payload), no cache needed.
- `GET /api/:v/defences/:id/replay` → the unzipped payload + `rulesVersion` + the stored result
  figures. 404 unless `defender_userid` is the caller (never another player's), 410 when
  `replay` is NULL. Both behind `verifyUserAuth` + `verifyAccountStatus` and a limiter like
  `autoAttackPlanLimiter`.
- The unused `GET /api/:v/attacklogs` is left alone.

## 7. Viewer: the attack scene in read-only playback

- Reuse the watch scene (`AttackScene` `watch` option + `WATCH_PLUGINS`): only the battle layer and
  a watch plugin mount; no save, checkpoint, drop or army controls, so nothing reaches the server.
- Generalise `game/autoAttack/watchRun.ts` into a watch source with two kinds, auto-attack and
  defence. `watchTarget` for a defence builds the roster from the payload: monsters `flungOf(events)`,
  `levels`, `ranks`, the attacker's champion and brains, and `siege` (auto-attack's has none).
  `session.playScript(events, tick)` as today.
- **Speed:** `AttackSpeed` gains `4`, offered only in playback; the live attack HUD keeps 1x/2x
  (attack-flow decision). Check the per-frame tick catch-up still keeps up at 4x.
- **Skip to end:** new `AttackSession.skipToEnd()`: runs the remaining ticks to `scriptEnd` without
  drawing, in slices per frame so the page never freezes, then shows the final yard and the result.
- **Dock:** "Defence replay: <attacker>", the time, 1x / 2x / 4x, Skip to end. No pause, no Retreat,
  no revenge button [owner].
- **Result panel:** the STORED figures: "<attacker> attacked your yard and did 35% damage. 1,234
  Twigs were looted." (housed monsters lost added as the notice words them), plus "They left the
  attack" when `left`. Buttons: Watch again, Back (to the Defences screen).
- **Drift check:** at the end, if the engine's damage differs from the stored damage, log it
  (`defence-replay-drift`, console + client telemetry if any); the panel still shows the stored result.

## 8. Defences screen and the message

**Defences screen [owner decision 4, look suggested]:** a modal in the style of `MailboxScreen`.
One row per attack, newest first: attacker avatar + name, time ("3 h ago", full date on hover),
damage this attack did ("35%"), loot lost (resource icons), housed monsters lost if any, and **Watch**. When the version no
longer matches: Watch hidden, grey text "Replay not available after a game update" [owner]. When
`hasReplay` is false: "Replay not available". Empty: "Nobody has attacked your yard yet." Only shown
to MR2 players until #246. Opened from a **Defences button next to Mail on the yard screen**, and
from a link on the attack notice [owner, §12.1].

**Message [owner decision 4]:** `afterYardDefended` (`services/base/afterYardDefended.ts:48`) today
returns unless the yard is on MR1. Widen it so a REAL defender's MR2 main yard also gets
`noticeYardAttack`, the very same words and kind (`YARD_ATTACKED`: "X attacked your yard", "It was
left 63% damaged, and ... were looted."). Bot jobs (repair, revenge) stay MR1 only. "While you were
away" then shows it with no client change (`JobNotices.ts` already knows `yardAttacked`); WP4 checks
it on an MR2 own-yard load. Wording stays "attacked your yard" [owner, §12.2]; the notice's body
is left exactly as MR1's (it would change MR1's too); only the Defences screen and the result panel
show the damage this attack did.

**Watch on the notice [owner, §12.3]:** the landing records the replay FIRST and hands its id to
`noticeYardAttack`; the message gets a nullable `replayid` column (migration in WP1), the mail API
returns it, and the mailbox shows **Watch** (opens that replay, same version check as the list) and
**Defences** (opens the screen) on that notice. No Watch when `replayid` is null.

## 9. Edge cases

| Case | What happens |
|---|---|
| Attacker closes the tab / never finishes | The finaliser lands it from the last checkpoint; the replay ends at that tick, `left` set, panel says they left. [fact: finaliser path] |
| Attack loaded, nothing flung, no checkpoint | Finaliser has nothing to land: no row, no notice, no log entry. [suggested] |
| Server restart mid-attack | Checkpoint and `defence-replay-load:` key are in Redis; the finaliser lands it after restart and records it. If Redis lost the load key but not the checkpoint, the row is written with `replay` NULL ("Replay not available"). |
| Save replay times out (5 s worker) | Nothing written; the finaliser lands it later and records then. |
| Attacker deleted | Row kept, name "Deleted player", replay still watchable. |
| Defender deleted | Their rows deleted. |
| Defender's yard changed since | Irrelevant: the payload carries the yard as fought. |
| Rules changed since | Version mismatch: Watch hidden, "Replay not available after a game update". |
| Web and server on different versions | Client checks its own version (§4). |
| Defender moved to MR1 / another world later | Rows stay listed (they were MR2 defences); viewer needs only the payload. |
| Outposts, own attacks, camps, raids, Trojan, Inferno | Not recorded (gate in §5). |
| Hidden bots never revealed | Recording, list, API and viewer never ask `isBot` and carry no bot field; a bot attacker (e.g. a revenge on a player who later moved to MR2) is recorded like anyone. Only bot JOBS stay MR1-gated. When #246 turns MR1 on, it must record EVERY MR1 main-yard defence (bot-neighbours decisions 3, 21), and bot revenge's load path (`revengeRun.ts`) must keep the load key too. |
| Defender online during an attack | Cannot happen: attacks are refused while the defender is online [fact]. |

## 10. Test plan

- **Server unit/DB:** insert + prune keeps exactly the newest 20; gate (MR2 main yes; MR1, outpost,
  own, camp, Inferno no); payload round-trips through gzip; yard blobs are the fought ones; account
  deletion (defender rows gone, attacker name replaced); recording failure does not fail the landing.
- **Landing paths:** a full attack save records once; a finaliser landing records once with `left`;
  a save that times out records only when the finaliser lands it; nothing recorded twice.
- **Determinism (key test):** record a real attack in a DB test, then replay the stored payload with
  `replayAttack` (server) AND the web engine via `AttackSession.playScript` (Vitest): both reach the
  stored damage and building health.
- **Version guard:** a golden defence-replay fixture with its `rules_version`; a test fails if the
  fixture's outcome changes while the version did not (catches a missed `REPLAY_FORMAT` bump).
- **API:** list shape; other player's id 404; NULL payload 410; MR1 player gets an empty list.
- **Client:** 4x speed only in playback; Skip to end reaches the same final state as playing through;
  Watch hidden on version mismatch; result panel shows stored figures; Defences list states.
- **Notice:** MR2 main-yard defence writes `YARD_ATTACKED`, shows in mailbox and once in "While you
  were away"; bot jobs not booked on MR2; the notice carries the replay id and its Watch opens that
  replay; damage shown is `after - before`.
- **Live browser check** (one headless `bymr` session, two seeded MR2 accounts): attack B's main yard
  from A, close the tab mid-attack once, then log in as B: notice, Defences list, Watch at 1x/2x/4x,
  Skip to end, result matches.

## 11. Work packages

| WP | Issue | What | Depends on | Size |
|---|---|---|---|---|
| WP1 | #358 | Server storage: rules version in MANIFEST (sync tool) + `REPLAY_FORMAT`; migration + entity `defence_replay` (damage before/after) + `message.replayid`; gzip payload helpers; insert + prune to 20; account deletion; unit/DB tests | none | M |
| WP2 | #359 | Server recording: load key at attack load; `recordDefenceReplay` from save and finaliser (damage before/after; replay id to the notice); gate; never fails landing; Redis key in account keys; landing-path + determinism tests | WP1 | M |
| WP3 | #360 | Server API: `GET defences`, `GET defences/:id/replay`, limiter, ownership, tests | WP1 | S |
| WP4 | #361 | MR2 "attacked your yard" notice (widen `afterYardDefended`, bot jobs stay MR1) + "While you were away" check; mail API returns `replayid` | WP1 (column) | S |
| WP5 | #362 | Client viewer: defence watch source, roster with champion/siege, 4x playback speed, `skipToEnd`, defence dock + result panel (stored figures), version check, drift log | WP1 (version field); API mocked until WP3 | M |
| WP6 | #363 | Client Defences screen + API client + button next to Mail; Watch and Defences buttons on the mailbox notice; Watch into the viewer, "not available" states | WP3, WP4, WP5 | M |
| WP7 | #364 | Golden defence-replay fixture + version guard test; end-to-end live browser check (§10) | WP2, WP4, WP6 | S |

WP1 starts first; WP3, WP4 and WP5 in parallel after it (WP4's notice change itself needs nothing).

## 12. Owner decisions on the open questions (2026-10-16, final)

1. **Entry point:** a Defences button next to Mail on the yard screen, plus a link from the attack
   notice.
2. **Wording:** "attacked your yard", the same as MR1.
3. **Watch on the notice:** yes, the notice gets its own Watch button (§8).
4. **Version strictness:** strict hiding is OK: any battle-code update hides older replays.
5. **Damage figure:** show the damage THIS attack did ("did 35% damage"), not the % the yard was
   left at; WP1 stores the damage before and after (§3).
