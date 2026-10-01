# Auto-Attack for Wild Monster Camps — Design Proposal

A design document for issue #221. The owner's request, word for word:

> Auto attack feature for wild monster tribe camps. Players find it a hassle attacking the same yard
> with the same monsters, a waste of time, to conquer outposts.

All citations are `path:line` or `path` relative to the repository root. Claims about current
behaviour cite the server, the web client or the Flash client (`client/scripts`); anything new is
marked as a proposal. Numbers that have not been playtested are marked `[PLACEHOLDER]`.

Contents:

1. [The problem](#1-the-problem)
2. [What already exists](#2-what-already-exists)
3. [Who it is for: wild camps only, never players](#3-who-it-is-for-wild-camps-only-never-players)
4. [Options](#4-options)
5. [Rules common to every option](#5-rules-common-to-every-option)
6. [Server and anti-cheat](#6-server-and-anti-cheat)
7. [UI](#7-ui)
8. [Recommendation, build order and work packages](#8-recommendation-build-order-and-work-packages)
9. [Open questions for the owner](#9-open-questions-for-the-owner)

---

## 1. The problem

To take a Map Room 2 wild monster camp over as an outpost, the camp has to be at 90% damage or more
(`TAKEOVER_DAMAGE`, `server/src/services/maproom/v2/takeoverRules.ts`). A big camp rarely falls to
one attack, so a player attacks the same camp several times in a row. Each attack is a full manual
attack: open the camp from the map, pick the same army, fling at the same spots, then watch for up
to five minutes. The player makes no new decision after the first attack. They are repeating input
to get to the decision they care about, which is taking the camp over.

**Player fantasy.** "I've cracked this camp. Now send my army in again and tell me how it went."

**The decision we keep.** The first attack on a camp layout is still played by hand: choosing the
army and where to drop it is the skill. Auto-attack removes only the repeats.

**Flash had no auto-attack.** A search of `client/scripts` for `autoattack`, `auto_attack`,
`attackagain`, `repeatattack` and "again" in the end-of-attack popup (`popup_attackend_CLIP.as`)
finds nothing. The Flash end popup offers only the takeover (`popup_attackend.as:82-98`). This is a
new feature, so no Flash behaviour has to be matched.

## 2. What already exists

Most of the server half is already built, because of two earlier pieces of work.

**The server decides every battle (#23).** The save that ends an attack replays the client's fling
log in the shared deterministic engine (`server/src/game-rules/combat/replay.ts`, a synced copy of
`web/src/game/combat/rules/replay.ts`). It writes the health map, damage, `destroyed`, the loot, the
fired traps and the bunker garrisons from that run, and never the client's copies
(`docs/design/server-combat.md` §2.8).

**The server can already finish an attack with no client (#138).**
`server/src/services/base/finaliseAttack.ts` (`finaliseLocked`, lines 119-324) takes a stored
checkpoint (the fling log, the tick and the source cells), replays it in a worker
(`replayAbandonedInWorker`, 20 s deadline) and lands the result exactly as a save would. It spends
the flung monsters from the attacker's cells (`spendFlung`), charges bombs, banks loot up to the
storage cap (`bankAttackLoot`, #166), and writes the camp's damage, fired traps, garrisons and
report. It also restarts the camp's 12-hour clock (`savetime = now`), grants protection or a
takeover where the rules say so, clears `attackid` and ends the session. **An auto-attack is the
same operation, with a fling log that the server supplies instead of one the client left behind.**

**Loot is capped by the replay (#163, #166).** `attackLootOf` and `fightableLog`
(`server/src/services/base/combat/attackLoot.ts:179`) clamp a log to what the attacker actually held
at attack start. That covers each monster id (at most `entryHoused`), each champion (one they own,
once, at no more than its level and power level) and each bomb (one their catapult unlocks and they
can pay for). A replayed plan therefore can never fling more than the player has.

**Camps are fixed layouts.** A Map Room 2 camp's tribe and level are pure functions of its
coordinates. Its yard is one fixture per tribe and level bucket (`tribeSaveV2.ts`,
`docs/specs/maproom2.md` "Wild monster camp rules"). Damage persists on the camp's row until it
regenerates, 12 hours after its last save (`wildMonsterExpiry.ts`). Between attacks, a camp changes
only by the damage done to it. This is what makes repeating a plan meaningful for camps and not for
players (section 3).

**What does not exist yet:**

- **No stored plan.** The fling log lives in Redis only while the attack runs (the checkpoint), and
  is discarded when the attack lands (`discardCheckpoint`). Nothing keeps it after that.
- **No attack log for camps.** `createAttackLog` runs only for non-tribe targets
  (`baseModeAttack.ts:283-291`), so camp attacks never reach `attack_logs`. Its `loot` and
  `attackreport` columns are written as `{}` and never filled (`createAttackLog.ts:31-32`).
- **No global cap on replay workers.** `replayRunner.ts:61` starts one `Worker` per replay.

## 3. Who it is for: wild camps only, never players

**Allowed against:**

- Map Room 2 wild monster camps (`type === "tribe"`, `wmid` set, attacker on Map Room 2).
- Map Room 1 tribes, as a follow-up (section 8, WP10). They need their own landing path, because
  Map Room 1 tribe attacks have no checkpoint and no finaliser (`server-combat.md` §2.8, C4).

**Never against:** player main yards, player outposts, Map Room 3 structures, or the Inferno. The
server refuses these, not just the UI, for these reasons:

1. **A plan only means something against a target that stays the same.** A camp's layout is fixed
   by its coordinates, so "the same attack again" is a well-defined thing. A player's yard changes
   between attacks: the layout moves, the bunkers refill, the champion heals, towers get upgraded.
   A replayed plan there is a blind attack, not a repeat.
2. **The defender gets no counterplay.** Player-versus-player is where the game's skill and social
   tension live. One-tap repeated attacks would let an attacker farm a player's yard at machine
   speed, and the defender could not respond with anything but protection.
3. **The player-versus-player rules assume a live attacker.** The online check
   (`userOnlineErr`), truces (#203), damage protection, outpost attack notices (#187) and the
   one-chance takeover grant for player outposts (#182) were all designed around one attacker
   playing one attack. A takeover grant that a macro can earn on demand stops being a "single
   opportunity".
4. **It is the owner's scope.** The request names wild monster tribe camps.

## 4. Options

Each option shows the player flow, the server work and the effort (S < 2 days, M < 1 week, L more).

### (a) Repeat last attack

**Player flow.** The player attacks a camp by hand once. After that, the camp's panel on the map
offers **Repeat attack**, with a one-line summary of the plan ("300 Pokey, 40 Bolt, Krallen · 3
drops"). One tap opens a confirmation: the monsters the plan needs against what the player has in
range, and **Attack now**. The server resolves the battle at once and the result panel opens. That
is two taps per repeat, instead of a full attack.

**Server work.**

- Keep the last *landed* fling log for each attacker (the log the replay actually fought, after
  `fightableLog`). It is recorded from both the save and the finaliser.
- Add one endpoint that mints an attack session and builds a checkpoint from the plan, with a fresh
  seed and the full tick span. It then runs the finaliser's landing on it at once.
- The finaliser's write half becomes a shared `landAttack()` function, so a manual attack and an
  auto-attack land through the same code.

**Camp changed since the last attack.** The layout is the same, but damage has been done, so the
plan meets a different battle. Creeps target the nearest standing building, so after the buildings
near the drop points have fallen, the same drops walk further and spend longer under tower fire.
Measured on real camp layouts (section 6.3), repeating one 300-Pokey drop on the top Kozu camp
gave **15.9% → 25.3% → 28.5%** damage over three attacks: each repeat added less. A repeat is
therefore not guaranteed to finish a camp, and the result panel has to show the damage gained so
the player can see when the plan has stopped working (section 7.3). Other ways the camp can change:

| Change | What happens |
| --- | --- |
| Camp regenerated (12 h) | The plan fights a fresh camp, like the first attack did. |
| Camp taken over by anyone | It is now an outpost, which is player-owned. Refused. |
| Camp under attack by someone else | Refused, as a manual attack is (`baseUnderAttackErr`). |
| Camp layout data changed (game update) | The plan is keyed by a layout hash (section 5.1). A different hash marks the plan stale: "Attack once by hand to record a new plan." |
| Player has fewer monsters than the plan | `fightableLog` flings what they have, earliest drops first. The confirmation shows the shortfall first (section 9, Q5). |

**Effort: M.** Server M (plan store S, the endpoint and the `landAttack` extraction M), client M.

### (b) Auto-resolve

**Player flow.** The player picks an army (or "everything in range") and taps **Auto-attack**. The
server chooses the drops with a simple deterministic strategy. For example: split the army into
`k` drops, placed at the yard edge nearest the largest clusters of standing buildings, one every
`n` seconds.

**Server work.** All of (a)'s, plus a drop planner in the shared rules: candidate drop points, a
scoring function, and tuning against every tribe and level bucket. To keep it honest it also needs
a test harness that runs the planner against each layout.

**Risks.**

- A weak planner feels bad: "the AI wasted my army".
- A strong one makes manual play pointless and becomes the only way anyone attacks a camp.
- Either way it needs balance work per tribe and layout, and it removes the one real decision (where
  to drop) instead of reusing it.

**Effort: L.**

### (c) Saved plans

**Player flow.** After any attack the player taps **Save as plan** and names it ("Kozu 35 north
rush"). Plans are listed per tribe and layout. The camp panel offers a plan picker: choose a plan,
confirm, and it runs as in (a).

**Server work.** All of (a)'s, plus CRUD for named plans and a cap per player. A plan written by the
client would need the full log validation a save gets (positions in the yard, event count ≤ 500,
`t` ≤ the last tick, the per-fling bucket cap). Plans the server recorded itself need none of that.

**Effort: M on top of (a)** with "save the attack you just did". **L** if it includes a plan editor
(dragging drop points on a camp map).

**Relationship.** (a) is (c) with one plan per layout, called "Last attack", recorded
automatically. Building (a) first means (c) is a later extension and not a rewrite.

### Add-ons (each works with any option)

- **Watch at high speed.** The server's response carries the seed, the fought log, the camp's
  health before the attack and the defence it fought (`defenderForces`). The engine is
  deterministic and shared, so the web client can play the identical battle in the attack scene in
  a watch-only mode at 4x or 8x, and finish on the same digest. The server's result is the one that
  counts, and the playback is only a picture of it. **Effort: M** (the attack scene already has 1x
  and 2x, so this needs an input-free mode and a digest check).
- **Attack until destroyed.** A bounded series of repeats in one request while the player watches
  the summary: see section 5.4. **Effort: S-M on top of (a).**

## 5. Rules common to every option

### 5.1 What a plan is

A plan is the **fightable log the server landed**: drops (time, position, radius, monsters,
champion) in order. Proposed defaults:

- **Bombs and siege weapons are removed.** They spend resources and stock beyond "the same
  monsters", which is all the owner asked for (Q4).
- **Retreat events are removed.** A retreat was a decision made during that particular battle. A
  repeat runs to the battle's natural end: everything flung is dead, the camp is destroyed, or the
  attack's longest end (`ATTACK_MAX_SECONDS` = 540 s,
  `web/src/game/combat/rules/stats.ts:89`) is reached.
- **The seed is never reused.** Every auto-attack gets a fresh server seed from its new session.
- **Keyed by attacker and layout.** The layout key is a hash of the camp's fixture `buildingdata`
  positions and types. Every camp of the same tribe and level bucket shares one layout, so a plan
  recorded on one Kozu 35 camp also works on the next. A plan for this exact camp is preferred
  when one exists (Q2).
- **Stored in Postgres.** Plans should survive restarts, so they go in a new `attack_plan` table
  (`userid`, `layout_key`, `baseid`, `log jsonb`, `sources`, `recorded_at`), one row per attacker
  and layout, upserted on every landed camp attack. A plan is a few KB at most: the log is capped
  at 500 events (`MAX_CHECKPOINT_EVENTS`).

### 5.2 Costs

- **Monsters are spent as in a manual attack.** Everything flung leaves its source cell for good
  (`spendFlung`). The champion's health and the siege stock land as the save lands them.
- **No fee and no per-camp cooldown** `[PLACEHOLDER]`. The army already is the cost: monsters have
  to be hatched and housed again before the next repeat, and that is the natural cooldown. A fee
  would tax exactly the players the feature is for. The levers are listed in case playtests show
  camps falling too fast:

| Lever | Default | Range | Why it exists |
| --- | --- | --- | --- |
| Per-user auto-attacks per minute | 10 `[PLACEHOLDER]` | 4-20 | Server CPU (section 6.3), not balance |
| Auto-attacks in flight per user | 1 | 1 | One battle at a time, as by hand |
| Fee per auto-attack | 0 `[PLACEHOLDER]` | 0 to 5% of the camp's loot | Only if camps fall too fast in playtests |
| "Until destroyed" attacks per request | 5 `[PLACEHOLDER]` | 3-10 | Bounds unattended spending |
| Stall threshold for "until destroyed" | +2% damage `[PLACEHOLDER]` | 1-5% | Stops a plan that has stopped working |

- **The attacker's own damage protection ends**, as it does for a manual attack on a camp
  (`damageProtection(userSave, ATTACK)`, `baseModeAttack.ts:174-176`;
  `damageProtection.ts:42-48`). The confirmation says so when the player has protection (Q10).

### 5.3 What persists

Everything persists exactly as for a manual attack, because both go through the same landing code:

- **Attacker:** monsters spent from each source cell, the champion's health after the attack,
  loot banked up to the storage cap.
- **Camp:** `buildinghealthdata`, `damage` (stored whole, #72), `destroyed`, fired traps removed,
  bunker garrisons, the camp's pool reduced by the defender delta (so loot dwindles over repeats,
  as it does by hand), and `attackreport`.
- **The camp's 12-hour regeneration clock restarts** (`savetime = now`), as with every attack.
- **Takeover:** a camp at 90% or more is open to anyone in range until it regenerates, by Flash's
  rule (`takeoverRules.ts`). Auto-attack does not change this. In particular, it never takes a camp
  over by itself: the takeover always costs resources or Shiny and is always the player's own tap.

### 5.4 "Attack until destroyed", and why there is no offline queue

**No offline queue.** A queue that keeps attacking while the player is away invites these abuses:

| Risk | Why it matters |
| --- | --- |
| Botting and farming while asleep | Map Room 1 tribes respawn 10 minutes after they fall (`MR1_TRIBE_RESPAWN_SECONDS`): a queue could farm them 144 times a day. |
| Camp hoarding | Knock down every camp in range overnight, then snipe the takeovers at breakfast. Other players in range lose those camps without ever seeing them stand. |
| Denial | A camp being attacked is refused to everyone else (`isAttackActive`). A queue could keep a contested camp permanently "under attack". |
| Unattended spending | One bad plan empties every yard in range with nobody watching. |
| Server load | A scheduler fires in bursts, unlike players, who spread their attacks out. |

**Proposed instead (v1.1): Attack until destroyed**, run online, in one request, with hard limits:

- At most 5 repeats per tap `[PLACEHOLDER]`.
- Stops as soon as any of these happens:
  - The camp reaches 90%.
  - The plan has nothing left to fling.
  - A repeat adds less than the stall threshold.
  - The camp becomes unavailable (taken over, or attacked by someone else).
- Each repeat is its own attack session and its own landing, so the series can stop safely between
  any two.
- The result panel lists each attack's damage, loot and losses.
- The player starts every series and sees the result. Nothing runs while they are away.

## 6. Server and anti-cheat

### 6.1 Nothing is trusted from the client

The request is `POST /worldmapv2/autoattack { baseid, plan: "last" }` (proposed). The client sends
only which camp to attack and which plan to use. It never sends a log, a result, a seed or a roster.
The server derives everything, in this order:

1. **Authenticate**, apply the rate limiter (the existing `middleware/rateLimiters.ts` pattern), and
   take a per-user lock (`SET NX auto-attack:<userid>`). A second tap while one is running is
   refused.
2. **Check the target with the manual attack's own rules.** Factor them out of `baseModeAttack.ts`
   so they cannot drift apart:
   - same world;
   - a camp (`type === "tribe"` and `wmid` set) on the attacker's Map Room 2. Anything else is
     refused with `autoAttackNotACamp`;
   - not under attack (`isAttackActive`);
   - in flinger range (`validateRange`).

   A regenerated camp is renewed first, the way the view path renews it. A camp seen for the first
   time gets its row lazily (`tribeSaveHandler`).
3. **Catch up the attacker's armies** (`catchUpArmiesForAttack`), which gives `entryHoused` for the
   cells in range. Load the plan and clamp it with `fightableLog` against `entryHoused` and the
   attacker's champions. If nothing is left to fling, refuse with `autoAttackNoMonsters` before
   anything is written.
4. **Mint the attack** as the load does: `attackid` on the camp's row, then flush (the camp now
   reads "under attack" to everyone else). Start the attack session with the same facts a manual
   attack records (`newAttackSession`: `entryHoused`, the camp's pool, `attackerlevel`, the
   attacker's pool, `defenderForces`) and a fresh seed. Drop the attacker's protection.
5. **Write a checkpoint** from the plan: the new seed, `tick` set to the plan's last event plus the
   full tail (capped at `MAX_CHECKPOINT_TICK`), and `sources` in the army panel's default order
   (Q11).
6. **Land it at once**, through `finaliseAbandonedAttack(basesaveid, "auto-attack")`. That
   function already takes the final lock, replays in a worker, lands the result, clears `attackid`,
   ends the session and discards the checkpoint. Two small changes are needed:
   - a flag that leaves out the "Left the attack" report line;
   - returning the landed outcome, not just `"finalised"`, so the endpoint can answer with it.

   (The recommended refactor is to extract `landAttack()` from `finaliseLocked`, so that the
   finaliser and auto-attack each call it.)
7. **Record the plan again** (the newly landed log), write the log event, and respond (section 6.4).

**Failure leaves nothing spent.** If the replay misses its deadline, or the server restarts during
step 6, nothing has landed yet: the monsters are still in their cells. A timeout clears `attackid`
and answers `503 autoAttackBusy`. A crash leaves the checkpoint, which the finaliser's sweep lands
within a minute (`FINALISE_SWEEP_MS`), so the attack is never lost and never landed twice. This is
the same exactly-once guarantee a manual attack has.

**No outcome oracle.** There is no preview. A preview with the real seed would let a player look at
the result and only commit to good rolls, and a preview with a different seed is a free simulator
for planning against camps. Monsters are spent on every attack, so retrying costs as much as a
manual attack. The Wild Monster Baiter stays the simulator for the player's own yard.

### 6.2 Attack session, finaliser and logs

| Piece | Manual camp attack | Auto-attack |
| --- | --- | --- |
| Attack session (`attackSession.ts`) | Minted by the attack-mode load, lives up to 7 min | Minted by the endpoint, lives for the ~1 s of the request |
| Checkpoint (`attackCheckpoint.ts`) | Written by the client every few seconds | Written once by the server, from the plan |
| Landing | `baseSave.ts` (the client's final save) or `finaliseAttack.ts` | `finaliseAttack.ts` (or the extracted `landAttack()`) |
| Final lock (`acquireFinalLock`) | Exactly once | Exactly once, through the same lock |
| Camp's `attackreport` | Built by `rules/report.ts` from the replay | The same, with an "Auto-attack" line in place of "Left the attack" |
| `attack_logs` row | None for camps (section 2) | None, the same as today |
| Server log | `attack-finalised` | `auto-attack`, with the same fields plus `planKey`, `seed` and `damageBefore` |

`attack_logs` is left alone. It has no camp rows today, and filling it in properly (the loot and
report it never receives) is a separate fix. The `auto-attack` log line together with the plan
table is enough to audit and reproduce any auto-attack: same layout, same log, same seed, same
result.

### 6.3 Cost per attack: measured

Measured on Bun 1.4.2, on this development machine while other agents' test suites were running,
so the real numbers are lower.

`bun tools/bench-combat.mjs --all -n 3` (from `web/`), against the 575-building sandbox **player**
yard:

| Scenario | Median | Worst |
| --- | --- | --- |
| pokey-rush (300 Pokeys) | 976 ms | 1286 ms |
| mixed-waves (bench case) | 1108 ms | 1263 ms |
| outpost-core | 214 ms | 279 ms |
| maze | 317 ms | 365 ms |
| champion-and-bunkers | 550 ms | 763 ms |
| burrow-rush | 52 ms | 54 ms |

A scratch run of the same logs against **real camp layouts** (`replayAttack` with `kind: "wild"`,
each attack against the damage the previous one left):

| Camp | Log | Attack 1 | Attack 2 | Attack 3 |
| --- | --- | --- | --- | --- |
| Kozu top bucket (931 buildings) | pokey-rush | 202 ms, 15.9% | 228 ms, 25.3% | 132 ms, 28.5% |
| Kozu top bucket | mixed-waves | 355 ms, 100% | 17 ms | 19 ms |
| Legionnaire top bucket (239 buildings) | pokey-rush | 256 ms, 43.3% | 140 ms, 70.7% | 213 ms, 100% |
| Legionnaire top bucket | mixed-waves | 260 ms, 100% | 6 ms | 5 ms |

The drop points in these logs were placed for the sandbox yard, not chosen for the camps, so the
damage figures show the shape of the curve (diminishing returns), not what a good plan achieves.

**What this means:**

- **An auto-attack costs the same one replay as a manual attack's final save:** roughly 0.2-0.4 s
  of CPU in a worker on a camp, plus about 40 ms of worker start-up.
- **It is cheaper than a manual attack overall.** It has no seven-minute session and no client
  checkpoint every few seconds.
- **The new risk is frequency, not cost.** A player can repeat in seconds instead of every five
  minutes. Three limits bound it:
  - **Monster supply.** Each repeat spends the army.
  - **The per-user limits:** 1 auto-attack in flight, 10 per minute `[PLACEHOLDER]`.
  - **A global replay-worker cap (new).** A semaphore of `max(1, cores - 1)` worker slots shared by
    saves, the finaliser and auto-attacks. An auto-attack waits up to 5 s for a slot, then answers
    `503 autoAttackBusy`. Manual saves keep priority, because a player who is watching their attack
    should never wait behind a batch of auto-attacks.

### 6.4 Response

```jsonc
{
  "baseid": "…",
  "damageBefore": 41, "damageAfter": 78, "destroyed": 0,
  "loot": { "r1": 120000, "r2": 120000, "r3": 80000, "r4": 0 }, // credited, after the storage cap
  "lootCapped": { "r3": 15000 },                                 // what the storage cap left behind
  "flung": { "C1": 300, "C5": 40 },
  "champion": { "t": 3, "hp": 1450, "maxHp": 4000 },
  "report": [ "…" ],                                             // rules/report.ts lines
  "takeover": { "open": true, "quote": { … } },                   // when damageAfter >= 90
  "replay": { "seed": 123, "log": { … }, "healthBefore": { … } }  // for the watch add-on
}
```

## 7. UI

### 7.1 Where the button lives

- **The camp's cell panel on the map** (`web/src/ui/maproom/CellPanel.ts`). A **Repeat attack**
  button sits under **Attack**, the same slot Take over uses (`CellPanel.ts:86-111`), with the
  plan summary on the line below it. It is shown only when a plan exists for this camp or its
  layout, and it is disabled with the reason underneath when the camp is out of range, under
  attack, or the player has no monsters for it. On a camp at 90% or more, **Take over** is the
  primary button and **Repeat attack** stays available (for loot, Q6).
- **The end-of-attack panel** (`web/src/ui/attack/EndAttackPanel.ts`), after a manual attack on a
  camp that is still under 90%: **Attack again** runs this exact attack's plan, which skips the
  trip back to the map. That is the moment the hassle is felt most.
- **The result panel** of an auto-attack offers **Attack again** too, so a conquest is a chain of
  taps on one screen.

### 7.2 Confirmation

This is a small sheet, the same on desktop and phone:

```
Repeat attack on Kozu camp (level 35)            Camp damage now: 41%
  Pokey   300 needed · 300 in range   ✓
  Bolt     40 needed ·  25 in range   ! 15 short: fewer will be flung
  Krallen champion · 1450/4000 health
  Attacking ends your damage protection.           (only when the player has it)
                       [ Cancel ]  [ Attack now ]
```

The confirmation is always shown, because monsters are spent. "Don't ask again for this camp" is a
later option, if playtesters find the extra tap a hassle.

### 7.3 Result panel

This is a variant of `EndAttackPanel` that reuses its parts:

- **Camp damage bar,** before → after, with the gain called out: **"+37% (41% → 78%)"**. When the
  gain is under the stall threshold it adds: "This plan has stopped working here. Attack by hand to
  try new drop points."
- **"Destroyed!"** when the camp reaches 90%, with the takeover offer embedded: the
  `EndTakeoverOffer` component that manual attacks already show, with its quote and Take over
  button.
- **Loot** per resource, using the resource icons, with "storage full: N left behind" when the cap
  bit.
- **Losses:** the monsters spent, and the champion's health after the attack.
- **Actions:** **Attack again** (hidden at 90% or more, disabled without monsters), **Watch
  replay** (the add-on, when it is built) and **Back to map**.
- For "Attack until destroyed", one row per attack (damage gained, loot) and the reason the series
  stopped.

## 8. Recommendation, build order and work packages

**Recommendation: (a) Repeat last attack, keyed by layout, resolved instantly on the server.** It
meets the owner's request directly ("the same yard with the same monsters"). It keeps the one real
decision, where to drop, in the player's hands. The server side is mostly code that already exists
(the finaliser, the replay, the loot rule), and (c) and the add-ons extend it later without a
rewrite. (b) costs the most, carries the most balance risk and takes away the decision.

**Fun hypothesis to test first:** "Conquering a camp feels like a decision (pick the camp, plan the
first attack, take it over) and not a chore." **Broken looks like:** players never attack by hand
after their first plan, or camps change hands so fast that players in range never see one standing.

### v1

| WP | Work | Size |
| --- | --- | --- |
| WP1 | **Plan store.** `attack_plan` table and the layout hash. Record the landed fightable log (bombs, siege and retreat removed) from `baseSave.ts` and the finaliser, on every landed Map Room 2 camp attack. Tests: recorded after a save, after a finalise, never for a player yard. | S |
| WP2 | **`landAttack()` extraction** from `finaliseLocked`. The finaliser calls it unchanged, and the existing `finaliseAttack.test.ts` stays green. It returns the landed outcome. | M |
| WP3 | **`POST /worldmapv2/autoattack`.** Target checks factored out of `baseModeAttack.ts`, the per-user lock, the rate limiter, session and checkpoint minting, landing through WP2, the response. Tests: refused for a main yard, an outpost, Map Room 3, a camp under attack, out of range, no monsters, another world; a timeout leaves nothing spent; a crash is landed by the sweep exactly once; the result equals a manual save of the same log and seed. | M |
| WP4 | **Global replay-worker semaphore** in `replayRunner.ts`, with manual saves first. | S |
| WP5 | **Plan summary** for the cell panel: needs against has, and the champion. A field on the existing cell request, or `GET /worldmapv2/autoattackplan`. | S |
| WP6 | **Web: Repeat attack** in `CellPanel`, and the confirmation sheet. | S-M |
| WP7 | **Web: result panel** (an `EndAttackPanel` variant, the takeover offer reused) and **Attack again**. | M |
| WP8 | **Web: Attack again** on the manual end-of-attack panel. | S |

Order: WP1 → WP2 → WP3 (+ WP4 in parallel) → WP5 → WP6 → WP7 → WP8. WP1 can ship on its own first
and quietly start recording plans, so players already have a plan for every camp layout they have
attacked by the time the button appears.

### Later

| WP | Work | Size |
| --- | --- | --- |
| WP9 | Attack until destroyed (section 5.4) | S-M |
| WP10 | Watch replay at 4x/8x (section 4, add-ons) | M |
| WP11 | Map Room 1 tribes: their own session and landing (no checkpoint today), respecting the per-respawn loot cap | M |
| WP12 | (c) Saved, named plans | M |

## 9. Open questions for the owner

Each question has a proposed default, which applies if the owner has no preference.

| # | Question | Proposed default |
| --- | --- | --- |
| Q1 | Map Room 2 camps only in v1, with Map Room 1 tribes later? | Yes. Map Room 1 tribes respawn every 10 minutes, so auto-attack there is mostly loot farming; it is worth a separate decision. |
| Q2 | Should a plan be reused on every camp with the same layout (same tribe and level bucket), or only on the camp it was recorded on? | Every camp with the same layout. One manual attack per layout, then repeats everywhere. |
| Q3 | Any cost beyond the monsters spent: a fee or a cooldown? | None. Rate limits exist for the server only. Revisit if playtests show camps falling too fast. |
| Q4 | Should a repeat also fire the original's bombs and siege weapons? | No: monsters and champion only. |
| Q5 | When the player is short of monsters for the plan: fling what they have, or refuse? | Fling what they have, after the confirmation shows the shortfall. |
| Q6 | Allow repeats on a camp already at 90% or more (for loot)? | Yes, with Take over as the primary button. |
| Q7 | Fling the champion if the plan had one and it is available? | Yes, at its current health. If it is unavailable, the drop goes without it. |
| Q8 | An offline "keep attacking until conquered" queue? | No (section 5.4). Offer the online "Attack until destroyed", capped at 5 attacks, in v1.1. |
| Q9 | Instant result only, or watch the battle at high speed? | Instant result in v1. Watch replay in v1.1. |
| Q10 | Does an auto-attack end the attacker's damage protection, like a manual attack? | Yes, the same rule. The confirmation says so. |
| Q11 | Which yard's monsters are spent first? | The army panel's default order: the main yard first, then outposts nearest the camp. |
| Q12 | Should a repeat run to the battle's natural end, even if the original attack retreated early? | Yes. |
