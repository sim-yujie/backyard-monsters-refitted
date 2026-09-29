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
both. **Every route accepts either encoding**, and both reach a controller as the same flat
body. Query strings are used for GET routes.

**Form-urlencoded (`application/x-www-form-urlencoded`)** — what the archived Flash client
sends, via `URLLoader`/`URLVariables`. Every field is a string, so fields that hold structure
(`data`, `ids`, `traps`, `resources`, `buildingdata`, `buildinghealthdata`, `champion`,
`purchase`, `attackData`, `attackcost`, `monsterupdate`, `bookmarks`, `cellids`, `imonsters`
and friends) are **JSON-stringified into a single field**, and the zod schema (or the
controller) does `z.string().transform(JSON.parse)` on them. This is the contract the
schemas and services are written against and it has not changed.

**Native JSON (`application/json`)** — a structured field may be sent as the object or array
it is. `middleware/jsonBody.ts` (`jsonBodyCompat`, mounted directly after `koa-bodyparser`)
re-stringifies every **top-level** field of a JSON body whose value is an object or an array,
so what the router sees is identical to the form body above. A form body never enters that
middleware, so the Flash path is untouched. Two rules for a JSON client:

- **Scalars are passed through as sent.** Numbers are fine — the numeric body fields are
  declared `z.coerce.number()` — and booleans must not be stringified, because
  `POST /api/:apiVersion/player/settings` takes `shinyLocked: z.boolean()` and only a JSON
  body can satisfy it. `null` is left in place rather than becoming the string `"null"`.
  The id fields the schemas declare as plain `z.string()` — `baseid`, `basesaveid`,
  `attackid`, `userid` on `/base/load` — must still be **sent as strings**.
- **A field that is already a string stays a string**, so stringifying some fields yourself
  and not others is read the same way either way. Only the top level is converted, which is
  exactly as deep as a form body can go.

The two calls below are equivalent, and were verified against the dev server
(`PUT /api/:apiVersion/bm/yardplanner/layouts/:slot`):

```http
PUT /api/v1/bm/yardplanner/layouts/9
Content-Type: application/json
Authorization: Bearer <token>

{"name":"Main","data":{"version":2,"expansion":6,"nodes":[{"id":1,"t":1,"x":355,"y":375}]}}
```

```http
PUT /api/v1/bm/yardplanner/layouts/9
Content-Type: application/x-www-form-urlencoded
Authorization: Bearer <token>

name=Main&data=%7B%22version%22%3A2%2C%22expansion%22%3A6%2C%22nodes%22%3A%5B%7B%22id%22%3A1%2C%22t%22%3A1%2C%22x%22%3A355%2C%22y%22%3A375%7D%5D%7D
```

On the web client, `post()` in `web/src/api/http.ts` sends the form encoding and `postJson()`
(or `send(..., { json })`) sends the JSON one.

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
    `userOnlineErr`, `takeoverCellErr`, `truceActiveErr`, `mapRoomDisabledErr`,
    `economySaveRejectedErr` (a rejected `/base/save` under the economy audit — see "Economy
    save validation" under Base / Yard) and `attackNotBoundErr` (an attack save from someone
    other than the attacker, or after the attack ran out — see "Attack session binding").
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
| POST | `/api/:apiVersion/player/avatar` | apiVersion, verifyUserAuth, logRequest | `SetAvatarSchema`: `{ avatar: string }` | `{ error: 0, pic_square }` | Sets the player's avatar (issue #175) to one of the twelve critters in `game-data/avatars.ts`, stored in `pic_square` as its web-client path (`/avatars/<id>.webp`). Anything off that allow-list throws `unknownAvatarErr()` (400, `data.reason: "unknownAvatar"`) and writes nothing. The login's daily Discord refresh (`fetchDiscordAvatar`) leaves a picked critter in place. |

### Base / Yard

Mounted at `/base/...` — **no** `/api/:apiVersion` prefix and **no** `apiVersion` middleware
on any of these five routes.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/base/load` | verifyUserAuth, logRequest | `BaseLoadSchema`: `type` (a `BaseMode` value — see below), `userid` (accepted but unused by the handler), `baseid`, `mapversion?` (coerced number), `attackData?` (JSON string → `{champions?, monsters?}`), `attackcost?` (JSON string → `{resources?: number[], shiny?: number}`) | See "Base load/save response envelope" below | **The main "open a base" call.** `type` selects a mode handler: `build` (own yard, editable; on the caller's own main yard it first runs the yard catch-up and writes it — see "Yard actions"), `view`/`wmview` (someone else's yard, read-only), `attack`/`wmattack` (start an attack — runs every refusal first: protection, an attack already running, the defender being online, a truce, then range; only once all of them pass does it mint an `attackid`, lock the defender and log the attack, so a refused attack writes nothing), and Inferno equivalents `ibuild`/`iview`/`iattack`/`iwmattack`/`iwmview`/`idescent`. `attack`/`wmattack`/`iattack`/`iwmattack` require `ctx.meetsDiscordAgeCheck` (else `discordAgeErr()` 401) unless the target is a scripted MR1 tribe. Also used for Map Room 1's `/api/:apiVersion/bm/base/load` (identical controller, different mount). |
| POST | `/base/save` | verifyUserAuth, logRequest | `BaseSaveSchema` (`baseid`, `basesaveid`→number, plus a long list of optional JSON-string fields — `purchase`, `champion`/`attackerchampion`, `buildingdata`, `buildinghealthdata`, `monsterupdate`, `attackloot`, `resources`, `monsters`, `attackcreatures`, `attackersiege`, `over`→number, `destroyed`→number, `attackid`) **and** every raw body key matching `Save.saveKeys` (own base) or `Save.attackSaveKeys` (attack) is separately JSON-parsed onto the entity — see "Save write keys" below | `{ error: 0, basesaveid, ...filteredSave, ...(takeoverData && { takeover: takeoverData }), ...(grant && { takeovergrant }) }` | **The main "close/checkpoint a base" call.** Throws `permissionErr()` (403) if the caller neither owns the base nor is saving a base that carries a non-zero `attackid`. **An owner save of the caller's `main` yard or `outpost` is refused** with `ownerSaveRetiredErr()` (409, `reason: "ownerSaveRetired"`) before anything else runs, unless `OWNER_SAVE_MODE=allow` — see "Owner saves retired" below; attack saves are unaffected, so in practice this route now carries attack results only. An attack save must additionally be the result of *this caller's* attack, or it is refused with `attackNotBoundErr()` — see "Attack session binding" below. Runs `scripts/anticheat/anticheat.ts`'s `validateSave` before applying anything. On `over` (attack finished) with damage ≥ 90%, triggers MR3 structure takeover (`takeoverCellMR3`) or destroys an MR3 tribe cell, and grants the defender fresh damage protection, except that a Map Room 2 player outpost left at ≥ 90% gives the attacker a one-time takeover grant instead, answered as `takeovergrant` (see "Takeover grants"). `protected` and `locked` are never taken from the client (issue #182). Advances building timers to "now" using the pre-save health snapshot. **Non-attack owner saves of an `outpost` or `main` yard, which reach this far only under `OWNER_SAVE_MODE=allow`, are also run through the economy audit** before any key is applied — see "Economy save validation" below; controlled by `ECONOMY_SAVE_VALIDATION` (`off`/`log`/`reject`, default `log`). |
| POST | `/base/updatesaved` | verifyUserAuth, logRequest | inline schema: `type`, `version`, `lastupdate`, `baseid`, `mapversion`→number | `{ error: 0, flags, ...filteredSave, credits, ...(alliancedata && {alliancedata}), ...(powerups && {powerups}) }` | **Polling heartbeat**, called by the client roughly every 30 seconds while a base screen is open, to refresh timers/resources without a full `/base/load`. Does not accept any save data from the client — read-only refresh. |
| POST | `/base/migrate` | verifyUserAuth, verifyAccountStatus, logRequest | `MigrateBaseSchema`: `type` (`BaseType`), `baseid`, `resources?` (JSON), `shiny?`→number | Three shapes depending on branch: cooldown active → `{ error: 0, cantMoveTill, currenttime }`; `type="random"` (empire overrun) → `{ error: 0 }`; normal migrate-to-outpost → `{ error: 0, coords: [x, y] }` | Relocates the player's home base. A 24-hour cooldown (`userSave.cantmovetill`) applies after any migration. `type="random"` leaves and rejoins a Map Room 2 world at a new random location, free, only for a player on Map Room 2 (`reason` `notMapRoom2` otherwise, issue #190), on Flash's lost-main-base gate (`BASE.as:2340-2341`, `randomRelocateRefusal`): the main yard, caught up to now as a load would, is below 10% of its health (every building but traps and walls), the player is in no alliance and owns no outposts, and no attack on the main yard is running; otherwise `relocateRefusedErr` with `reason` `notMapRoom2`, `yardStanding`, `inAlliance`, `hasOutposts` or `underAttack` (HTTP 200, `error` set). Otherwise it swaps the home cell onto one of the **caller's own Map Room 2 outposts** in their world, deletes that outpost's cell and save, and charges the server's price: 30,000,000 of each resource, or 1,500 Shiny when `shiny` is positive (`services/maproom/v2/relocateRules.ts`, issue #181; the posted amounts are ignored). Refused, as HTTP 200 with `error` set and `reason` in `data`, when the outpost is not found, in another world, not an outpost, not the caller's, when it or the main yard is under attack (`underAttack`), or when the caller cannot pay; the main yard's row is locked first, then the outpost's (WP7); `shinyLockedErr()` 403 for Shiny on a shiny-locked account. All writes run in one transaction under a lock on the main yard row. |
| POST | `/base/checkpoint` | verifyUserAuth | `AttackCheckpointSchema` | `{ error: 0, stored, tick? }` | The web client's running record of an attack, so one left without a save is finished by the server rather than undone. See "Leaving an attack: checkpoints and finalisation" below (issue #138). |

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
add `attpowerups`. A `build` load of the caller's own main yard, or of one of their Map Room 2
outposts, adds `completed`: what its catch-up finished, in the yard routes' shape (see "The owner's `/base/load`" under "Yard actions"). Map Room 3 build/attack adds a `player.buffs` / `attackingplayer.buffs` /
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
| `buildingresources` | ignored | Server-owned since outposts WP4 (`services/maproom/v2/autobank.ts`): never written from an owner or an attack save. |
| everything else | inline | `JSON.parse(value)` if possible, else stored as the raw string. |

On an **attack** save (`Save.attackSaveKeys`: `destroyed`, `damage`, `locked`, `protected`,
`monsters`, `champion`, `over`, `buildingdata`, `buildinghealthdata`, `buildingresources`,
`attackreport`, `attackersiege`), additional attacker-side effects run: `monsterupdate` →
`monsterUpdateHandler.ts`. An MR3 object keyed by creature id is written as sent. An MR2
array of cells is **never written** (issue #103, `docs/design/yard-buildings.md` §4.6): only the
save carrying `over` acts on it, holding the final lock. It catches each of the attacker's own
yards named in it up to now (monsters only, scoped to the caller's `saveuserid`) and subtracts
the monsters that were flung. With a `flinglog` the count is the log's, taken first yard first,
and no yard gives more than it housed at attack entry (`entryHoused`, see "Attack session
binding"). Without a log the count is `clamp(entryHoused − sent, 0, entryHoused)` per yard. A
sent count can never add a monster, and production during the attack is kept. An outpost
that flung loses its protection, as before. An earlier save of the same attack does nothing
with it: every save repeats the whole log, so the final one settles the attack once (the same
rule `finaliseAttack.ts` uses). `attackcreatures` (Flash Map Room 1's whole-army blob) overwrites
the attacker's own `monsters` only when the attack session carries no `entryHoused`, which means
never on an MR2 or MR1 attack (issue #132: an MR1 attack's `entryHoused` holds the main yard
only, and its army settles through `monsterupdate` like an MR2 attack's). `attackloot` →
`attackLootHandler.ts` credits the attacker's resource pool; the resource bombs in the web
client's `flinglog` are then charged to the attacker at the shared rules' bomb costs, floored at 0
(issue #90, `services/base/combat/bombSpend.ts`; a bomb the attacker could not have fired is logged
or, under `COMBAT_SAVE_VALIDATION=reject`, refuses the save with reason `bombSpend`; a Flash save
carries no log and nets its bomb spend into `attackloot` instead); `resources` (the defender's
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

### Owner saves retired

An owner `/base/save` writes `Save.saveKeys` onto the row close to verbatim — `storedata`,
`buildingdata`, `champion` and the rest — which is how the Flash client banked everything it did
in its own yard. There is no Flash client any more, and the web client never sends an owner save:
its yard changes go through the server-authoritative action routes (Yard Planner, and the yard
action routes of `docs/design/yard-buildings.md`), and its only `/base/save` is the attack result
(`web/src/api/base.ts`, `saveAttack`). So an owner save of a **main** yard (issue #101,
`docs/design/yard-buildings.md` T1) or an **outpost** (outposts plan WP0b) is refused, controlled
by `OWNER_SAVE_MODE`:

- **`refuse`** (default; also what an absent or unknown value means, with a startup warning) —
  the save is refused right after the ownership check, before the attack binding, `validateSave`,
  the economy audit and any write, so the stored row is untouched. One `owner-save-refused` line
  is logged with the caller.
- **`allow`** — the save is applied as before. For debugging only.

The rule is `services/base/ownerSave.ts`'s `isRetiredOwnerSave`: the caller owns the row and the
row's `type` is `main` or `outpost`. Not refused, in either mode: attack saves (the caller is not
the owner, including the resource-bomb charge of issue #90), Inferno yards and Map Room 1 tribe
saves. The Inferno save route
(`/api/:apiVersion/bm/base/save`) applies the same check, because it writes whatever row
`basesaveid` names — the caller's main yard included.

**Refusal shape.** A real HTTP **409** (`isClientFriendly: true`; there is no Flash client left
to need the 200 rewrite):

```json
{
  "error": "Your yard is saved by the server now; this save was not applied. Reload your yard.",
  "errorDetails": {
    "status": 409,
    "data": { "reason": "ownerSaveRetired" },
    "message": "Your yard is saved by the server now; this save was not applied. Reload your yard."
  }
}
```

### Attack session binding

A non-zero `attackid` on a base says only that *somebody* is attacking it. On its own that is
not permission to write to the row, so `/base/save` also requires the save to come from the
account the server recorded when the attack began (`services/base/attackSession.ts`).

**Minting.** A successful `/base/load` with `type=attack` or `type=wmattack` mints the random
`attackid` onto the defender's row and, in the same step, writes a session to Redis under
`attack-session:<basesaveid>` holding `attackerid:attackid:startedat`
(`controllers/base/load/modes/baseModeAttack.ts`). For a Map Room 2 or Map Room 1 attack the
session is stored as JSON `{ attackerid, attackid, startedat, entryHoused }` instead. `entryHoused`
is what each of the attacker's own yards housed at entry, keyed by base id (on Map Room 1, the
main yard only: outposts do not fling there). The parser reads both forms.
Before minting, once every refusal has passed, the load catches both armies up
(`services/yard/armies.ts`, issue #103). The defender's main yard gets the full locked catch-up
its owner's load would give it (a defending outpost: its monsters). The attacker's main yard
gets the same, or is only measured while someone is attacking it. Every attacker outpost
inside the range rule's sweep box around the target gets its monsters caught up and written.
The defender's pool takes in its Map Room 2 outpost income first (outposts WP4, issue #179): a
defending outpost's owner is autobanked under their main row's lock before the catch-up, a
defending main yard inside its locked catch-up, so the `defenderResources` snapshot holds it.
Only a successful one: every refusal,
range included, is decided before the first write, so an attack the server turns down leaves no
`attackid`, no lock, no attack log and no session key (issue #26). The key's TTL is 480 seconds; the window it
authorises is **420 seconds**, the same `ATTACK_TIMEOUT` `isAttackActive` uses, so a defender
that is free to be attacked by somebody else can no longer be written to by the previous
attacker. The extra 60 seconds of key lifetime exist only so a late save is logged as `expired`
rather than as a base with no attack at all. A Map Room 1 tribe has no stored row, so its
session is keyed by attacker and tribe instead — see "Map Room 1 tribe attacks" below.

#### Map Room 1 tribe attacks

Every player has their own copy of the four Map Room 1 tribes (their `Maproom.tribedata`), so a
tribe attack has no defender row and no `basesaveid`. It is bound the same way all the same
(issue #161; before, a `/base/save` naming a tribe base credited `attackloot` and overwrote the
army with no attack behind it):

- **Load** (`wmattack`, `mapversion: 1`, a tribe base id). Refused with 409
  `mr1TribeRefusedErr` before anything is written (`services/maproom/v1/mr1TribeAttack.ts`) when
  the caller's main save is not on map version 1 (`reason: "notMapRoom1"`), the base is not one
  of the four tribes their map shows now (`"notYourTribe"`: another Town Hall tier's), or it is
  wrecked and has not respawned (`"tribeDestroyed"`, with `respawnAt`). A wrecked tribe whose ten
  minutes are up is stood back up there. A successful load mints the session under
  `attack-session:mr1:<userid>:<tribe baseid>` (`mr1TribeSession.ts`), same format, TTL and
  420-second window.
- **Save** (`/base/save`, `baseid` = the tribe, `basesaveid` `"0"`). The session is checked with
  `checkAttackBinding` (same reasons as below) before anything is written. A save without `over`
  records only the tribe's damage (`buildinghealthdata`, `destroyed`, `damage`). The save carrying
  `over` takes `attack-final:mr1:<userid>:<baseid>` (a copy racing it is refused with
  `reason: "finalising"`), applies the attacker's side — the army (the flung monsters leave the
  main yard's housing through `monsterupdate` and the fling log, capped by the session's
  `entryHoused`, exactly as an MR2 attack settles; `attackcreatures` is ignored and only the
  main yard's `monsterupdate` entry is read), `attackerchampion`, `attackersiege`,
  the bombs in `flinglog` (issue #90), and the loot — then ends the session, so a copy sent again
  as the page closes is refused with `"no-session"`. The loot credited is
  `creditableMR1Loot` (`mr1TribeRules.ts`): each resource whole and non-negative, and everything
  taken from that tribe since it last respawned (`tribedata[].looted`) at most its pool — its
  `resources` plus its harvesters' `st` — times `LOOT_GAIN_RATIO` (1.6, the low-level bonus).
  There is no `/base/checkpoint` for a tribe attack.

**Checking.** On an attack save — the caller is not the owner and the row's `attackid` is
non-zero — the session is read back and checked before `validateSave`, before the economy audit
and before any key is applied, so a refusal leaves the stored row byte-for-byte untouched. The
rule is pure and lives in `checkAttackBinding`:

| Order | Condition | `errorDetails.data.reason` |
|---|---|---|
| 1 | No session stored for this `basesaveid` | `no-session` |
| 2 | `now - startedat >= 420` | `expired` |
| 3 | The session's `attackerid` is not the authenticated caller's `userid` | `wrong-attacker` |
| 4 | The session's `attackid` is not the one now on the row, or not the one the client sent | `stale-attack` |

The binding is derived from the authenticated user, not from anything new the client sends: the
archived Flash client cannot be taught new fields. It does already send `attackid` on every
non-build save (`client/scripts/BASE.as:3264`), and that value is compared when it is present
and non-zero, but only as a consistency check — a value the client holds authorises nothing.

**Refusal shape.** `attackNotBoundErr()` is `isClientFriendly: false`, so like the economy
refusal it comes back as **HTTP 200** with `error` set — the only failure shape the Flash client
turns into a readable message rather than five silent retries. The intended status travels in
`errorDetails.status` as `403`, and the reason in `errorDetails.data.reason`:

```json
{
  "error": "This attack is no longer yours to save. Reload your yard.",
  "errorDetails": {
    "error": "This attack is no longer yours to save. Reload your yard.",
    "status": 403,
    "data": { "reason": "wrong-attacker" },
    "message": "This attack is no longer yours to save. Reload your yard."
  }
}
```

Every refusal writes one `attack-binding-refused` line to the log with the caller, the recorded
attacker and the reason.

**Ending.** A save carrying `over` clears the row's `attackid` and deletes the session key, so
the base is immediately free rather than carrying a key that authorises nothing until it times
out.

**Once.** A save carrying `over` first takes a Redis lock, `attack-final:<basesaveid>` (`SET NX`,
30 seconds), and releases it when it is done (issue #138). The server finishing an abandoned attack
takes the same lock (below), and each ends the session before letting go, so of two that race —
the web client's final save and the copy of it sent as the page closes, or a save and the server's
finalisation — exactly one lands. The loser is refused with `attackNotBoundErr("finalising")` if it
arrives while the lock is held, or by the binding check / `permissionErr` once the row is free.

### Leaving an attack: checkpoints and finalisation (issue #138)

Leaving the web client's attack screen (a reload, a closed tab, browser Back, in-app navigation, a
sign-out) ends the battle at that moment, with its results standing. The client sends its final
save as a keepalive request as the page goes (`web/src/game/attack/plugins/end.ts`). A hidden tab
(another tab, a minimised browser, a locked phone) is not leaving and ends nothing. So that an
attack whose save never arrives (a killed browser, a hidden page the browser or phone discards, a
lost connection) is not undone, the client also checkpoints it:

| Method | Path | Middleware | Request fields | Response |
|---|---|---|---|---|
| POST | `/base/checkpoint` | verifyUserAuth | `AttackCheckpointSchema`: `basesaveid`, `attackid?`, `tick` (battle ticks reached), `flinglog` (JSON string, the §3.10 fling log so far), `sources` (JSON string array of the attacker's cell base ids, in the order a fling spends them) | `{ error: 0, stored: true, tick }`, or `{ error: 0, stored: false }` for a log with no events (#79) |

Sent after every drop, bomb and siege weapon, every 5 seconds while the battle runs, and once
more when the page is hidden. Bound
exactly like the attack save (same `checkAttackBinding`). A checkpoint may only extend the one
held: same seed, every stored event unchanged and in place, a clock that has not gone back; else
`attackCheckpointRefusedErr` (409, `reason`: `malformed`, `rewound` or `reseeded`). It writes no
game state: the latest checkpoint is kept in Redis under `attack-checkpoint:<basesaveid>`, indexed
by the set `attack-checkpoints` (`services/base/attackCheckpoint.ts`, `attackCheckpointStore.ts`).

**Finalisation** (`services/base/finaliseAttack.ts`) finishes an attack from its checkpoint: the
log is replayed with the shared engine to the checkpoint's tick (`combat/abandonedAttack.ts`) and
the result written as an `over` save would write it — flung monsters taken out of the listed cells
(each caught up to now first, monsters only, so production during the attack stays; first cell
first, the same subtraction the attack save uses, `services/yard/attackRoster.ts`), bombs charged (`combat/bombSpend.ts`), loot credited, the
attacker's champion health and siege stock, the defender's health, damage, `destroyed`, fired traps,
resource loss and report, damage protection, `attackid` cleared, session ended. It runs, under the
same final lock:

- at the top of `/base/load` for `build` and every attack mode, for every attack the caller left
  without a save, window or not, before any row is read;
- at the top of an `attack`/`wmattack` load, for the target row's previous attack if its window has
  closed; and at the top of a `build` load, for attacks on the caller's own yard whose window has
  closed;
- from a sweep every 60 seconds (`startAttackFinaliser`, `server.ts`), for every attack whose
  window has closed.

The final save and the finalisation discard the checkpoint, so each attack is written once.

**Not yet covered.** The Inferno save endpoint (`/api/:apiVersion/bm/base/save` →
`controllers/inferno/infernoSave.ts`) still has the original gate — a non-zero `attackid` on the
Inferno row is enough — and `infernoModeAttack` mints no session. The two sides have to land
together, so the Inferno twin is left for a follow-up.

### Economy save validation

Every non-attack owner save of a `main` or `outpost` yard is audited against the building cost
table before any key is applied (a `main` one only reaches the audit under
`OWNER_SAVE_MODE=allow` — see "Owner saves retired"), controlled by the `ECONOMY_SAVE_VALIDATION` environment
variable (`off` | `log` | `reject`, default `log`). The rule set, the reference-yard method
(advancing the stored countdowns to "now" before comparing, so a countdown that merely ticked is
never a violation) and the rollout plan are in
[`docs/design/economy-save-validation.md`](design/economy-save-validation.md).

- **`off`** — today's behaviour: nothing is audited, nothing is derived.
- **`log`** — the audit runs and every violation is written as a structured `logger.warn` line
  plus one `Report` row (`services/base/reportManager.ts`'s `logReport`), but nothing the player
  sees changes: `resources.r1max..r4max`, `basevalue` and `points` are still stored exactly as
  the client sent them, and the save always succeeds.
- **`reject`** — the same audit, but a save carrying an *enforced* violation is refused (see
  below), and `resources.r1max..r4max` / `basevalue` are overwritten with the server-derived
  values instead of the client's.

Attack saves, Inferno saves and Map Room 1 tribe saves are never audited.

**Rejection shape.** A rejected save is still an HTTP **200** with `error` set — the same
`isClientFriendly: false` convention as the other six cases in §1 "Errors" — because that is the
one failure shape the archived Flash client can show the player; a real `409` would instead
trigger its silent-retry path. A client should check `errorDetails.data.violations` the same way
it already checks `error`/`errorDetails.message` for every other soft failure:

```json
{
  "error": "This save does not add up (resourceBudget). Reload your yard.",
  "errorDetails": {
    "status": 409,
    "message": "This save does not add up (resourceBudget). Reload your yard.",
    "data": {
      "violations": [
        {
          "rule": "resourceBudget",
          "detail": { "resource": "r1", "delta": 1000000000, "budget": 43200 },
          "enforced": true
        }
      ],
      "elapsed": 61
    }
  }
}
```

A malformed save (`buildingdata` not a map of `{ t, id }` objects, or `points`/`basevalue`/
`resources` not numeric) is instead a real `400` in every mode, since only a broken client sends
one — the request is rejected before an audit verdict exists at all.

**Rule names.** Every violation the audit can record. "Enforced" means it rejects the save in
`reject` mode; a recorded-only rule is always written to the log and the `Report` row but never
rejects, in any mode:

| Rule | Enforced? | Meaning |
|---|---|---|
| `typeChanged` | Yes | A building changed type other than the legacy Stone→Wooden Block (18→17) rewrite. |
| `unknownType` | Yes | A new building has no row in the cost table. |
| `unpaidBuild` | Yes | A new, finished building has no free finish, voucher or inventory source explaining it. |
| `levelJumped` | Yes | A building's level rose by more than the ladder walk allows, or a `cB` building reports a level past 1. |
| `levelDropped` | Yes | A building's level fell. |
| `unpaidUpgrade` | Yes | A level step finished with no countdown, free finish or `IU` voucher. |
| `upgradeBlocked` | Yes | A new countdown started on a building the yard cannot upgrade yet — town hall, prerequisites, busy or damaged, the same detail keys the Yard Planner batch routes use. |
| `countdownJumped` | Yes | A countdown shrank faster than elapsed time with no speed-up voucher to explain the gap. |
| `countdownTooLong` | Yes | A countdown started above `costs[level].time` (scaled by the Sharper Tools multiplier). |
| `capReached` | Yes | More buildings of a type than `quantity[townHallLevel]` allows. |
| `voucherShort` | Yes | An `IB`/`IU`/`BRTOPUP` voucher is smaller than the price it needs to cover. |
| `negativePool` | Yes | The resource delta would take a pool below zero. |
| `resourceBudget` | Yes for `r1`/`r2`; recorded-only for `r3`/`r4` | A positive resource delta exceeds what harvesting, outpost income, refunds and top-ups can explain. `r3`/`r4` (putty/goo) are recorded only, because monster and academy accounting — which also returns putty/goo — is out of scope for this audit. |
| `bufferJumped` | Yes | A harvester's buffered amount is above what it could have produced since the last save. |
| `overCap` | Yes | A positive delta carries a pool from at/below the derived storage cap to above it. |
| `capMismatch` | No (recorded-only) | The client's `rNmax` differs from the server-derived cap. Can't reject, because `reject` mode overwrites `rNmax` instead of comparing it. |
| `basevalueMismatch` | No (recorded-only) | The client's `basevalue` differs from the server-derived value, for the same reason. |
| `pointsJumped` | Yes | `points` grew by more than banking, completions and outpost income allow, or shrank. |
| `fortifyUnpriced` | No (recorded-only) | A fortification step has no ladder to price yet — no Map Room 2 main-yard building can fortify today. |

### Map Room 1 / Inferno

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/api/:apiVersion/bm/getnewmap` | apiVersion, verifyUserAuth, logRequest | none | If the user's home cell is on Map Room 3: `{ newmap: true, mapheaderurl, width: 500, height: 500 }`; else `{ newmap: false }` | Tells the client at startup whether to use the legacy (non-grid) map UI or the MR3 grid UI. |
| POST | `/api/:apiVersion/bm/base/load` | apiVersion, verifyUserAuth, logRequest | same as `/base/load` | same as `/base/load` | Identical controller to `/base/load`, mounted under the MR1 API prefix. |
| POST | `/api/:apiVersion/bm/base/save` | apiVersion, verifyUserAuth, logRequest | `BaseSaveSchema`, same as `/base/save` | If no `Save` row matches `basesaveid`: `{ error: 0, ...freshlyScaledMolochTribeBase }` (see §5 Game data — Inferno tribe templates). Otherwise: `{ error: 0, ...filteredSave, champion: [], credits }` (`champion` forced empty; `credits` via `visibleCredits`) | The **Inferno** equivalent of `/base/save`. A first save against a not-yet-materialized attack target hands back a freshly level-scaled "Moloch tribe" base to attack. Runs the same damage-protection and building-timer-advance logic as `/base/save`, and the same owner-save refusal: an owner save naming the caller's `main` yard is refused with `ownerSaveRetiredErr()` (409) under `OWNER_SAVE_MODE=refuse` (see "Owner saves retired"); Inferno yards are unaffected. |
| POST | `/api/:apiVersion/bm/base/updatesaved` | verifyUserAuth, logRequest | same inline schema as `/base/updatesaved` | same shape as `/base/updatesaved` | Same controller as `/base/updatesaved`. |
| POST | `/api/:apiVersion/bm/base/infernomonsters` | apiVersion, verifyUserAuth, logRequest | `{ type: "get" \| "set", imonsters?: JSON string, default {} }` | `{ error: 0, imonsters }` | Gets or sets the player's Inferno monster cage/roster (`Save.monsters` on the Inferno save). `get` ignores whatever the client sent and returns the DB value; `set` persists and echoes back the client's value unchanged. |
| POST | `/api/:apiVersion/bm/neighbours/get` | apiVersion, verifyUserAuth, logRequest | `{ type?: string }` (`"inferno"` selects the Inferno pool, anything else the MR1 overworld pool) | `{ error: 0, wmbases: [], bases: NeighbourData[] }` (`wmbases` always empty, kept for legacy compatibility); if the caller has no `save` at all: `{ error: 0, bases: [] }` (no `wmbases` key) | Returns a cached PvP matchmaking list of opponents (`Maproom.neighbors` / `InfernoMaproom.neighbors`, re-rolled every ~2 weeks once ≥10 candidates are found, else retried every 30 min). MR1/Inferno has **no coordinate grid** at all — there is no per-cell or viewport endpoint; browsing opponents means picking from this cached list. |
| GET | `/api/:apiVersion/bm/maproom1` | apiVersion, verifyUserAuth (no `logRequest`: re-read while the map is open) | none | `{ error: 0, now, level, protectedUntil, tribes: MapRoom1Tribe[4], neighbours: NeighbourData[] }` — see "Map Room 1 read" below | The web client's Map Room 1 screen in one read (issue #132). 409 `reason: "notMapRoom1"` once the player's main save is on Map Room 2. |


#### Map Room 1 read

`GET /api/:apiVersion/bm/maproom1` (`controllers/maproom/getMapRoom1.ts`, pure shape
`services/maproom/v1/mapRoom1View.ts`) answers everything the web client's Map Room 1 screen
shows. It does what Flash's map did on open — the build-mode load with `mapversion: 1` plus
`bm/neighbours/get` — so it writes: tribes wrecked at least ten minutes ago are stood back up,
the four current tribes are merged into the save's `wmstatus`, and the neighbour list is
re-searched when its cache has run out (same cache rules as `bm/neighbours/get`).

```jsonc
{
  "error": 0,
  "now": 1790000000,          // server unix seconds, to count respawnAt / protection down
  "level": 12,                // the player's base level
  "protectedUntil": 0,        // when the player's own damage protection ends; 0 without any
  "tribes": [                 // always 4: Legionnaire, Kozu, Abunakki, Dreadnaut
    {
      "baseid": "3",          // for wmview / wmattack with mapversion: 1
      "tribe": "Legionnaire",
      "tier": "TH3",          // NEW (Town Hall 1-2) | TH3 | TH4 | TH5 | HIGH (6+)
      "level": 11,            // pin level: player level -1, 0, +1, +2 (min 1)
      "destroyed": 1,
      "damage": 95,           // last attack's damage % this tribe life; 0 when fresh
      "respawnAt": 1790000420 // unix seconds a wrecked tribe is back; 0 when standing
    }
  ],
  "neighbours": [ /* the `bases` of bm/neighbours/get, plus protectedUntil on each */ ]
}
```

There is no tutorial camp: every account faces its Town Hall's tier (base 1, Flash's tutorial
camp before tutorial stage 205, is no longer served, since no tutorial exists; issue #132).
Every neighbour entry (here and in `bm/neighbours/get`) carries `protectedUntil`, the unix
second its damage protection ends, 0 without any. Refused with a real 409
`{ error, errorDetails: { data: { reason: "notMapRoom1" } } }` when the player's main save is
not on map version 1.

### Map Room 2

An 800×800 grid per `World`; terrain for cells that have never held activity is generated
live from a noise function seeded by the world's uuid, and is not persisted.

| Method | Path | Middleware | Request fields | Response (`ctx.body`) | Description |
|---|---|---|---|---|---|
| POST | `/worldmapv2/getarea` | verifyUserAuth, verifyAccountStatus (+Discord age check), getAreaLimiter (120/min/user), logRequest | `{ x, y }` (coerced ints, 0–799), `sendresources?` (coerced number, default 0) | `{ error: 0, x, y, data: { [x]: { [y]: CellPayload } }, alliancedata, ...(sendresources===1 && { resources, credits }) }` for an **11×11** block (`x..x+10`, `y..y+10`); `{ error: 0, x, y, data: {}, alliancedata: [] }` (still `200`, no `resources`/`credits` even if requested) if the caller has no Map Room 2 placement | The core "pan the map" call. Throws `mapRoomDisabledErr()` (404, rewritten to 200 by the interceptor since it's `isClientFriendly:false`) if MR2 is disabled server-wide. **No placement** — no `Save` row yet (before the account's first `/base/load`) or a `Save` whose `worldid` is still null (Town Hall < 6, or not yet through `setmapversion`) — returns the clean empty response above instead of throwing (`services/maproom/v2/emptyAreaResponse.ts`), mirroring `/worldmapv3/getcells`'s `{ celldata: [] }` for the same case; the route used to crash with a 500 here (issue #35), which the web client's `ZoneStore` retried forever with backoff since it treats any thrown error as transient. See "MR2 cell payload" below for `CellPayload` field meanings. |
| GET | `/worldmapv2/terrain` | **verifyApiConsumer (X-API-Key)**, terrainLimiter (10/min/consumer), logRequest | Query: `worldid` (uuid, required) | `application/octet-stream`, exactly 640,000 bytes — one unsigned byte of terrain height per cell, indexed `x*800+y`. Brotli/gzip negotiated, strong `ETag`, `Cache-Control: public, max-age=3600`-style immutable caching, 304 on matching `If-None-Match` | **API-consumer only**, not for the game client — built for an external map-viewer. Full terrain height map for one MR2 world. |
| GET | `/worldmapv2/snapshot` | **verifyApiConsumer**, snapshotLimiter (10/min/consumer), logRequest | Query: `worldid` (uuid, required) | JSON occupancy overlay: generated at most once every 5 minutes per world; players, cells `[x,y,base_type,uid,baseid,empirevalue,flinger,catapult,damage,protectedUntil,destroyed][]` | **API-consumer only.** Everything occupied in a world (main yards, outposts, attacked wild-monster camps) that isn't derivable from terrain alone — meant to be combined client-side with `/worldmapv2/terrain`. |
| GET | `/worldmapv2/alliances` | **verifyApiConsumer**, alliancesLimiter (10/min/consumer), logRequest | none | JSON directory of every MR2 alliance across all worlds: membership, leader, and hostile(-1)/friendly(1) relationship flags | **API-consumer only.** Lets an external map viewer color/label territory by alliance without per-alliance calls. |
| POST | `/worldmapv2/setmapversion` | verifyUserAuth, logRequest (Discord-age check done manually in the controller) | `{ version }` (string→`MapRoomVersion`: 0=NONE, 1=V1, 2=V2, 3=V3) | `{ error: 0, id, baseurl, ...filteredSave }` | Switches the player's Map Room version. `NONE`: leaves the current world, drops to `mapversion=1`. `V2`: requires Town Hall ≥ 6 (unless already `mr2upgraded`) and no alliance; joins a random MR2 world under 2500 players or creates one. `V3`: same TH6 gate; calls the MR3 world-join flow. Shared controller with the MR3 routes below. |
| POST | `/worldmapv2/takeoverCell` | verifyUserAuth, verifyAccountStatus, logRequest | `TakeoverCellSchema`: `{ baseid, resources?: JSON, shiny?→number }` | `{ error: 0 }` | Converts a ≥90%-damaged Map Room 2 cell in the caller's world into the caller's outpost: charges the server's price (`takeoverCost.ts`; a positive `shiny` picks Shiny, the posted amounts are ignored), evicts any previous owner, grants a 12h protection window. Eligibility is `services/maproom/v2/takeoverRules.ts` (issue #182): never a main yard or the caller's own cell; a **wild camp** follows Flash (anyone in range, destroyed, not regenerated 12 h after its last save, not protected, not locked by someone else, no attack running); a **player outpost** can be taken only by the attacker holding its one-time takeover grant (see "Takeover grants" below), which the takeover spends; and the caller must be under 3,500 outposts. Range is `validateRange`. Checks and writes run in one transaction with the caller's main yard, the target and the previous owner's main yard locked. Refused with `takeoverRefusedErr(reason)` (HTTP 200, `error` set, `reason` in `data`). |
| POST | `/worldmapv2/takeoverquote` | verifyUserAuth, verifyAccountStatus, takeoverQuoteLimiter (60/min per user), logRequest | `{ baseid }` | `{ error: 0, baseid, kind?: "camp" \| "outpost", eligible, reason, resources?, shiny?, adjacent?, grantExpiresAt?, affordable?: { resources, shiny }, shinyLocked?, now }` | What taking a Map Room 2 cell over would cost the caller and whether `takeoverCell` would allow it now (issue #82). Runs `takeoverRules.ts` on the same rows, unlocked, then the range rule (`rangeCheckV2`, reported as `outOfRange` instead of thrown), and prices with `quoteTakeover`. `reason` is null when eligible, else a `TakeoverRefusal` or `outOfRange`; payment is answered per way in `affordable`, never as a reason. `grantExpiresAt` is set only on a player outpost while the caller holds its takeover grant; a player outpost without one answers `noTakeoverChance`. A wild camp never attacked has no cell row: it is priced from the coordinates in its id and answers `notDestroyed`. An id that is not a cell of the caller's world, or is water, answers `eligible: false, reason: "notFound"` with no price. Always HTTP 200. `now` is server seconds, for countdowns. |
| POST | `/worldmapv2/declinetakeover` | verifyUserAuth, verifyAccountStatus, logRequest | `{ baseid }` | `{ error: 0, protectedUntil }` | The attacker turns down their one-time takeover grant on an outpost (issue #182): the grant ends and the outpost's 8 hours of damage protection start now. Only the grant's holder, and only while it runs; otherwise `takeoverRefusedErr("noTakeoverChance")`. |
| POST | `/worldmapv2/transferassets` | verifyUserAuth, verifyAccountStatus, logRequest | `{ frombaseid, tobaseid, monsters: JSON [sourceMonsters, targetMonsters] }` — two **complete replacement** `monsters` blobs, not a delta | `{ error: 0 }`; `{ error: 1 }` with a 400/403 status if a `baseid` doesn't resolve or the two bases have different owners; `permissionErr()` (403) if either base isn't the caller's; `monsterTransferRejectedErr()` (200 + `error`) if a transfer rule refuses | Moves a monster garrison between two of the caller's own bases (main yard ↔ outpost). Both yards' monsters are first caught up to now (issue #103). Since issue #27 the two blobs are validated against those caught-up rows before anything is written (see "Monster transfer rules" below). An accepted transfer writes only the two posted `housed` rosters onto the caught-up blobs. The hatchery state (`h`, `hcc`, `saved`, …) stays the server's. A transfer involving an outpost is refused (`rule: "world"`) unless both yards' map cells are on the same world, and any transfer is refused (`rule: "underAttack"`) while either yard has an attack running; the check and the write run in one transaction with the main yard's row locked first, then the two yards (outposts plan WP0). |
| POST | `/api/:apiVersion/player/savebookmarks` | apiVersion, verifyUserAuth, verifyAccountStatus, logRequest | `{ bookmarks: JSON string }` (no zod schema) | `{ error: 0 }` | Persists the player's map bookmark list onto `user.bookmarks`. |

**MR2 cell payload.** `b` (base_type, `MapRoomCell`): `1`=wild monster camp, `2`=own/other
player's main yard, `3`=captured outpost. Cells with terrain height `i ≤ 99` (`Terrain.WATER3`)
are plain water and carry only `{ i }`. A user cell additionally carries: `uid`, `bid`
(baseid), `aid` (owner's alliance id), `n` (owner's username), `l` (calculated level), `v`
(empirevalue), `f`/`c` (flinger/catapult level), `dm`/`d` (damage % / destroyed flag, `d=1` once
`dm≥90`), `lo` (locked — forced `1` while the owner is online or under active attack, `0` on the
viewer's own cell), `p` (protection active), `pe` (when that protection ends, unix seconds; only while `p` is 1, #187), `t` (truce **expiry unix timestamp** with that
owner, absent for the viewer's own cell), `mine` (1 for the caller's own cell), `pic_square`,
`pi` (always `0` — UNVERIFIED: unused placeholder), `fr` (always `0` — UNVERIFIED: unused
placeholder). `r` (the owner's live `resources` object) and `m` (the owner's `monsters`
object, `{}` if unset) are included **only when `mine` is 1**. `m` is the stored blob
caught up to the request in memory: production, the HCC refund and the cull, at the owner's
academy levels (issue #103, `services/yard/armies.ts` `monstersForMap`). Nothing is written, and
the next write catches up from the same snapshot, so the two agree. Before the revamp branch every
cell carried them, which exposed every player's resource and monster counts to anyone panning the
map; the Flash client only ever read them for the viewer's own cell (`userCell.ts`). A wild-monster
cell carries only `{ uid: 0, b, i, bid, n (tribe name, purely `(x+y) % 4`-derived — not random
per-world), l (tribe level), dm, d }` — no `r`/`m`/ownership fields, since it is unowned until
captured.

**Takeover grants** (`services/maproom/v2/takeoverGrant.ts`, issue #182, the owner's rule for
player outposts). When the save that ends an attack (or the server finishing an abandoned one,
`finaliseAttack.ts`) leaves a **player outpost** at 90% damage or more, the usual damage protection
is not started. The attacker gets a one-time grant instead: 10 minutes, kept in Redis under
`takeover-grant:<basesaveid>`, and the outpost's `protected` is set to the grant's end plus 8
hours. That one value keeps everyone else off the outpost while the grant runs (the attack load
and the takeover rules refuse a protected yard), and becomes the normal 8 hours when the grant
ends unused, with nothing to apply later. Only the holder may take the outpost over, once
(`takeoverCell` spends the grant; the new owner gets 12 h). `declinetakeover` ends it early and
starts the 8 hours then. The final `/base/save` answers with
`takeovergrant: { baseid, expiresAt, resources, shiny, adjacent }`, where `resources` (of each of
r1..r4) and `shiny` are the price `takeoverCell` will charge (`takeoverOffer.ts`). 25-89% damage
is unchanged (8 h, no grant). Wild camps have no grant: anyone in range may take a destroyed camp
until it regenerates, 12 h after its last save.

**Monster transfer rules** (`services/monsters/transferRules.ts`, issue #27). `transferassets`
posts a *replacement* `monsters` blob for each yard, so before the revamp branch a hand-made
request could hand the destination a copy of the source's army and leave the source untouched —
monster duplication in one request. Five rules now run after the ownership check, in this order,
and the first one to refuse names itself in `data.rule`:

| `rule` | What it refuses | Refusal `data` |
|---|---|---|
| `endpoints` | A yard sending to itself, an endpoint that is not a main yard or an outpost, or a main-to-main move — the client only offers the flow to a player holding at least one outpost | `baseid`, or `from`/`to` base types |
| `quantities` | A `housed` count that is not a non-negative whole number, or a `housed` field that is not an object | `monsters` (the offending ids) |
| `holdings` | The source ending up with more of a type than it could have held | `monster`, `claimed`, `held` |
| `conservation` | The two yards' combined total for a type rising | `monster`, `before`, `after` |
| `capacity` | The destination's resulting roster not fitting its Monster Housing | `used`, `capacity` |

Capacity is derived from the destination's own `buildingdata` — every type-15 Monster Housing that
has finished building and is above 10 health, at its stored level, against the Map Room 2 capacity
table `[200, 260, 320, 380, 450, 540]` (`GLOBAL.as:682`), times 1.25 while `EXH`/`EXHI` is running
in `storedata`. The client-written `space` field on the `monsters` blob is **not** trusted for
this. Monster Bunkers and champions are separate pools and add nothing. Housing space per monster
(`cStorage`) is read at the caller's Monster Academy level, which only changes the answer for `C1`.

`conservation` is checked against the stored totals **plus a production allowance**, because the
map ticks hatchery production locally and adds finished monsters to `housed`
(`MapRoomCell.as:800-811`) — a yard last saved long ago legitimately shows more monsters than the
server stored. The allowance is the hatchery work the stored blob already carries (the monster in
production, the per-hatchery queues and the shared HCC queue), capped by how many of that type the
yard could house at all. It is deliberate, bounded slack; closing it entirely needs a
server-authoritative production replay.

Refusals use `monsterTransferRejectedErr()`, which is `isClientFriendly: false` — HTTP **200** with
`error` set to a readable sentence fragment. That is the only shape the Flash client shows the
player: `transferSuccessful` branches on `param1.error == 0` and otherwise prints
`msg_err_transfer` ("There was a problem with the transfer:") with `param1.error` appended
(`MapRoom.as:735-792`). The intended `409` travels in `errorDetails.status`.

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
`{ id, t, x, y, l?, fort?, plan? }`: the building id from `buildingdata`, its type, and its
origin in yard units. `l` and `fort` are advisory — Apply never writes them. `plan` is
`{ level, order }`, a planned upgrade: the level the player wants that building to reach and
their own queue position for it, walked by Apply when `startUpgrades` is set and ignored
otherwise (`docs/design/planner-upgrades.md` §2). It is additive and optional, so the layout
version stays 2. Every account gets 10 slots, enforced server-side
(`docs/design/yard-planner-redesign.md` §8, decision Q2).

The `layouts` routes answer a rejection with the error status and the detail flattened next to
`error` (`{ error: "...", unplaced: [...] }`), not under `errorDetails` as the rest of the API
does. Validation lives in `server/src/services/yardplanner/validateLayout.ts` and the footprint
table it measures against is `server/src/game-data/buildingFootprints.ts`.

The two **batch** routes below (`walls/upgrade`, `traps/rearm`) and `apply` with
`startUpgrades=1` are the only places in this API where the server decides what something costs
instead of adding a delta the client worked out. Prices come from
`server/src/game-data/buildingCosts.ts`, generated from the Flash props table and byte-identical
to the copy the web client shows them from; the rules live in `services/yardplanner/wallUpgrade.ts`,
`trapRearm.ts` and `startUpgrades.ts`. All three award empire points the way the Flash client's
`Upgraded()`/`Constructed()` do and answer a rejection in the same flattened shape. The two batch
routes are all-or-nothing: `400` means the request names something wrong (`unknown`, `notWalls`,
`alreadyAtLevel`, `busy`, `damaged`, `level`, `notTraps`, `offGrid`, `outOfBounds`,
`overlapping`); `409` means the yard cannot do it yet (`shortfall`, `townHall`, `requirements`,
`capReached`). Apply's upgrade walk is **partial by design** and reports the same conditions
instead of refusing the request.

**Outposts (issue #184).** `apply`, `walls/upgrade` and `traps/rearm` take an optional `baseid`:
absent (or `0`, or the main yard's own) acts on the main yard exactly as before; the `baseid` of one
of the caller's Map Room 2 outposts acts on that outpost the way the yard actions do (see
"Outposts" under "Yard actions"): one transaction, the main row locked first and the outpost row
second, the outpost caught up to now, its own buildings moved, upgraded or added, priced from the
outpost table (walls stop at level 5; 25 Booby Traps and 5 Heavy Traps at most; one worker for
Apply's walk; the core is the hall), and every charge and point taken from and given to the main
yard. `resources` in the answer is the main pool. `403 { reason: "notYourYard" }` for a `baseid`
that is not one of the caller's own outposts, `409 underAttack` while either yard is attacked.
Saving, loading or deleting a layout (`layouts`, `gettemplates`, `savetemplate`, `deletetemplate`)
with an outpost's `baseid` is refused `409 { reason: "notInOutpost" }`: Flash's planner could not
save or load templates in an outpost (`BasePlanner.as:41`).

| Method | Path | Middleware | Request fields | Response | Description |
|---|---|---|---|---|---|
| GET | `/api/:apiVersion/bm/yardplanner/layouts` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0, slots: 10, layouts: Layout[] }` | Every saved layout, ordered by slot, converted to version 2. Slots with nothing in them are simply absent from the array. |
| PUT | `/api/:apiVersion/bm/yardplanner/layouts/:slot` | apiVersion, verifyUserAuth, logRequest | `name` (trimmed, 1-20 chars), `data` (JSON string of `{ version: 2, expansion, nodes }`) | `{ error: 0, layout }` | Overwrites one slot. Rejects with `400` for a slot outside 0-9, a name outside 1-20 characters, unreadable or non-version-2 data, more than 1200 nodes, a node id the caller's `buildingdata` does not have or has at a different type, a duplicate id, a position outside the plot for the layout's own `expansion`, or two footprints that overlap. Decorations are measured against the planner's extended 3240 x 2600 area instead of the plot. Mushrooms are ignored here. Planned upgrades are checked too, and more strictly than Apply checks them: `400 { planLevel: [ids] }` for a target past the top of that type's ladder or on a type with no ladder, and `400 { planCaughtUp: [ids] }` for one at or below the level the building is already at. |
| DELETE | `/api/:apiVersion/bm/yardplanner/layouts/:slot` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0 }` | Empties one slot. Deleting an empty slot succeeds. `400` if the slot is outside 0-9. |
| POST | `/api/:apiVersion/bm/yardplanner/apply` | apiVersion, verifyUserAuth, logRequest | `data` (JSON string, same shape as PUT), `startUpgrades` (`0` or `1`, default `0`) | `{ error: 0, moved: number, buildingdata, resources, upgrades: UpgradeReport \| null }` | **Server-authoritative**: the server moves the buildings, where the Flash client moved them itself and let an ordinary `/base/save` carry the result (`client/scripts/BASE.as:5025-5041`). Runs the same node checks as PUT, then three more: positions are measured against the caller's **current** `storedata.ENL.q` rather than the layout's `expansion`; mushrooms from `save.mushrooms` are obstacles no node may overlap; and every non-decoration, non-mushroom building in `buildingdata` must appear in `nodes`, else `409 { error, unplaced: [ids] }` with no auto-place (decision Q4). On success it writes only `X` and `Y` on the listed buildings, brings every countdown in the yard forward to now before moving `savetime`, and returns the updated `buildingdata`. Buildings under construction, upgrading or fortifying may be moved. With `startUpgrades=0` no resource or level is touched and `upgrades` is `null`; with `startUpgrades=1` the nodes' `plan` fields are walked after the move, in the same flush — see below. |
| POST | `/api/:apiVersion/bm/yardplanner/walls/upgrade` | apiVersion, verifyUserAuth, logRequest | `ids` (JSON string, `number[]`), `level` | `{ error: 0, upgraded, level, cost, resources, buildingdata }` | Raises every listed wall (type 17, or legacy 18) to `level` at once, charging `costs[k]` for each step server-side and completing instantly under the 300-second free-finish rule (decision Q1). All-or-nothing: `400` for unknown, non-wall, busy or damaged ids or a bad level; `409 { shortfall }`, `{ townHall }`, `{ requirements }` for state. Countdowns are advanced to now before `savetime` moves. |
| POST | `/api/:apiVersion/bm/yardplanner/traps/rearm` | apiVersion, verifyUserAuth, logRequest | `traps` (JSON string, `{ t, x, y }[]`) | `{ error: 0, placed, ids, cost, resources, buildingdata, firedtraps }` | Builds a Booby Trap (24) or Heavy Trap (117) at each position, charging `costs[0]`, capped by `quantity[townHallLevel]`, checked against the plot, every building and every mushroom. New ids continue from the highest existing id. Matching entries are removed from `save.firedtraps`, which the attack save fills when a trap fires. |
| GET | `/api/:apiVersion/bm/yardplanner/gettemplates` | apiVersion, verifyUserAuth, logRequest | none | `{ error: 0, ...entries }` | **Deprecated**, the Flash client's route. Keeps its original quirk: the array is spread into the body, so the client receives a numeric-string-keyed object, not a JSON array under a named key. Each entry is `{ slotid, name, data }` with `data` a JSON **string** of an index-keyed `{x, y, id, type}` object, because the client runs `JSON.parse` on it. Layouts written by the new client are converted down to this shape on the way out. |
| POST | `/api/:apiVersion/bm/yardplanner/savetemplate` | apiVersion, verifyUserAuth, logRequest | `{ slotid: number, name: string, data: string }` | `{ error: 0, ...entries }` (same spread-array quirk) | **Deprecated**, the Flash client's route. Now rejects `400` for a `slotid` outside 0-9 or a `data` payload over 64 KB, where before the request body was spread into the column unchecked. Everything else is taken as best it can be — the name is trimmed and clipped to 20 characters, unreadable nodes are dropped — because a Flash client cannot show a validation message from here. The nodes are converted to version 2 and stored alongside anything the new client wrote, with `expansion: 0` since a version 1 body never said which plot it was drawn for. |
| POST | `/api/:apiVersion/bm/yardplanner/deletetemplate` | apiVersion, verifyUserAuth, logRequest | `{ slotid: number }` | `{ error: 0 }` | **Deprecated** alias for `DELETE /layouts/:slot`. This is the route `BasePlannerService.clearSlot:64-67` has always called and the server never implemented, so until now a slot could only be overwritten, never emptied. |

#### Apply with `startUpgrades=1`

After the move loop, the server walks every node that carries a `plan`, in ascending `plan.order`
with ties broken by building id, and starts as many upgrades as the yard's free workers and
resources allow (`services/yardplanner/startUpgrades.ts`;
`docs/design/planner-upgrades.md` §3.4). A yard has `min(5, 1 + storedata.BEW.q)` workers and
every running `cB`, `cU` or `cF` holds one, so the walk may start at most `total - busy` jobs.

Each planned building is walked one step at a time. A **wall or trap step** (5 seconds; decision
Q1, D13) is written straight to its finished level, charged, awarded its points and holds no
worker, and the walk carries on to the next step of the same building — the rule the batch wall
route runs on. **Every other step, however short**, takes a free worker, is charged, gets
`cU = floor(time * bst)` where `bst` is 0.8 while Sharper Tools is running (and the same figure
as the job's length `cL`, see `buildingdata` below), and **ends that building's turn**: there is no job queue, so whatever the plan still wants stays in the layout for
a later Apply. That includes a harvester's 300-second level 1 → 2 step (#137): it runs a real
countdown, and the player finishes it early for free with `bm/yard/speedup` `SP1` if they want.

The walk is partial. Nothing about the yard's state refuses the request; it is reported instead,
and the rest of the queue carries on, so one unaffordable tower does not silence the cheap walls
behind it. Only a malformed plan is a rejection: `400 { planLevel: [ids] }` for a target past the
top of that type's ladder.

`upgrades` is:

```ts
{
  started:  { id, t, from, to, seconds, cost }[],   // cU (and cL) written, one worker each
  finished: { id, t, from, to, cost }[],            // wall and trap steps, written complete
  waiting:  { id, t, from, to, reason: "workers" }[],
  skipped:  { id, t, reason, from?, to?, ...detail }[],
  cost:     { r1, r2, r3, r4 },                     // total actually charged
  points:   number,                                 // wall and trap steps only
  workers:  { total, busyBefore, busyAfter },
}
```

`skipped[].reason` is one of `shortfall` (with `shortfall: { r1..r4 }`, what that job was still
short of), `busy`, `damaged`, `townHall` (with `townHall: { have, need }`), `requirements` (with
`requirements: [type, count, level][]`), `caughtUp` (the yard is already at or past
`plan.level`) or `noLadder`. The detail keys are the ones the batch routes already use, so a
client reads a skipped row the same way it reads their `409`.

`resources` is the pool as the server now holds it, so the HUD re-reads it rather than
subtracting its own arithmetic. Points for a started job are **not** awarded here; they are
awarded by whoever completes it, as in the Flash client.

### Yard actions

`POST /api/:apiVersion/bm/yard/<action>` — the server-authoritative yard routes
(`docs/design/yard-buildings.md` §2.1, decision D2). The web client never sends a whole-yard
save: it names an action, and the server loads the save, finishes whatever timers ended, checks
the rules, charges, writes once and returns the new state. Routes are registered in
`server/src/controllers/yard/index.ts` (append-only) and all run through one wrapper,
`yardRoute(action)` (`controllers/yard/yardRoute.ts`, the Koa binding of `runYardAction` in `controllers/yard/yardAction.ts`, where the route types live). Every route is mounted behind
`apiVersion`, `verifyUserAuth` and `logRequest`. Bodies are form fields (or the equivalent flat
JSON), parsed by the route's zod schema in `server/src/schemas/YardSchemas.ts`.

**What every request does, in order.**

1. Parse the body with the route's schema. Failure: `400 { reason: "badRequest", issues: [{ path, message }] }`.
2. Open a transaction and re-read the caller's `user.save` with `SELECT … FOR UPDATE`, so two
   requests for the same player run one after the other and the second sees what the first
   wrote. `409 notMainYard` if the caller has no save yet or it is not their own main yard;
   `409 underAttack` while `isAttackActive` says an attack is running. A `baseid` naming one of
   the caller's outposts acts on that outpost instead (see "Outposts" below).
3. **Catch-up** (`services/yard/catchUp.ts`, `catchUpYard(save, now)`): advance the yard from
   `savetime` to `now`, clamped to 30 days; a `savetime` of 0 (never saved) replays nothing.
   Phase 1 (`catchUpBuildings.ts`): every `cB`/`cU`/`cF` countdown is brought forward by
   `advanceBuildingTimers` (paused while the building is damaged or repairing, as before); each
   one that reaches zero completes and **awards its points once** — an upgrade
   `floor((time + r1 + r2 + r3 + r4) / 3)` of the step it finished, a build
   `floor(time / 2 + (r1 + r2 + r3 + r4) / 10)` of `costs[0]` (+100 for a Town Hall), a fortify
   0 on a main yard and `floor((time + r1 + r2 + r3 + r4) / 3)` of the step on an outpost
   (`Fortified()`, `BFOUNDATION.as:2485-2503`); `flinger`/`catapult` are re-derived; `storedata` entries whose `e` has passed are removed.
   Phase 2, locker (`catchUpLocker.ts`, run before the buildings step so an Overdrive that ran
   out in the window is still counted): the running surface unlock (`lockerdata[id].t == 1`) has
   `e` reduced by 4 × the seconds of the window inside `storedata.CLOD`'s `s`..`e` (the countdown
   runs 5x, as the original's `e -= 4` per tick); once `e` has passed it becomes `{ t: 2 }` and
   `academy[id]` is created as `{ level: 1 }` if absent.
   Phase 3, repairs (`catchUpRepairs.ts`, issue #113, run **before** the buildings step): every
   building with `rE` set heals `ceil(max / min(3600, repairTime[l−1]))` health a second
   (`repairTime` per type in `server/src/game-data/repairTimes.ts`, generated by
   `web/tools/gen-repair-times.mjs`; a building under construction reads `repairTime[0]`), so no
   repair takes more than an hour. One short of full has `hp` and `buildinghealthdata[id]` raised;
   one that reaches full has `hp`, `rE` and the `buildinghealthdata` entry removed at that second,
   and its paused `cU`/`cB`/`cF` (the first running, as `advanceBuildingTimers` reads them) gets the
   seconds it was paused for added, so the buildings step runs it on from the repair's end. A
   damaged building without `rE` stays as it is; `rE` on a building at full health is dropped.
   Phase 2, monsters (`catchUpMonsters.ts`, issue #103, after the buildings step), with the window split at
   every hatchery, Housing and HCC build or upgrade that finished inside it:
   - **HCC finished**: every hatchery's own queue is emptied and refunded in goo at the level each
     stack was paid at, capped at the storage cap. The monster in production stays.
   - **Production** (`production.ts`, `simulateProduction`) runs from `monsters.saved`:
     - A hatchery works when built, not upgrading and at ≥ 50% health.
     - Each monster takes `cTime` at its academy level in whole seconds, divided by the `HOD*`
       power while one runs.
     - A finished monster moves into housing if it fits. Otherwise the hatchery stalls, with
       nothing lost or refunded.
     - A built HCC with health > 10 hands its queue out in `hid` order.
   - **Cull**: while the army does not fit the housing still standing, one of every type is
     removed per pass, with no refund.
   - **Write**: `saved`, `space`, `hcount`, `hstage` and `overdrivepower`/`overdrivetime` are
     written, and the hatchery/HCC building fields `rPS`/`rCP`/`rIP`/`mq` are dropped.
     `monsters.h[i]` is `[monster, countdown, queue, paidLevel]` (`["", 0, queue]` when idle),
     and queue stacks are `[id, count, paidLevel]`. An old two-element stack reads as paid at
     the current academy level.
   A Map Room 3 blob is left alone.
   Before all of that, a migration (`mapRoom.ts` `migrateYard`, §2.5 and §5.7 of the design):
   a Map Room above level 2 is written back to 2 (a running upgrade past 2 dropped); a save with
   `mr2upgraded` gets a level 2 Map Room (one still being built is left until it stands); a save
   on Map Room 2 (`mr2upgraded` or `mapversion` 2) with no Map Room at all gets one, level 2 and
   finished, with the next building id, on the free spot nearest the middle of the plot (the build
   route's placement rule: inside the plot, clear of buildings and mushrooms; nothing when the plot
   has no room), reported as a `mapRoomAdded` job; every
   Radio Tower (type 113) is removed with its `buildinghealthdata` entry and its build cost
   (2,000 / 2,000 / 2,000) credited, clamped to the storage cap, and reported as a
   `radioRemoved` job.
   Phase 3, harvesters (`catchUpHarvesters.ts`, issue #109, after the monsters step; arithmetic in
   `services/base/economy/production.ts`, shared with the economy audit): every Twig Snapper,
   Pebble Shiner, Putty Squisher and Goo Factory fills its buffer `st` cycle by cycle — `produce[l−1]`
   per `cycleTime + ceil(cycleTime × (4 − 4 × health / max))` seconds, up to `capacity[l−1]`, where
   it stops — and nothing is banked. `cP` is the seconds left of the running cycle (absent, with
   `pr: 0`, once full; an idle harvester with room starts a fresh cycle). Nothing while a
   `cB`/`cU`/`cF` runs (one that finished in the window produces from that moment at its new
   level) or below half health; a repair that finished in the window splits it: the health the
   harvester had at the start until the repair's end, full health after; the Production Overdrive
   (`storedata.POD`) doubles `produce` until its `e`. Phase 3, mushrooms (`catchUpMushrooms.ts`, issue #114, last): one grows per 17,280 s
   since `mushrooms.s`, at most 10 per catch-up and 10 in the yard (a yard already above 10 keeps them and grows none), each on a random free spot in
   the plot; whenever a whole period has passed `s` becomes `now` (a yard with no `s` counts as
   overdue). Nothing is reported for them. Phase 4, academy (`catchUpTraining.ts`, issue #116,
   after the mushrooms): a surface `academy[id].time` at or below 583,200 (162 h) is a legacy
   remainder and becomes `time + savetime` once; the legacy id `C100` becomes `C12` in `academy`
   and in an academy's `upg`; every training whose `time` has passed finishes — `level + 1` (never
   past the catalogue's top), `time`/`duration` removed, the Monster Academy's `upg` naming it
   removed — and is reported as a `train` job (`detail: { level, academy }`); an academy whose
   `upg` names a monster that is not training loses the stale `upg`. Phase 5, champions
   (`catchUpChampions.ts`, issue #123): every champion with `status` 0 heals
   `int(max × 5 / healtime)` per whole 5-second period of the clock, up to full (the food bonus
   counts); found past `ft + 24 h` it starves, exactly as the original (D11, owner ruling
   2026-09-28; `ChampionBase.as:1062-1109`): below level 6 one feed lost (not below 0), at level 6
   one food-bonus rank lost (not below 0) and health down to the new full; either way `ft` restarts
   at `now + 23 h`. At most one loss per catch-up, however long the player was away (no back-fill).
   Each starving that cost something is reported as a `starve` job; frozen and juiced champions do
   nothing.
   `savetime` becomes `now`. Idempotent: a second
   catch-up at the same `now` changes nothing.
   Then, outside the pure catch-up: a yard left with a level 2 Map Room that is not on Map Room 2
   yet (`mr2upgraded` false, `mapversion` not 3) joins a world as `setmapversion` version 2 does
   (pending alliance invites cleared, `joinOrCreateWorld`, the Map Room 1 row dropped; skipped
   when the save already has a `worldid`), and `mr2upgraded = true`, `mapversion = 2`
   (`services/yard/mapRoom.ts` `joinMapRoom2`). This runs in the same transaction for every yard
   action and for the owner's `/base/load`.
4. Run the route's rules against the caught-up save.
5. Apply the result: Shiny (`409 shinyLocked` for an account with Shiny locked, `409 credits
   { have, need }` if short), resources (`409 shortfall { r1..r4 }`), then the new save slices,
   the debit, any credit clamped to the storage cap (a pool already over the cap is never
   reduced; `services/yard/credit.ts`, `creditResources`, the one clamp every server credit takes —
   the route refunds, banking and the catch-up's HCC queue refund, issue #110), points, and `flinger`/`catapult` again. One flush, commit.
6. Answer `200 { error: 0, ...YardState, completed, report }`.

A refused request rolls the whole transaction back, catch-up included, so it writes nothing.

#### Outposts (`baseid`, issue #184)

Every yard route takes an optional `baseid`. Absent, `0` or the main yard's own `baseid`, the
request acts on the caller's main yard exactly as described above. The `baseid` of one of the
caller's Map Room 2 outposts (the id `/base/load` and `Save.outposts` use) acts on that outpost:

- **Who.** The outpost must be listed in the main yard's `outposts`, owned by the caller
  (`userid` and `saveuserid`), in the main yard's world, and not a Map Room 3 structure, else
  `403 { reason: "notYourYard" }`. A `baseid` that is not a whole number is `400 badRequest`.
- **Locks.** The main row is locked first and the outpost row second (the order every route that
  touches both keeps), so a request on an outpost and one on the main yard or another outpost run
  one after the other and cannot spend the one pool twice. `409 underAttack` while either row is
  being attacked.
- **One pool.** The outpost has no resources of its own (`client/scripts/BASE.as:4776-4825`):
  every charge, refund, Shiny spend and point lands on the main row, and credits are clamped to the
  main yard's cap (`services/yard/poolView.ts`). The answer's `YardState` says so (above).
- **Catch-up.** An outpost's catch-up (`catchUpOutpost`) runs, in order: the core (type 112,
  level 1, at (0, -50), the next free id) into an outpost with no buildings at all
  (`client/scripts/BASE.as:1605-1614`), then repairs, building countdowns (points priced from the
  outpost table), hatcheries and housing, and `damage` following the repairs down. No starter
  base, Map Room, Locker, Academy, Lab, mushrooms, champions or harvester buffers: those are the
  main yard's or the player's, and an outpost's harvesters are autobanked. Map Room 2 is never
  joined from an outpost. The owner's build-mode `/base/load` of an own outpost runs the same
  catch-up, locked the same way, and answers with `completed`.
- **Rules.** Everything is priced and capped from the outpost table
  (`OUTPOST_YARD_PROPS.as`, `propsFor("outpost")`): limits are `quantity[1]` (the core never
  leaves level 1: at most 4 of each harvester, cannon and sniper; 2 hatcheries, bunkers, lasers,
  teslas and flaks; 1 flinger, housing, juicer, HCC, planner and railgun; 100 walls; 25 Booby
  Traps and 5 Heavy Traps), the build menu is those 20 types, the Juicer, Hatchery and Bunker need
  a Housing and the HCC two Hatcheries, the core is the hall (`409 townHall` says "core"), and the
  core cannot be upgraded (`409 maxLevel`, "The outpost can not be upgraded."). **One worker**,
  whatever `BEW` says (`client/scripts/QUEUE.as:31-52`).
- **Routes.** Allowed: `state`, `build`, `build/instant`, `upgrade`, `upgrade/cancel`,
  `upgrade/instant`, `speedup` (a fortification too), `fortify`, `fortify/cancel`, `repair`,
  `repair/instant`, `hatchery/*`, `juice`, `bunker/*` and `shop/buy`, which sells an outpost only
  `BST`, `HOD`, `HOD2`, `HOD3` and `EXH` (`client/scripts/STORE.as:198-199`; anything else is
  `400 notForSale`), bought into the outpost's own `storedata`. Refused `409 { reason:
  "notInOutpost" }`, before the catch-up, so nothing is written: `recycle` ("You cannot Recycle
  buildings in Outposts."), `build/cancel` ("You cannot stop the construction of a building in
  your Outposts."), `bank` ("Outposts bank automatically (Auto-Banking)."), and `locker/*`,
  `academy/*`, `lab/*`, `champion/*` and `mushroom/pick` ("That cannot be done in an outpost.").
  Cancelling an upgrade or a fortification is allowed, as in Flash.
- **Old rows.** The first time a process catches an outpost up at load it logs (and changes
  nothing) where the row breaks the outpost props: unknown or blocked types, more of a type than
  allowed, levels above the outpost ladder, no core or more than one.
- **Starter Kits** (outposts WP9, #188): `POST /bm/yard/starterkit { baseid, kit: 1-3, pay:
  "resources" | "shiny", topUp? }` replaces every building but the core with one of the three
  layouts of `client/scripts/popup_prefab.as` (`GetBuildings`, `:278-311`; data in
  `game-data/starterKits.ts`, generated by `web/tools/gen-starter-kits.mjs`). The core moves to the
  kit's spot, healed, keeping any higher fortification; the kit's buildings get fresh ids and the
  kit's fortifications. Paid with Shiny (Regular 420, Mega 800, Ultra 1,500) they are finished at
  once. Paid with resources (Regular 12M/12M/6M twigs/pebbles/putty, Mega 50M/50M/25M, Ultra
  200M/200M/100M, never goo, from the main pool) each is a prefab: `l = prefab`, `cB = cL` = every
  step up to that level from the outpost table, and `prefab` set, which **holds no worker**
  (`busyWorkers`) and finishes at its level on catch-up (`BFOUNDATION.as:3054-3066`,
  `:3155-3159`). A short pool pays what it holds and the rest is `topUp` Shiny,
  `ceil(sqrt(short / 2) ^ 0.75)` (`:147-226`); without a matching `topUp` it is `409 shortfall {
  shortfall, topUp }`. Refused `409 notOutpost` on a main yard, and `409 monsters { monsters:
  { housing, capacity, inBunkers, inProduction } }` while the outpost holds monsters the new yard
  cannot keep (housed monsters over the kit's finished Housing, none at all while a resource-paid
  Housing still builds, or any in a Bunker, hatchery or the HCC): "Move the monsters out of this
  outpost first". `report { kit, pay, placed, removed, cost, shiny, doneBy }`.

**Errors** use the Yard Planner's flat shape, not the global `errorDetails` envelope: the real
HTTP status and `{ error: "<message for the player>", reason: "<key>", ...detail }`. `400` means
the client sent something malformed; `409` means the yard refuses right now. Reasons so far:
`badRequest`, `notMainYard`, `underAttack`, `shinyLocked`, `credits`, `shortfall`, and for
outposts `notYourYard` (`403`) and `notInOutpost`; each route
lists its own (so far `notRunning`, `damaged`, `mapRoom`, `itemRefused`, `useBatchRoute`, `busy`,
`townHall`, `maxLevel`, `requirements`, `notForSale`, `alreadyActive`, `soldOut`,
`alreadyUnlocked`, `unlockRunning`, `noLocker`, `lockerLevel`, `notUnlocking`, `locked`,
`noHatchery`, `useHcc`, `noHcc`, `noSlot`, `nothingToFinish`, `housingFull`, `mapRoom3`,
`moved`, `workers`, `noAcademy`, `academyBusy`, `academyLevel`, `training`, `notTraining`, `notDamaged`, `isTownHall`,
`championInCage`, `championsFrozen`, `researching`, `hatcheryBusy`, `unlocking`, `noJuicer`, `inferno`, `notEnough`, `noBunker`,
`notBunkerable`, `notBuyable`, `bunkerFull`, `notInBunker`, `notRaisable`, `noCage`, `frozen`,
`noChampion`, `notHungry`, `fullBuff`, `fullHealth`, `nameRefused`, `noChamber`, `injured`, `hungry`,
`notFrozen`, `notFortifiable`, `maxFortify`, `notFortifying`). Anything that is not a refusal (a bug, a database error) still goes to the global
`ErrorInterceptor` as a `500`.

**`YardState`** (`services/yard/yardState.ts`) — **frozen**: fields may be added by agreement,
never renamed or removed. The save slices keep their `/base/load` names and shapes so the client
merges them into the response it already holds.

```ts
{
  savetime: number,              // unix s; equals currenttime after the catch-up
  currenttime: number,           // server clock, unix s
  resources: { r1, r2, r3, r4 }, // save.resources as stored (legacy r*max keys pass through)
  credits: number,               // Shiny; 0 while the account has Shiny locked, as /base/load
  caps: { r1, r2, r3, r4 },      // storage cap (storageCap), one figure repeated per key
  workers: { total, busy },      // total = min(5, 1 + storedata.BEW.q), 1 on an outpost; busy = running cB/cU/cF
  buildingdata, buildinghealthdata, storedata,
  monsters, lockerdata, academy, champion, mushrooms, researchdata,
}                                // null columns come out as {} (champion as [])
```

On an outpost `resources`, `credits`, `caps`, `lockerdata` and `academy` are the main yard's (the
pool the outpost spends from, and the main yard's caps: its silos plus 2,000,000 per outpost), as
`/base/load` serves an outpost; everything else is the outpost's own.

**`completed`** lists what the catch-up finished during this request, oldest first. Every entry
is `{ kind, id, t, at, detail }`, `at` being the unix second the job ended:

```ts
{ kind: "build" | "upgrade" | "fortify", id: number /* building id */, t: number /* type */,
  at: number, detail: { from: number, level: number, fort?: number, points: number } }
{ kind: "storeItem", id: string /* e.g. "BST" */, t: null, at: number /* its e */, detail: {} }
{ kind: "unlock", id: string /* e.g. "C5" */, t: null, at: number /* Overdrive counted */, detail: {} }
{ kind: "hatch", id: string /* monster */, t: null, at: number /* the last one */, detail: { count } }
{ kind: "cull", id: string /* monster */, t: null, at: number, detail: { count } }
{ kind: "queueRefund", id: number /* HCC building id */, t: 16, at: number,
  detail: { goo: number /* credited, after the cap */, monsters: { [id]: count } } }
{ kind: "radioRemoved", id: number /* building id it had */, t: 113, at: number /* now */,
  detail: { refund: { r1, r2, r3, r4 } /* credited, after the cap */ } }
{ kind: "mapRoomAdded", id: number /* the new building's id */, t: 11, at: number /* now */,
  detail: { level: 2, x: number, y: number /* its footprint origin */ } }
{ kind: "starterBase", id: number /* the Town Hall's id */, t: 14, at: number /* now */,
  detail: { buildings: { id, t, x, y, level }[] /* Town Hall first */,
            resources: { r1, r2, r3, r4 } /* credited, after the cap */ } }
{ kind: "repair", id: number /* building id */, t: number /* type */, at: number /* full health */,
  detail: { from: number /* health at the start of the window */, max: number } }
{ kind: "starve", id: string /* "G1".."G5" */, t: null, at: number /* now: when the loss was taken */,
  detail: { level: number, feeds: number, foodBonus: number /* after the loss */ } }
```

Later phases add kinds (`train`, …) with the same five keys.

**`report`** is the route's own result (`null` for `state`).

| Method | Path | Request fields | `report` | Description |
|---|---|---|---|---|
| POST | `/api/:apiVersion/bm/yard/state` | none (every route also takes `baseid`, see "Outposts") | `null` | Catches the caller's main yard (or the outpost `baseid` names) up, writes it, and returns it. The client calls it a second after one of its own countdowns reaches zero and when the tab becomes visible again (`docs/design/yard-buildings.md` §2.4). |
| POST | `/api/:apiVersion/bm/yard/upgrade` | `id` (building id, coerced non-negative int) | `{ id, from, to, seconds, cost: { r1..r4 } }` | Takes one building one level up (the building panel's **Upgrade**). Every step starts, however short (#137): `cU = floor(time × bst)` (`bst` 0.8 while Sharper Tools `storedata.BST.e` is in the future, else 1) and `cL` = the same figure (the job's length, for progress bars, #136), `costs[level]` charged, one worker held, `seconds` = that countdown, points awarded later by whatever completes it (the catch-up, or a speed-up). A step of 300 s or less (in practice the harvesters' level 1 → 2) is no exception: nothing finishes for free on its own; the player presses **Finish free**, `speedup` `SP1`, which is allowed while 300 s or less remain. Rules, checked in this order (the first failure answers): `400 badRequest` if the yard has no building with that id; `400 useBatchRoute { id }` for a wall or trap (types 17, 18, 24, 117 — they use `bm/yardplanner/walls/upgrade` and `traps/rearm`); `400 badRequest` for a building with no upgrade ladder (decorations, mushrooms); `409 busy` (a `cB`, `cU` or `cF` running); `409 damaged` (`hp` set or an entry in `buildinghealthdata`); `409 townHall { have: 0, need: 1 }` (no Town Hall); `409 maxLevel { level, max }`; the step's `re` prerequisites — `409 townHall { have, need }` when a Town Hall level is missing, else `409 requirements [[type, count, level]]` listing the unmet ones; `409 shortfall { r1..r4 }`; `409 workers { total, busy }` with every worker busy. The rules are `planOneUpgrade` (`server/src/services/yardplanner/startUpgrades.ts`), the same function the Yard Planner's Apply walk takes each step with (`services/yard/upgrade.ts` adds the refusals). The Map Room (type 11) is upgraded here too: its level is the map version, capped at 2 by the cost table, and its one step (L1 → L2, no resources, 345,600 s) needs Town Hall 6 (`409 townHall { have, need: 6 }` below it); once it reaches level 2 the server joins the yard to a Map Room 2 world (see step 3 above; decision D16). `upgrade/instant` and `speedup` refuse the Map Room with `409 mapRoom`. |
| POST | `/api/:apiVersion/bm/yard/upgrade/cancel` | `id` (building id) | `{ id, refund: { r1..r4 } }` | Cancels a running upgrade (the panel's **Cancel upgrade**): `cU` and `cL` removed, level unchanged, progress lost, and the step's full price `costs[level]` credited (`cancelRefund`), each resource clamped to the storage cap; `refund` is what actually came back after that clamp. Shiny spent on the job is not refunded. `400 badRequest` if the yard has no building with that id; `409 notUpgrading` if no `cU` is running (including an upgrade the request's own catch-up just finished). |
| POST | `/api/:apiVersion/bm/yard/speedup` | `id` (building id), `item` = `SP1`\|`SP2`\|`SP3`\|`SP4` | `{ id, item, credits, remaining, finished }` — `credits` is the Shiny charged, `remaining` the seconds left afterwards (0 when finished), `finished` the job as a `completed` entry or `null` | Takes time off a running build (`cB`) or upgrade (`cU`): `SP1` finishes, free, only at ≤ 300 s left; `SP2` −1 h for 20, only at ≥ 1 h; `SP3` −2 h for 40, only at ≥ 2 h; `SP4` finishes for `timeCost(remaining)`, only at > 300 s (`client/scripts/STORE.as:1071-1082`). A countdown taken to 0 finishes on the spot exactly as the catch-up would finish it: level (or `prefab`), points, `flinger`/`catapult`. Refusals in order: `400 badRequest` (unknown id), `409 notRunning` (no `cB`/`cU`; a fortify does not count), `409 damaged` (damaged or repairing: the countdown is paused, and the original spent a speed-up on the repair instead), `409 mapRoom` (its L1→L2 step joins a world on completion, §5.7), `409 itemRefused { item, remaining }`, then `shinyLocked`/`credits`. `SP1` spends nothing, so a Shiny-locked account may use it. |
| POST | `/api/:apiVersion/bm/yard/upgrade/instant` | `id` | `{ id, from, to, credits, points }` — `credits` is the Shiny charged | Raises a building one level now: no resources charged, no worker held, the step's points awarded, `flinger`/`catapult` re-derived (`BFOUNDATION.DoInstantUpgrade`, `client/scripts/BFOUNDATION.as:2130-2140`). Price `int((ceil(sqrt((r1 + r2 + r3) / 2)^0.75) + timeCost(time)) × 0.95)` over `costs[level]`, goo not counted, time before Sharper Tools. Gates in order — the `upgrade` route's (`planOneUpgrade`, `server/src/services/yardplanner/startUpgrades.ts`) minus its last two, resources and a free worker: `400 badRequest` (unknown id), `400 useBatchRoute` (wall or trap), `409 mapRoom`, `400 badRequest` (decoration, mushroom or anything with no ladder), `409 busy` (`cB`/`cU`/`cF`), `409 damaged` (`hp` set or an entry in `buildinghealthdata`), `409 townHall { have: 0, need: 1 }` (no Town Hall), `409 maxLevel { level, max }`, `409 townHall { have, need }` or `409 requirements [[type, count, level]]` for `costs[level].re`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/shop/buy` | `item` (store code) | `{ item, credits, q, endsAt }` — `credits` is the Shiny charged, `q` the count now held, `endsAt` the expiry (unix s) of a timed item or `null` | Buys a General Store item for Shiny. Only allowlisted codes are sold (Phase 1: `BEW` extra worker, 250 / 500 / 1,000 / 2,000, four at most; `BST` Sharper Tools, 225, seven days; Phase 2: `CLOD` Monster Locker Overdrive, 60, four hours, sold only while an unlock runs, else `409 notUnlocking`; `HOD` / `HOD2` / `HOD3` Hatchery Overdrive 4x / 6x / 10x, 30 / 50 / 100, one hour, one stage at a time — any of the three still running is `409 alreadyActive { item, endsAt }` naming it; `EXH` Housing Expansion, 375, 24 hours, housing counts 1.25x); anything else is `400 notForSale`. The price is always the store table's (`game-data/store/storeItems.ts`); any price field the client sends is ignored. Written as the original wrote it (`client/scripts/STORE.as:2169-2182`): `storedata[item].q + 1`, and for a timed item `{ q: 1, s: now, e: now + du }` (the catch-up removes it once `e` passes, and it can then be bought again). Refusals: `409 alreadyActive { endsAt }` (a timed item still running), `409 soldOut { have, max }` (every tier bought), then `shinyLocked`/`credits`. Later phases add items to the allowlist in `controllers/yard/shopBuy.ts`. |
| POST | `/api/:apiVersion/bm/yard/locker/start` | `monster` (roster id, e.g. `C5`) | `{ monster, endsAt, cost: { r3 } }` — `endsAt` before any Overdrive | Starts unlocking a monster in the Monster Locker (`CREATURELOCKER.Start`, `client/scripts/CREATURELOCKER.as:961-1025`): the catalogue's full putty price (`server/src/game-data/monsterCatalogue.ts` `resource`) charged now, `lockerdata[monster] = { t: 1, s: now, e: now + time }`. Completion is the catch-up's. Refusals in order: `400 badRequest` (not an obtainable surface monster: not in the catalogue, blocked — only C18, spawned by Slimeattikus — or not a `C` id; C16, C17 and C19 are obtainable, decision D7); `409 alreadyUnlocked { monster }` (already in `lockerdata`); `409 unlockRunning { monster }` (one unlock at a time — names the running one, including when it is this monster; an Inferno `IC…` entry does not count); `409 noLocker` (no Monster Locker, type 8, or it is still being built); `409 lockerLevel { have, need }` (the highest finished locker's level, counting one mid-upgrade at its current level, below the monster's `level`); then `409 shortfall { r3 }`. |
| POST | `/api/:apiVersion/bm/yard/locker/cancel` | none | `{ monster, refund: { r3 } }` — what actually came back after the cap | Cancels the running unlock (`CREATURELOCKER.Cancel`, `:1027-1035`): the entry is removed and the full putty price credited, clamped to the storage cap. Shiny spent on an Overdrive is not refunded. `409 notUnlocking` if none is running (including one the request's own catch-up just finished). |
| POST | `/api/:apiVersion/bm/yard/locker/finish` | none | `{ monster, credits }` — Shiny charged | Finishes the running unlock now for `timeCost(e − now)` (free at ≤ 300 s; `e` already has any Overdrive taken off by the catch-up): `{ t: 2 }` and `academy[monster] ??= { level: 1 }`. `409 notUnlocking`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/locker/instant` | `monster` | `{ monster, credits }` — Shiny charged | Unlocks a monster at once for `timeCost(time) + ceil(sqrt(resource / 2)^0.75)` Shiny and **no putty** (`CREATURELOCKERPOPUP.InstantUnlock`, `client/scripts/CREATURELOCKERPOPUP.as:326-331`, `:365-443`): `{ t: 2 }` and `academy[monster] ??= { level: 1 }`. The `start` refusals except putty, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/hatchery/add` | `hatchery` (a hatchery's building id, or `hcc`), `monster` (roster id), `count` (1..400) | `{ hatchery, monster, added, requested, stoppedBy, cost: { r4 } }` — `stoppedBy` is `null` (all added), `"queue"` (no stack room) or `"goo"` | Queues up to `count` monsters in **one** request and one write (issue #31); partial by design. Monsters go in one at a time as the original's clicks did: the goo for the next one is tested first (`hatchCost(monster, academy level)` from the monster catalogue), then the stack rule. A hatchery's own queue (`monsters.h[i][2]`) puts the monster into its **first** non-full stack of that monster, else a new stack while it has fewer than `1 + level` (`client/scripts/HATCHERYPOPUP.as:234-292`; a hatchery still being built is level 0 unless it is a prefab, so one stack); the HCC's shared queue (`monsters.hcc`) only into its **last** stack, else a new one while it has fewer than 7 (`HATCHERYCCPOPUP.as:302-350`). Stacks hold 20 and are `[id, count, paidLevel]`: a stack merges only with one paid at the same academy level. After each one an idle hatchery starts the head of its queue (so an idle level 3 hatchery takes 81: one in production, four stacks of 20), or with an HCC the idle hatcheries that can work (built, at least half health) take from the shared queue in `hid` order. The goo for what went in is charged; `added: 0` writes nothing. A damaged or unbuilt hatchery still accepts queue changes. Refusals: `400 badRequest` (not an obtainable monster, as the locker reads it); `409 locked { monster }` (`lockerdata[monster].t` is not 2); `409 noHcc` (`hcc` without a finished Hatchery Control Centre); `409 noHatchery { id }` (no hatchery, type 13, with that id); `409 useHcc { id }` (a hatchery named once an HCC has finished building: its queue replaces theirs). |
| POST | `/api/:apiVersion/bm/yard/hatchery/remove` | `hatchery`, `slot` (0 = the monster in production, n ≥ 1 = the n-th queue stack), `count` (≥ 1 or `all`; default 1) | `{ hatchery, slot, monster, removed, refund: { r4 } }` — `refund` is what actually came back after the cap | Takes monsters out for the goo **paid** (the stack's paid level, not today's price; decision §10 Q2), credited and clamped to the storage cap. Slot 0 removes the one monster in production (whatever `count` says) and starts the next: from the hatchery's own queue, or with an HCC from the shared queue (`HATCHERYPOPUP.as:300-326`, `HATCHERYCCPOPUP.as:405-459`). With an HCC, `hcc` names the shared stacks and a hatchery id names only its slot 0 (the × on its tile); a hatchery's slot ≥ 1 is then `409 useHcc`. `409 noSlot { slot }` for an empty slot, plus the target refusals of `add`. |
| POST | `/api/:apiVersion/bm/yard/mushroom/pick` | `id` (the mushroom's index in `mushrooms.l`, coerced non-negative int), `x?`, `y?` (where the client saw it, yard units) | `{ id, x, y, golden, shiny }` — `shiny` is 0, 3 or 8 | Picks one yard mushroom (`docs/design/yard-buildings.md` §5.6, D14). `mushrooms` is stored as the Flash client stored it, `{ l: [[frame, X, Y], ...], s }`, and a mushroom's id is its place in `l`. The mushroom is removed at once and the server rolls the reward: golden one time in four, then 8 Shiny one time in three and 3 Shiny otherwise (`client/scripts/MUSHROOMS.as:224`, `:236-241`); the Shiny is credited even on a Shiny-locked account. A free worker is needed but not held (the original's job lasted seconds). Refusals: `400 badRequest` (no mushroom at that index); `409 moved { id, at: { x, y } }` (`x`/`y` given and the mushroom at that index stands elsewhere: the client's list is stale); `409 workers { total, busy }`. |
| POST | `/api/:apiVersion/bm/yard/hatchery/finish` | `hatchery` (or `hcc`: every working hatchery plus the shared queue) | `{ hatchery, housed: { id: n }, credits, finishedAll }` — `credits` is the Shiny charged; `finishedAll` false when housing ran out first | Houses what fits now for `timeCost(total, false) × 4` Shiny (`BUILDING13.as:268-413`, `BUILDING16.as:96-237`), `total` = what was left on each monster in production that is housed (0 for one already waiting for housing) + the hatch time of each queued monster housed, at today's academy levels. A hatchery: its monster in production first (if it does not fit, nothing does), then its queue from the head, whole stacks then as many of the next as fit; the next queued monster then starts from a full countdown. `hcc`: each working hatchery's monster in production in `hid` order, then the shared queue the same way; idle hatcheries then take the next. Free housing is `deriveHousingCapacity` (built Housing above 10 health, 1.25x while `EXH` runs) less the army. Refusals: the target refusals of `add` (with an HCC only `hcc`); `409 busy { id }` (hatchery still being built); `409 damaged { id }` (hatchery below half health, or an HCC at 10 health or less); `409 nothingToFinish`; `409 housingFull { free }` when nothing fits; then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/bank` | `ids` (a JSON array of harvester building ids) **or** `all=1` — exactly one | `{ banked: { r1..r4 }, byBuilding: { [id]: { resource, amount } }, leftInBuffers: { r1..r4 }, skipped: [{ id, reason }], points }` | Moves what harvesters hold into the pool (issue #109; `docs/design/yard-buildings.md` §5.1, D12): a tap on one harvester sends its id, the HUD's **Collect all** sends `all=1`. Per harvester in id order (`BRESOURCE.Bank`, `client/scripts/BRESOURCE.as:441-467`): it offers `min(st, capacity)`; what fits under the storage cap is credited, and what does not **stays in its buffer** (`leftInBuffers`; the original lost it, §10 Q3); points = the amount banked, halved and rounded up from tutorial stage 200 on (outside production the tutorial is skipped, which counts as 205); a buffer left below its capacity that was idle starts a fresh cycle (`pr: 1`, `cP` = one cycle). `all` takes every harvester that is built, has no `cB`/`cU`/`cF` running, is at full health and holds something (the original's Bank all, `client/scripts/BUILDINGINFO.as:458-466`). `ids` banks each named harvester that is built and has no countdown running, damaged or not; one that is busy or empty is listed in `skipped` (`busy`/`empty`) rather than refusing the rest. Refusals: `400 badRequest` for a malformed body (neither or both fields, `ids` not a non-empty JSON array of ids) or an id that is not a harvester in the yard. |
| POST | `/api/:apiVersion/bm/yard/build` | `type` (building type), `x`, `y` (the footprint's origin in yard units, integers) | `{ id, t, x, y, seconds, finished, cost: { r1..r4 }, points }` | Places a new building from the build menu (issue #111; `docs/design/yard-buildings.md` §5.3). Buildable types (`BUILDABLE_TYPES`, `server/src/services/yard/build.ts`): the harvesters and Silo (1-4, 6), Flinger, Yard Planner, Map Room, General Store, Baiter, Catapult (5, 10, 11, 12, 19, 51), the monster buildings (8, 9, 13, 15, 16, 26, 114, 116, 119) and the defences (17, 20-25, 115, 117, 118); not the Town Hall, the legacy Stone Block, the Radio (D15), any Inferno type (D19), the Map Room 3 structures or decorations. The new building gets the next id (one above every id in `buildingdata` and `buildinghealthdata`), `X`/`Y`, no `l`, and `cB = floor(time × bst)` with `cL` the same figure; `costs[0]` is charged and a worker held; the catch-up finishes it at level 1 with `floor(time / 2 + (r1 + r2 + r3 + r4) / 10)` points (+100 for a Town Hall). A wall or trap (17, 24, 117) is written finished at level 1 with those points at once and holds no worker (D13); `finished` says which, `points` is what was awarded now. Refusals in order: `400 notBuildable { type }`; `409 townHall { have, need }` (no hall, or `quantity[hall]` is 0; `need` the first hall that allows one); `409 limit { have, allowed, next }` (already as many as `quantity[hall]` allows, those under construction included; `next` is the hall level that allows more, or `null`); `costs[0].re` — `409 townHall { have, need }` or `409 requirements [[type, count, level]]` (a prerequisite under construction counts as level 0); `409 shortfall { r1..r4 }`; `409 placement { placement: "outOfBounds" }` (the footprint must end inside the plot for `storedata.ENL.q`), `{ placement: "overlap", with: id }` or `{ placement: "mushroom" }`; `409 workers { total, busy }` (not for walls and traps). |
| POST | `/api/:apiVersion/bm/yard/build/cancel` | `id` (building id) | `{ id, t, refund: { r1..r4 } }` — what actually came back after the cap | Takes down a building still under construction (the panel's **Cancel build**): it is removed from `buildingdata` (and its `buildinghealthdata` entry, if any) and its full build price `costs[0]` credited, clamped to the storage cap. Shiny spent speeding it up is not refunded. `400 badRequest` for an unknown id; `409 notBuilding` if no `cB` is running (including a build the request's own catch-up just finished). |
| POST | `/api/:apiVersion/bm/yard/build/instant` | `type`, `x`, `y` | `{ id, t, x, y, credits, points }` — `credits` is the Shiny charged | Places a new building finished at level 1 for `int((ceil(sqrt((r1 + r2 + r3) / 2)^0.75) + timeCost(time)) × 0.95)` Shiny over `costs[0]` (`BFOUNDATION.InstantBuildCost`, `client/scripts/BFOUNDATION.as:2085-2098`), no resources charged, no worker held, the build's points awarded now. The `build` refusals except `shortfall` and `workers`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/academy/train` | `monster` (roster id), `academy?` (a Monster Academy's building id; absent takes the lowest-level idle one that can train the monster, the lower id on a tie, issue #180) | `{ monster, academy, to, endsAt, cost: { r3 } }` | Trains a monster one level at a Monster Academy (`ACADEMY.StartMonsterUpgrade`, `client/scripts/ACADEMY.as:54-131`): the catalogue's `trainingCosts[level − 1]` putty charged now, `academy[monster] = { …, level, time: now + seconds, duration: seconds }`, and the academy's `buildingdata[id].upg = monster` (one academy, one monster: two academies are two slots). Completion is the catch-up's. Refusals: `400 badRequest` (not an obtainable surface monster, or `academy` not in the yard or not a Monster Academy, type 26); with `academy`: `409 busy { id }` (being built, upgraded or fortified — the original has no Open button then), `409 damaged { id }`, `409 academyBusy { id, monster }`; without it `409 noAcademy` (no finished one) first; then `409 training { monster, endsAt }`, `409 locked { monster }` (`lockerdata[monster].t` is not 2), `409 maxLevel { monster, level }` (5 for C15, 6 for the rest); without `academy`, the first academy's `busy`/`damaged`/`academyBusy` when none is idle; `409 academyLevel { have, need }` (level N → N+1 needs an academy at level N); then `409 shortfall`. |
| POST | `/api/:apiVersion/bm/yard/academy/cancel` | `monster` | `{ monster, refund: { r3 } }` — what actually came back after the cap | Cancels a training (`ACADEMY.CancelMonsterUpgrade`, `:133-146`): `time`/`duration` removed, the academy's `upg` removed, the step's full putty price credited, clamped to the storage cap. `409 notTraining { monster }` (including one the request's own catch-up just finished). |
| POST | `/api/:apiVersion/bm/yard/academy/finish` | `monster` | `{ monster, level, credits }` — the new level, Shiny charged | Finishes a training now for `timeCost(time − now)` (the generic `SP4`, `ACADEMYPOPUP.as:435-438`; free at ≤ 300 s): as the catch-up's completion. `409 notTraining`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/academy/instant` | `monster`, `academy?` | `{ monster, level, credits }` | Trains one level at once for `timeCost(seconds) + ceil(sqrt(putty / 2)^0.75)` Shiny and **no putty** (`ITR`, `ACADEMYPOPUP.as:129-137`, `:365-424`); the academy is not taken. The `train` refusals except putty, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/repair` | `ids` (a JSON array of building ids) **or** `all=1` — exactly one | `{ started: number[], skipped: [{ id, reason: "notDamaged" \| "repairing" }], doneBy }` — `doneBy` is the unix second by which every repair now running is done | Starts repairs (issue #113; `docs/design/yard-buildings.md` §5.5): sets `rE: 1` on each damaged building (health below the level's maximum, read from `buildinghealthdata` then `hp`). Free, no worker (`BFOUNDATION.Repair`, `client/scripts/BFOUNDATION.as:2017-2022`); the catch-up heals it. `all=1` takes every damaged building not already repairing (the post-attack banner's **Repair all**, `client/scripts/BASE.as:2064-2081`); `ids` takes each named one that is damaged and not repairing and lists the rest in `skipped`. Refusals: `400 badRequest` for a malformed body or an id not in the yard; `409 notDamaged { skipped }` when nothing was started. |
| POST | `/api/:apiVersion/bm/yard/repair/instant` | none | `{ repaired: number[], credits }` — `credits` is the Shiny charged | **Repair now** (`FIX`): every damaged building, repairing or not, to full health at once (`hp`, `rE` and the `buildinghealthdata` entry removed; a paused countdown runs again from now) for `timeCost(sum of the repair seconds over 300) + 10 × how many of those`, each building's seconds `int((max − health) / rate)` (`client/scripts/STORE.as:381-395`, `:2149-2161`; the original's Repair Now started a repair on everything damaged before pricing, `BASE.as:2082-2096`). Repairs of 300 s or less are neither charged nor counted, so the price can be 0. Refusals: `409 notDamaged`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/recycle` | `id` (building id) | `{ id, t, refund: { r1..r4 }, lost: { r1..r4 }, stored: { type, count } \| null, culled: { [monster]: count } }` — `refund` is what came back after the cap, `lost` what the cap turned away | Takes a building off the yard (issue #112; `docs/design/yard-buildings.md` §5.4). An ordinary building refunds half of every level's cost paid, floored per resource (`refundOf`; `BFOUNDATION.RecycleCost`, `client/scripts/BFOUNDATION.as:2625-2666`), credited under the storage cap the yard has **without** the building (so a Storage Silo's refund meets the smaller cap). A decoration refunds nothing and goes into storage, `researchdata["b<type>"] + 1` (the two Wild Monster totems, 121 and 131, also keep `researchdata["bl<type>"]` = their level); a taunt or gift sign comes off for nothing. The building leaves `buildingdata` and `buildinghealthdata`. Recycling Monster Housing that leaves the army without room runs the overflow cull at once (one of every type per pass, no refund) and writes `monsters.housed` and `space`; the original refused such a recycle instead (`BUILDING15.as:45-52`). Refusals in order: `400 badRequest` (malformed or unknown id); `409 isTownHall`; `409 mapRoom` (its level is the map version, D16); `409 busy` (`cB`/`cU`/`cF` running — a build is cancelled, not recycled); `409 championInCage` (Champion Cage, type 114, while a champion has status 0); `409 championsFrozen` (Champion Chamber, type 119, with a non-empty `fz` or a champion with status 1); `409 researching` (Monster Lab, type 116, with `upg` or `upt` in the future); `409 training` (Monster Academy, type 26, with `upg`, or any `academy[id].time` in the future when the yard has one academy); `409 hatcheryBusy` (a Hatchery with a monster in production or queued, or an HCC with a queue — take them out first, which refunds them); `409 unlocking` (the Monster Locker while an unlock runs — cancel it first). Every refusal carries `{ id }`. |
| POST | `/api/:apiVersion/bm/yard/juice` | `monsters` (a JSON object of counts, e.g. `{"C2": 20, "C5": 3}`; 1 to 40 ids, each a whole count ≥ 1) | `{ juiced: { id: n }, goo, lost, rate }` — `goo` is what landed after the cap, `lost` what the cap swallowed, `rate` the Juicer's | Juices housed monsters in the Monster Juicer (§7.3, issue #122): each gives `ceil(cResource × rate)` goo, `cResource` its hatch cost at its academy level and `rate` 0.6 / 0.8 / 1.0 at Juicer level 1 / 2 / 3 (`client/scripts/BUILDING9.as:54-67`), credited clamped to the goo cap; the monsters leave `monsters.housed` for good. The Juicer (type 9) must be built, not upgrading, and above half health. Refusals, in order: `409 mapRoom3`; per id `409 inferno` (an `IC` id) or `400 badRequest` (not a monster); `409 noJuicer`; `409 busy` (still being built, or upgrading); `409 damaged` (at half health or below); `409 notEnough { monster, have, need }`. |
| POST | `/api/:apiVersion/bm/yard/bunker/fill` | `bunker` (a Monster Bunker's building id), `monsters` (a JSON object of counts, as `juice`), `source` = `housing`\|`buy` | `{ bunker, source, added: { id: n }, cost: { r3 }, credits, used, capacity }` — `cost` the putty charged (`housing`), `credits` the Shiny (`buy`), `used`/`capacity` the bunker's space afterwards | Puts monsters in a Monster Bunker (type 22, §7.1, issue #120). Its contents live on its own building entry, `buildingdata[id].m = { monsterId: count }` (`client/scripts/BUILDING22.as:665-700`); its room is 380 / 450 / 540 / 660 / 800 by level (Map Room 2, `GLOBAL.as:683`), in `cStorage` at each monster's academy level, checked against what is inside plus the whole selection. `housing`: the monsters leave `monsters.housed` for `floor(cResource × 0.5 × n)` putty per type (`MONSTERBUNKERPOPUP.as:464-476`). `buy`: Shiny per monster C2 2, C5 16, C6 5, C7 8, C8 12, C10 14, C11 24, C12 65, C13 24, C17 17 (`:30-46`), the monster unlocked. Only C1–C13 and C17 go in. Refusals, in order: `409 mapRoom3`; `409 noBunker { id }`; `409 busy` (still being built); per id `400 badRequest` (not a monster) or `409 notBunkerable { monster }`; `buy`: `409 notBuyable { monster }`, `409 locked { monster }`; `housing`: `409 notEnough { monster, have, need }`; `409 bunkerFull { capacity, used, need }`; then the wrapper's `shortfall` / `shinyLocked` / `credits`. |
| POST | `/api/:apiVersion/bm/yard/bunker/remove` | `bunker`, `monster` (roster id), `count` (≥ 1 or `all`; default 1; more than the bunker holds takes what it holds) | `{ bunker, monster, removed, juiced, goo, lost }` — `juiced` true when a Juicer turned them into goo, `goo` what landed after the cap, `lost` what the cap swallowed | Takes monsters out of a bunker for good (D11: never back to housing, nothing refunded). With a working Juicer they are juiced at its rate, exactly as `juice`; otherwise they are simply deleted (`MONSTERBUNKERPOPUP.as:698-745`). Refusals: `409 noBunker { id }`; `409 mapRoom3`; `400 badRequest` (not a monster); `409 notInBunker { monster }`. |
| POST | `/api/:apiVersion/bm/yard/lab/start` | `monster` (roster id; one of the ten with a Lab ability) | `{ monster, rank, lab, endsAt, cost: { r3 } }` | Researches a monster's next Lab rank (`MONSTERLAB.StartMonsterPowerup`, `client/scripts/MONSTERLAB.as:315-325`): the rank's putty (`LAB_ABILITIES`, `:77-188`) charged now, and the Lab's own entry gets `upg = monster`, `upt = now + seconds` (absolute), `upl = rank`. One Lab, one research at a time. Completion is the catch-up's (`academy[monster].powerup = upl`, the three fields removed; `completed` kind `research`, `detail: { rank, lab }`). Refusals: `400 badRequest` (no Lab ability); `409 noLab`; `409 busy { id }` (being built, upgraded or fortified), `409 damaged { id }`, `409 labBusy { id, monster }`; then `CanPowerup` (`:269-313`): `409 locked { monster }`, `409 maxRank { monster, rank }`, `409 labLevel { have, need }` (rank N needs Lab level N), `409 monsterLevel { monster, have, need }` (rank N needs the monster at academy level N + 1); then `409 shortfall`. While a research runs the Lab cannot be upgraded (`409 busy`, `MONSTERLAB.as:241-247`) or recycled (`409 researching`). |
| POST | `/api/:apiVersion/bm/yard/lab/cancel` | none | `{ monster, rank, refund: { r3 } }` — what actually came back after the cap | Cancels the research (`MONSTERLAB.CancelMonsterPowerupB`, `:379-388`): the Lab's `upg`/`upt`/`upl` removed, the rank's full putty price credited, clamped to the storage cap. `409 noLab`, `409 notResearching` (including one the request's own catch-up just finished). |
| POST | `/api/:apiVersion/bm/yard/lab/finish` | none | `{ monster, rank, credits }` | Finishes the research now for `timeCost(upt − now)` (the generic `SP4` on the Lab, `MONSTERLABPOPUP.as:429-432`, `STORE.as:377-378`; free at ≤ 300 s): as the catch-up's completion. `409 noLab`, `409 notResearching`, then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/lab/instant` | `monster` | `{ monster, rank, credits }` | Researches the next rank at once for `timeCost(seconds, no free minutes) + ceil(sqrt(putty / 2)^0.75)` Shiny and **no putty** (`IPU`, `MONSTERLAB.GetShinyCost`, `:69-73`, `:390-431`); the Lab is not taken. The `start` refusals except putty (so not while the Lab researches), then `shinyLocked`/`credits`. |
| POST | `/api/:apiVersion/bm/yard/champion/raise` | `type` (1..5; only 1 Gorgo, 2 Drull, 3 Fomor are raisable) | `{ champion }` — the new `champion` entry | Hatches a champion at the Champion Cage (type 114, §7.2, issue #123), free: level 1, full health, `ft` = now + 23 h, `status` 0 (`CHAMPIONSELECTPOPUP.as:72-90`). A juiced champion of the same type is replaced. Refusals, in order: `409 notRaisable { type }` (Korath, Krallen, D17); `409 noCage`; `409 busy` (cage still being built); `409 championInCage`; `409 frozen { type }` (that champion is in the Chamber). |
| POST | `/api/:apiVersion/bm/yard/champion/feed` | `mode` = `monsters`\|`shiny` | `{ champion, mode, eaten: { id: n }, credits, evolved }` | Feeds the champion in the cage (`CHAMPIONCAGE.FeedGuardian`, `:682-877`). Below level 6: only once hungry (`ft` < now); eats the level's Map Room 2 recipe from `monsters.housed` (e.g. Gorgo L1 15 × C2, `CHAMPIONCAGE.as:539-565`) or costs the level's `feedShiny`; `fd` + 1 and, at the level's `feedCount` (3/6/9/12/15), evolves: next level, `fd` 0, full health. Level 6: raises the food bonus `fb` one rank (max 3) and adds its bonus health; Shiny price is the next rank's `bonusFeedShiny`, doubled while not hungry. Either way `ft` = now + 23 h. Refusals: `409 noCage` / `busy`; `409 noChampion`; `409 notHungry { feedTime }`; `409 fullBuff` (level 6, not hungry, rank 3, Shiny); `409 mapRoom3`; `409 notEnough { monster, have, need }`; then the wrapper's `shinyLocked` / `credits`. |
| POST | `/api/:apiVersion/bm/yard/champion/evolve` | none | `{ champion, credits }` | Evolves the champion one level now for `feedShiny × 2 × (feedCount − fd)` Shiny (`CHAMPIONCAGEPOPUP.as:1208-1238`; the `evolveShiny` table is never read): `fd` 0, full health, `ft` = now + 23 h. Refusals: `409 noCage` / `busy`; `409 noChampion`; `409 maxLevel`; wrapper `shinyLocked` / `credits`. |
| POST | `/api/:apiVersion/bm/yard/champion/heal` | none | `{ champion, credits }` | Heals to full now for `timeCost(missing / max × healtime, false)` (`ChampionBase.as:1237-1241`); full health counts the food bonus. Refusals: `409 noCage` / `busy`; `409 noChampion`; `409 fullHealth`; wrapper `shinyLocked` / `credits`. |
| POST | `/api/:apiVersion/bm/yard/champion/rename` | `name` (trimmed, 1–20 characters) | `{ champion }` | Sets `nm`. Refusals: `400 badRequest` (empty or too long); `409 nameRefused` (profanity filter); `409 noChampion`. |
| POST | `/api/:apiVersion/bm/yard/champion/juice` | none | `{ champion }` | Puts the champion into the Monster Juicer for good: `status` 2, no goo (`BUILDING9.as:70-73`, `ChampionBase.as:276`). A new one can then be raised. Refusals: `409 noChampion`; `409 noJuicer`; `409 busy` (Juicer being built or upgraded); `409 damaged` (Juicer at half health or below). |
| POST | `/api/:apiVersion/bm/yard/champion/freeze` | none | `{ champion }` | Moves the champion in the cage into the Champion Chamber (type 119, §7.2, issue #125; `CHAMPIONCHAMBER.FreezeGuardian`, `:103-141`): `status` 1 and `ft` made relative (`ft − now`), so it neither heals nor starves while frozen; the chamber's `fz` is rewritten as the JSON string of every frozen entry. Free. Refusals, in order: `409 noChamber`; `409 busy` (chamber still being built); `409 noChampion`; `409 injured { hp, max }`; `409 hungry { feedTime }`. |
| POST | `/api/:apiVersion/bm/yard/fortify` | `id` (building id) | `{ id, from, to, seconds, cost: { r1..r4 } }` — the fortification it was at and will reach, the countdown written | Outposts only (issue #184): starts the next step of the outpost table's fortify ladder on the core (112) or a cannon, sniper, laser, tesla, flak or railgun tower, F1 to F4 (`BFOUNDATION.Fortify`, `BASE.CanFortify`). Charges the step to the main pool up front and writes `cF = floor(time × bst)`, which holds the worker; the catch-up raises `fort` by one and awards `Fortified()`'s points. `400 notFortifiable` for a building with no ladder (every main-yard building), then `409` `busy`, `damaged`, `townHall`, `maxFortify { fort, max }` ("This building is fully fortified."), `requirements`, `shortfall`, `workers`. `speedup` works on a running fortification. |
| POST | `/api/:apiVersion/bm/yard/fortify/cancel` | `id` (building id) | `{ id, refund: { r1..r4 } }` — what actually came back after the cap | Stops a running fortification and refunds the step's full price to the main pool, clamped to the storage cap (`FortifyCancelC`); the fortification stays where it was. `409 notFortifying` when no `cF` runs. |
| POST | `/api/:apiVersion/bm/yard/champion/thaw` | `type` (1..5) | `{ champion }` | Brings a frozen champion back to the cage (`ThawGuardian`, `:143-221`): `status` 0, `ft + now`; `fz` rewritten. Free. Refusals, in order: `409 noChamber` / `busy`; `409 damaged { id }` (the chamber); `409 noCage` / `busy`; `409 championInCage` (freeze that one first); `409 notFrozen { type }`. |

**Shiny prices** are all worked out on the server by `services/yard/shiny.ts`, never taken from
the client (`docs/design/yard-buildings.md` §2.6). `timeCost(t)` is the original
`STORE.GetTimeCost` (`client/scripts/STORE.as:162-171`): `min(ceil(t × 20 / 3600), int(sqrt(t × 0.8)))`,
free at ≤ 300 s (the hatchery, Lab and healing variants pay for every second). Examples: 1 h → 20,
24 h → 262. Shiny is never refunded, and a spend never takes the balance below 0 (`409 credits`).

**The owner's `/base/load`.** A `build` load of the caller's own main yard runs the same locked
catch-up and writes it before answering (skipped while the yard is under attack, which the load
already refuses). So a plain yard load now writes the save row: `savetime` always (it moves to
now), plus `buildingdata` when a countdown ran, `points` when one completed, `flinger`/`catapult`
when they were stale, and `storedata` when a buff expired (MikroORM writes only the columns that
changed, plus the `lastupdateAt` timestamp). Any owner load of any base also re-derives
`flinger`/`catapult`. The three Yard Planner write routes re-derive them too.

That load's answer carries `completed`: the jobs its catch-up finished, oldest first, in exactly
the shape of a yard action's `completed` above (`[]` when nothing finished, or when the catch-up
was skipped because the yard is under attack). Because the load wrote them, the client's first
`POST /bm/yard/state` finds nothing new, so this list is the only record of what finished while
the player was away; the web client shows it as one "While you were away: …" notice (issue #135).
Any such load counts, including the map screen's (it loads the own yard to find the home cell), so
the client keeps each list until the yard screen shows it.
A `build` load of one of the caller's own Map Room 2 outposts does the same for the outpost
(outposts WP3, issue #184): the main row locked first, then the outpost's, its catch-up written,
the core placed when it is empty, and `completed` sent; it is skipped (and the row answered as it
is) while either yard is under attack or when the outpost is not listed in the main yard's
`outposts`. No other load (another mode, somebody else's base, Inferno) sends `completed`.

**Outpost income (autobank, outposts WP4, issue #185).** A Map Room 2 player's outposts pay into
the main pool on the server (`services/maproom/v2/autobank.ts`, Flash's
`AutoBankManager.as`): per outpost, per 10 s tick, `max(int(produce[l − 1] × 125 / h), 1)` summed
over its harvesters (types 1-4) with health above 0, `h` the cell's `terrainHeight` (100 when
missing), an upgrading harvester at its next level, one under construction at 1. Every whole tick
since `buildingresources.t` is paid, at most two days' worth, doubled up to the end of the main
yard's Production Overdrive (`POD`), credited under the main storage cap (overflow lost), plus
`ceil(0.375 × credited)` points; `t` moves to the end of the last tick paid and the column is
rewritten as `{ t, b<baseid>: { r1..r4 } }` for the current outposts. No `t` on record pays nothing
and starts the clock. It runs under the main row's lock in the owner's build load (main yard or
outpost), in every yard action before `run` (so `state` pays), and in an attack load before the
loot snapshot (see the attack section); nothing is added to `completed`.

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
| `pic_square` | string, nullable | yes | Avatar: a picked critter's web-client path (`/avatars/<id>.webp`, set by `/player/avatar`, issue #175), or the older placeholder / Discord avatar URL. |
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
| `buildingdata` | `Record<buildingId, { x, y, t (type), id, l? (level), fort?, cB?/cU?/cF? (countdown build/upgrade/fortify), cL? (length in seconds of the running build or upgrade as it was started, after Sharper Tools: written with `cU` by `bm/yard/upgrade` and Apply, left alone by the catch-up and by speed-ups, removed when the job finishes or is cancelled; absent on jobs started before #136 and on any job not started by the server, where a client falls back to the cost table's time), hp? (only present when damaged), rE? (repairing flag), prefab? }>` — every building on the yard. |
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
| `quests`, `player`, `krallen`, `siege`, `rewards`, `researchdata`, `lockerdata`, `events`, `inventory`, `monsterbaiter`, `loot`, `attackloot`, `lootreport`, `attackersiege`, `buildingresources`, `mushrooms`, `frontpage`, `effects`, `achieved`, `gifts`, `sentinvites`, `sentgifts`, `fbpromos`, `updates`, `stats`, `aiattacks`, `monsters`, `coords`, `savetemplate` | Opaque JSON, format owned by the Flash client / specific handlers; not exhaustively typed server-side (`JsonObject`). Confirmed specific uses: `rewards` holds unlockable-event flags keyed by reward id (see `getDefaultBaseData.ts`); `buildingresources` holds a `t` (last auto-bank timestamp) plus per-outpost `b{baseid}` rates; on Map Room 2 it is the server's alone (`services/maproom/v2/autobank.ts`: `t` is when outpost income was paid up to, each `b{baseid}` is `{r1..r4}` per 10 s tick) and Map Room 3 uses only `t`; `savetemplate` is the yard-planner template array (`/bm/yardplanner/*`); `monsters` is the owned-monster roster (shape branches by MR2 vs MR3 in `monsterUpdateHandler.ts`), and its MR2 `housed` counts are the one part of it the server reads rather than stores blindly — `/worldmapv2/transferassets` validates them against the other yard's and against derived housing capacity (see "Monster transfer rules" above), while `space`, `h`, `hid`, `hstage` and `hcc` stay opaque. Everything else in this row is passed through opaquely by the server (read, stored, and echoed back without validation) — a new client must reproduce the Flash client's exact shape for whichever of these it needs to write to, since the server does not document or enforce one. |

`Save.saveKeys` / `Save.attackSaveKeys` (static arrays on the entity) enumerate exactly which
of the above the save endpoint will accept from the client in which context — see the Base
Save table above.

When `ECONOMY_SAVE_VALIDATION=reject`, `resources.r1max..r4max` and `basevalue` on a `main`/
`outpost` owner save are computed server-side by the economy audit rather than stored as the
client sent them — see "Economy save validation" under Base / Yard.

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
- **JSON-in-a-string fields are pervasive, not legacy cruft to clean up.** Zod schemas across
  the codebase expect `resources`, `buildingdata`, `champion`, `purchase`, `attackData`,
  `bookmarks`, `monsterupdate`, etc. as JSON **strings**, and that is still the shape every
  controller and service works with. Since issue #28 a client sending `application/json` may
  pass them as native objects and arrays — `middleware/jsonBody.ts` does the stringifying at
  the edge — but nothing downstream of that middleware was changed, so a form-encoded client
  must keep double-encoding them (see §1, "Request body format").
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
