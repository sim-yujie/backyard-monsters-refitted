/**
 * Wire types for the routes this client calls.
 *
 * Only the fields the client actually reads are typed. Responses carry far more
 * (see docs/server-api.md §3 Data models), so every envelope keeps an index
 * signature rather than pretending the list is complete.
 */

import type { InfernoLoadState } from "./inferno";

/** Every successful game response carries `error: 0`. See ApiError for why. */
export interface ApiEnvelope {
  error?: number | string;
  [key: string]: unknown;
}

/** The `errorDetails` object the global ErrorInterceptor attaches. */
export interface ApiErrorDetails {
  error?: string;
  status?: number;
  message?: string;
  data?: unknown;
  internalInfo?: unknown;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

/** `sessionType` on the login route. A game session and a launcher session coexist. */
export const SessionType = {
  GAME: "game",
  LAUNCHER: "launcher",
} as const;
export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export interface LoginRequest {
  email?: string;
  password?: string;
  /** A previously issued JWT, for re-login without credentials. */
  token?: string;
  sessionType?: SessionType;
}

export interface LoginResponse extends ApiEnvelope {
  error: number;
  userId: number;
  token: string;
  /** Which Map Room the account is on: 0 none, 1 v1, 2 v2, 3 v3. */
  mapversion: number;
  username?: string;
  email?: string;
  pic_square?: string | null;
  language?: string;
  /**
   * The map bookmark blob, stored unvalidated on `user.bookmarks`. `{}` on a
   * new account. See api/bookmarks.ts for the shape and why it is not an array.
   */
  bookmarks?: unknown;
}

/** `POST /api/:apiVersion/player/register` (issue #213). */
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  /** The sign-up form's Turnstile token; the server checks it when it has a secret key. */
  turnstileToken?: string;
  /** The form showed the Terms and age line; the server records when. */
  termsAccepted?: boolean;
  /**
   * The dev-only "Start with the test yard" box was ticked (issue #217): the
   * first yard is the maxed sandbox yard. A server without DEV_SANDBOX ignores it.
   */
  sandboxStart?: boolean;
}

/** What the sign-up form may offer, from GET /api/:apiVersion/player/signupoptions (issue #217). */
export interface SignUpOptionsResponse extends ApiEnvelope {
  /** The server has DEV_SANDBOX on (never in production), so the test yard box is shown. */
  sandboxStart: boolean;
}

export interface RegisterResponse extends ApiEnvelope {
  user: { userid: number; username: string; email: string };
}

/** What the client keeps once a login succeeds. */
export interface Session {
  token: string;
  userId: number;
  username: string | null;
  /**
   * `pic_square` as the login sent it: a picked avatar's path, or whatever the
   * account had before (issue #175; read it with `game/avatars.ts`). Optional
   * because a session saved before avatars existed has none.
   */
  picSquare?: string | null;
  sessionType: SessionType;
}

/** `POST /api/:apiVersion/player/avatar` (issue #175): the stored path, echoed. */
export interface SetAvatarResponse extends ApiEnvelope {
  error: number;
  pic_square: string;
}

/** `GET /api/:apiVersion/player/account`. */
export interface AccountResponse extends ApiEnvelope {
  error: number;
  username: string;
  canChangeUsername: boolean;
  nextChangeAt: string | null;
  settings?: {
    shinyLocked?: boolean;
    hideOnline?: boolean;
    friendRequests?: boolean;
    /** The server's MR2_TILT switch lets Map Room 2 tilt (MR2 look plan step 4). */
    mapTiltAllowed?: boolean;
    /** The player's own choice: Map Room 2 tilted (default) or flat. */
    tiltedMap?: boolean;
    /** The server's MR2_HEX_SHAPE switch: Map Room 2's hexes flat-top (default) or pointy-top. */
    mapHexShape?: "flat" | "pointy";
    /** The player's country (ISO 3166-1 alpha-2), null when not set. */
    country?: string | null;
    countryAsked?: boolean;
    /** The country's chat room, when it has one. */
    countryChannel?: string | null;
    /** The bell's notification categories turned off (`api/notificationSettings.ts`). */
    notificationsOff?: string[];
  };
}

/** `POST /api/:apiVersion/player/changeusername`. */
export interface ChangeUsernameResponse extends ApiEnvelope {
  error: number;
  username: string;
  nextChangeAt: string;
}

/** `POST /api/:apiVersion/player/settings`. */
export interface SettingsResponse extends ApiEnvelope {
  error: number;
  settings: { shinyLocked: boolean; mapTiltAllowed?: boolean; tiltedMap?: boolean; mapHexShape?: "flat" | "pointy" };
}

/* ── Base / yard ────────────────────────────────────────────────────────── */

/** `type` on /base/load. Values from server/src/enums/Base.ts (BaseMode). */
export const BaseMode = {
  /** Own yard, editable. */
  BUILD: "build",
  /** Someone else's yard, read-only. */
  VIEW: "view",
  /** Read-only view opened from the world map. */
  WORLD_MAP_VIEW: "wmview",
  ATTACK: "attack",
  WORLD_MAP_ATTACK: "wmattack",
  /** "no base id yet" sentinel; a build load with this id opens the main yard. */
  DEFAULT: "0",
} as const;
export type BaseMode = (typeof BaseMode)[keyof typeof BaseMode];

export interface BaseLoadRequest {
  type: BaseMode;
  /** Accepted but unused by the handler; still required by the schema. */
  userid: string;
  /** `"0"` (BaseMode.DEFAULT) opens the caller's main yard. */
  baseid: string;
  /**
   * Which Map Room the caller is in. Optional on the schema, but the attack
   * modes' range check throws without it (`validateRange.ts:49`), so an attack
   * load always sends it.
   */
  mapversion?: number;
  /**
   * The attacker's declared roster and stats, as a JSON string in one form
   * field (`BaseLoadSchema.ts`, `z.string().transform(JSON.parse)`). Required
   * on `attack`/`wmattack` and read on nothing else; see {@link AttackData}.
   */
  attackData?: string;
}

/* ── Attack ─────────────────────────────────────────────────────────────── */

/**
 * One monster type on an attack load's `attackData`
 * (`server/src/schemas/AttackSchema.ts`, `MonsterSchema`).
 *
 * `count` is how many the attacker can send; the server does not check it
 * (`validateAttack.ts:10-11`'s own TODO). `stats` is the full prop block the
 * server holds for that id, every key of which it compares against its own
 * copy to two decimal places and bans on a mismatch (`validateAttack.ts:44-66`).
 */
export interface AttackDataMonster {
  /** Roster id: `C1`, `IC7`, … */
  id: string;
  count: number;
  stats: Record<string, unknown>;
}

/** One champion on `attackData` (`ChampionSchema` in `AttackSchema.ts`). */
export interface AttackDataChampion {
  /** `G<t>`, the key the server's `championStats` table uses. */
  type: string;
  stats: Record<string, unknown>;
}

/**
 * What `ATTACK.AttackData()` builds (`client/scripts/ATTACK.as:199-222`,
 * `docs/specs/combat.md` §2 "The request"): every champion the player owns and
 * every monster type available to fling, each with its stat block.
 */
export interface AttackData {
  champions: AttackDataChampion[];
  monsters: AttackDataMonster[];
}

/**
 * One entry of a save's `champion` list (`server/src/schemas/ChampionSchema.ts`).
 *
 * The attacker's own list rides out on the own-yard load and back in as
 * `attackerchampion` on an attack save; the defender's arrives on the attack
 * load and goes back as `champion`, of which only a lower `hp` is honoured.
 */
export interface ChampionSaveEntry {
  /** Champion type, 1 to 5; `G<t>` keys the stat table. */
  t: number;
  hp: number;
  /** Evolution level. */
  l: number;
  /** Feed time, unix seconds. */
  ft: number;
  /** Feed count. */
  fd: number;
  /** Food bonus level. */
  fb: number;
  /** Power level, 0 to 3. */
  pl: number;
  /**
   * 0 active, 1 frozen, 2 juiced, 3 an egg in the cage (`ft` then its hatch
   * time). Only 0 may be flung (`combat.md:750-751`).
   */
  status: number;
  nm?: string;
  /** The Mode it last attacked in (issue #220); absent is Hybrid. Anything else is ignored. */
  s?: unknown;
  /** Its learned brain's weights (issue #219, `brain.ts`); the server's alone to write. */
  b?: unknown;
  /** What its brain has learned from: `n` attacks, and each Mode's usual score. */
  bs?: unknown;
  /** Its habits per Mode (champion modes round 2, `habits.ts`); the server's alone to write. */
  h?: unknown;
  /** What its habits learned from: `n` attacks, and each Mode's count and usual scores. */
  hs?: unknown;
  [key: string]: unknown;
}

/**
 * A save's `monsters` blob: housing state (`docs/specs/maproom2.md:286-290`,
 * `MapRoomCell.as:397-432`). Only `housed` is read here; the hatchery fields
 * are left to the index signature.
 */
export interface MonstersSave {
  /** Monster count by roster id. */
  housed?: Record<string, number | undefined>;
  /** Housing capacity in `cStorage` units. */
  space?: number;
  /**
   * Unix seconds the hatchery countdowns in `h` are measured from
   * (`docs/specs/monsters-and-hatchery.md` §10).
   */
  saved?: number;
  /**
   * One entry per hatchery, index-aligned with `hid` and `hstage`:
   * `[inProduction, countdownProduce, queue?, paidLevel?]`, the countdown in
   * seconds left at `saved`; queue stacks are `[id, count, paidLevel]` and the
   * paid level is the academy level the goo was charged at (design §10 Q2).
   */
  h?: (readonly [monster: string, countdown: number, queue?: unknown, paidLevel?: number])[];
  /** The hatcheries' building ids, index-aligned with `h`. */
  hid?: number[];
  /** Production stage per hatchery: 0 idle, 1 producing, 2 waiting for housing, 3/4 starting. */
  hstage?: number[];
  [key: string]: unknown;
}

/**
 * One academy entry: the monster's training level and Lab rank
 * (`docs/specs/monsters-and-hatchery.md` §10 "academy").
 */
export interface AcademyEntry {
  /** Academy level, 1..6; absent means 1. */
  level?: number;
  /**
   * End of the running training, unix seconds. A legacy save may hold a
   * value of 583,200 or less, which is a remainder relative to `savetime`
   * (`client/scripts/com/monsters/player/Player.as:170-177`).
   */
  time?: number;
  /** Total seconds of the running training. */
  duration?: number;
  /** Monster Lab ability rank, 1..3; absent means 0. */
  powerup?: number;
  [key: string]: unknown;
}

/** `academy`, keyed by roster id. */
export type AcademyData = Record<string, AcademyEntry | undefined>;

/**
 * One `lockerdata` entry (`docs/specs/monsters-and-hatchery.md` §10
 * "lockerdata"): `t` 1 while unlocking, 2 once unlocked; `s` and `e` are the
 * unlock's start and end in unix seconds and go once it completes.
 */
export interface LockerEntry {
  t: number;
  s?: number;
  e?: number;
  [key: string]: unknown;
}

/** `lockerdata`, keyed by roster id. A monster not listed is locked. */
export type LockerData = Record<string, LockerEntry | undefined>;

/** One `storedata` entry: `q` a quantity bought, `e` a buff's expiry in unix seconds. */
export interface StoreEntry {
  q?: number;
  e?: number;
  [key: string]: unknown;
}

/** `storedata`, keyed by store item code (`BEW`, `BST`, `ENL`, …). */
export type StoreData = Record<string, StoreEntry | undefined>;

/**
 * The main yard's `buildingresources` on Map Room 2: `t`, the unix second the
 * player's outpost income is paid up to, and one `b<baseid>` rate per outpost,
 * what it adds to each resource per 10 s tick. The server writes it at every
 * payout (`server/src/services/maproom/v2/autobank.ts`); `game/yard/outpostIncome.ts`
 * reads it.
 */
export type BuildingResources = { t?: number } & Record<string, unknown>;

/** The storage cap per resource, as the server clamps credits to it. */
export interface ResourceCaps {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

/** Worker slots, and how many hold a build, upgrade or fortify countdown. */
export interface WorkerCount {
  total: number;
  busy: number;
}

/**
 * What an attack save sends, before form encoding (`docs/design/attack-flow.md`
 * §5.2 and §5.3; `docs/server-api.md` "Save write keys" and the attack branch of
 * `baseSave.ts`).
 *
 * Every structured field goes over the wire JSON-stringified into its own form
 * field and the scalars as strings, which `saveAttack` does; this is the
 * client-side shape before that. Fields not on `Save.attackSaveKeys` and not
 * read by the attack branch are sent and ignored by a server that predates
 * them.
 */
export interface AttackSavePayload {
  /** The defender's base id, echoed from the attack load. */
  baseid: string;
  /** The defender's `basesaveid`, echoed from the attack load. */
  basesaveid: number;
  /** Echoed from the attack load; a consistency check only, never authority. */
  attackid: number;
  /** True on the final save: clears `attackid`, ends the session, grants protection. */
  over?: boolean;
  /**
   * The battle clock when the save was built. The server replays the fling log
   * to it and writes the battle from that replay (issue #23, C3), so the
   * figures below are only compared with it, except in Map Room 3.
   */
  tick?: number;
  /**
   * True when the player left the attack screen and the battle stopped there
   * (issue #138). Only the server's attack report reads it (issue #23, C6).
   */
  left?: boolean;
  /** The enemy yard after the battle. Only a fired trap's absence is honoured. */
  buildingdata?: BuildingDataMap;
  /** The enemy yard's health after the battle. */
  buildinghealthdata?: BuildingHealthData;
  /** Damage percent, 0..100, walls excluded. */
  damage?: number;
  /** 1 once damage reaches the takeover threshold; wild camps and outposts. */
  destroyed?: number;
  /** The defender's housing after consumption. */
  monsters?: MonstersSave;
  /** The defender's champions; only a lower `hp` is honoured. */
  champion?: ChampionSaveEntry[];
  /** The attacker's own champions, written verbatim onto the attacker. */
  attackerchampion?: ChampionSaveEntry[];
  /**
   * `[{ baseid, m }]` per attacker cell in range, housing minus what was flung
   * (`monsterUpdateHandler.ts`, Map Room 2 shape).
   */
  monsterupdate?: { baseid: string; m: MonstersSave }[];
  /** What the attacker looted, bombs not netted in; added to the attacker's pool. */
  attackloot?: Resources;
  /** The defender's loss as a delta; only subtractions are honoured. */
  resources?: Resources;
  /** Plain-text summary for the defender's attack log (§7, Q5). */
  attackreport?: string;
  /** The attacker's siege inventory after use; overwrites `userSave.siege`. */
  attackersiege?: unknown;
  /**
   * The fling log, `docs/design/server-combat.md` §3.10. The server replays it
   * to `tick` for the battle and the loot (issue #23), and charges its bombs'
   * cost to the attacker (issue #90).
   */
  flinglog?: unknown;
}

/**
 * The /base/save envelope: `{ error: 0, basesaveid, ...filteredSave }` plus
 * `takeover` when the save completed a Map Room 3 takeover.
 */
export interface BaseSaveResponse extends ApiEnvelope {
  error: number;
  basesaveid: number;
  attackid?: number;
  damage?: number;
  destroyed?: number;
  takeover?: unknown;
  /** What the attacker's pool banked of the loot, on the save that ends an attack (issue #166). */
  lootcredited?: Resources;
  /**
   * The attacker's one chance to take over the player outpost this attack
   * destroyed (issue #182), on the save that ends the attack.
   */
  takeovergrant?: TakeoverGrantOffer;
}

/**
 * A takeover grant as the final attack save reports it
 * (`server/src/services/maproom/v2/takeoverOffer.ts`): when the chance ends,
 * in server seconds, and the price `takeoverCell` will charge. The price is
 * absent only when the server could not place the outpost's cell.
 */
export interface TakeoverGrantOffer {
  baseid: string;
  expiresAt: number;
  /** Of each of r1..r4. */
  resources?: number;
  shiny?: number;
  adjacent?: boolean;
}

/**
 * Why a takeover quote says no (`POST /worldmapv2/takeoverquote`,
 * `server/src/services/maproom/v2/takeoverRules.ts` plus `outOfRange`).
 */
export type TakeoverRefusalReason =
  | "notFound"
  | "mainYard"
  | "ownYard"
  | "noTakeoverChance"
  | "notDestroyed"
  | "regenerated"
  | "protected"
  | "locked"
  | "underAttack"
  | "maxOutposts"
  | "outOfRange"
  | "notEnoughShiny"
  | "notEnoughResources";

/**
 * `POST /worldmapv2/takeoverquote` (issue #82): the price and the server's
 * verdict for one cell. The only source of takeover eligibility on the web;
 * the client copies neither the rules nor the price formula.
 */
export interface TakeoverQuoteResponse extends ApiEnvelope {
  baseid: string;
  /** Absent when the cell could not be found. */
  kind?: "camp" | "outpost";
  eligible: boolean;
  reason: TakeoverRefusalReason | null;
  /** Of each of r1..r4. Absent when the cell could not be found. */
  resources?: number;
  shiny?: number;
  /** Next to the caller's main yard, which halves the price. */
  adjacent?: boolean;
  /** "New to Map Room 2": `resources` is the cheap price (10% of the full base). */
  welcome?: true;
  /** The resource price without that discount; only with `welcome`. */
  usualResources?: number;
  /** Server seconds when the caller's chance at this player outpost ends; only while it runs. */
  grantExpiresAt?: number;
  /** Whether the caller can pay each way right now. */
  affordable?: { resources: boolean; shiny: boolean };
  shinyLocked?: boolean;
  /** Server seconds when the quote was made. */
  now: number;
}

/** Resource counts and their caps, as carried on a save and on a map cell. */
export interface Resources {
  r1?: number;
  r2?: number;
  r3?: number;
  r4?: number;
  r1max?: number;
  r2max?: number;
  r3max?: number;
  r4max?: number;
  [key: string]: number | undefined;
}

/**
 * One building in `buildingdata`.
 *
 * Mirrors `server/src/types/BuildingData.ts`, which in turn mirrors what
 * `BFOUNDATION.Export()` writes (`client/scripts/BFOUNDATION.as:2968-3029`).
 * Almost every field is omitted at its default, so absence is meaningful:
 *
 * - **`l` absent means level 1**, not level 0. `Export` only writes the level
 *   when it is not 1 (`:2975-2977`) and `Setup` defaults it to 1
 *   (`:3043-3048`). A building is at level 0 only while `cB` is counting down.
 * - `hp` is written only below full health (`:3025`), so its absence means
 *   undamaged. `buildinghealthdata` carries the same numbers keyed by id.
 * - `fort` is the fortification level. `fz` is *not* fortification: it is the
 *   Champion Chamber's frozen-champion blob (`CHAMPIONCHAMBER.as:376`).
 */
export interface BuildingData {
  /** Yard units, origin at the plot centre. */
  X: number;
  Y: number;
  /** Building type id. */
  t: number;
  /** Building id, unique within the yard. */
  id: number;
  /** Level. Absent means 1. */
  l?: number;
  /** Fortification level, 0 when absent. */
  fort?: number;
  /** Seconds left on the initial build. Present means level 0, under construction. */
  cB?: number;
  /** Seconds left on an upgrade. */
  cU?: number;
  /** Seconds left on a rebuild. */
  cR?: number;
  /** Seconds left on a fortification. */
  cF?: number;
  /**
   * Length in seconds of the running build or upgrade as the server started
   * it, after Sharper Tools (#136). Absent on older jobs; the progress then
   * falls back to the cost table's time (`countdownProgress`, `jobs.ts`).
   * Not `cT`, which `BEXPIRABLE` uses for its create time.
   */
  cL?: number;
  /** Current health. Absent means full. 0 means destroyed. */
  hp?: number;
  /** 1 while a worker is repairing. */
  rE?: number;
  /** Harvester: units banked in the building's own buffer. */
  st?: number;
  /** Harvester: 1 while producing. */
  pr?: number;
  /**
   * Harvester: seconds left of the current production cycle, as the original
   * (`client/scripts/BRESOURCE.as:487-489`) and the server's catch-up write it.
   */
  cP?: number;
  /** Older name this client read for {@link BuildingData.cP}; read as a fallback only. */
  rCP?: number;
  /**
   * A Starter Kit building still building up to this level: its `cB` runs
   * without a worker and ends at `l = prefab` (outposts WP9,
   * `client/scripts/BFOUNDATION.as:3054-3066`).
   */
  prefab?: number;
  [key: string]: unknown;
}

/** `buildingdata`, keyed by building id as a string. */
export type BuildingDataMap = Record<string, BuildingData>;

/** `buildinghealthdata`: current health keyed by building id. */
export type BuildingHealthData = Record<string, number>;

/**
 * The siege weapons a player holds (`siege`, Inferno WP 6.3): each weapon's
 * researched level, 0..10, and how many are made and unused, 0 or 1
 * (`SiegeWeapon.exportVariables`).
 */
export type SiegeData = Record<string, { level?: number; quantity?: number } | undefined>;

/**
 * The Inferno purse (`iresources`): Bone, Coal, Sulfur and Magma held as
 * `r1..r4`, their caps as `r1max..r4max` (`BASE._iresources`).
 */
export type InfernoResourcesData = Partial<Record<`r${1 | 2 | 3 | 4}` | `r${1 | 2 | 3 | 4}max`, number>>;

/**
 * One yard mushroom as the save stores it: `[frame, X, Y]`, the art frame
 * (1 to 5) and the position in yard units, as for a building
 * (`client/scripts/BASE.as:2749-2757` writes it, `MUSHROOMS.as:84-90` reads
 * it). Mushrooms have no stored id; their place in the list is their id.
 */
export type MushroomEntry = [frame: number, x: number, y: number];

/**
 * An older object-shaped mushroom. Nothing writes these; the reader accepts
 * them so a hand-written save still draws.
 */
export interface MushroomData {
  X?: number;
  Y?: number;
  id?: number;
  /** Which of the art's frames this one shows. */
  frame?: number;
  [key: string]: unknown;
}

/** `mushrooms`: a list plus the timestamp of the last spawn. */
export interface MushroomSave {
  l?: (MushroomEntry | MushroomData)[];
  s?: number;
}

/**
 * One of the player's Map Room 2 outposts, as the main yard lists it in
 * `outposts`: its cell and its `baseid` (`server/src/database/models/save.model.ts`,
 * written by `takeoverCell.ts`). Flash-era rows may hold the numbers as strings
 * and the id as a number; `ownYards.ts` reads them either way.
 */
export type OutpostEntry = [x: number, y: number, baseid: string];

/**
 * The /base/load envelope. The server spreads every @FrontendKey field of the
 * Save entity into the top level, so this lists the handful the client needs
 * now and leaves the rest to the index signature.
 */
export interface BaseLoadResponse extends ApiEnvelope {
  error: number;
  /** = basesaveid. */
  id: number;
  baseid: string;
  basesaveid: number;
  /** [height, width]; 800 x 800 on Map Room 2. */
  worldsize: [number, number];
  currenttime: number;
  /**
   * The kinds of the seasonal events on now (`"halloween"`), absent when none
   * is (`server/src/services/yard/season.ts`). The yard dresses for them.
   */
  activeevents?: string[];
  /**
   * The weekend event on now and the next one (`{ active, next }`,
   * `server/src/services/events/weekendSchedule.ts`), read by `game/weekend.ts`.
   */
  weekend?: unknown;
  /**
   * The player's event coins (`server/src/services/events/eventCoins.ts`):
   * on the owner's main-yard build load, and merged from every yard answer
   * that changed them. Absent elsewhere (a visit, an attack, an outpost).
   */
  eventcoins?: number;
  /** When the yard was last saved, in unix seconds. 0 on a yard never saved. */
  savetime?: number;
  resources?: Resources;
  credits?: number;
  /** The player's unread messages, the server's own count (#193's Mail badge). */
  unreadmessages?: number;
  homebase?: [number, number];
  /**
   * The player's Map Room 2 outposts. Served from the main yard on every load
   * of a yard the player owns, an outpost's included (`mapSaveData.ts`), so
   * the yard switcher can list them from whichever yard is open.
   */
  outposts?: OutpostEntry[] | null;
  /**
   * The player's outpost names and pins, `{ names, pins }`
   * (`server/src/services/outposts/outpostLabels.ts`), on the owner's
   * build-mode loads; absent when there are none. Read by `outpostLabels.ts`.
   */
  outpostlabels?: unknown;
  /**
   * When "Move to a random spot" last moved the main yard, unix seconds; null
   * or absent when it never has (issue #366). The next move opens 7 days later.
   */
  randommoveat?: number | null;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  /** The siege weapons (WP 6.3). Not a yard-state field: siege answers and `completed` keep it current. */
  siege?: SiegeData | null;
  /** The Inferno purse the Siege Lab and Factory pay from (WP 6.3). */
  iresources?: InfernoResourcesData | null;
  mushrooms?: MushroomSave | null;
  /**
   * Owned store items. `ENL.q` is the yard expansion level, 0..6, `BEW.q` the
   * extra workers bought, and `e` a buff's expiry as a unix second — `BST.e`
   * is when Sharper Tools runs out (`client/scripts/STORE.as:2513-2519`).
   */
  storedata?: StoreData | null;
  /**
   * The player's outpost income (`BuildingResources`). Served from the main
   * yard on every load of a yard the player owns (`mapSaveData.ts`); not part
   * of the yard routes' answers.
   */
  buildingresources?: BuildingResources | null;
  basename?: string;
  level?: number;
  tutorialstage?: unknown;
  flags?: Record<string, unknown>;
  /**
   * Traps that fired and were dropped from `buildingdata`, newest last.
   *
   * Written by the attack save and never by the client — it is not one of the
   * save's writable keys — so this is the only record of where a fired trap
   * stood. The planner's re-arm button counts it.
   */
  firedtraps?: FiredTrap[];
  /** `main`, `outpost` or `tribe` (`server/src/enums/Base.ts`, BaseType). */
  type?: string;
  /**
   * The player's alliance, on an own main-yard load only (server
   * `allianceData.ts`): read through `game/alliance/allianceBonuses.ts`
   * and `api/chat.ts`.
   */
  alliancedata?: unknown;
  /** Owner username; the tribe name on a wild monster camp. */
  name?: string;
  /** Housing and hatchery state. On the own-yard load, the roster to fling. */
  monsters?: MonstersSave | null;
  /** The base's champions. On the own-yard load, the attacker's own. */
  champion?: ChampionSaveEntry[] | null;
  /** Academy levels by roster id, `{ C1: { level: 6 } }`; absent means level 1. */
  academy?: AcademyData | null;
  /** Monster unlocks. Carried by `/base/load` and by every yard action. */
  lockerdata?: LockerData | null;
  researchdata?: Record<string, unknown> | null;
  /**
   * Only once a yard action has answered (`/bm/yard/*`): the storage cap per
   * resource. `/base/load` does not send it.
   */
  caps?: ResourceCaps;
  /** Only once a yard action has answered: the server's worker count. */
  workers?: WorkerCount;
  /** Flinger and catapult levels of this base. */
  flinger?: number;
  catapult?: number;
  /** Damage protection expiry, unix seconds; at or below now means none. */
  protected?: number;
  /**
   * Attack modes only. Minted by `baseModeAttack` once every refusal has
   * passed, and echoed back on every save of this attack. 0 on any other load.
   */
  attackid?: number;
  /** `canAttack()`'s verdict on the caller against this base. */
  canattack?: boolean;
  /**
   * Attack modes only: the attacker's player level from their stored save,
   * which the engine's low-level loot bonus reads (`ATTACK.as:678-680`). The
   * server's loot replay runs at the same level (issue #167).
   */
  attackerlevel?: number;
  /**
   * Attack modes only: the attacker's champions' learned brains, by type, as
   * the server froze them into this attack at launch (issue #219). Each flung
   * champion's log entry carries its own, which is what the server replays.
   */
  attackerbrains?: unknown;
  /**
   * Attack modes only: the attacker's champions' health, by type, as the
   * server froze it into this attack at launch. A flung champion comes out at
   * this (`ATTACK.as:532`), which is what the server replays.
   */
  attackerhealth?: unknown;
  /**
   * Attack modes only: the attacker's academy levels, by monster id, as the
   * server froze them into this attack at launch after catching their yard up
   * (issue #201). The battle is fought at these, which the server replays.
   */
  attackeracademy?: unknown;
  /**
   * Attack modes only: the attacker's Monster Lab ranks, by monster id, frozen
   * with the academy (issue #352). Absent when nothing is researched.
   */
  attackerranks?: unknown;
  /**
   * The own yard's loads (not Inferno): the player's level from their main
   * save's empire points, the level the map shows (#192). The yard routes
   * send it too, read after the action.
   */
  playerlevel?: number;
  /** The empire points behind `playerlevel`, for the yard HUD's XP bar. */
  playerpoints?: number;
  /**
   * The owner's build-mode loads of their own yard: how many of their
   * notifications are unread, for the yard's bell (#257). The yard routes
   * send it too, after the action. Absent when the server could not count.
   */
  notifications?: number;
  /**
   * What the Quests button's red number counts (beta 6), from the latest yard
   * answer that carried `questsClaimable`; the load itself does not send it.
   */
  questsClaimable?: number;
  /**
   * The owner's loads: how to reach world chat (#282, `game/chat/chatSession.ts`).
   * `chatservers` is every load's, the chat WebSocket's `host:port`;
   * `chattoken` (a day's, per player) and `chatchannel` (the world room for
   * the player's Map Room) ride the owner's loads only.
   */
  chatservers?: string[];
  chattoken?: string;
  chatchannel?: string;
  /**
   * The owner's loads, when the player has picked a country (every country has its own chat room)
   * (owner 3 Nov 2026): the room's key (`chat:country:PH`) and the country.
   */
  chatcountrychannel?: string;
  chatcountry?: string;
  /** The owner's loads, until answered or put off: ask once where the player is from. */
  countryask?: number;
  /** The owner's build-mode loads on a local test server started with `QUIET_LOGIN=1` (`game/quietLogin.ts`). */
  quietlogin?: number;
  /**
   * Map Room 2 attack loads only: the target cell's height, `i`, which
   * stretches an outpost's tower range (`BTOWER.as:80-85`). The server's loot
   * replay reads the same stored value (`world_map_cell.terrainHeight`).
   */
  cellheight?: number;
  /**
   * Map Room 2 attack loads and the owner's own outpost build load, with the
   * land switch on: the target cell's land feature (`landFeatures.ts`), for
   * the range rings. Absent on open ground. The battle reads the copy in the
   * defence (`defenderforces.land`).
   */
  landfeature?: number;
  /**
   * On an attack load: the defence the battle is fought against, as the
   * server keeps it for its replay (issue #195): each bunker's garrison, the
   * defender's academy levels and the champion in its cage. Read with
   * `parseDefenderForces`.
   */
  defenderforces?: unknown;
  /**
   * Only on the owner's build-mode load of their own main yard or outpost: what the
   * load's catch-up finished while the player was away, oldest first, in the
   * yard routes' `completed` shape (issue #135). `[]` when nothing did.
   */
  completed?: CompletedJob[];
  /**
   * Only on the owner's build-mode load of their own main yard, and only while
   * the new Inferno is switched on: the cave, and the level Moloch's
   * emergence just raised it to (`docs/design/inferno.md` §2.2).
   */
  infernostate?: InfernoLoadState;
  /**
   * Only on the owner's build-mode load of their own main yard or outpost:
   * the account's new-player tutorial summary (issue #227). Every yard action
   * answer refreshes it.
   */
  onboarding?: Onboarding;
  /**
   * Only on the owner's build-mode load of their own main yard or outpost:
   * achievements earned and paid but not yet shown (issue #204). Absent when
   * there are none, and always while the server's `ACHIEVEMENT_REWARDS` is off.
   */
  achievements?: AchievementUnlock[];
  /**
   * The Trojan Horse was just placed on this load (issue #324, #327,
   * `docs/design/trojan-horse.md` §3.1): the own yard's one-time camera pan
   * to it. Absent on every other load, including a later one that still
   * finds the horse unsprung.
   */
  trojanNew?: true;
}

/* ── Map Room 2 ─────────────────────────────────────────────────────────── */

/** `b` on a cell payload: server/src/enums/MapRoom.ts (MapRoomCell). */
export const CellType = {
  WILD_MONSTER: 1,
  HOME_CELL: 2,
  OUTPOST: 3,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

/**
 * A water cell. The server short-circuits height <= 99 to terrain height alone,
 * so every other field is absent (createCellData.ts).
 */
export interface WaterCell {
  /** Terrain height. */
  i: number;
  b?: undefined;
}

/**
 * A cell outside the viewer's Map Room 2 fog of war sight (issue #330,
 * `docs/design/fog-of-war.md` §5.1): nothing else is sent about it, not even
 * terrain height, so a hidden cell can never be told apart from another by
 * its payload. Drawing fog cells is #331; this shape only lets the client
 * compile against `getarea`'s new wire format.
 */
export interface FogCell {
  fog: 1;
  b?: undefined;
}

/**
 * A wild monster camp. Also what every unoccupied land cell is served as —
 * Map Room 2 has no distinct "empty land" shape.
 */
export interface WildMonsterCell {
  uid: 0;
  b: typeof CellType.WILD_MONSTER;
  i: number;
  /** 14 digits: 8 world hash + 3 x + 3 y. */
  bid: string;
  /** Tribe name, derived from (x + y) % 4. */
  n: string;
  /** Camp level, 25..44. */
  l: number;
  /** Damage percent 0..100. */
  dm: number;
  /** 1 once damage >= 90. */
  d: number;
  /** The cell's land feature (`landFeatures.ts`), with the server's land switch on; absent on open ground. */
  lf?: number;
  /**
   * Map Room 2 rivers (look only, server `rivers.ts`, switch `MR2_RIVERS`): the river on this
   * cell's own three edges, axial directions 0, 1, 2, two bits of width (1-3) each,
   * `width << (2 * direction)`. Absent where none, or with the switch off.
   */
  rv?: number;
  /**
   * Map Room 2's neighbour defence bonus (`docs/mr2-neighbours.md`): the
   * friendly cells around this one, 1 to 6, counted as the attack load counts
   * them. Sent only with the switch on and at least one friend.
   */
  nb?: number;
}

/** A player's main yard (`b` 2) or captured outpost (`b` 3). */
export interface PlayerCell {
  uid: number;
  b: typeof CellType.HOME_CELL | typeof CellType.OUTPOST;
  i: number;
  bid: string;
  /** Owner's alliance id. */
  aid: number | null;
  /** The cell's land feature (`landFeatures.ts`), with the server's land switch on; absent on open ground. */
  lf?: number;
  /**
   * Map Room 2 rivers (look only, server `rivers.ts`, switch `MR2_RIVERS`): the river on this
   * cell's own three edges, axial directions 0, 1, 2, two bits of width (1-3) each,
   * `width << (2 * direction)`. Absent where none, or with the switch off.
   */
  rv?: number;
  /** Owner username. */
  n: string;
  /** Owner's base level. */
  l: number;
  /** Empire value. */
  v: number;
  /**
   * Flinger level 0..4, on the player's own cells only: the server leaves it
   * out of anyone else's (owner decision 2026-10-22).
   */
  f?: number;
  /** Catapult level 0..3, on the player's own cells only, like `f`. */
  c?: number;
  /** Effective damage percent; reported as 0 once protection lapses. */
  dm: number;
  /** 1 when damage >= 90, i.e. takeover-eligible. */
  d: number;
  /**
   * Map Room 2's neighbour defence bonus (`docs/mr2-neighbours.md`): the
   * friendly cells around this one, 1 to 6, counted as the attack load counts
   * them. Sent only with the switch on and at least one friend.
   */
  nb?: number;
  /** Lock owner user id; non-zero means busy. Always 0 on the caller's cell. */
  lo: number;
  /** 1 while damage protection is active. */
  p: number;
  /** When damage protection ends, unix seconds; sent while it runs (#187). */
  pe?: number;
  /** Truce expiry, unix seconds. Absent on the caller's own cell. */
  t?: number;
  /** 1 when this base's owner has ever attacked the caller. */
  ak?: 1;
  /**
   * 1 when the owner is HOSTILE to the caller (owner, 8 Nov 2026): at least one attack between
   * them, either way, ever, and no truce running. Map Room 2's red dashed border and red plate.
   */
  ho?: 1;
  /** 1 when the cell belongs to the caller. */
  mine: 0 | 1;
  pic_square: string | null;
  /**
   * On the caller's own outpost: the thread of the invitation to move onto it
   * still waiting for its answer (#205; Flash's `_invitePendingID`), else 0.
   */
  pi: number;
  /** 1 when the owner is the caller's friend (beta 7), else 0. */
  fr: number;
  /** 1 when that friend is pinned to the top of the caller's Friends list (beta 7); absent otherwise. */
  fp?: 1;
  /** 1 on the caller's own outpost whose worker is free (#338); absent otherwise. */
  wi?: 1;
  /** 1 on the caller's own outpost whose worker is building, upgrading or fortifying; absent otherwise. */
  wb?: 1;
  /** With `wb`: when that job ends, Unix seconds on the server's clock (owner, 12 Nov 2026); absent while it is paused. */
  wf?: number;
  /** Own cells only: the owner's live resources. */
  r?: Resources;
  /** Own cells only: hatchery and garrison state. */
  m?: Record<string, unknown>;
  /**
   * An outpost's Starter Kit (issue #334): 0 none, 1 Regular, 2 Mega, 3 Ultra.
   * Everyone sees it, not only the owner. Absent on a main yard cell (`b` 2).
   */
  kit?: number;
  /**
   * A main yard cell's Town Hall level (1-10), kept in a column by the server;
   * 0 or absent when unknown, and then the map draws the level-3 hall. Absent
   * on an outpost (`b` 3).
   */
  th?: number;
}

export type MapCell = WaterCell | WildMonsterCell | PlayerCell | FogCell;

/** `data[x][y]`, exactly as the client stores it (`_zones[zoneId].data`). */
export type AreaCellGrid = Record<string, Record<string, MapCell>>;

export interface GetAreaRequest {
  /** Zone origin x, 0..799, a multiple of 10 by convention. */
  x: number;
  /** Zone origin y, 0..799. */
  y: number;
  /** 1 asks the server to include the caller's own resources and credits. */
  sendresources?: 0 | 1;
}

export interface GetAreaResponse extends ApiEnvelope {
  error: number;
  x: number;
  y: number;
  /** 11 x 11 cells covering x..x+10, y..y+10. */
  data: AreaCellGrid;
  alliancedata?: unknown;
  /** The viewer's own alliance id (issue #334: the map's "your alliance" plate colour), or null. */
  myalliance?: number | null;
  resources?: Resources;
  credits?: number;
  /**
   * The viewer's Map Room 2 sight version (issue #330): a short fingerprint
   * of their sight sources and revealed cells, so the client can tell when
   * its cached zones need refetching without comparing the two lists itself.
   */
  sv?: string;
}

/**
 * One of the caller's sight circles (issue #330, #331): their main yard's or
 * an outpost's flinger reach, or an ally's under the same rule, Declare War's
 * bonus already folded into `reach`.
 */
export interface SightSource {
  x: number;
  y: number;
  reach: number;
  /** Whose circle this is, so the minimap can paint the two in different tints (#331). */
  kind: "own" | "ally";
}

/** A cell visible regardless of range: the caller's own bases, and any attacker's (#330). */
export interface RevealedSightCell {
  x: number;
  y: number;
}

/**
 * `POST /worldmapv2/sight`'s answer (`docs/design/fog-of-war.md` §5.2): the
 * caller's whole Map Room 2 fog of war sight, so the client can draw the fog
 * edge and the minimap without waiting on individual `getarea` zones, and
 * skip a zone entirely outside it with no request at all. Everything in it is
 * already visible to the caller (`getarea` would show all of it), so none of
 * it is a leak.
 */
export interface SightResponse extends ApiEnvelope {
  error: number;
  /** Matches `GetAreaResponse.sv` when the two are in step. */
  sv: string;
  sources: SightSource[];
  revealed: RevealedSightCell[];
}

/** Narrows a cell payload to one outside the viewer's fog of war sight. */
export const isFogCell = (cell: MapCell): cell is FogCell => "fog" in cell;

/** Narrows a cell payload to water, which carries terrain height only. */
export const isWaterCell = (cell: MapCell): cell is WaterCell => cell.b === undefined && !isFogCell(cell);

/** Narrows a cell payload to a player-owned main yard or outpost. */
export const isPlayerCell = (cell: MapCell): cell is PlayerCell =>
  cell.b === CellType.HOME_CELL || cell.b === CellType.OUTPOST;

/* ── Yard Planner ───────────────────────────────────────────────────────── */

/**
 * One building in a saved layout.
 *
 * Same units as `buildingdata` — yard units with the origin at the plot centre
 * — but the position fields are lower case `x` and `y` where a save row spells
 * them `X` and `Y`. That is the server's contract, not a slip: a layout node is
 * its own record rather than a save row, and keeping the case different makes
 * it obvious which of the two a value came from.
 *
 * `l` and `fort` carry the level and fortification a layout was designed
 * around; nothing reads them back but the layout itself. A layout saved before
 * 2026-11-03 may also carry a `plan` (a planned upgrade), which nothing reads
 * any more: the planner no longer plans upgrades.
 */
export interface LayoutNode {
  /** Building id, matching the id in `buildingdata`. */
  id: number;
  /** Building type id. */
  t: number;
  x: number;
  y: number;
  l?: number;
  fort?: number;
}

/** The layout format version this client writes and reads. */
export const LAYOUT_VERSION = 2;

/** A saved layout in one of the account's slots. */
export interface Layout {
  slot: number;
  name: string;
  version: number;
  /** `storedata.ENL.q` at save time: the plot the layout was designed for. */
  expansion: number;
  /** Unix seconds, or an ISO string; the client formats whichever arrives. */
  updatedAt: number | string;
  nodes: LayoutNode[];
  /** Buildings the layout keeps in the drawer: a half-finished plan. Absent when none. */
  stored?: LayoutStoredNode[];
}

/**
 * A building a saved layout keeps in the planner's drawer (owner decision
 * 2026-10-05). Not on the plot, so no position: loading puts it back in the
 * drawer, and Apply stays blocked on it like any other stored building.
 */
export interface LayoutStoredNode {
  id: number;
  /** Building type id. */
  t: number;
}

/** The body of the `data` form field on save and apply. */
export interface LayoutPayload {
  version: number;
  expansion: number;
  nodes: LayoutNode[];
  /** Decorations Apply takes out of storage and puts down (#128); a slot save drops them. */
  fromStorage?: { t: number; x: number; y: number }[];
  /** Buildings in the drawer, for a slot save. Apply ignores them. */
  stored?: LayoutStoredNode[];
}

export interface LayoutsResponse extends ApiEnvelope {
  error: number;
  /** How many slots the account has. Ten for everyone (design §8, Q2). */
  slots: number;
  layouts: Layout[];
}

export interface SaveLayoutResponse extends ApiEnvelope {
  error: number;
  layout: Layout;
}

export interface ApplyLayoutResponse extends ApiEnvelope {
  error: number;
  /** How many buildings changed position. */
  moved: number;
  buildingdata: BuildingDataMap;
  /** The resource pool as the server now holds it. */
  resources?: Resources;
  /** Decorations the layout left out, now in storage (#128). */
  stored?: number[];
  /** The ids of the decorations `fromStorage` put down (#128). */
  placed?: number[];
  /** Storage after Apply (#128): what it put in and took out. */
  researchdata?: Record<string, unknown>;
  /** Health readings after Apply: a stored decoration's is gone (#128). */
  buildinghealthdata?: BuildingHealthData;
  /**
   * The mushrooms after Apply (#263): any a building landed on have popped
   * up on free ground. Absent from a server that predates it.
   */
  mushrooms?: MushroomSave;
}

/** Twigs, pebbles, putty and goo. */
export interface UpgradeCost {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

/**
 * The failure bodies, which are flat rather than wrapped in `errorDetails`.
 *
 * 400 carries `overlapping`, `unknown`, `notWalls`, `alreadyAtLevel`, `busy` or
 * `damaged`; 409 carries `unplaced`. Every one of them is a list of building
 * ids the planner should outline and offer to show, which is why
 * `applyConflictIds` reads them together.
 */
export interface ApplyConflictDetails {
  error?: string;
  unplaced?: number[];
  overlapping?: number[];
  unknown?: number[];
  /** Batch wall upgrade: ids whose type is not a wall. */
  notWalls?: number[];
  /** Batch wall upgrade: ids already at or above the target level. */
  alreadyAtLevel?: number[];
  /** Batch wall upgrade: ids with a build, upgrade or fortify countdown. */
  busy?: number[];
  /** Batch wall upgrade: ids that have to be repaired before they upgrade. */
  damaged?: number[];
}

/* ── Batch actions ──────────────────────────────────────────────────────── */

/**
 * What a batch action cost, as the server charged it.
 *
 * All four are always present, zero included, because the panel shows a row per
 * resource and an absent field would have to be read as a zero anyway.
 */
export interface BatchCost {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

/**
 * `POST /bm/yardplanner/walls/upgrade`.
 *
 * `resources` and `buildingdata` are the save as the server now holds it, not a
 * delta: the client re-reads them rather than assuming its own arithmetic won,
 * exactly as it does with `ApplyLayoutResponse.buildingdata`.
 */
export interface WallUpgradeResponse extends ApiEnvelope {
  error: number;
  /** How many walls were raised. */
  upgraded: number;
  /** The level they were all raised to. */
  level: number;
  cost: BatchCost;
  resources: Resources;
  buildingdata: BuildingDataMap;
}

/**
 * One trap to re-arm: a type and a position in yard units.
 *
 * Lower case `x` and `y`, like a `LayoutNode` and unlike a `buildingdata` row,
 * because this is a request field rather than a save row.
 */
export interface TrapPlacement {
  t: number;
  x: number;
  y: number;
}

/**
 * A trap that fired, recorded by the attack save so it can be put back.
 *
 * Upper case `X` and `Y`: this one *is* lifted straight off the save row the
 * attacker's client stopped reporting. `at` is unix seconds.
 */
export interface FiredTrap {
  t: number;
  X: number;
  Y: number;
  at: number;
}

/** `POST /bm/yardplanner/traps/rearm`. */
export interface TrapRearmResponse extends ApiEnvelope {
  error: number;
  /** How many traps were built. */
  placed: number;
  /** The ids they were given, continuing from the highest id in the yard. */
  ids: number[];
  cost: BatchCost;
  resources: Resources;
  buildingdata: BuildingDataMap;
  /** What is left of the fired list once the placed traps are struck off. */
  firedtraps: FiredTrap[];
  /** The mushrooms after the re-arm: one a trap landed on has moved (#263). */
  mushrooms?: MushroomSave;
}

/* ── Yard actions ───────────────────────────────────────────────────────── */

/**
 * The yard state every `/bm/yard/*` answer carries (`docs/server-api.md`
 * "Yard actions", `server/src/services/yard/yardState.ts`). Frozen on the
 * server: fields may be added, never renamed or removed.
 *
 * The save slices keep their `/base/load` names and shapes, so the client
 * merges them straight into the `BaseLoadResponse` it holds. Null columns
 * arrive as `{}` (`champion` as `[]`).
 */
export interface YardState {
  /** Unix seconds the relative countdowns are measured from; equals `currenttime`. */
  savetime: number;
  /** The server's clock at the moment of the answer, unix seconds. */
  currenttime: number;
  resources: Resources;
  /** Shiny; 0 while the account has Shiny locked. */
  credits: number;
  caps: ResourceCaps;
  workers: WorkerCount;
  /** Damage protection expiry, unix seconds, as `/base/load` sends it; at or below now means none. */
  protected: number;
  buildingdata: BuildingDataMap;
  buildinghealthdata: BuildingHealthData;
  storedata: StoreData;
  monsters: MonstersSave;
  lockerdata: LockerData;
  academy: AcademyData;
  champion: ChampionSaveEntry[];
  mushrooms: MushroomSave;
  researchdata: Record<string, unknown>;
  /** The account's new-player tutorial summary (issue #227); the main yard's on an outpost too. */
  onboarding: Onboarding;
}

/* ── New-player tutorial (issue #227) ───────────────────────────────────── */

/** Where the guided start stands (`server/src/services/onboarding/state.ts`). */
export type GuideState = "pending" | "active" | "done" | "skipped" | "legacy";

/** The practice camp's state (`docs/design/tutorial.md` §5.5). */
export type CampState = "none" | "open" | "removed";

/**
 * What the server tells the client about its tutorial record, `save.onboarding`
 * (`server/src/services/onboarding/summary.ts`, `docs/design/tutorial.md` §8.1).
 * Carried by every yard action's answer and by the own yard's build-mode
 * `/base/load`. The record itself (the grant ledger, the counters) never
 * leaves the server.
 */
export interface Onboarding {
  guide: {
    state: GuideState;
    /** The macro step while `pending` or `active`, e.g. `"build-sniper"`. */
    step?: string;
    /** The building the guide paid for and has not finished yet, by id. */
    building?: number;
  };
  camp: CampState;
  /** Goals ready to claim: the Goals button's badge. */
  goalsReady: number;
  /** Screen id to the unix second its tips were seen. */
  tips: Record<string, number>;
}

/** The names of every {@link YardState} field, for merging and tests. */
export const YARD_STATE_KEYS = [
  "savetime",
  "currenttime",
  "resources",
  "credits",
  "caps",
  "workers",
  "protected",
  "buildingdata",
  "buildinghealthdata",
  "storedata",
  "monsters",
  "lockerdata",
  "academy",
  "champion",
  "mushrooms",
  "researchdata",
  "onboarding",
] as const satisfies readonly (keyof YardState)[];

/**
 * A job the server's catch-up finished during a request, oldest first.
 *
 * Every kind has the same five keys. Phase 1 sends `build`, `upgrade`,
 * `fortify` and `storeItem`; later phases add `unlock`, `hatch`, `train`, …
 * with the same shape, which {@link CompletedOtherJob} lets through.
 */
export type CompletedJob = CompletedBuildingJob | CompletedStoreItemJob | CompletedOtherJob;

export interface CompletedBuildingJob {
  kind: "build" | "upgrade" | "fortify";
  /** Building id. */
  id: number;
  /** Building type. */
  t: number;
  /** Unix second the countdown reached zero. */
  at: number;
  detail: {
    from: number;
    level: number;
    fort?: number;
    /** Empire points the completion awarded. */
    points: number;
  };
}

export interface CompletedStoreItemJob {
  kind: "storeItem";
  /** Store item code, e.g. `BST`. */
  id: string;
  t: null;
  /** The buff's expiry, `e`. */
  at: number;
  detail: Record<string, never>;
}

/** A kind a later phase adds; read through its five common keys. */
export interface CompletedOtherJob {
  kind: string;
  id: number | string;
  t: number | null;
  at: number;
  detail: Record<string, unknown>;
}

/** What every successful yard action answers: the state, what finished, and the route's own report. */
export type YardResponse<Report> = ApiEnvelope &
  YardState & {
    error: 0;
    completed: CompletedJob[];
    report: Report;
    /** The player's level after the action, as `/base/load` sends it (#192). */
    playerlevel?: number;
    /** The empire points behind it, for the XP bar. */
    playerpoints?: number;
    /** The unread notifications after the action, as `/base/load` sends it (#257). */
    notifications?: number;
    /** Paid unlocks not yet shown, as `/base/load` sends them (#204). */
    achievements?: AchievementUnlock[];
    /**
     * Quests, login days and bonuses waiting for a Claim tap (beta 6, the
     * Quests button's red number). Absent before the player's quest record exists.
     */
    questsClaimable?: number;
    /** The event coin purse after this action, when it changed (a buy, a claim). */
    eventcoins?: number;
    /** What this action paid in event coins, for the "+15" moment. */
    coinsGained?: CoinGain[];
  };

/** One event coin payment (`server/src/services/events/eventCoins.ts`). */
export interface CoinGain {
  amount: number;
  /** `calendar` or `ladder` (a big event's claims). */
  reason: string;
}

/**
 * An achievement earned and paid but not yet shown: what the yard answers,
 * the owner's load and a takeover carry until `bm/yard/achievements/seen`
 * names it (`docs/design/achievements.md` §9.3, issue #204). The server's
 * `UnlockView`.
 */
export interface AchievementUnlock {
  id: number;
  name: string;
  shiny: number;
  /** Found by the first read's backfill: shown together as one summary. */
  backfill?: true;
}

/**
 * A yard refusal's body (`{ error: message, reason, ...detail }`), carried by
 * the `ApiError` the call throws. 400 = malformed request, 409 = the yard
 * refuses right now. Read it with `yardRefusal` in `api/yard.ts`.
 */
export interface YardRefusalBody {
  error: string;
  reason: string;
  [detail: string]: unknown;
}

/** `POST /bm/yard/upgrade`: the countdown started, however short the step (#137). */
export interface UpgradeStartReport {
  id: number;
  from: number;
  to: number;
  /** The countdown written, Sharper Tools applied. */
  seconds: number;
  /** What was charged: less a Builder's Weekend's `weekendOff`%, when one ran. */
  cost: UpgradeCost;
  weekendOff?: number;
}

/** `POST /bm/yard/upgrade/cancel`: the step's full cost, back, clamped to the cap. */
export interface UpgradeCancelReport {
  id: number;
  refund: UpgradeCost;
}

/** `POST /bm/yard/upgrade/instant`: level raised now for Shiny, no resources charged. */
export interface UpgradeInstantReport {
  id: number;
  from: number;
  to: number;
  /** Shiny spent. */
  credits: number;
  /** Empire points the step awarded. */
  points: number;
}

/**
 * The four speed-ups (`client/scripts/STORE.as:1071-1082`): `SP1` finishes a
 * job of 300 s or less for free, `SP2` / `SP3` take off one / two hours,
 * `SP4` finishes a longer one now.
 */
export type SpeedupItem = "SP1" | "SP2" | "SP3" | "SP4";

/** `POST /bm/yard/speedup`. */
export interface SpeedupReport {
  id: number;
  item: SpeedupItem;
  /** Shiny spent. */
  credits: number;
  /** Seconds left on the job afterwards; 0 when it finished. */
  remaining: number;
  /** The job as a `completed` entry when the speed-up finished it, else null. */
  finished: CompletedJob | null;
  /** Set when `SP1` finished a repair instead of a job (#279). */
  repaired?: true;
  /**
   * Seconds of a free `SP2` / `SP3` that went unused: the job had less time
   * left than it takes off, so it finished and the rest was lost (patch 6.3).
   */
  unused?: number;
}

/** `POST /bm/yard/mushroom/pick` (`docs/design/yard-buildings.md` §5.6). */
export interface MushroomPickReport {
  /** The mushroom's place in the list it was picked from. */
  id: number;
  /** Where it stood, yard units. */
  x: number;
  y: number;
  /** Golden: one in four, rolled by the server at pick time. */
  golden: boolean;
  /** Shiny it gave: 0, 3 or 8. */
  shiny: number;
  /** During the Halloween pumpkin hunt: the player's pumpkin count, this one included. */
  pumpkins?: number;
  /** The same during the Thanksgiving turkey hunt: the player's turkey count. */
  turkeys?: number;
}

/** `POST /bm/yard/shop/buy`. */
export interface ShopBuyReport {
  /** Store item code. */
  item: string;
  /** Shiny spent. */
  credits: number;
  /** How many the account now holds (`storedata[item].q`). */
  q: number;
  /** The buff's expiry, unix seconds, for a timed item (`BST`); null for a permanent one (`BEW`). */
  endsAt: number | null;
  /** Wall upgrades (`BLK2`..`BLK5`) only: the tier, how many Blocks it raised, the points they earned. */
  tier?: number;
  blocks?: number;
  /** Wall upgrades and resource packs: the empire points earned. */
  points?: number;
  /** Resource packs (`BR11`..`BR43I`, issue #393) only: which resource, how much landed, and whether into the Inferno purse. */
  resource?: "r1" | "r2" | "r3" | "r4";
  amount?: number;
  inferno?: boolean;
}
