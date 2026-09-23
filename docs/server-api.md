# Backyard Monsters Refitted — Server API Reference

This document describes the HTTP and WebSocket API exposed by `server/` (Bun + Koa +
TypeScript, PostgreSQL via MikroORM, Redis), for the purpose of building a new client
against it. Everything below was read directly from the code in `server/src/`; anything
that could not be confirmed from the code is marked `UNVERIFIED:`.

## 1. Overview

### Stack / request lifecycle

`server/src/server.ts` wires the Koa app: CORS + cache-control (`corsCacheControl`) →
`koa-bodyparser` → MikroORM request context → asset/request logging → static file / language
file serving → `ErrorInterceptor` → the router (`app.routes.ts`) → a separate chat WebSocket
server (`chat/chatServer.ts`, started in the same process, own port). Migrations run
automatically on boot outside of `ENV=production`.

### Request body format

`koa-bodyparser` is configured with `enableTypes: ["json", "form"]` and an 8 MB limit for
both. **A route can receive either a JSON body or a form-urlencoded body** — the original
Flash client used `URLLoader`/`URLVariables` (form-encoded), so most controllers read
individual string fields off `ctx.request.body` and `JSON.parse` them by hand rather than
expecting a nested JSON object. Concretely: fields like `resources`, `buildingdata`,
`buildinghealthdata`, `champion`, `purchase`, `attackData`, `attackcost`, `monsterupdate`,
`bookmarks`, `imonsters` etc. are all **JSON-stringified inside a single form field**, and
the zod schema (or the controller) does `z.string().transform(JSON.parse)` on them. A new
client can send either encoding, but must still JSON-stringify these specific fields — the
server does not accept them as native nested JSON objects. Query strings are used for GET
routes.

### Authentication

- **Player auth**: a Bearer JWT in the `Authorization` header (`Authorization: Bearer <token>`).
  - Minted by `POST /api/:apiVersion/player/getinfo` (the login route — see Auth table). Payload:
    `{ user: { email, discordId, sessionType } }`, signed with `process.env.SECRET_KEY`,
    expiry `process.env.SESSION_LIFETIME` (default `"30d"`).
  - `sessionType` is `"game"` or `"launcher"` (`enums/SessionType.ts`) and is tracked
    **independently** — a player can hold one valid game-client session and one valid
    launcher/website session at the same time, but logging in again with the same
    `sessionType` invalidates the previous token of that type.
  - The **only** currently-valid token for an account+sessionType is the one stored in Redis
    at `user-token:{sessionType}:{email}` (`middleware/auth.ts`, `controllers/auth/login.ts`).
    `verifyUserAuth` decodes the Bearer token, then requires it to **exactly match** what's in
    Redis — an older, structurally-valid JWT that has been superseded by a newer login is
    rejected even though it hasn't expired. There is no logout endpoint that clears this key;
    logging in again (or letting the token expire) is the only way a session ends.
  - In `ENV=local`, `verifyJwtToken` only **decodes** (does not verify the signature) — local/dev
    builds do not need a valid `SECRET_KEY` signature. In `ENV=production` it verifies the
    signature and, if the token carries a `discordId`, also checks `isDiscordAccountOldEnough`
    (Discord account must be ≥ 7 days old) to compute `meetsDiscordAgeCheck`.
  - `verifyUserAuth` also loads the `User` row fresh from Postgres by email and rejects if the
    user is missing or `banned`. It sets `ctx.authUser` (the `User` entity) and
    `ctx.meetsDiscordAgeCheck` for downstream controllers/middleware.
  - `verifyAccountStatus` (a second, separate middleware) requires `ctx.meetsDiscordAgeCheck`
    to be `true`, throwing `discordAgeErr()` otherwise. It gates every Map Room v3 route and
    most Map Room v2 write routes — i.e., linking and "aging" a Discord account is a
    prerequisite for playing on the map, presumably as an anti-multi-account/anti-bot measure.
    A couple of controllers (`setMapVersion`) enforce the same check manually inside the
    handler instead of via this middleware — same effective rule, different code path.
- **API-consumer auth**: a completely separate mechanism, `middleware/apiConsumer.ts`'s
  `verifyApiConsumer`. Requires an `X-API-Key` header matching an active row in the
  `api_consumer` Postgres table (validated keys are cached in Redis; revoking one clears the
  cache entry). Returns a plain `401 { error: "Missing or invalid API key" }` — not a
  `ClientSafeError` — specifically so it isn't rewritten to a 200 by `ErrorInterceptor` (which
  only exists to placate the Flash client; a non-Flash API consumer should see the real status
  code). Skipped entirely when `ENV=local`. Keys are managed with
  `bun run consumer:create|list|revoke` (`scripts/api-consumers.ts`). This gates three
  Map Room 2 bulk read endpoints meant for an external map-viewer (see the Map Room 2 table) —
  it has nothing to do with player accounts.

### Errors

All thrown errors that controllers want to surface use `ClientSafeError`
(`errors/errors.ts` exports one factory function per error, e.g. `authFailureErr()`,
`permissionErr()`, `allianceFullErr()`). A global `ErrorInterceptor` middleware
(`middleware/clientSafeError.ts`) wraps the whole router and catches everything:

- A `ClientSafeError` not caught anywhere else is turned into
  `{ error: <message-or-undefined>, errorDetails: { error, status, data, message,
  internalInfo? } }`.
- Any other thrown value (a bug, a DB error, etc.) is wrapped into a generic
  `ClientSafeError` with the message `"Something went wrong, please contact support."`,
  status 500, and `isClientFriendly: true`; the original error is logged server-side only.
- **HTTP status code quirk, load-bearing for a new client**: each `ClientSafeError` has an
  `isClientFriendly` flag.
  - If `isClientFriendly` is **true**, the response's `error` field is `undefined` and the
    **real** HTTP status (401/403/404/409/etc.) is sent.
  - If `isClientFriendly` is **false**, the response's `error` field is set to the message,
    **and the HTTP status is forced to 200 (`Status.OK`)** regardless of the error's declared
    status. This exists (per the code comment, "bad to accommodate for the client") because
    the Flash client mishandles certain non-200 responses for ordinary game-flow conditions.
    Errors constructed with `isClientFriendly: false` are exactly the "this is a normal game
    outcome, not a real HTTP error" set: `baseUnderAttackErr`, `baseProtectedErr`,
    `userOnlineErr`, `takeoverCellErr`, `truceActiveErr`, `mapRoomDisabledErr`.
  - **A new client must therefore check the response body's `error` field, not just the HTTP
    status code**, to detect all failure cases — a 200 response can still mean "the request
    failed," and the message to show the player is in `error` (when present) or
    `errorDetails.message` (always present).
- Independently of `ClientSafeError`, some controllers (e.g. `login` success path, `sendMessage`
  soft-failures) put an `error: 0` (success) or `error: 1` (soft failure, still HTTP 200) field
  directly in a normal `200` response body — this is a second, older convention layered on top
  of the `ClientSafeError` one and is **not** related to the interceptor. Treat `error !== 0`
  in a 200 body as a failure too.

### API versioning vs. Map Room version (two unrelated things with "version" in the name)

- **`:apiVersion` URL param / `apiVersion` middleware** (`middleware/apiVersioning.ts`): this is
  a **client build gate**, unrelated to the game's Map Room. Many routes are mounted at
  `/api/:apiVersion/...`. The middleware compares the `:apiVersion` path segment against a
  version manifest (`config/VersionManifestConfig.ts`, fetched once at boot from
  `${CDN_URL}/versionManifest.json`, e.g. producing strings like `"v1.6.1-beta"`). If the
  manifest was loaded (`USE_VERSION_MANAGEMENT=enabled`) and the segment doesn't match either
  the desktop or Android version, the request is rejected with `400`. When version management
  is disabled (the default/dev case), any value in the URL segment is accepted. `POST /init`
  performs the same check itself via a zod schema before the client even starts talking to
  numbered endpoints.
- **`setMapVersion`** (`controllers/maproom/setMapVersion.ts`, routed at both
  `/worldmapv2/setmapversion` and `/worldmapv3/setmapversion`): this is an ordinary
  authenticated controller, not middleware, that switches **which Map Room a player's save is
  on** — `MapRoomVersion.NONE|V1|V2|V3` (`enums/MapRoom.ts`). It has nothing to do with the
  `:apiVersion` client-build check. See the Map Room 2/3 endpoint tables for its exact
  behavior per target version.

---

## 2. Endpoint reference

### Auth

All routes below are mounted under `/api/:apiVersion/player/...` or `/api/:apiVersion/...`
and pass through the `apiVersion` middleware **except** where noted.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/api/:apiVersion/player/getinfo` | apiVersion, loginLimiter (30/5min prod, 30/min dev), logRequest | `UserLoginSchema`: `email?` (trimmed, lowercased), `password?` (≥8 chars, ≥1 special char), `token?` (a previously issued JWT, for token-based re-login), `sessionType` (`"game"` \| `"launcher"`, default `"game"`) | `{ error: 0, userId, ...filteredUser, version: 128, token, mapversion: 2, mailversion: 1, soundversion: 1, languageversion: 8, sendinvite: 1, app_id: "", tpid: "", currency_url: "", language: "en", settings: {} }` — `filteredUser` is the `User` entity's `@FrontendKey` fields (see Data Models) | **Login.** Either `token` (validated against the Redis-stored current token) or `email`+`password` (bcrypt-compared) must succeed. Throws `emailPasswordErr()` (409) on bad credentials, `userPermaBannedErr()` (403) if banned, `discordVerifyErr()` (401) if `ENV=production` and the account has no verified Discord link. On success mints and stores a new JWT (see Overview), fires an async Discord avatar refresh. Several response fields (`mapversion`, `mailversion`, `version`, etc.) are hardcoded constants, not derived from the account — comment in source: "TODO: add remaining keys that the client expects." |
| POST | `/api/:apiVersion/player/register` | apiVersion, registerLimiter (3/hour prod, 3/min dev), logRequest | `UserRegistrationSchema`: `username` (2–12 chars, `[a-zA-Z0-9_]`), `email`, `password` (same rules as login) | `{ user: filteredUser }` | Creates an account. Throws `usernameUniqueErr()`/`emailUniqueErr()` (409) on conflict. **Quirk**: the password schema is technically optional at the type level (empty string → `undefined` via a zod preprocess step) but the controller does `bcrypt.hash(registeredUser.password!, 10)` with a non-null assertion — sending an empty/omitted password would throw an unhandled error rather than a clean validation error. |
| POST | `/api/:apiVersion/player/forgotPassword` | apiVersion only (no rate limiter, no logRequest) | `{ email }` | `200 { message }` on success; `400 { message }` on any failure (this controller catches internally rather than using `ClientSafeError`) | Emails a reset link containing a 20-minute JWT (`{user:{email}}`), stored on `user.resetToken`, using the HTML template at `public/templates/forgot-password.html` and `WEB_URL` env var. |
| POST | `/api/:apiVersion/player/reset-password` | **none** — no `apiVersion`, no `logRequest` middleware applied on this route despite the URL shape | `{ password, token }` | `200 { message }` on success; `401 { message }` if the token is expired (`TokenExpiredError`); otherwise throws `authFailureErr()` (401) via the global interceptor | Verifies the emailed JWT, requires `token === user.resetToken` (single-use), hashes and sets the new password, clears `resetToken`. |
| GET | `/api/:apiVersion/supportedLangs` | apiVersion, logRequest | none | Raw array, not wrapped: `["English","French","Spanish","Portuguese"]` | Static list of supported language *names* (not codes). The actual translation JSON is served separately as static files at `/gamestage/assets/<code>.json` via `middleware/processLanguageFile.ts` (cached in-process except in `ENV=local`). |
| GET | `/api/:apiVersion/player/account` | apiVersion, verifyUserAuth | none | `{ error: 0, userId, username, email, pic_square, discord_verified, canChangeUsername, nextChangeAt, settings: { shinyLocked } }` | Returns the caller's own account summary. `nextChangeAt` is `null` when the username-change cooldown has elapsed. |
| POST | `/api/:apiVersion/player/changeusername` | apiVersion, verifyUserAuth, changeUsernameLimiter (5/hour), logRequest | `ChangeUsernameSchema`: `{ username }` (same rules as registration) | `{ error: 0, username, nextChangeAt }` | Renames the account, subject to a **6-month cooldown** (`services/user/renameUser.ts`, `USERNAME_CHANGE_COOLDOWN_MONTHS`). Throws `usernameCooldownErr(nextChangeAt)` (409) if still cooling down, `usernameUniqueErr()` (409) if taken. The rename is transactional and also updates `save.name` on every yard the user owns, `alliance.leader_name` if they lead one, and renames any `World` still labelled after their old username. A running game client keeps the old name cached until restarted. |
| POST | `/api/:apiVersion/player/settings` | apiVersion, verifyUserAuth, logRequest | `UpdateSettingsSchema`: `{ shinyLocked: boolean }` | `{ error: 0, settings: { shinyLocked } }` | Sets the account-wide "no-shiny" toggle. When locked, `credits` (shiny) is reported as `0` everywhere (`visibleCredits`) and any purchase/attack cost that would spend shiny throws `shinyLockedErr()` (403) instead. |

### Base / Yard

Mounted at `/base/...` — **no** `/api/:apiVersion` prefix and **no** `apiVersion` middleware
on any of these four routes.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/base/load` | verifyUserAuth, logRequest | `BaseLoadSchema`: `type` (a `BaseMode` value — see below), `userid` (accepted but unused by the handler), `baseid`, `mapversion?` (coerced number), `attackData?` (JSON string → `{champions?, monsters?}`), `attackcost?` (JSON string → `{resources?: number[], shiny?: number}`) | See "Base load/save response envelope" below | **The main "open a base" call.** `type` selects a mode handler: `build` (own yard, editable), `view`/`wmview` (someone else's yard, read-only), `attack`/`wmattack` (start an attack — validates range/level/protection, mints an `attackid`, logs the attack), and Inferno equivalents `ibuild`/`iview`/`iattack`/`iwmattack`/`iwmview`/`idescent`. `attack`/`wmattack`/`iattack`/`iwmattack` require `ctx.meetsDiscordAgeCheck` (else `discordAgeErr()` 401) unless the target is a scripted MR1 tribe. Also used for Map Room 1's `/api/:apiVersion/bm/base/load` (identical controller, different mount). |
| POST | `/base/save` | verifyUserAuth, logRequest | `BaseSaveSchema` (`baseid`, `basesaveid`→number, plus a long list of optional JSON-string fields — `purchase`, `champion`/`attackerchampion`, `buildingdata`, `buildinghealthdata`, `monsterupdate`, `attackloot`, `resources`, `monsters`, `attackcreatures`, `attackersiege`, `over`→number, `destroyed`→number, `attackid`) **and** every raw body key matching `Save.saveKeys` (own base) or `Save.attackSaveKeys` (attack) is separately JSON-parsed onto the entity — see "Save write keys" below | `{ error: 0, basesaveid, ...filteredSave, ...(takeoverData && { takeover: takeoverData }) }` | **The main "close/checkpoint a base" call.** Throws `permissionErr()` (403) if the caller neither owns the base nor holds an active `attackid` on it (i.e. isn't mid-attack against it). Runs `scripts/anticheat/anticheat.ts`'s `validateSave` before applying anything. On `over` (attack finished) with damage ≥ 90%, triggers MR3 structure takeover (`takeoverCellMR3`) or destroys an MR3 tribe cell, and grants the defender fresh damage protection. Advances building timers to "now" using the pre-save health snapshot. |
| POST | `/base/updatesaved` | verifyUserAuth, logRequest | inline schema: `type`, `version`, `lastupdate`, `baseid`, `mapversion`→number | `{ error: 0, flags, ...filteredSave, credits, ...(alliancedata && {alliancedata}), ...(powerups && {powerups}) }` | **Polling heartbeat**, called by the client roughly every 30 seconds while a base screen is open, to refresh timers/resources without a full `/base/load`. Does not accept any save data from the client — read-only refresh. |
| POST | `/base/migrate` | verifyUserAuth, logRequest | `MigrateBaseSchema`: `type` (`BaseType`), `baseid`, `resources?` (JSON), `shiny?`→number | Three shapes depending on branch: cooldown active → `{ error: 0, cantMoveTill, currenttime }`; `type="random"` (empire overrun) → `{ error: 0 }`; normal migrate-to-outpost → `{ error: 0, coords: [x, y] }` | Relocates the player's home base. A 24-hour cooldown (`userSave.cantmovetill`) applies after any migration. `type="random"` leaves and rejoins a Map Room 2/3 world at a new random location (blocked if the player still owns outposts — `relocateOutpostErr()` 403). Otherwise it swaps the home cell onto a **captured outpost's** coordinates, deletes the old outpost cell/save, and charges the given `resources`/`shiny` (throws `shinyLockedErr()` 403 if shiny-locked and `shiny` is set). |

**Base load/save response envelope.** Both `/base/load` and `/base/save` (and `/base/updatesaved`)
spread the full set of `@FrontendKey`-decorated fields from the `Save` entity (see Data
Models §Save) into the top level of the response, via `mapSaveData`/`buildSaveData`
(`services/base/mapSaveData.ts`). On top of the raw save fields, `/base/load` additionally
adds: `relationship` (`EnumBaseRelationship`), `canattack` (bool, from `canAttack()`), `flags`
(the full feature-flag object — see §5 Game data), `worldsize: [800, 800]`, `error: 0`,
`id` (= `basesaveid`), `storeitems` (the **entire** store catalog, verbatim — see §5),
`tutorialstage`, `currenttime`, `pic_square` (base owner's avatar), `chatservers` (a 1-element
array with `CHAT_WS_HOST`), and — only when the caller owns the base — `chatenabled: 1`,
`chattoken`, `chatchannel`, `alliancedata`, `powerups` (see §Alliance and §Chat). Attack modes
add `attpowerups`. Map Room 3 build/attack adds a `player.buffs` / `attackingplayer.buffs` /
`defendingplayer.buffs` object keyed by small numeric buff-type ids (`2`=resource rate,
`10`=resource capacity, `1`=defender damage reduction %, `5`/`6`=stronghold attacker/defender
damage bonus %). `idescent` mode additionally overwrites `resources` with the player's
`iresources` and filters `wmstatus` down to descent-tribe ids 201–213.

**`BaseMode` values** (`enums/Base.ts`): `build`, `attack`, `wmattack` (wild-monster attack),
`view`, `help`, `ibuild`, `iattack`, `iwmattack`, `idescent`, `iview`, `ihelp`, `wmview`,
`iwmview`, `"0"` (default/unset).

**Save write keys** (`enums/SaveKeys.ts` / `Save.saveKeys` / `Save.attackSaveKeys` in
`database/models/save.model.ts`). On a normal (non-attack) save, the server iterates
`Save.saveKeys` (`buildingdata`, `buildingkeydata`, `researchdata`, `stats`, `rewards`,
`tutorialstage`, `aiattacks`, `monsters`, `resources`, `iresources`, `lockerdata`, `events`,
`inventory`, `monsterbaiter`, `mushrooms`, `monsterupdate`, `buildinghealthdata`, `frontpage`,
`academy`, `loot`, `storedata`, `coords`, `quests`, `player`, `krallen`, `siege`,
`buildingresources`, `attackloot`, `lootreport`, `attackersiege`, `updates`, `effects`,
`homebase`, `outposts`, `wmstatus`, `chatservers`, `achieved`, `attacks`, `gifts`,
`sentinvites`, `sentgifts`, `fbpromos`, plus the scalar fields `level`, `catapult`, `flinger`,
`destroyed`, `damage`, `locked`, `protected`, `champion`, `over`, `usemap`, `basevalue`,
`empirevalue`, `points`) and, for each one present in the raw request body, either runs a
dedicated handler or falls back to `JSON.parse`-and-assign:

| Key | Handler (`controllers/base/save/handlers/`) | Behavior |
|---|---|---|
| `resources` | `resourceHandler.ts` (`resourcesHandler`) | Adds the client's `{r1..r4, r1max..r4max}` delta onto the stored pool (`updateResources`). When the owner is saving from an **outpost** session, the `rNmax` fields are dropped (`skipCapacity`) — capacity is a property of the main yard's buildings, not the outpost's. |
| `iresources` | same handler, `key: SaveKeys.IRESOURCES` | Same, but writes the Inferno resource pool. |
| `academy` | `academyHandler.ts` | Parses `{[monsterKey]: {level}}`, clamps every `level` to a maximum of `6`. |
| `buildingdata` | `buildingDataHandler.ts` (attack only; non-attack just assigns directly) | On an **attack** save, non-trap buildings are never modified by the client payload — they're always taken from the DB. The only legitimate change is removing a triggered trap (`t===24` TRAP or `t===117` HEAVY_TRAP): if the client's submission no longer includes that trap's key, it's dropped from the defender's `buildingdata`. |
| `champion` | `championHandler.ts` (attack only) | Only `hp` can be lowered by an attack, and only if the reported `hp` is less than the stored value (`Math.min`) — every other champion field is server-authoritative. |
| `points` / `basevalue` | inline | `baseSave.points = value.toString()` / `.basevalue = value.toString()` — stored as strings. |
| everything else | inline | `JSON.parse(value)` if possible, else stored as the raw string. |

On an **attack** save (`Save.attackSaveKeys`: `destroyed`, `damage`, `locked`, `protected`,
`monsters`, `champion`, `over`, `buildingdata`, `buildinghealthdata`, `buildingresources`,
`attackreport`, `attackersiege`), additional attacker-side effects run: `monsterupdate` →
`monsterUpdateHandler.ts` (branches on MR2 array-of-cells vs MR3 object-keyed-by-creature-id
shape, and can also push housing updates to a *different* base id, e.g. an outpost, via
`updateMonsters`); `attackcreatures` overwrites the attacker's own `monsters`; `attackloot` →
`attackLootHandler.ts` credits the attacker's resource pool; `resources` (the defender's
reported delta) → `defenderLootHandler.ts` **only ever subtracts** from the defender/outpost
pool (any positive value in the client's delta is ignored — an attacker cannot top up a base by
lying about the delta), capped at 10,000,000 per resource type per save, and clamped to not go
below 0.

Purchases (`purchase: [itemKey, quantity]`, non-attack saves only) go through
`purchaseHandler.ts`: looks up `storeItems[itemKey]` for its duration (`du`), stacks the
purchased quantity onto `save.storedata[itemKey].q`, sets/refreshes an expiry
(`storedata[itemKey].e = now + du`) for items with a duration, stacks damage-protection time
(`PRO1`/`PRO2`/`PRO3` extend `save.protected`), and calls `updateCredits` to charge or credit
shiny (throws `shinyLockedErr()` 403 if the account is shiny-locked and the item isn't a shiny
*gain* per `game-data/store/purchaseKeys.ts`'s `isShinyGain`).

### Map Room 1 / Inferno

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/api/:apiVersion/bm/getnewmap` | apiVersion, verifyUserAuth, logRequest | none | If the user's home cell is on Map Room 3: `{ newmap: true, mapheaderurl, width: 500, height: 500 }`; else `{ newmap: false }` | Tells the client at startup whether to use the legacy (non-grid) map UI or the MR3 grid UI. |
| POST | `/api/:apiVersion/bm/base/load` | apiVersion, verifyUserAuth, logRequest | same as `/base/load` | same as `/base/load` | Identical controller to `/base/load`, mounted under the MR1 API prefix. |
| POST | `/api/:apiVersion/bm/base/save` | apiVersion, verifyUserAuth, logRequest | `BaseSaveSchema`, same as `/base/save` | If no `Save` row matches `basesaveid`: `{ error: 0, ...freshlyScaledMolochTribeBase }` (see §5 Game data — Inferno tribe templates). Otherwise: `{ error: 0, ...filteredSave, champion: [], credits }` (`champion` forced empty; `credits` via `visibleCredits`) | The **Inferno** equivalent of `/base/save`. A first save against a not-yet-materialized attack target hands back a freshly level-scaled "Moloch tribe" base to attack. Runs the same damage-protection and building-timer-advance logic as `/base/save`. |
| POST | `/api/:apiVersion/bm/base/updatesaved` | verifyUserAuth, logRequest | same inline schema as `/base/updatesaved` | same shape as `/base/updatesaved` | Same controller as `/base/updatesaved`. |
| POST | `/api/:apiVersion/bm/base/infernomonsters` | apiVersion, verifyUserAuth, logRequest | `{ type: "get" \| "set", imonsters?: JSON string, default {} }` | `{ error: 0, imonsters }` | Gets or sets the player's Inferno monster cage/roster (`Save.monsters` on the Inferno save). `get` ignores whatever the client sent and returns the DB value; `set` persists and echoes back the client's value unchanged. |
| POST | `/api/:apiVersion/bm/neighbours/get` | apiVersion, verifyUserAuth, logRequest | `{ type?: string }` (`"inferno"` selects the Inferno pool, anything else the MR1 overworld pool) | `{ error: 0, wmbases: [], bases: NeighbourData[] }` (`wmbases` always empty, kept for legacy compatibility); if the caller has no `save` at all: `{ error: 0, bases: [] }` (no `wmbases` key) | Returns a cached PvP matchmaking list of opponents (`Maproom.neighbors` / `InfernoMaproom.neighbors`, re-rolled every ~2 weeks once ≥10 candidates are found, else retried every 30 min). MR1/Inferno has **no coordinate grid** at all — there is no per-cell or viewport endpoint; browsing opponents means picking from this cached list. |

### Map Room 2

An 800×800 grid per `World`; terrain for cells that have never held activity is generated
live from a noise function seeded by the world's uuid, and is not persisted.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/worldmapv2/getarea` | verifyUserAuth, verifyAccountStatus (+Discord age check), getAreaLimiter (120/min/user), logRequest | `{ x, y }` (coerced ints, 0–799), `sendresources?` (coerced number, default 0) | `{ error: 0, x, y, data: { [x]: { [y]: CellPayload } }, alliancedata, ...(sendresources===1 && { resources, credits }) }` for an **11×11** block (`x..x+10`, `y..y+10`) | The core "pan the map" call. Throws `mapRoomDisabledErr()` (404, rewritten to 200 by the interceptor since it's `isClientFriendly:false`) if MR2 is disabled server-wide. See "MR2 cell payload" below for `CellPayload` field meanings. |
| GET | `/worldmapv2/terrain` | **verifyApiConsumer (X-API-Key)**, terrainLimiter (10/min/consumer), logRequest | Query: `worldid` (uuid, required) | `application/octet-stream`, exactly 640,000 bytes — one unsigned byte of terrain height per cell, indexed `x*800+y`. Brotli/gzip negotiated, strong `ETag`, `Cache-Control: public, max-age=3600`-style immutable caching, 304 on matching `If-None-Match` | **API-consumer only**, not for the game client — built for an external map-viewer. Full terrain height map for one MR2 world. |
| GET | `/worldmapv2/snapshot` | **verifyApiConsumer**, snapshotLimiter (10/min/consumer), logRequest | Query: `worldid` (uuid, required) | JSON occupancy overlay: generated at most once every 5 minutes per world; players, cells `[x,y,base_type,uid,baseid,empirevalue,flinger,catapult,damage,protectedUntil,destroyed][]` | **API-consumer only.** Everything occupied in a world (main yards, outposts, attacked wild-monster camps) that isn't derivable from terrain alone — meant to be combined client-side with `/worldmapv2/terrain`. |
| GET | `/worldmapv2/alliances` | **verifyApiConsumer**, alliancesLimiter (10/min/consumer), logRequest | none | JSON directory of every MR2 alliance across all worlds: membership, leader, and hostile(-1)/friendly(1) relationship flags | **API-consumer only.** Lets an external map viewer color/label territory by alliance without per-alliance calls. |
| POST | `/worldmapv2/setmapversion` | verifyUserAuth, logRequest (Discord-age check done manually in the controller) | `{ version }` (string→`MapRoomVersion`: 0=NONE, 1=V1, 2=V2, 3=V3) | `{ error: 0, id, baseurl, ...filteredSave }` | Switches the player's Map Room version. `NONE`: leaves the current world, drops to `mapversion=1`. `V2`: requires Town Hall ≥ 6 (unless already `mr2upgraded`) and no alliance; joins a random MR2 world under 2500 players or creates one. `V3`: same TH6 gate; calls the MR3 world-join flow. Shared controller with the MR3 routes below. |
| POST | `/worldmapv2/takeoverCell` | verifyUserAuth, verifyAccountStatus, logRequest | `TakeoverCellSchema`: `{ baseid, resources?: JSON, shiny?→number }` | `{ error: 0 }` | Converts a ≥90%-damaged wild-monster/tribe cell into a player Outpost: deducts the given resources/shiny, evicts any previous owner, grants a 12h protection window. Throws `takeoverCellErr()` (500, but rewritten to 200) if damage is below 90%. |
| POST | `/worldmapv2/transferassets` | verifyUserAuth, verifyAccountStatus, logRequest | `{ frombaseid, tobaseid, monsters: JSON [Monster[], Monster[]] }` | `{ error: 0 }`, or `{ error: 1 }` with a 400/403 status on failure | Moves a monster garrison between two of the caller's own bases (main yard ↔ outpost). |
| POST | `/api/:apiVersion/player/savebookmarks` | apiVersion, verifyUserAuth, verifyAccountStatus, logRequest | `{ bookmarks: JSON string }` (no zod schema) | `{ error: 0 }` | Persists the player's map bookmark list onto `user.bookmarks`. |

**MR2 cell payload.** `b` (base_type, `MapRoomCell`): `1`=wild monster camp, `2`=own/other
player's main yard, `3`=captured outpost. Cells with terrain height `i ≤ 99` (`Terrain.WATER3`)
are plain water and carry only `{ i }`. A user cell additionally carries: `uid`, `bid`
(baseid), `aid` (owner's alliance id), `n` (owner's username), `l` (calculated level), `v`
(empirevalue), `f`/`c` (flinger/catapult level), `dm`/`d` (damage % / destroyed flag, `d=1` once
`dm≥90`), `lo` (locked — forced `1` while the owner is online or under active attack, `0` on the
viewer's own cell), `p` (protection active), `t` (truce **expiry unix timestamp** with that
owner, absent for the viewer's own cell), `mine` (1 for the caller's own cell), `pic_square`,
`pi` (always `0` — UNVERIFIED: unused placeholder), `fr` (always `0` — UNVERIFIED: unused
placeholder). `r` (the owner's live `resources` object) and `m` (the owner's `monsters`
object, `{}` if unset) are included **only when `mine` is 1**. Before the revamp branch every
cell carried them, which exposed every player's resource and monster counts to anyone panning the
map; the Flash client only ever read them for the viewer's own cell (`userCell.ts`). A wild-monster
cell carries only `{ uid: 0, b, i, bid, n (tribe name, purely `(x+y) % 4`-derived — not random
per-world), l (tribe level), dm, d }` — no `r`/`m`/ownership fields, since it is unowned until
captured.

### Map Room 3

A 500×500 grid per `World`, precomputed/cached (`getGeneratedCells()`) rather than generated
live. A player's home cell is always ringed by 6 hexagonal defender cells; resource/stronghold
structures likewise carry their own defender rings.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| GET/POST | `/worldmapv3/initworldmap` | verifyUserAuth, verifyAccountStatus, logRequest | none | `{ error: 0, celldata: CellData[] }` | Returns **every** cell the caller owns (home yard, outposts, captured defenders) up front when the map opens, so the client has full data for owned structures outside the current viewport before any `getcells` call. |
| POST | `/worldmapv3/getcells` | verifyUserAuth, verifyAccountStatus, getCellsLimiter (60/min/user), logRequest | `CellSchema`: `{ cellids?: JSON string → number[] }`, 1-based ids computed by the client as `y*500+x+1`; capped at 4250 ids/request (plain `400` string error, not zod, if exceeded) | No save/worldid/cellids: `{ celldata: [] }`; otherwise `{ celldata: CellData[], alliancedata }` — a **flat** array, each entry carrying its own `x`/`y` | Fetches specific cells by id (cell-list panning rather than viewport-rectangle panning). Auto-expands the request to include each cell's hex "defender" siblings and parent structure; lazily deletes destroyed outpost cells/saves once `TRIBE_REGEN_TIME` (3 days) has elapsed so the position regenerates. |
| GET | `/worldmapv3/relocate` | verifyUserAuth, verifyAccountStatus, logRequest | none | `{ error: 0, mapheaderurl }` | Leaves the current MR3 world and rejoins a random one under 1000 players (or creates one), placing the player's home yard + 6 defender outposts at a new free sector. |
| GET | `/worldmapv3/getfriendinfo` | verifyUserAuth, verifyAccountStatus | none | `{ error: 0, friends: [] }` (hardcoded) | Stub for a "relocate near a friend" picker — not implemented; always returns an empty list. |
| GET/POST | `/worldmapv3/setmapversion` | verifyUserAuth, verifyAccountStatus, logRequest | `{ version }` | Same as the MR2 `setmapversion` route (shared controller) | The `V3` branch calls the MR3 world-join flow instead of the MR2 one. |

**MR3 cell payload.** Formatting is dispatched by `services/maproom/v3/createCellData.ts`: a
DB cell with `uid > 0` (any real player-owned cell) → the "player cell" shape `{ uid, b, bid,
n, tid: 0, x, y, i, l, fbid: "", pl: 0, r, dm, lo, fr: 0, p, d, t, rel, aid, pic_square }`
(here `t` is a **0/1 truce flag**, not a timestamp like MR2; `rel` is an
`EnumBaseRelationship` code); a `STRONGHOLD`/`RESOURCE`/`FORTIFICATION` cell → the "wild
monster" shape `{ uid: 0, bid, n, tid, x, y, i, l, r, dm, d, b, rel: ENEMY }` (`tid` = tribe
index, coordinate-derived); an `OUTPOST`-type generated tribe cell → `{ uid: 0, b: 100 (EMPTY),
bid, n, tid, x, y, i, l, rel: ENEMY, dm, d }`; anything else (border/plain terrain) →
`{ x, y, i }` only.

### Alliance

Mounted at `/alliance/...`, `verifyUserAuth` + `logRequest` on every route, plus a per-route
rate limiter on a few of them (see `app.routes.ts`: `searchAlliancesLimiter` 30/min,
`allianceJoinRequestLimiter` 10/min, `allianceInviteLimiter` 20/min).

| Method | Path | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|
| POST | `/createalliance` | `CreateAllianceSchema`: `alliance_name`, `alliance_image` (1–41), `alliance_desc` (1–255 chars) | `{ error: 0, alliance: {alliance_id, name, image, description, leader, world_id} }` | Creates an alliance in the caller's current world with them as leader. Throws `alreadyInAllianceErr()` (409) if already affiliated, `allianceNoWorldErr()` (403) with no world, `allianceNameTakenErr()` (409) on a duplicate name, `allianceNameTooShortErr`/`TooLongErr`/`BannedErr` (400) or `allianceDescriptionBannedErr()` (400) from the name/profanity filter (min 3 / max 30 chars, must start with a letter/digit, checked via the `bad-words` filter — the zod schema alone is not sufficient, this check happens after). |
| POST | `/editalliance` | `EditAllianceSchema`: `alliance_image` (1–41), `alliance_desc` (1–255) | `{ error: 0, alliance: {...} }` (same shape as create) | **Leader only** (`requireAllianceLeader` → `permissionErr()` 403). The name is immutable — not accepted by this endpoint at all. |
| POST | `/leavealliance` | none | `{ error: 0 }` | Leaves the caller's alliance. A **leader** may only leave once no other members remain (`leaderMustTransferErr()` 403 otherwise — must promote someone first). The last member leaving **disbands** the alliance (row deleted) rather than leaving it leaderless. Always calls `disconnectAllianceChat(userId)` to evict the user from their alliance's live chat channel. |
| GET | `/myalliance` | none | Unaffiliated: `{ error: 0, alliance: null }`. Otherwise: `{ error: 0, alliance: {alliance_id, name, image, description, rank (global_rank), avg_level, leader_name, number_of_members, online_members} }` | Summary for the "My Alliance" tab. `rank` is standing across the whole map version (not just the alliance's own world). `avg_level` is the rounded average base level of members with a main yard. `online_members` counts members with a recent `last-seen:main:{userid}` Redis key (see §Data models note below). |
| GET | `/myalliancemembers` | none | `{ error: 0, members: AllianceMember[] }` | Full roster for the Members tab — see "Alliance member shape" below. Requires membership (`requireAllianceMember` → `permissionErr()` 403 if unaffiliated). |
| GET | `/getsuggestedmembers` | none | `{ error: 0, members: AllianceMember[] }` (max 50) | **Leader only.** Unaffiliated players on the same Map Room version, sorted by most recently active (`save.savetime DESC`), excluding anyone with a pending invite/request already open with this alliance. |
| POST | `/searchalliances` | `SearchAlliancesSchema`: `search?` (≤30 chars, `ILIKE` substring match), `page` (int, default 0), `world` (stringbool — `"true"`/`"false"` as a string, not a real boolean; see schema comment on why) | `{ error: 0, alliances: [{alliance_id, name, image, members, leader_name, leader_baseid, rank, relationship, ep}], pageSize: 10, totalResults }` | Browse tab, paginated 10/page. `world: true` scopes to the caller's own world; `false` scopes to every world on the caller's Map Room version (never across versions). Sorted by empire points descending. `rank` is `world_rank` or `global_rank` depending on the scope. `relationship` defaults to `AllianceStance.NEUTRAL` (`0`) when the caller's alliance has no flag set for that target. |
| POST | `/requestjoin` | `RequestJoinSchema`: `alliance_id` (positive int) | `{ error: 0 }` | Browse tab's "Request to Join." Throws `mustLeaveAllianceErr()` (409) if already in an alliance, `permissionErr()` (403) if the target alliance doesn't exist, `allianceNoWorldErr()`/`unknownWorldErr()` if the caller has no resolvable world, `joinMapVersionErr()` (403) if the target alliance is on a different Map Room version. Creates a `pending` `AllianceInvite` (`type: "request"`) — lands in the leader's Invites tab. Throws `requestPendingErr()` (409) on a duplicate, `allianceFullErr()` (409) if the alliance is at `MAX_ALLIANCE_MEMBERS` (50). |
| POST | `/inviteuser` | `InviteUserSchema`: `userid` (positive int) | `{ error: 0 }` | Suggested tab / map popup. **Leader only** (`inviteLeaderOnlyErr()` 403 — checked *after* confirming the caller is at least a member, so a non-member gets `permissionErr()` first). Throws `permissionErr()` if the target user doesn't exist, `userAlreadyInAllianceErr()` (409) if already affiliated, `inviteMapVersionErr(username)` (403) if the target has no world or is on a different Map Room version. Creates a `pending` `AllianceInvite` (`type: "invite"`); `invitePendingErr()` (409) on a duplicate, `allianceFullErr()` (409) if full. |
| POST | `/changeinvitestatus` | `ChangeInviteStatusSchema`: `invite_id` (positive int), `status`: `"accepted"` \| `"declined"` (never `"pending"`) | `{ error: 0, ...(joined && {alliancedata}) }` | Answers a row in the Invites tab. Only the side being asked may answer: an `invite` is the invited player's to accept/decline; a `request` is the leader's. Throws `permissionErr()` (403) if the row doesn't exist or the caller isn't the one being asked, `inviteNotPendingErr()` (409) if already resolved, `mustLeaveAllianceToAcceptErr()`/`userAlreadyInAllianceErr()` (409) if the relevant player already joined something else in the meantime. Accepting runs inside a transaction with a row lock on the alliance to prevent overfilling past 50 members concurrently. `alliancedata` (the same shape embedded in base-load — see below) is only included when this specific answer caused **the caller** to join (accepting an invite sent to them), not when a leader admits someone else. |
| GET | `/getmessages` | none | `{ error: 0, messages: InviteMessage[] }` | The Invites tab inbox: `{invite_id, type, status, alliance_name, alliance_image, leader_name, invited_by_name, user_id, user_name, user_pic_square, base_id, update_at_formatted (MM/DD/YYYY)}[]`, newest first. One inbox shows both directions — invites/requests waiting on the caller to answer, and the resolved outcomes of ones they sent. |
| POST | `/deletemessages` | `DeleteMessagesSchema`: `invite_ids` — a **comma-separated string** (Flash form-post artifact) transformed to `number[]`, max 100 ids | `{ error: 0, deleted: <count> }` | Clears selected Invites-tab rows, scoped to the caller's own inbox (ids outside it simply match nothing — no error). A still-`pending` row is **declined**, not deleted (the other party is owed an outcome notice); already-resolved rows are hard-deleted. |
| POST | `/kickmember` | `MemberActionSchema`: `userid` (positive int) | `{ error: 0 }` | **Leader only.** Throws `cannotKickErr()` (403) for self-kick or a `userid` that isn't actually a member of the caller's alliance. |
| POST | `/promotemember` | `MemberActionSchema`: `userid` | `{ error: 0 }` | **Leader only.** Hands leadership to `userid` and demotes the caller to member in the same transaction (an alliance always has exactly one leader) — this is the only way a leader with members remaining can eventually leave. Throws `cannotPromoteErr()` (403) for self-promote or a non-member target. |
| POST | `/changerelationship` | `ChangeRelationshipSchema`: `target_alliance_id` (positive int), `relationship`: `-1` (hostile) \| `0` (neutral) \| `1` (friendly) — coerced int piped through the `AllianceStance` enum | `{ error: 0 }` | **Leader only**, Browse tab. One-directional and private — only changes how the caller's alliance sees the target; the target is never notified, and nothing server-side restricts attacking based on it (advisory only — the client warns before attacking an ally). Throws `cannotChangeRelationshipErr()` (403) for self-target, an unknown target, or a target on a different Map Room version. Setting `NEUTRAL` deletes the stored row rather than writing a zero (neutral = absence of a flag). |
| GET | `/getpowerups` | none | `{ error: 0, powerups: [{powerup_id, type, active, endTime, hourly_cost, total_running_time, total_recharge_time}] (always 3 rows) }` | Requires membership. Reading this endpoint is also what **advances a finished run back into "charging"** — there is no background scheduler; `alliancePowerup()` lazily flips `active:false` and rolls `end_time` forward by the recharge time whenever a stale "active" row is read. |
| POST | `/activatepowerup` | `ActivatePowerupSchema`: `powerup_id` (positive int, matches `POWERUP_RULES[].powerup_id`: `1`=Armament, `2`=Conquest, `3`=Declare War) | `{ error: 0, powerups: [...] }` (same 3-row shape as getpowerups) | **Leader only** (`powerupLeaderOnlyErr()` 403, checked after confirming membership so a member sees "leader only" rather than "not in an alliance"). Starts a fully-charged power-up for `running_time` seconds, buffing the whole alliance. Throws `powerupUnknownErr()` (400) for a bad id, `powerupRunningErr()` (409) if already active, `powerupNotReadyErr()` (409) if still charging. Broadcasts a `POWERUP_ACTIVATED` alliance shout. |
| POST | `/purchasepowerup` | `PurchasePowerupSchema`: `powerup_id`, `purchase_hours` (positive int) | `{ error: 0, powerups: [...], credits }` | **Any member** may contribute Shiny to speed up a charging power-up (leader-only gate applies to activation, not funding). Cost = `min(purchase_hours, hoursRemaining) × hourly_cost` (from `POWERUP_RULES`), deducted from the caller's own `save.credits`. Throws `shinyLockedErr()` (403) if shiny-locked, `powerupUnknownErr()`/`powerupRunningErr()`/`powerupReadyErr()` (400/409) for bad state, `notEnoughShinyErr()` (409) if the caller can't afford even one hour. Broadcasts a `POWERUP_PURCHASE` shout. |

**Alliance member shape** (`AllianceMember`, used by `myalliancemembers` and
`getsuggestedmembers`): `{ user_id, display_name, pic_square, base_id, level (calculated from
points/basevalue), points (empire points), last_attacker (name, or "" if none), is_leader,
status: { online (has a recent last-seen key), damage_protection (save.protected > now) } }`.
`myalliancemembers` sorts by `points` descending; `getsuggestedmembers` sorts by most-recently
active.

**The `alliancedata` object** embedded in `/base/load`, `/base/updatesaved`, and returned by
`changeinvitestatus` on a successful self-join, is built by
`services/alliance/allianceData.ts`'s `getAllianceData(user)`:
`{ alliance_id, name, image, is_leader, relationships: Record<targetAllianceId, AllianceStance> }`
— a much smaller object than `/alliance/myalliance`'s response (no member count/rank/avg
level; those are only fetched for the dedicated Alliance UI, to keep the base-load hot path
cheap). A separate, unrelated `alliancedata` shape — `AllianceRosterEntry[]`
(`{alliance_id, name, image, relationships: {}}`, one per alliance referenced in a chunk of
cells) — is what `getAllianceRoster()` builds for the Map Room `getarea`/`getcells` responses;
its `relationships` field is always empty (`{}`), unlike the base-load version's populated map.

**Power-up run/recharge model** (`config/AllianceConfig.ts`'s `POWERUP_RULES`, backing the
`AlliancePowerup` table): Armament (`ap_armament`) runs 12h, recharges 7 days, costs 20
Shiny/hour to rush; Conquest (`ap_conquest`) runs 6h, recharges 5 days, 20 Shiny/hour;
Declare War (`ap_declarewar`) runs 12h, recharges 7 days, 20 Shiny/hour. A power-up an
alliance has never triggered starts **charging from the moment it's first read**, not from
the alliance's creation date.

**Text filtering**: alliance name and description both go through the `bad-words` npm
package's profanity filter (`services/alliance/textFilter.ts`), independent of and in addition
to the zod length/type validation — a syntactically valid but profane name/description is
rejected with a dedicated error, not a generic 400.

### Mail / Threads

Mounted at `/api/:apiVersion/player/...`, `apiVersion` + `verifyUserAuth` + `logRequest` on
every route.

| Method | Path | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|
| GET | `/getmessagetargets` | none | `{ targets: {} }` if no threads, else `{ targets: { [userid]: { friend: 0, mapver: 2, first_name, last_name?, pic_square? } } }` | Everyone the caller has an existing thread with. `friend` is hardcoded `0` and `mapver` hardcoded `2` — no actual per-user lookup for either. |
| GET | `/getmessagethreads` | none | `{ error: 0, threads: { [threadid]: FilteredMessage } }` | One entry per thread (its last message, `@FrontendKey`-filtered), keyed by `threadid`. Threads with a blocked counterpart or no `lastMessage` are filtered out. `userid` on each entry is rewritten to always be "the other party." `messageid` is the **array index**, not a stable id. |
| POST | `/getmessagethread` | `{ threadid: string→number }` | `{ error: 0, thread: { [messageid]: FilteredMessage } }` | Every message in a thread the caller participates in (silently `{}` if not a participant — no explicit ownership error). Marks the caller's unread messages read and recomputes `save.unreadmessages`. `messageid` is again just the array index. |
| POST | `/sendmessage` | `{ subject, type: MessageType, message (1–580 chars), targetid: string→number, threadid: string→number (0 = new), targetbaseid: string, baseid?: string }` | Success `{ error: 0, messageid: 0, threadid }` (note: `messageid` is hardcoded `0`); soft failure (still 200) `{ error: 1 }` or `{ error: 1, message }` | **General-purpose send, and where truce request/accept/reject live**, piggybacked on `type`: `"trucerequest"` creates a `Truce` row (403 `permissionErr()` if a duplicate pending/active truce exists); `"truceaccept"`/`"trucereject"` resolve the thread's linked truce (404 `mailboxErr()` if none/not requested; 403 `permissionErr()` if the caller isn't the recipient; accept sets a 14-day expiry). `"migraterequest"` has no special handling — stored as a plain message. `type` is gated by `devConfig.allowedMessageType`; disabled types return `{error:1, message:"Message type disabled on server"}` without persisting. Message/subject run through a profanity filter. Blocking is checked both directions. `targetbaseid`/`baseid` are required by the schema but **unused** in the handler. |
| POST | `/requesttruce` | `{ baseid, message (1–580 chars) }` | `{ error: 0 }` | A **second, independent** way to start a truce, keyed by `baseid` (e.g. from the attack/map UI) rather than an existing thread. Resolves the target via `Save.baseid`. Always creates a **new** thread (never reuses an existing one, unlike the `sendmessage` path). Same duplicate-truce guard as above. |
| POST | `/reportmessagethread` | `{ threadid: string→number, reason: string }` | `{ error: 0 }` | Adds the other thread participant's userid to the caller's `blockedUsers`. `reason` is accepted but **never stored anywhere** — no `Report` row is created despite the name. No check that the caller is actually a participant of the given thread. Idempotent (no-op if already blocked). |

### Attack Logs

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| GET | `/api/:apiVersion/attacklogs` | verifyUserAuth (no `apiVersion` check, no `logRequest`) | Query `filter?`: `AttackLogFilter` (`myattacks`, `peopleattackingme`; anything else, including `both`, behaves as "both") | `{ attackLogs: AttackLogs[] }` (raw entity rows, not `@FrontendKey`-filtered) | Up to 50 most recent rows, `attacktime DESC`, cached in Redis 30 minutes per user+filter. Rows are written exactly once, by `services/base/createAttackLog.ts` when an attack **starts** (called from `baseModeAttack.ts`) — `loot: {}` and `attackreport: {}` are hardcoded at creation and confirmed **never updated anywhere else** in the codebase (only `createAttackLog.ts` ever writes an `AttackLogs` row). A new client should not expect these two fields to ever be populated; they exist on the model but are currently dead columns. |

### Events

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| GET | `/api/:apiVersion/events/wmi` | apiVersion, logRequest (no auth) | Query `type`: `"wmi1"` \| `"wmi2"` (required) | Success: `{ start, end, extension }` (unix seconds); failure: `400 {error:"Missing required event parameters"}` or `400 {error:"Invalid invasion event"}` | Returns the schedule window for a Wild Monster Invasion event. WMI1/WMI2 alternate by calendar-month parity, always start the 10th of the month, run 7 days; `extension` is currently computed equal to `end` (adds 0 days). `devConfig.wmi{1,2}StartNowOverride` can force an immediate start for testing. Per-user wave progress/reset logic (`invasionUtils.ts`) exists but is not part of this endpoint's response. |

### Leaderboards

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| GET | `/api/:apiVersion/worlds` | publicReadLimiter (30/min/IP, **no auth**) | none | `{ worlds: World[] }` — every row of the `World` entity (see Data Models), verbatim, cached in Redis 24h under `availableWorlds`, invalidated whenever a world is created or renamed | Public. This is the same cached list `worldid` is validated against everywhere else (leaderboards, alliance world/map-version lookups) — a new client can treat it as the canonical world directory. |
| GET | `/api/:apiVersion/leaderboards` | publicReadLimiter (**no auth**) | Query `worldid` (required), `mapversion` (required numeric, must be MR2 or MR3) | `{ leaderboard: MR2Leaderboard[] \| MR3Leaderboard[] }`; `400` errors for missing params / unsupported version / unknown world | **MR2**: top 100 by outpost count (`{username, pic_square, discord_tag, outpost_count}`). **MR3**: top 25 by stronghold+outpost count (`{username, discord_tag, pic_square, stronghold_count, outpost_count}`). Both cached 2 hours in Redis. |

### Yard Planner

Two generations of routes share one storage column, `save.savetemplate`. The four `layouts`
routes are the version 2 API the web client uses; `gettemplates` and `savetemplate` are the
Flash client's and are deprecated. A layout saved through either is visible through both —
version 1 rows are converted to version 2 on read and never rewritten in place, and version 2
rows are converted back down for `gettemplates`.

A **layout** is `{ slot, name, version: 2, expansion, updatedAt, nodes }`. `expansion` is the
`storedata.ENL.q` the layout was drawn for (0-6) and `updatedAt` is unix seconds. A **node** is
`{ id, t, x, y, l?, fort? }`: the building id from `buildingdata`, its type, and its origin in
yard units. `l` and `fort` are advisory — Apply never writes them. Every account gets 10 slots,
enforced server-side (`docs/design/yard-planner-redesign.md` §8, decision Q2).

The `layouts` routes answer a rejection with the error status and the detail flattened next to
`error` (`{ error: "...", unplaced: [...] }`), not under `errorDetails` as the rest of the API
does. Validation lives in `server/src/services/yardplanner/validateLayout.ts` and the footprint
table it measures against is `server/src/game-data/buildingFootprints.ts`.

The two **batch** routes below (`walls/upgrade`, `traps/rearm`) are the only place in this API
where the server decides what something costs instead of adding a delta the client worked out.
Prices come from `server/src/game-data/buildingCosts.ts`, generated from the Flash props table
and byte-identical to the copy the web client shows them from; the rules live in
`services/yardplanner/wallUpgrade.ts` and `trapRearm.ts`. Both are all-or-nothing, both award
empire points the way the Flash client's `Upgraded()`/`Constructed()` do, and both answer a
rejection in the same flattened shape. `400` means the request names something wrong (`unknown`,
`notWalls`, `alreadyAtLevel`, `busy`, `damaged`, `level`, `notTraps`, `offGrid`, `outOfBounds`,
`overlapping`); `409` means the yard cannot do it yet (`shortfall`, `townHall`, `requirements`,
`capReached`).

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| GET | `/api/:apiVersion/bm/yardplanner/layouts` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0, slots: 10, layouts: Layout[] }` | Every saved layout, ordered by slot, converted to version 2. Slots with nothing in them are simply absent from the array. |
| PUT | `/api/:apiVersion/bm/yardplanner/layouts/:slot` | apiVersion, verifyUserAuth, logRequest | `name` (trimmed, 1-20 chars), `data` (JSON string of `{ version: 2, expansion, nodes }`) | `{ error: 0, layout }` | Overwrites one slot. Rejects with `400` for a slot outside 0-9, a name outside 1-20 characters, unreadable or non-version-2 data, more than 1200 nodes, a node id the caller's `buildingdata` does not have or has at a different type, a duplicate id, a position outside the plot for the layout's own `expansion`, or two footprints that overlap. Decorations are measured against the planner's extended 3240 x 2600 area instead of the plot. Mushrooms are ignored here. |
| DELETE | `/api/:apiVersion/bm/yardplanner/layouts/:slot` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0 }` | Empties one slot. Deleting an empty slot succeeds. `400` if the slot is outside 0-9. |
| POST | `/api/:apiVersion/bm/yardplanner/apply` | apiVersion, verifyUserAuth, logRequest | `data` (JSON string, same shape as PUT) | `{ error: 0, moved: number, buildingdata }` | **Server-authoritative**: the server moves the buildings, where the Flash client moved them itself and let an ordinary `/base/save` carry the result (`client/scripts/BASE.as:5025-5041`). Runs the same node checks as PUT, then three more: positions are measured against the caller's **current** `storedata.ENL.q` rather than the layout's `expansion`; mushrooms from `save.mushrooms` are obstacles no node may overlap; and every non-decoration, non-mushroom building in `buildingdata` must appear in `nodes`, else `409 { error, unplaced: [ids] }` with no auto-place (decision Q4). On success it writes only `X` and `Y` on the listed buildings, brings every countdown in the yard forward to now before moving `savetime`, and returns the updated `buildingdata`. Buildings under construction, upgrading or fortifying may be moved. No resource or level is touched. |
| POST | `/api/:apiVersion/bm/yardplanner/walls/upgrade` | apiVersion, verifyUserAuth, logRequest | `ids` (JSON string, `number[]`), `level` | `{ error: 0, upgraded, level, cost, resources, buildingdata }` | Raises every listed wall (type 17, or legacy 18) to `level` at once, charging `costs[k]` for each step server-side and completing instantly under the 300-second free-finish rule (decision Q1). All-or-nothing: `400` for unknown, non-wall, busy or damaged ids or a bad level; `409 { shortfall }`, `{ townHall }`, `{ requirements }` for state. Countdowns are advanced to now before `savetime` moves. |
| POST | `/api/:apiVersion/bm/yardplanner/traps/rearm` | apiVersion, verifyUserAuth, logRequest | `traps` (JSON string, `{ t, x, y }[]`) | `{ error: 0, placed, ids, cost, resources, buildingdata, firedtraps }` | Builds a Booby Trap (24) or Heavy Trap (117) at each position, charging `costs[0]`, capped by `quantity[townHallLevel]`, checked against the plot, every building and every mushroom. New ids continue from the highest existing id. Matching entries are removed from `save.firedtraps`, which the attack save fills when a trap fires. |
| GET | `/api/:apiVersion/bm/yardplanner/gettemplates` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0, ...entries }` | **Deprecated**, the Flash client's route. Keeps its original quirk: the array is spread into the body, so the client receives a numeric-string-keyed object, not a JSON array under a named key. Each entry is `{ slotid, name, data }` with `data` a JSON **string** of an index-keyed `{x, y, id, type}` object, because the client runs `JSON.parse` on it. Layouts written by the new client are converted down to this shape on the way out. |
| POST | `/api/:apiVersion/bm/yardplanner/savetemplate` | apiVersion, verifyUserAuth, logRequest | `{ slotid: number, name: string, data: string }` | `{ error: 0, ...entries }` (same spread-array quirk) | **Deprecated**, the Flash client's route. Now rejects `400` for a `slotid` outside 0-9 or a `data` payload over 64 KB, where before the request body was spread into the column unchecked. Everything else is taken as best it can be — the name is trimmed and clipped to 20 characters, unreadable nodes are dropped — because a Flash client cannot show a validation message from here. The nodes are converted to version 2 and stored alongside anything the new client wrote, with `expansion: 0` since a version 1 body never said which plot it was drawn for. |
| POST | `/api/:apiVersion/bm/yardplanner/deletetemplate` | apiVersion, verifyUserAuth, logRequest | `{ slotid: number }` | `{ error: 0 }` | **Deprecated** alias for `DELETE /layouts/:slot`. This is the route `BasePlannerService.clearSlot:64-67` has always called and the server never implemented, so until now a slot could only be overwritten, never emptied. |

### Debug

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| POST | `/api/:apiVersion/player/recorddebugdata` | apiVersion, debugDataLimiter (120/min/IP) — **no auth** | `{ key, saveid, value }` (all required strings, cast not zod-validated) | `{ error: 0 }`; `debugClientErr()` (404) if any field is falsy/missing | Client-side telemetry/error sink — purely logs to the server log (`key === "err"` exactly logs at error level, anything else at info level), nothing is persisted to the DB. |

### Misc

| Method | Path | Middleware | Description |
|---|---|---|---|
| POST | `/init` | logRequest | Validates `apiVersion` against the version manifest via a zod schema (`InitSchema`); `500 {error, versionMismatch:true}` on mismatch, else `200 {debugMode: devConfig.debugMode}`. The very first call a client makes. |
| GET | `/connection` | none | Heartbeat: `200`, no body. Polled by every connected client roughly every 30 seconds — treat a failure here as "server unreachable," not a game-logic error. |

---

## 3. Data models

All entities are in `server/src/database/models/`, decorated with MikroORM's
`@Entity`/`@Property`. Fields marked `@FrontendKey` in the source are the ones actually
returned to clients via `FilterFrontendKeys()` (used for `User` in auth responses and `Save`
in base load/save responses) — fields without that decorator exist in Postgres but are never
sent over the wire as-is.

### `User` (table `user`)

| Field | Type | Frontend? | Meaning |
|---|---|---|---|
| `userid` | number, PK, autoincrement | yes | Account id. |
| `save` | one-to-one → `Save`, nullable | — | The account's main-yard save. |
| `infernosave` | one-to-one → `Save`, nullable | — | The account's Inferno-yard save. |
| `username` | string, unique | yes | Display name. |
| `username_changed_at` | Date, nullable | yes | Drives the 6-month rename cooldown. |
| `banned` | boolean, default false | — | Blocks login and `verifyUserAuth`. |
| `shiny_locked` | boolean, default false | — | No-shiny mode toggle (`/player/settings`). |
| `email` | string, unique | yes | Login identity. |
| `password` | string | — | bcrypt hash. |
| `discord_verified` | boolean, default false | — | Gates login in `ENV=production`. |
| `discord_id` | string, nullable, indexed | — | Linked Discord account id; used for the "≥7 days old" age check. |
| `discord_tag` | string, nullable | — | Cached Discord tag, shown on leaderboards. |
| `discord_avatar_checked_at` | Date, nullable | — | Throttles avatar refresh. |
| `last_name` | string, default "" | yes | Never set by any writer reviewed (no registration/settings field for it) but read by `/player/getmessagetargets`, which includes it alongside `username`/`pic_square` for each mail target — likely a Facebook-era display-name field the client can still render if populated by other means (e.g. a migration from the original game). |
| `resetToken` | string, default "" | — | Current password-reset JWT (single-use). |
| `pic_square` | string, nullable | yes | Avatar URL. |
| `timeplayed` | number, default 0 | yes | Cumulative play time. |
| `stats` | jsonb, nullable | yes | Opaque per-account stats blob (also used for WMI wave progress — see `invasionUtils.ts`). |
| `friendcount` / `sessioncount` / `addtime` / `sendgift` / `sendinvite` | number | yes | Legacy Flash/Facebook social counters; mostly unused server-side beyond being echoed back. |
| `bookmarks` | jsonb, nullable | yes | Map bookmark list (`/player/savebookmarks`). |
| `blockedUsers` | jsonb, `number[]` | — | Userids the account has blocked (via `reportmessagethread` or block UI). |
| `alliance_id` | number, nullable, indexed | — | Current alliance, if any. |
| `alliance_role` | string (`AllianceRole`), nullable | — | `"leader"` or `"member"`. |

### `Save` (table `save`) — the base/yard record

This is the largest entity and represents **one yard** (main base, Inferno base, MR2/MR3
outpost, or a materialized wild-monster/tribe cell) — `type` (`BaseType`: `main`, `outpost`,
`tribe`, `inferno`, `iwm`, plus transient `random`/`get`/`set` values used only as request
discriminators) distinguishes which. Almost every field is `@FrontendKey` (sent to clients via
`mapSaveData`/`buildSaveData`); a handful of scalars are the row's own bookkeeping.

Key relations: `cell` (one-to-one → `WorldMapCell`, for MR2/MR3 — absent for MR1/Inferno
saves), `userid`/`saveuserid` (owning `User.userid` — `userid` is the *base's* nominal owner,
`saveuserid` is who it's billed/credited to; they differ for the special-case tribe/outpost
rows). Identifying fields: `basesaveid` (PK), `baseid` (string, the map-visible id used in
most other endpoints), `homebaseid` (numeric form of the owner's main `baseid`), `worldid`
(the `World.uuid` this yard belongs to, MR2/MR3 only), `wmid` (an `EnumYardType` value for
MR3 structures: outpost/resource/stronghold/fortification).

Scalar gameplay fields (selected — see the full list in `save.model.ts`): `credits` (shiny;
DB-constrained ≥0), `points`/`basevalue` (strings; combined by `calculateEmpirePoints`/
`calculateBaseLevel` into a level via `game-data/stats/experiencePoints.ts`'s 56-entry XP
table), `level`, `damage`, `destroyed`, `locked`, `protected` (unix timestamp until which the
base cannot be attacked), `cantmovetill` (migration cooldown), `attackid` (nonzero while under
active attack — a random 1–99999 id minted per attack), `mapversion` (`MapRoomVersion`),
`mr2upgraded` (bool, unlocks/keeps MR2 access independent of current `mapversion`),
`champion` (`ChampionData[]`: `{t, hp, l, ft, fd, fb, pl, status, nm?}` — champion type,
health, evolution level, feed time/count, food-bonus level, power level, status
0=active/1=frozen/2=juiced, optional name).

JSON blob columns (`jsonb`, mostly typed `JsonObject = Record<string, any>` at the DB layer —
their internal shape is defined by convention between client and specific handlers, not by
the DB schema):

| Column | Confirmed shape / contents |
|---|---|
| `resources`, `iresources` | `{ r1, r2, r3, r4, r1max, r2max, r3max, r4max }` — the four resource pools + their capacities. `iresources` is the Inferno-side pool. |
| `buildingdata` | `Record<buildingId, { x, y, t (type), id, l? (level), fort?, cB?/cU?/cF? (countdown build/upgrade/fortify), hp? (only present when damaged), rE? (repairing flag), prefab? }>` — every building on the yard. |
| `buildinghealthdata` | `Record<buildingId, number>` — current HP, only for buildings below full health (or `0` for a fired trap). |
| `firedtraps` | `{ t, X, Y, at }[]` — traps that fired and were removed, newest last, capped at 200. Written **only** by the server: `buildingDataHandler.ts` appends an entry as an attack save drops a trap (the one moment the position is still known, since a fired trap leaves nothing but a zero in `buildinghealthdata`), and `/yardplanner/traps/rearm` strikes entries off as they are rebuilt. Deliberately **not** in `Save.saveKeys`, so a client cannot write it; `@FrontendKey`, so it is sent out on `/base/load`. |
| `buildingkeydata` | Initialized to `{}` in every scaffolded base template (all MR2/MR3/Inferno tribe/outpost templates and the dev sandbox yards) and on the `Save` entity default; no code path in the server was found that ever writes a non-empty value or reads this field back. Effectively a dead/reserved column server-side today — a new client should not expect meaningful data here, but should still round-trip whatever it receives since `baseSave.ts`'s default JSON-parse-and-assign would persist a non-empty value the client sends. |
| `academy` | `Record<monsterKey, { level }>`, level clamped 0–6 by the server. |
| `storedata` | `Record<itemKey, { q (quantity owned/active), e? (expiry unix time, for duration-limited items) }>` — active/owned store purchases. |
| `attacks` | `AttackDetails[]`: `{ fbid, name, pic_square?, friend, count, starttime, seen }` — recent-attackers list shown on the base (capped to the last 2 entries once it exceeds 3). |
| `outposts` | `[x, y, baseid][]` tuples — every MR2 outpost the player owns. |
| `homebase` | `[x, y]` (as strings) — the player's home cell coordinates. |
| `wmstatus` | `number[][]` — per-tribe status tuples (tribe id first element) for MR1 wild-monster tribes the player has interacted with. |
| `champion` | see above. |
| `quests`, `player`, `krallen`, `siege`, `rewards`, `researchdata`, `lockerdata`, `events`, `inventory`, `monsterbaiter`, `loot`, `attackloot`, `lootreport`, `attackersiege`, `buildingresources`, `mushrooms`, `frontpage`, `effects`, `achieved`, `gifts`, `sentinvites`, `sentgifts`, `fbpromos`, `updates`, `stats`, `aiattacks`, `monsters`, `coords`, `savetemplate` | Opaque JSON, format owned by the Flash client / specific handlers; not exhaustively typed server-side (`JsonObject`). Confirmed specific uses: `rewards` holds unlockable-event flags keyed by reward id (see `getDefaultBaseData.ts`); `buildingresources` holds a `t` (last auto-bank timestamp) plus per-outpost `b{baseid}` resource snapshots for MR3 resource-outpost income; `savetemplate` is the yard-planner template array (`/bm/yardplanner/*`); `monsters` is the owned-monster roster (shape branches by MR2 vs MR3 in `monsterUpdateHandler.ts`). Everything else in this row is passed through opaquely by the server (read, stored, and echoed back without validation) — a new client must reproduce the Flash client's exact shape for whichever of these it needs to write to, since the server does not document or enforce one. |

`Save.saveKeys` / `Save.attackSaveKeys` (static arrays on the entity) enumerate exactly which
of the above the save endpoint will accept from the client in which context — see the Base
Save table above.

### `World` (table `world`)

`uuid` (PK), `name`, `playerCount`, `map_version` (2 or 3 — which grid system this world
uses), `createdAt`/`lastupdateAt`. One-to-many → `WorldMapCell` (orphan-removed with the
world).

### `WorldMapCell` (table `world_map_cell`)

`cellid` (PK), `baseid` (indexed), `map_version`, `uid` (owner's userid, indexed), `x`/`y`,
`base_type` (`MapRoomCell` for MR2 / `EnumYardType` for MR3), `terrainHeight`, `destroyed_at`
(nullable — set when an MR3 tribe cell is destroyed and pending regen). Many-to-one → `World`.
One-to-one → `Save` (`mappedBy: "cell"`) — the occupant, if any.

### `Maproom` / `InfernoMaproom` (tables `maproom` / `maproom_inferno`)

Identical shape, one per user (`userid` PK), for MR1 overworld vs. Inferno respectively:
`tribedata` (`TribeData[]`: `{baseid, tribeHealthData: Record<buildingId, hp>, monsters?,
destroyed?, destroyedAt?}` — per-tribe combat state), `neighbors` (`NeighbourData[]` — the
cached opponent-matchmaking list returned by `/bm/neighbours/get`, see its many optional
fields in `types/NeighbourData.ts`), `neighborsLastCalculated`.

### `Alliance` (table `alliance`)

`id` (PK), `name`, `image` (icon index 1–41), `description`, `leader_userid` (indexed),
`leader_name` (denormalized, kept in sync by `renameUser`), `world_id`, `map_version`,
`created_at`. One-to-one → `AllianceStats` (a DB view, not a stored column).

### `AllianceStats` (view `alliance_stats`, `alliancestats.view.ts`)

Computed, not stored: `member_count`, `empire_points` (sum of every member's main-save
`points+basevalue`), `world_rank`, `global_rank` (both via SQL `rank()` window functions,
partitioned by `world_id` and `map_version` respectively).

### `AllianceInvite` (table `alliance_invite`)

`id` (PK), `alliance_id`, `user_id`, `type` (`AllianceInviteType`: `invite` — leader invited a
player — or `request` — player asked to join), `status` (`AllianceInviteStatus`: `pending` →
`accepted`/`declined`), `created_at`/`updated_at`. Indexed by `(alliance_id, status)` and
`(user_id, status)`.

### `AllianceMessage` (table `alliance_message`)

`id` (PK, bigint), `alliance_id`, `author` (→ `User`), `targetAlliance` (→ `Alliance`,
nullable — set for relationship-change events), `messageType` (`AllianceMessageType`:
`message`, `joined`, `left`, `kicked`, `promoted`, `created`, `relationship`,
`powerup_activated`, `powerup_purchase`), `body`, `created_at`. This is the alliance chat
feed / activity log combined into one table.

### `AlliancePowerup` (table `alliance_powerup`, composite PK `[alliance_id, powerup]`)

`powerup` (`AlliancePowerupType`: `ap_armament`, `ap_conquest`, `ap_declarewar` — values chosen
to match the Flash client's `POWERUPS.as` keys exactly), `active` (bool), `end_time` (unix —
either "runs until" while active, or "ready again at" while recharging), `updated_at`. Rules
(run time, recharge time, hourly Shiny cost) live in code, not the DB —
`config/AllianceConfig.ts`'s `POWERUP_RULES`.

### `AllianceRelationship` (table `alliance_relationship`, composite PK on both alliance FKs)

`alliance`/`targetAlliance` (→ `Alliance`, both primary), `relationship` (`AllianceStance`:
`-1` hostile, `0` neutral, `1` friendly), `updated_at`.

### `ApiConsumer` (table `api_consumer`)

`id`, `name`, `key_prefix` (shown when listing keys), `key_hash` (unique — the actual secret is
never stored), `created_at`, `last_used_at`, `revoked_at`. Backs `verifyApiConsumer`.

### `AttackLogs` (table `attack_logs`)

`id`, `attacker_userid`/`attacker_username`/`attacker_pic_square`,
`defender_userid`/`defender_username`/`defender_pic_square`, `type`, `x`/`y` (nullable),
`loot` (jsonb), `attackreport` (jsonb), `attacktime`. Indexed on `(attacker_userid,
attacktime)` and `(defender_userid, attacktime)` for the two `/attacklogs` filter modes.

### `JobRun` (table `job_run`, composite PK `[job, period]`)

`ran_at`. A generic "has scheduled job X already run for period Y" marker, used by
cron-style scripts (e.g. `scripts/monthly-shiny.ts`) to avoid double-running.

### `Message` (table `message`)

`id` (uuid PK), `messageid`/`unread`/`messagecount` (all `persist: false` — computed at read
time, never stored), `threadid` (indexed), `updatetime`, `userid`, `targetid`, `messagetype`
(a `MessageType` string), `userUnread`/`targetUnread` (the two participants' independent
unread flags), `message` (≤580 chars), `subject`, `reportid` (default `"0"`, legacy — see
Mail table, never actually set to anything else in the code reviewed), `truceid`/`trucestate`
(nullable, set when `messagetype` is a truce message), `migratestate` (nullable, unused by any
handler reviewed), `coords` (nullable `number[]`), `worldid`/`baseid` (nullable), `createdAt`.
`selectUnread(userid)` picks `userUnread` or `targetUnread` depending on which side `userid`
is.

### `Thread` (table `thread`)

`id` (uuid PK), `threadid` (unique, numeric, what routes actually key on), `userid`,
`targetid`, `lastMessage` (one-to-one → `Message`), `messagecount`, `truce_id` (nullable),
`trucestate` (`TruceStatus`, nullable), `createdAt`. Indexed `(userid, threadid)` and
`(targetid, threadid)`.

### `Truce` (table `truce`)

`id`, `initiator_userid`, `recipient_userid`, `status` (`TruceStatus`: `requested` → `accepted`
| `rejected`), `expires_at` (unix, nullable — set on accept, 14 days out), `created_at`.
Indexed `(initiator_userid, status)` and `(recipient_userid, status)` (duplicate-truce checks
scan both).

### `Report` (table `report`)

`userid` (PK), `username` (unique), `discord_tag`, `report` (jsonb — accumulated report
detail), `banReason` (jsonb), `violations`, `attackViolations`, `createdAt`/`lastupdateAt`.
**Not** written by `/player/reportmessagethread` (which only touches `User.blockedUsers`) —
this table's writer is elsewhere (anti-cheat / moderation tooling), outside the files read for
this document.

---

## 4. Chat

WebSocket chat is a **separate service** from the HTTP API: same Bun process, different TCP
port, plain JSON-over-WebSocket protocol (no library — raw `Bun.serve({ websocket })`).

### Discovery & handshake

A client never derives the chat host itself — it comes from an HTTP base-load/base-save
response:

```
chatservers: [process.env.CHAT_WS_HOST]           // always present
chatenabled: 1, chattoken, chatchannel             // only when the caller owns the base
```

- `chattoken` is minted by `getOrCreateChatToken(userId)` (`chat/chatChannels.ts`): a
  `crypto.randomUUID()` stored in Redis at `chat-token:{userId}` with a **24-hour TTL**,
  reused (not rotated) on repeated calls while still valid.
- `chatchannel` is `getChatChannel(mapversion)` → one of `chat:mr1-global` / `chat:mr2-global`
  / `chat:mr3-global` (`config/ChatConfig.ts`'s `CHANNELS`), or `chat:inferno-global` for
  Inferno.
- The WebSocket upgrade itself requires no headers/query params — any request is upgraded.
  Authentication happens over the wire: the client's **first message** must be
  `{ type: "auth", userId, token }` (using `chattoken`/the account's `userid`); every other
  message type is rejected with `{ type: "error", code: "not_authenticated" }` until auth
  succeeds. After `auth_ok`, the client sends `{ type: "join", channel: chatchannel }` (the
  exact string handed out over HTTP) to enter global chat, or `{ type: "join", channel:
  "alliance" }` (a fixed alias — the server resolves it to the caller's real alliance
  channel server-side; a client cannot join another alliance's channel by guessing an id).

### Wire protocol (`chat/chatProtocol.ts`)

Client → server (`ClientMessageType`): `auth {userId, token}`, `join {channel}`,
`say {channel, message}`, `leave {channel}`, `getignore {}`, `ignore {targetId}`,
`unignore {targetId}`, `updatename {}` (accepted but a no-op — display names are
server-computed, not client-settable), `ping {}` (also currently a no-op, no pong reply).

Server → client (`ServerMessageType`): `auth_ok {userId, displayName}`,
`auth_fail {reason: "invalid_token" | "user_not_found"}`,
`joined {channel, history: HistoryEntry[]}`,
`message {channel, messageType, userId, displayName, picSquare, allianceImage, body, ts}`,
`user_enter {channel, userId, displayName}`, `user_exit {channel, userId}`,
`ignore_list {list: [{target, displayname}]}`,
`error {code: invalid_json | already_authenticated | rate_limited | not_authenticated |
invalid_channel | not_in_channel | server_error}`.

`messageType` on a `message`/`HistoryEntry` reuses `AllianceMessageType` (`message`, `joined`,
`left`, `kicked`, `promoted`, `created`, `relationship`, `powerup_activated`,
`powerup_purchase`) — ordinary chat lines are always `"message"`; the other values are
alliance-feed "shouts" delivered through the same channel and envelope, distinguishable only
by this field.

### `say` rate limiting and filtering

Enforced per-connection, in-process (not Redis, so it resets per socket, not per account across
chat-server instances): a `say` is rejected with `{ type: "error", code: "rate_limited" }` if
sent less than **500ms** after the connection's previous `say`. The message body is then
truncated to **200 characters** and passed through the `bad-words` npm package's profanity
filter; if filtering leaves nothing (the whole message was blocked words), the message is
**silently dropped** — no `message` is broadcast and no error is sent back, so a client should
not assume every accepted `say` produces a visible chat line. `join`/`leave`/`ignore`/`unignore`
have no rate limit.

### Rooms / channels

Global channel keys are the fixed strings above; alliance channels are
`chat:alliance:{allianceId}` (never accepted as a literal from the client — only reachable via
the `"alliance"` alias, resolved server-side from the caller's DB `alliance_id`). Joining is
idempotent per client; the server subscribes to the underlying Redis pub/sub channel only for
the first local member and unsubscribes when the last one leaves, so message delivery works
across multiple server processes.

### Identity

The socket is anonymous until `auth` succeeds; the server re-checks the token against Redis
(exact string match, not a signature) and loads the user fresh from Postgres (rejecting
banned/missing accounts). Display name is always server-computed as `` `[${level}] ${username}` ``
(level from `calculateBaseLevel`) — never trusted from the client. Only one live connection per
`userId` is allowed; authenticating a second time closes the first socket and evicts it from
its channels.

### History

Global channels: Redis list, capped at the 100 most recent messages, **30-day TTL** refreshed
on every push. Alliance channels: Postgres (`AllianceMessage` table), capped at the 50 most
recent rows per alliance (older rows deleted), durable (no TTL). Delivered automatically in the
`joined` message's `history` field.

### Ignore list

Redis set per user (`chat-ignore:{userId}`) of ignored target userids, managed by
`getignore`/`ignore`/`unignore`. **Not enforced server-side** on message delivery — the server
only ever reads/writes the set on explicit request; a client must filter incoming messages
against its own `ignore_list` itself.

### Shouts

Alliance join/leave/kick/promote/create and power-up events are persisted as `AllianceMessage`
rows and simultaneously published live to the alliance's channel using the ordinary `message`
envelope (distinguished only by `messageType`), so a connected client sees them in real time
without a page reload.

### Transport / process layout

`chat/chatServer.ts` (started by `server.ts`'s `startChatServer()`, before the HTTP app starts
listening) runs, in the same Bun process: (1) a legacy Flash **socket-policy** TCP server on
port `843` (answers `<policy-file-request/>` for the SWF client's cross-domain-socket
handshake); (2) the actual chat WebSocket listener on `process.env.CHAT_WS_PORT`
(`idleTimeout: 120`s). Cross-process fan-out uses a dedicated Redis pub/sub connection
(`chat/chatTransport.ts`); in-memory state (`chat/chatState.ts`) tracks only which userIds are
connected to which channels on *this* process and is lost on restart (clients must
reconnect/re-auth/re-join — history and the ignore list survive in Redis/Postgres). A small
control channel (`chat/chatControl.ts`, `chat:control`) lets the HTTP/API process tell the
chat process to force-evict a user from their alliance channel the moment they're kicked —
currently the only cross-process moderation command implemented.

---

## 5. Game data

`server/src/game-data/` holds two categories of data: things served to the client verbatim
over the API, and internal tables the server uses to validate or generate content, which the
client is expected to already know (from its own compiled assets).

| File / group | Holds | Used by | Served to client? |
|---|---|---|---|
| `flags.ts` | ~70 feature-flag/config values (`getFlags()`) — platform switches, feature toggles (`maproom`, `maproom2`, `chat`, `krallen`, `subscriptions`, `leaderboard`, …), tuning numbers (`savedelay`, `empire_value_limit`), legacy promo timestamp windows, plus spread-in Wild Monster Invasion phase flags | `baseLoad.ts`, `updateSaved.ts` | **Yes** — the `flags` key in every base load/save/updatesaved response; some fields (`discordOldEnough`, `maproom2`, `mr2upgraded`) are overwritten per-request by the controller. A new client must read this live, not hardcode it. |
| `getDefaultBaseData.ts` | Initial `Save` fields for a brand-new base/Inferno base | `Save.createMainSave`/`createInfernoSave` | Indirect — shapes the first `/base/load` response for a new account, not returned as its own endpoint. |
| `stats/championStats.ts`, `stats/monsterStats.ts` (+ `mr3MonsterStats`), `stats/experiencePoints.ts`, `stats/monsterKeys.ts` | Full champion/monster balance tables (health/damage/speed/training cost curves per level), the 56-entry level→XP threshold table, and plain id-list enumerations | `services/maproom/validateAttack.ts` (anti-cheat: compares client-submitted attack stats against these authoritative values), `calculateBaseLevel.ts`, `infernoModeBuild.ts` | **No.** Never placed in a response body — purely server-side validation/lookup. A new client must source equivalent balance numbers itself (from decompiled client assets) both to render UI and to submit attack payloads the server's anti-cheat will accept. |
| `store/storeItems.ts` | ~153 store item records: `{ t (title), d (description), du (duration seconds, 0=permanent), c (cost per tier, number[]), i (inactive flag), a (active flag) }` | `purchaseHandler.ts`, `services/base/updateCredits.ts`, **and `baseLoad.ts`** | **Yes** — `baseLoad.ts` includes `storeitems: storeItems` verbatim in every `/base/load` response. A new client can and should treat the store catalog as server-authoritative and fetch it live. |
| `store/purchaseKeys.ts` | Classification tables for non-store purchase codes and quest/mushroom shiny-reward amounts | `updateCredits.ts`, `purchaseHandler.ts` | **No.** Internal economy classification only. |
| `tribes/v1/*`, `tribes/v2/*`, `tribes/v3/*` (defenders/resources/strongholds/outposts), `tribes/inferno/molochTribes.ts` | Complete hand-built base layouts (full `buildingdata` etc., in the same shape as a real player `Save`) for every wild-monster tribe/tier, per map-room version | `services/maproom/{v1,v2,v3,inferno}/*TribeSave*.ts`, various load-mode controllers | **Indirectly yes, never as a bulk dump.** Each template is materialized into a real `Save` row and served through the ordinary `/base/load` (or attack) response for that specific cell, exactly like a player base — there is no "get all tribe data" endpoint. A new client does not need to port these large files to get layouts (it can request them per-cell like any base), but still needs its own building-type/level→visual asset mapping either way. |

**Conclusions for a new client:** two things are genuinely authoritative-and-fetchable —
`storeItems` (via `/base/load`'s `storeitems` key) and `flags` (via `flags` in
load/save/updatesaved) — don't hardcode either. Everything under `stats/` (champion/monster
balance numbers, XP thresholds) is validation-only and never transmitted; a new client needs
its own copy of equivalent numbers from the original client's assets, both for UI and because
`validateAttack.ts` will reject an attack payload whose reported stats don't match the
server's copy of these tables. The `tribes/**` templates don't need to be ported at all — they
surface automatically through the normal base-load flow per cell.

---

## 6. Notes for a new client

- **Two sessions per account, not one.** `sessionType` (`"game"` vs `"launcher"`) means a
  browser client should probably identify as `"game"` and can hold its own session
  independent of any existing launcher/website login — but logging in twice with the same
  `sessionType` invalidates the earlier token of that type immediately (no multi-device support
  within one session type).
- **A 200 response can still be a failure.** Because of the `isClientFriendly` inversion in
  `ErrorInterceptor` (see §1 Overview), always check the body's `error` field (and
  `errorDetails.message`) rather than trusting the HTTP status code alone, especially for
  gameplay outcomes like "base under attack," "under protection," "player online," "truce
  active" — these are all forced to HTTP 200.
- **Form-encoded JSON-in-a-string fields are pervasive, not legacy cruft to clean up.** Zod
  schemas across the codebase expect `resources`, `buildingdata`, `champion`, `purchase`,
  `attackData`, `bookmarks`, `monsterupdate`, etc. as JSON **strings**, not native nested JSON,
  even on JSON-content-type requests. A new client must keep double-encoding these fields.
- **Polling, not push, for base state.** `/base/updatesaved` is a client-driven ~30s poll while
  a base screen is open; there is no server-push equivalent for base/resource state (only chat
  is push-based, over its own WebSocket). `GET /connection` is a similar ~30s heartbeat with no
  payload.
- **Two independent "map/build version" concepts.** Don't conflate the `:apiVersion` URL
  segment (a client-build gate, only enforced when `USE_VERSION_MANAGEMENT=enabled`) with a
  player's Map Room version (`mapversion` on `Save`, switched via `setMapVersion`). Also note
  `apiVersion` is only actually attached as middleware on some routes — several routes that
  include `:apiVersion` in their path (e.g. `reset-password`) don't validate it at all, and
  `/base/*` routes don't even have the segment.
- **A Discord link with a 7-day age requirement gates most of the map.** `verifyAccountStatus`
  (or the equivalent manual check) blocks Map Room v2/v3 movement/attack actions until
  `meetsDiscordAgeCheck` is true. A new client needs a UI path for "link Discord and wait" as a
  precondition for full map access, separate from ordinary login.
- **Rate limits are per-route, keyed by user where authenticated and by IP where not**
  (`middleware/rateLimiters.ts`); prefixes matter internally but from a client's perspective
  the practical numbers are: login 30/5 min (prod), register 3/hour, username change 5/hour,
  MR2 `getarea` 120/min, MR3 `getcells` 60/min, alliance search 30/min, alliance invite 20/min,
  alliance join-request 10/min, public leaderboard/world reads 30/min (unauthenticated, by IP),
  debug logging 120/min (by IP). All return `429` with a plain `{ error: "..." }` body (not the
  `ClientSafeError` envelope).
- **Flash-specific artifacts to be aware of, not necessarily reproduce:** the socket-policy
  TCP server on port 843 exists purely for the SWF's cross-domain-socket requirement and is
  irrelevant to a web/WebSocket client. `AlliancePowerupType` values (`ap_armament`,
  `ap_conquest`, `ap_declarewar`) are literal strings copied from the Flash client's
  `POWERUPS.as` and must match exactly if any code branches on them. The yard-planner
  endpoints spread an array into a numeric-keyed object rather than returning a JSON array —
  a new client's parser needs to handle that shape, not assume `Array.isArray`. `login`'s
  response embeds several hardcoded protocol-version-looking fields (`version: 128`,
  `mapversion: 2`, `mailversion: 1`, `soundversion: 1`, `languageversion: 8`) that appear to be
  vestigial Flash/AS3 protocol constants rather than meaningful data — the source comment
  itself calls the response incomplete ("TODO: add remaining keys that the client expects").
- **Anti-cheat runs on every base save** (`scripts/anticheat/anticheat.ts`'s `validateSave`,
  invoked from `baseSave.ts` before any field is applied) — not detailed in this document since
  it wasn't in the requested scope, but a new client's save payloads will be checked against it
  the same as the original client's.
