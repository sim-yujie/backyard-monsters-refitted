import type { EntityManager } from "@mikro-orm/postgresql";
import { z } from "zod";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { Status } from "../../enums/StatusCodes.js";
import { TICKS_PER_SECOND, type DefenderForces } from "../../game-rules/combat/index.js";
import { rulesPlay } from "../../game-rules/combat/rulesCompat.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import type { AbandonedInput, AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import { defenceReplayLoadOf } from "../defences/defenceReplayFields.js";
import type { RunTicketStore } from "./baiterRunStore.js";
import {
  INVITE_SECONDS,
  MAX_INVITES_PER_SEND,
  MAX_OPEN_INVITES,
  MAX_TEST_TICK,
  RESULT_KEEP_SECONDS,
  baiterLevelOf,
  capOfLevel,
  eventsFit,
  keptReport,
  parseTestArmy,
  resultOf,
  testAttacker,
  type TestResult,
} from "./baiterTestRules.js";
import {
  candidatesOf,
  cardsOf,
  closeInvite,
  countTest,
  decodeTestPayload,
  invitesReceived,
  invitesSent,
  listTests,
  loadTest,
  mayTest,
  openInvite,
  openInvites,
  storeTest,
  type TestPayload,
  type TestRow,
} from "./baiterTestStore.js";

/**
 * The friend-test routes (beta 9 feature #4) as functions of an entity
 * manager, the caller, what they sent, the time and the outside world
 * ({@link BaiterDeps}), so they run under test; `controllers/baiter/routes.ts`
 * binds them to Koa.
 *
 * What never happens here, by design: no save row is written, no resource,
 * monster, champion, trophy, shield, damage, loot or statistic changes for the
 * inviter or the tester. The only writes are the invite rows, the test rows
 * and two notices.
 */

export type BaiterBody = Record<string, unknown>;

/** Notices the routes send: an invite to the tester, a finished test to the inviter. */
export type BaiterNotice =
  | { event: "baiterInvite"; userid: number; username: string; expires: number }
  | { event: "baiterTest"; userid: number; username: string; damage: number; result: TestResult; testid: number };

/** What the routes need from outside: tickets, the battle, notices, randomness. */
export interface BaiterDeps {
  readonly tickets: RunTicketStore;
  /** The defenders a yard puts up (`servedDefenderForces`). */
  readonly forces: (save: Save, now: number) => Promise<DefenderForces>;
  /** Fights a battle the way the server fights an abandoned attack (`replayAbandonedInWorker`). */
  readonly fight: (input: AbandonedInput) => Promise<AbandonedOutcome>;
  readonly notify: (em: EntityManager, userid: number, notice: BaiterNotice) => Promise<void>;
  readonly rulesVersion: string;
  readonly makeToken?: () => string;
  readonly makeSeed?: () => number;
}

/** Refusals, each a `reason` the web client words. */
export type BaiterRefusal =
  | "noBaiter"
  | "notFriend"
  | "noInvite"
  | "tooManyInvites"
  | "noTicket"
  | "badArmy"
  | "overCap"
  | "badEvents"
  | "busy";

const MESSAGES: Record<BaiterRefusal, string> = {
  noBaiter: "That yard has no Wild Monster Baiter.",
  notFriend: "You can only invite friends and alliance mates.",
  noInvite: "That invite has ended.",
  tooManyInvites: `At most ${MAX_OPEN_INVITES} invites can be open at once.`,
  noTicket: "This test was not started or has ended. Start a new test.",
  badArmy: "That test army is not one the Baiter allows.",
  overCap: "That test army is bigger than the Baiter allows.",
  badEvents: "That test does not match its army.",
  busy: "The server is busy. Try again in a moment.",
};

const BAD_REQUEST: ReadonlySet<BaiterRefusal> = new Set(["badArmy", "overCap", "badEvents"]);

export const baiterRefusedErr = (reason: BaiterRefusal, detail: object = {}) =>
  new ClientSafeError({
    message: MESSAGES[reason],
    status: reason === "busy" ? Status.SERVICE_UNAVAILABLE : BAD_REQUEST.has(reason) ? Status.BAD_REQUEST : Status.CONFLICT,
    data: { reason, ...detail },
    isClientFriendly: true,
  });

const mainSaveOf = (em: EntityManager, userid: number): Promise<Save | null> =>
  em.findOne(Save, { saveuserid: userid, type: BaseType.MAIN });

/** Each inviter's Baiter level, from their main yards. */
const baiterLevels = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, number>> => {
  if (ids.length === 0) return new Map();
  const saves = await em.find(
    Save,
    { saveuserid: { $in: [...new Set(ids)] }, type: BaseType.MAIN },
    { fields: ["saveuserid", "buildingdata"] }
  );
  return new Map(saves.map((save) => [Number(save.saveuserid), baiterLevelOf(save)]));
};

/** A kept test as the Results list sends it. */
const resultView = (row: TestRow, photos: Map<number, { photo: number | null; level: number }>, rulesVersion: string) => ({
  id: row.id,
  tester: {
    userid: row.tester.userid,
    name: row.tester.username,
    pic: row.tester.pic,
    photo: photos.get(row.tester.userid)?.photo ?? null,
    level: photos.get(row.tester.userid)?.level ?? 0,
  },
  foughtAt: row.foughtAt,
  damage: row.damage,
  result: row.result,
  seconds: row.seconds,
  rulesVersion: row.rulesVersion,
  hasReport: row.hasReport,
  hasReplay: row.hasReplay,
  playable: row.hasReplay && rulesPlay(row.rulesVersion, rulesVersion),
});

/**
 * `GET /baiter/tests`: everything the Baiter window's Invite, Invited me and
 * Results tabs show, in one answer.
 */
export const testsAnswer = async (em: EntityManager, user: User, now: number, deps: Pick<BaiterDeps, "rulesVersion">): Promise<BaiterBody> => {
  const me = user.userid;
  const mine = await mainSaveOf(em, me);
  const baiterLevel = baiterLevelOf(mine);
  const [candidates, sent, received, results] = await Promise.all([
    baiterLevel > 0 ? candidatesOf(em, me) : Promise.resolve([]),
    invitesSent(em, me, now),
    invitesReceived(em, me, now),
    listTests(em, me, now),
  ]);
  // An invite from someone no longer a friend or mate is not offered.
  const usable = [];
  for (const invite of received) if (await mayTest(em, invite.inviter, me)) usable.push(invite);
  const [cards, levels] = await Promise.all([
    cardsOf(em, [...sent.map((one) => one.tester), ...usable.map((one) => one.inviter), ...results.map((one) => one.tester.userid)]),
    baiterLevels(em, usable.map((one) => one.inviter)),
  ]);
  const card = (userid: number) => cards.get(userid) ?? { userid, username: "", pic: null, photo: null, level: 0 };
  return {
    error: 0,
    now,
    baiterLevel,
    cap: baiterLevel > 0 ? capOfLevel(baiterLevel) : 0,
    inviteSeconds: INVITE_SECONDS,
    keepSeconds: RESULT_KEEP_SECONDS,
    maxPerSend: MAX_INVITES_PER_SEND,
    candidates,
    invited: sent.map((one) => ({ ...card(one.tester), expiresAt: one.expiresAt, tests: one.tests })),
    invitedMe: usable
      .filter((one) => (levels.get(one.inviter) ?? 0) > 0)
      .map((one) => ({ ...card(one.inviter), expiresAt: one.expiresAt, cap: capOfLevel(levels.get(one.inviter) ?? 1) })),
    results: results.map((row) => resultView(row, cards, deps.rulesVersion)),
  };
};

const id = z.coerce.number().int().positive().max(2_147_483_647);

/**
 * A JSON body's arrays and objects arrive re-stringified (`middleware/jsonBody.ts`),
 * so a string is parsed first.
 */
export const parsedField = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const InviteSchema = z.object({ userids: z.preprocess(parsedField, z.array(id).min(1).max(MAX_INVITES_PER_SEND)) });
export const CancelSchema = z.object({ userid: id });
export const StartSchema = z.object({ inviter: id });
export const FinishSchema = z.object({
  token: z.string().min(8).max(64),
  army: z.preprocess(parsedField, z.unknown()),
  flinglog: z.preprocess(parsedField, z.unknown()),
  tick: z.coerce.number().int().min(0).max(MAX_TEST_TICK),
  report: z.preprocess(parsedField, z.unknown()).optional(),
});
const TestIdSchema = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

/** `POST /baiter/invite { userids }`: opens a 24 h invite to each friend or mate named. */
export const inviteAnswer = async (
  em: EntityManager,
  user: User,
  body: unknown,
  now: number,
  deps: Pick<BaiterDeps, "notify">
): Promise<BaiterBody> => {
  const { userids } = InviteSchema.parse(body ?? {});
  const me = user.userid;
  if (baiterLevelOf(await mainSaveOf(em, me)) === 0) throw baiterRefusedErr("noBaiter");
  const wanted = [...new Set(userids)].filter((one) => one !== me);
  const allowed: number[] = [];
  for (const tester of wanted) if (await mayTest(em, me, tester)) allowed.push(tester);
  if (allowed.length === 0) throw baiterRefusedErr("notFriend");
  const open = await invitesSent(em, me, now);
  const fresh = allowed.filter((tester) => !open.some((one) => one.tester === tester));
  if (open.length + fresh.length > MAX_OPEN_INVITES) throw baiterRefusedErr("tooManyInvites");
  await openInvites(em, me, allowed, now);
  // Only a new invite is news; a renewed one is not sent again.
  for (const tester of fresh) {
    await deps.notify(em, tester, { event: "baiterInvite", userid: me, username: user.username, expires: now + INVITE_SECONDS });
  }
  return { error: 0, invited: allowed.length, skipped: wanted.length - allowed.length, expiresAt: now + INVITE_SECONDS };
};

/** `POST /baiter/invite/cancel { userid }`: ends an invite now. */
export const cancelAnswer = async (em: EntityManager, user: User, body: unknown, now: number): Promise<BaiterBody> => {
  const { userid } = CancelSchema.parse(body ?? {});
  return { error: 0, cancelled: await closeInvite(em, user.userid, userid, now) };
};

/**
 * The inviter's main yard as a test is served it: the fields the attack scene
 * reads (the defence replay's allow-list), the defenders it puts up, and no
 * resources (a test takes nothing, so the tester is not shown the pool).
 */
export const testLoadOf = (save: Save, forces: DefenderForces, now: number): JsonObject => ({
  ...defenceReplayLoadOf({
    type: BaseType.MAIN,
    basename: save.basename,
    level: save.level,
    buildingdata: save.buildingdata ?? {},
    buildinghealthdata: save.buildinghealthdata ?? {},
    champion: save.champion ?? [],
    mushrooms: save.mushrooms ?? {},
    savetime: save.savetime,
    currenttime: now,
    defenderforces: forces as unknown as JsonObject,
    storedata: save.storedata,
  }),
  baseid: String(save.baseid),
  resources: {},
});

const randomSeed = (): number => Math.floor(Math.random() * 0x7fff_ffff) + 1;

/** `POST /baiter/test/start { inviter }`: the yard to test, its seed and cap, and the ticket. */
export const startAnswer = async (em: EntityManager, user: User, body: unknown, now: number, deps: BaiterDeps): Promise<BaiterBody> => {
  const { inviter } = StartSchema.parse(body ?? {});
  const me = user.userid;
  const invite = await openInvite(em, inviter, me, now);
  if (!invite) throw baiterRefusedErr("noInvite");
  if (!(await mayTest(em, inviter, me))) throw baiterRefusedErr("notFriend");
  const save = await mainSaveOf(em, inviter);
  const baiterLevel = baiterLevelOf(save);
  if (!save || baiterLevel === 0) throw baiterRefusedErr("noBaiter");
  const cap = capOfLevel(baiterLevel);
  const load = testLoadOf(save, await deps.forces(save, now), now);
  const token = (deps.makeToken ?? (() => crypto.randomUUID()))();
  const seed = (deps.makeSeed ?? randomSeed)();
  await deps.tickets.issue(me, { token, inviter, seed, cap, baiterLevel, at: now, load });
  const [card] = (await cardsOf(em, [inviter])).values();
  return {
    error: 0,
    token,
    seed,
    cap,
    baiterLevel,
    inviter: { userid: inviter, name: card?.username ?? "" },
    expiresAt: invite.expiresAt,
    load,
  };
};

/** The first drop's tick, or 0. */
const firstDrop = (events: readonly { kind: string; t: number }[]): number =>
  events.find((event) => event.kind === "fling")?.t ?? 0;

/**
 * `POST /baiter/test/finish`: spends the ticket, checks the army and its drops,
 * fights the battle again on the yard served, and keeps it for the inviter.
 */
export const finishAnswer = async (em: EntityManager, user: User, body: unknown, now: number, deps: BaiterDeps): Promise<BaiterBody> => {
  const sent = FinishSchema.parse(body ?? {});
  const me = user.userid;
  const ticket = await deps.tickets.take(me);
  if (!ticket || ticket.token !== sent.token) throw baiterRefusedErr("noTicket");
  // The ticket was given while the invite was open; the friendship must still stand.
  if (!(await mayTest(em, ticket.inviter, me))) throw baiterRefusedErr("notFriend");

  const parsed = parseTestArmy(sent.army, ticket.cap);
  if ("refusal" in parsed) throw baiterRefusedErr(parsed.refusal);
  const { army } = parsed;
  const log = parseFlingLog(sent.flinglog);
  if (!log || log.seed !== ticket.seed || !eventsFit(log.events, army)) throw baiterRefusedErr("badEvents");

  const load = ticket.load;
  const claimed = (sent.report as { result?: unknown } | undefined)?.result;
  const input: AbandonedInput = {
    defender: {
      type: BaseType.MAIN,
      kind: "main",
      buildingdata: (load.buildingdata ?? {}) as AbandonedInput["defender"]["buildingdata"],
      buildinghealthdata: (load.buildinghealthdata ?? null) as AbandonedInput["defender"]["buildinghealthdata"],
      // As served: the yard's pool is left out of a test (`testLoadOf`).
      resources: (load.resources ?? null) as AbandonedInput["defender"]["resources"],
    },
    attacker: testAttacker(army),
    log: { v: 1, seed: log.seed, events: log.events },
    tick: sent.tick,
    declareWar: false,
    left: claimed === "stopped",
    ...(load.defenderforces ? { defence: load.defenderforces as unknown as DefenderForces } : {}),
  };
  let outcome: AbandonedOutcome;
  try {
    outcome = await deps.fight(input);
  } catch {
    // The ticket goes back, so the same test can be sent again.
    await deps.tickets.issue(me, ticket);
    throw baiterRefusedErr("busy");
  }

  const report = keptReport(sent.report, outcome);
  const result = resultOf(outcome, claimed, report !== null);
  const academyLevels: JsonObject = {};
  for (const [monster, row] of Object.entries(army.monsters)) academyLevels[monster] = row.level;
  const payload: TestPayload = {
    v: 1,
    load,
    seed: log.seed,
    events: log.events,
    tick: outcome.tick,
    levels: academyLevels,
    army: army as unknown as JsonObject,
    champion: input.attacker.champion ?? [],
    report,
    attackreport: outcome.attackreport,
  };
  const testid = await storeTest(em, {
    inviter: ticket.inviter,
    tester: { userid: me, username: user.username, pic: user.pic_square ?? null },
    baseid: String(load.baseid ?? ""),
    foughtAt: now,
    damage: outcome.damage,
    result,
    seconds: Math.max(0, (outcome.tick - firstDrop(log.events)) / TICKS_PER_SECOND),
    rulesVersion: deps.rulesVersion,
    payload,
  });
  // One notice per invite, on its first test: the rest show as New on the Results tab
  // (a tester may run a test a minute; the inviter's notices would fill with them).
  const tests = await countTest(em, ticket.inviter, me);
  if (tests === null || tests <= 1) await deps.notify(em, ticket.inviter, {
    event: "baiterTest",
    userid: me,
    username: user.username,
    damage: Math.floor(outcome.damage),
    result,
    testid,
  });
  return { error: 0, id: testid, damage: Math.floor(outcome.damage), result, reportKept: report !== null };
};

/** `GET /baiter/tests/:id`: one of the caller's tests with its replay and report. 404 unless theirs; 410 with no replay. */
export const testAnswer = async (
  em: EntityManager,
  user: User,
  params: unknown,
  now: number,
  deps: Pick<BaiterDeps, "rulesVersion">
): Promise<{ status: number; body: BaiterBody }> => {
  const parsed = TestIdSchema.safeParse(params ?? {});
  const notFound = { status: Status.NOT_FOUND, body: { error: "That test is no longer kept.", reason: "notFound" } };
  if (!parsed.success) return notFound;
  const found = await loadTest(em, user.userid, parsed.data.id, now);
  if (!found) return notFound;
  const cards = await cardsOf(em, [found.test.tester.userid]);
  const test = resultView(found.test, cards, deps.rulesVersion);
  if (!found.replay) return { status: Status.GONE, body: { error: "Replay not available.", reason: "noReplay", test } };
  let replay: TestPayload;
  try {
    replay = decodeTestPayload(found.replay);
  } catch {
    return { status: Status.GONE, body: { error: "Replay not available.", reason: "noReplay", test } };
  }
  return { status: Status.OK, body: { error: 0, test, replay } };
};
