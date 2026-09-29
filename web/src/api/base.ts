import { post, send, type FormBody, type RequestOptions } from "./http";
import { getSession } from "./auth";
import {
  BaseMode,
  type AttackData,
  type ApiEnvelope,
  type AttackSavePayload,
  type BaseLoadRequest,
  type BaseLoadResponse,
  type BaseSaveResponse,
  type CompletedJob,
} from "./types";
import type { AttackCheckpoint } from "@/game/attack/attackCheckpoint";
import type { AttackRoster, AttackTarget, AttackTargetKind } from "@/game/attack/attackTarget";
import { ATTACK_CHAMPION_PROPS, ATTACK_MONSTER_PROPS } from "@/game/attack/attackStats";

/**
 * Base / yard routes. Mounted at /base/... with no /api/:apiVersion prefix and
 * no apiVersion middleware (docs/server-api.md §Base / Yard).
 */
const LOAD_PATH = "/base/load";
const SAVE_PATH = "/base/save";
const CHECKPOINT_PATH = "/base/checkpoint";

/**
 * The Map Room this client is built for, sent on every foreign load as Flash
 * sent it. The server no longer trusts it: every rule follows the player's own
 * Map Room (`playerMapVersion.ts`, issue #165).
 */
const MAP_ROOM_VERSION = 2;

/* ── While you were away ─────────────────────────────────────────────── */

/**
 * What the own-yard loads finished while the player was away and nobody has
 * shown yet, per yard, and whose account it was (issue #135).
 *
 * The owner's build-mode load finishes and writes whatever ended while the
 * player was away, and its answer's `completed` is the only record of it: the
 * next load finds nothing. The map loads the own yard first, to find the home
 * cell, and it has no job notices, so every own-yard load keeps its list here
 * and the yard takes it when its store starts (`takeAwayJobs`). An outpost's
 * load keeps its own list, under its `baseid`, so opening an outpost never
 * shows what finished in the main yard, nor the other way round.
 */
let awayJobs: { userId: number | null; jobs: Map<string, CompletedJob[]> } = {
  userId: null,
  jobs: new Map(),
};

/** The key the main yard's list is kept under. */
const MAIN_AWAY = "main";

const noteAwayJobs = (
  completed: readonly CompletedJob[] | undefined,
  yard: string = MAIN_AWAY,
): void => {
  const userId = getSession()?.userId ?? null;
  if (awayJobs.userId !== userId) awayJobs = { userId, jobs: new Map() };
  if (!completed?.length) return;
  const list = awayJobs.jobs.get(yard) ?? [];
  list.push(...completed);
  awayJobs.jobs.set(yard, list);
};

/**
 * Hands over, once, every job an own-yard load finished while the player was
 * away that has not been shown yet, oldest first: the main yard's, or with a
 * `baseid` that outpost's. Only the signed-in account's: a list another
 * account's load left behind is dropped.
 */
export const takeAwayJobs = (baseid?: string): CompletedJob[] => {
  const userId = getSession()?.userId ?? null;
  if (awayJobs.userId !== userId) awayJobs = { userId, jobs: new Map() };
  const yard = baseid ?? MAIN_AWAY;
  const jobs = awayJobs.jobs.get(yard) ?? [];
  awayJobs.jobs.delete(yard);
  return jobs.sort((a, b) => a.at - b.at);
};

/**
 * Opens the caller's own main yard.
 *
 * `type: "build"` selects the editable own-yard handler, and `baseid: "0"`
 * (BaseMode.DEFAULT) is the sentinel the handler reads as "the main yard":
 * baseModeBuild treats it as the initial load, tops up the balanced reward and
 * resets invasion waves. `userid` is required by BaseLoadSchema but the
 * handler ignores it, so the caller's own id is the honest value to send.
 *
 * No field on this call is a JSON string. On other modes `attackData` and
 * `attackcost` are, and must be JSON.stringify'd into the single form field —
 * the server runs z.string().transform(JSON.parse) over them.
 *
 * The answer's `completed` is also kept for {@link takeAwayJobs}.
 */
export const loadOwnYard = async (
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: BaseMode.BUILD,
    userid: session ? String(session.userId) : "0",
    baseid: BaseMode.DEFAULT,
    ...(options.mapversion !== undefined ? { mapversion: options.mapversion } : {}),
  };

  const response = await post<BaseLoadResponse>(LOAD_PATH, { ...body });
  noteAwayJobs(response.completed);
  return response;
};

/**
 * Opens one of the caller's other yards (an outpost) by base id, still in
 * editable build mode (outposts WP5, #146). The server catches the outpost up
 * as it loads it and serves it with the main yard's pool and `outposts`
 * (`mapSaveData.ts`); the answer's `completed` is kept under the outpost's
 * `baseid` for {@link takeAwayJobs}.
 */
export const loadOwnBase = async (
  baseid: string,
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: BaseMode.BUILD,
    userid: session ? String(session.userId) : "0",
    baseid,
    ...(options.mapversion !== undefined ? { mapversion: options.mapversion } : {}),
  };

  const response = await post<BaseLoadResponse>(LOAD_PATH, { ...body });
  noteAwayJobs(response.completed, baseid);
  return response;
};

/* ── Foreign yards ──────────────────────────────────────────────────────── */

/**
 * Opens someone else's yard, or a wild monster camp, read-only.
 *
 * `view`/`wmview` dispatch to `baseModeView`, which finds or regenerates the
 * save row and does none of an attack's work: no `attackData`, no range,
 * protection or truce check, no `attackid`, no session, nothing cleared or
 * logged (`baseLoad.ts:71-74`, `:109-111`; `baseModeView.ts:19-37`). The
 * response has the same save fields an attack load carries, so it can be
 * drawn — but it cannot be saved against, which is why attacking from inside
 * a view is a second, `loadAttack` request (`docs/design/attack-flow.md` §5.1).
 */
export const viewBase = async (
  baseid: string,
  kind: AttackTargetKind,
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: kind === "wild" ? BaseMode.WORLD_MAP_VIEW : BaseMode.VIEW,
    userid: session ? String(session.userId) : "0",
    baseid,
    mapversion: options.mapversion ?? MAP_ROOM_VERSION,
  };

  return post<BaseLoadResponse>(LOAD_PATH, { ...body });
};

/**
 * The `attackData` payload, built the way `ATTACK.AttackData()` built it
 * (`client/scripts/ATTACK.as:199-222`; `docs/specs/combat.md` §2 "The
 * request"): every champion the player owns as `{ type: "G<t>", stats }`, and
 * every monster type available as `{ id, count, stats }`, where `stats` is
 * the full prop block for that id.
 *
 * The stat blocks come from `attackStats.ts`, a copy of the server's own
 * tables, because `validateAttack` compares every key of *its* block against
 * what arrives and bans the account on a mismatch or an unknown id
 * (`validateAttack.ts:44-90`). An id the table does not know is therefore
 * left out rather than sent — it could only ever be refused.
 */
export const buildAttackData = (roster: AttackRoster): AttackData => {
  const champions: AttackData["champions"] = [];
  for (const champion of roster.champions) {
    const type = `G${champion.t}`;
    const stat = ATTACK_CHAMPION_PROPS[type];
    if (!stat) continue;
    champions.push({ type, stats: { ...stat.props } });
  }

  const monsters: AttackData["monsters"] = [];
  for (const [id, count] of Object.entries(roster.monsters)) {
    const stats = ATTACK_MONSTER_PROPS[id];
    if (!stats || count <= 0) continue;
    monsters.push({ id, count, stats: { ...stats } });
  }

  return { champions, monsters };
};

/**
 * Starts an attack: `type: "attack"` on a player's main yard or outpost,
 * `"wmattack"` on a wild monster camp, with `attackData` from the roster.
 *
 * This is the request with side effects. Once every refusal has passed —
 * protection, an attack already running, the defender online, a truce, range
 * (`baseModeAttack.ts:71-104`) — the server mints `attackid`, starts the
 * 420-second attack session that alone authorises `/base/save` against this
 * row, clears the *attacker's* own damage protection, and writes an attack
 * log (`docs/server-api.md` "Attack session binding"). A refusal writes
 * nothing and comes back as an `ApiError` carrying the server's message.
 */
export const loadAttack = async (
  baseid: string,
  kind: AttackTargetKind,
  roster: AttackRoster,
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: kind === "wild" ? BaseMode.WORLD_MAP_ATTACK : BaseMode.ATTACK,
    userid: session ? String(session.userId) : "0",
    baseid,
    mapversion: options.mapversion ?? MAP_ROOM_VERSION,
    attackData: JSON.stringify(buildAttackData(roster)),
  };

  return post<BaseLoadResponse>(LOAD_PATH, { ...body });
};

/**
 * {@link loadAttack} for a target as the map handed it over: a Map Room 1
 * target names its Map Room (1), a Map Room 2 one takes the default.
 */
export const loadAttackOn = (
  target: Pick<AttackTarget, "baseid" | "kind" | "roster" | "mapversion">,
): Promise<BaseLoadResponse> =>
  target.mapversion === undefined
    ? loadAttack(target.baseid, target.kind, target.roster)
    : loadAttack(target.baseid, target.kind, target.roster, { mapversion: target.mapversion });

/**
 * A save's `basesaveid` as the form sends it. A Map Room 1 tribe has no row,
 * so its attack load carries none, and the tribe save must say `"0"`: the
 * server finds the tribe by `baseid` then (`baseSave.ts`, issue #161).
 */
export const basesaveidField = (basesaveid: number | undefined): string =>
  Number.isSafeInteger(basesaveid) && (basesaveid ?? 0) > 0 ? String(basesaveid) : "0";

/**
 * Posts an attack's outcome to `/base/save` (`docs/design/attack-flow.md`
 * §5.2, §5.3).
 *
 * Every structured field is JSON-stringified into its own form field and the
 * scalars go as strings, which is how the schema and the `attackSaveKeys` loop
 * read them (`BaseSaveSchema.ts`; `baseSave.ts`, the `JSON.parse`-and-assign
 * default branch). Absent fields are not sent at all: `attackreport` set to
 * an empty string, say, would still be a write. `over` goes as `"1"` or `"0"`
 * because the controller reads it as a number and only a truthy one ends the
 * attack.
 *
 * The save is refused unless it comes from the account the attack load
 * recorded, within 420 seconds of it (`checkAttackBinding`,
 * `docs/server-api.md:284-289`); the refusal is HTTP 200 with `error` set and
 * `errorDetails.data.reason`, which `post` raises as an `ApiError`.
 *
 * With `keepalive` (the save sent as the page closes, issue #138) the same
 * string fields go as a JSON body instead: form encoding would roughly double
 * every JSON field, and a keepalive body must fit the browser's 64 KB. The
 * server reads both encodings as the same flat body (`jsonBody.ts`).
 */
export const saveAttack = async (
  payload: AttackSavePayload,
  options: RequestOptions = {},
): Promise<BaseSaveResponse> => {
  const json = (value: unknown): string | undefined =>
    value === undefined ? undefined : JSON.stringify(value);

  const fields: FormBody = {
    baseid: payload.baseid,
    basesaveid: basesaveidField(payload.basesaveid),
    attackid: String(payload.attackid),
    over: payload.over === undefined ? undefined : payload.over ? "1" : "0",
    buildingdata: json(payload.buildingdata),
    buildinghealthdata: json(payload.buildinghealthdata),
    damage: payload.damage === undefined ? undefined : String(payload.damage),
    destroyed: payload.destroyed === undefined ? undefined : String(payload.destroyed),
    monsters: json(payload.monsters),
    champion: json(payload.champion),
    attackerchampion: json(payload.attackerchampion),
    monsterupdate: json(payload.monsterupdate),
    attackloot: json(payload.attackloot),
    resources: json(payload.resources),
    attackreport: payload.attackreport,
    attackersiege: json(payload.attackersiege),
    flinglog: json(payload.flinglog),
  };

  if (!options.keepalive) return post<BaseSaveResponse>(SAVE_PATH, fields, options);

  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body[key] = String(value);
  }
  return send<BaseSaveResponse>("POST", SAVE_PATH, { ...options, json: body });
};

/**
 * Sends the attack's running record (issue #138, `attackCheckpoint.ts`), so
 * that an attack whose save never arrives is finished by the server from it
 * rather than undone. Bound like the save: only the attacker, inside the
 * session window. `stored` is false for an attack with nothing dropped yet.
 */
export const sendAttackCheckpoint = (
  checkpoint: AttackCheckpoint,
): Promise<ApiEnvelope & { stored?: boolean }> =>
  post(CHECKPOINT_PATH, {
    basesaveid: String(checkpoint.basesaveid),
    attackid: String(checkpoint.attackid),
    tick: String(checkpoint.tick),
    flinglog: JSON.stringify(checkpoint.flinglog),
    sources: JSON.stringify(checkpoint.sources),
  });
