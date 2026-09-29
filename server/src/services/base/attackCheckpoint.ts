import {
  DECLARE_WAR_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  TICKS_PER_SECOND,
  type FlingEvent,
  type FlingLog,
} from "../../game-rules/combat/index.js";
import {
  ATTACK_SESSION_WINDOW,
  sessionFactsOf,
  type AttackSession,
  type AttackSessionFacts,
} from "./attackSession.js";

/**
 * An attack cannot be undone by never sending its result (issue #138).
 *
 * The web client sends one save per attack, at the end (`web/src/game/attack/plugins/end.ts`).
 * A player who reloads, closes the tab, loses the connection or has the browser
 * killed mid-battle sent nothing, and the attack session simply expired: the
 * flung monsters came home, the bombs were free (#90 charges them on the save)
 * and the defender's damage was lost. So while the attack runs the client
 * checkpoints it to the server — the fling log so far, the battle tick it has
 * reached, and which of its cells the monsters were housed in — after every
 * drop, bomb and siege weapon and every few seconds besides. An attack that
 * ends without a save is then finished by the server from the last checkpoint
 * (`finaliseAttack.ts`): the log is replayed with the shared engine up to the
 * checkpoint's tick, which is the moment the attacker was last seen, and the
 * result is written exactly as the client's own save would have written it.
 *
 * This module is pure: what a checkpoint is, whether one may replace the one
 * before it, and how it is written down. `attackCheckpointStore.ts` is the
 * half that talks to Redis.
 */

/** The last battle tick an attack can reach: Declare War's countdown plus the retreat grace. */
export const MAX_CHECKPOINT_TICK =
  (DECLARE_WAR_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS) * TICKS_PER_SECOND;

/** More events than an attack can hold: 300 s of drops is nowhere near it. */
export const MAX_CHECKPOINT_EVENTS = 500;

/** More source cells than a player owns within flinger range. */
export const MAX_CHECKPOINT_SOURCES = 64;

/**
 * How long a checkpoint is kept if nothing finalises it. The sweep finalises
 * one within a minute of its session expiring; this is only the backstop that
 * stops a key living for ever if the server is down when it should have run.
 */
export const ATTACK_CHECKPOINT_TTL = 7 * 24 * 60 * 60;

/** What the client sends. */
export interface CheckpointInput {
  /** Battle ticks the client's clock has reached. */
  tick: number;
  flinglog: FlingLog;
  /** The attacker's cells the roster was drawn from, in the order a fling spends them. */
  sources: string[];
}

/**
 * A checkpoint as stored: the input, the attack it belongs to, and what the
 * attack load recorded of it (issues #163, #165): the roster at entry, the
 * pool it served and the attacker's level. The session holding those expires
 * a minute after the attack's window, and the attack is often finished later
 * than that, so each checkpoint keeps its own copy: the finaliser caps and
 * credits the loot from them as the final save does (`finaliseAttack.ts`).
 */
export interface AttackCheckpoint extends CheckpointInput, AttackSessionFacts {
  attackerid: number;
  /** `saveuserid` of the defender's row, so the defender's own load can finish it. */
  defenderid: number;
  attackid: number;
  /** Server seconds at attack start, from the session: when it expires. */
  startedat: number;
  /** Server seconds when this checkpoint arrived. */
  at: number;
}

/** Why a checkpoint was not taken. */
export type CheckpointRefusal =
  | "malformed"
  | "empty"
  | "rewound"
  | "reseeded";

/** The key one defender row's checkpoint is kept under. */
export const attackCheckpointKey = (basesaveid: number) => `attack-checkpoint:${basesaveid}`;

/** Every defender row that holds a checkpoint, for the sweep. */
export const ATTACK_CHECKPOINT_INDEX = "attack-checkpoints";

/** The lock that makes an attack's result land once (`attackCheckpointStore.ts`). */
export const attackFinalLockKey = (basesaveid: number) => `attack-final:${basesaveid}`;

/** Held for no longer than a save or a finalisation can take. */
export const ATTACK_FINAL_LOCK_SECONDS = 30;

const EVENT_KINDS = new Set(["fling", "bomb", "siege", "retreat"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTick = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_CHECKPOINT_TICK;

const isCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** One event of the log, checked for the fields the replay reads. */
const isEvent = (value: unknown): value is FlingEvent => {
  if (!isRecord(value) || typeof value.kind !== "string" || !EVENT_KINDS.has(value.kind)) return false;
  if (!isTick(value.t)) return false;
  if (value.kind === "retreat") return true;
  if (!isCoordinate(value.x) || !isCoordinate(value.y)) return false;
  if (value.kind === "bomb") return typeof value.id === "string";
  if (value.kind === "siege") return typeof value.weapon === "string";

  if (!isCoordinate(value.r) || !isRecord(value.monsters)) return false;
  for (const count of Object.values(value.monsters)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return false;
  }
  if (value.champion === undefined) return true;
  return (
    isRecord(value.champion) &&
    Number.isInteger(value.champion.t) &&
    Number.isInteger(value.champion.l)
  );
};

/**
 * Reads a fling log, checked for everything the replay reads: version 1, a
 * whole seed, and at most {@link MAX_CHECKPOINT_EVENTS} well-formed events,
 * each inside the longest attack. The attack save's loot is replayed from the
 * same log (`combat/attackLoot.ts`), so both paths read it the same way.
 *
 * @param flinglog - The log, already JSON-parsed.
 * @returns The log, or null when it is not one.
 */
export const parseFlingLog = (flinglog: unknown): FlingLog | null => {
  if (!isRecord(flinglog) || flinglog.v !== 1 || !Number.isSafeInteger(flinglog.seed)) return null;

  const events = flinglog.events;
  if (!Array.isArray(events) || events.length > MAX_CHECKPOINT_EVENTS || !events.every(isEvent)) {
    return null;
  }

  return { v: 1, seed: flinglog.seed as number, events: events as FlingEvent[] };
};

/**
 * Reads a checkpoint off a request body.
 *
 * @param body - `tick`, `flinglog` and `sources`, already JSON-parsed.
 * @returns The checkpoint, or the reason it is not one.
 */
export const parseCheckpoint = (body: {
  tick: unknown;
  flinglog: unknown;
  sources: unknown;
}): CheckpointInput | { refused: CheckpointRefusal } => {
  const { tick, sources } = body;

  if (!isTick(tick)) return { refused: "malformed" };

  const log = parseFlingLog(body.flinglog);
  if (!log) return { refused: "malformed" };

  if (
    !Array.isArray(sources) ||
    sources.length > MAX_CHECKPOINT_SOURCES ||
    !sources.every((source) => typeof source === "string" && /^\d{1,20}$/.test(source))
  ) {
    return { refused: "malformed" };
  }

  // An attack with nothing dropped saves nothing (#79), so it has nothing to checkpoint.
  if (log.events.length === 0) return { refused: "empty" };

  // A tick behind the log's own last event is the client's clock read too early.
  const last = Math.max(...log.events.map((event) => event.t));

  return { tick: Math.max(tick, last), flinglog: log, sources: sources as string[] };
};

/**
 * Whether `next` may replace `stored`.
 *
 * A checkpoint only ever adds to what the server already holds: the same seed,
 * every stored event unchanged and in place, and a clock that has not gone
 * back. Without this a client could take a drop back out of the record by
 * checkpointing a shorter log, which is the very undo the checkpoint exists to
 * stop.
 *
 * @param stored - The checkpoint held now, or null for the first.
 * @param next - The one just sent.
 * @returns Null when it may, or why not.
 */
export const checkpointExtends = (
  stored: AttackCheckpoint | null,
  next: CheckpointInput
): CheckpointRefusal | null => {
  if (!stored) return null;
  if (stored.flinglog.seed !== next.flinglog.seed) return "reseeded";
  if (next.tick < stored.tick) return "rewound";

  const before = stored.flinglog.events;
  const after = next.flinglog.events;
  if (after.length < before.length) return "rewound";

  for (let at = 0; at < before.length; at++) {
    if (JSON.stringify(before[at]) !== JSON.stringify(after[at])) return "rewound";
  }
  return null;
};

/**
 * The record kept for a checkpoint.
 *
 * @param session - The attack session the checkpoint was bound to.
 * @param defenderid - `saveuserid` of the row under attack.
 * @param input - What the client sent.
 * @param now - Server seconds.
 */
export const newCheckpoint = (
  session: AttackSession,
  defenderid: number,
  input: CheckpointInput,
  now: number
): AttackCheckpoint => ({
  attackerid: session.attackerid,
  defenderid,
  attackid: session.attackid,
  startedat: session.startedat,
  at: now,
  ...input,
  ...(session.entryHoused && { entryHoused: session.entryHoused }),
  ...(session.defenderResources && { defenderResources: session.defenderResources }),
  ...(session.attackerResources && { attackerResources: session.attackerResources }),
  ...(session.attackerlevel !== undefined && { attackerlevel: session.attackerlevel }),
  ...(session.defenderForces && { defenderForces: session.defenderForces }),
});

export const serialiseCheckpoint = (checkpoint: AttackCheckpoint): string =>
  JSON.stringify(checkpoint);

/**
 * Reads a stored checkpoint back; anything unreadable is no checkpoint at all.
 *
 * @param raw - The stored value, if there was one.
 */
export const parseStoredCheckpoint = (raw: string | null | undefined): AttackCheckpoint | null => {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const { attackerid, defenderid, attackid, startedat, at } = value;
  if (![attackerid, defenderid, attackid, startedat, at].every(Number.isSafeInteger)) return null;

  const input = parseCheckpoint({ tick: value.tick, flinglog: value.flinglog, sources: value.sources });
  if ("refused" in input) return null;

  return {
    attackerid: attackerid as number,
    defenderid: defenderid as number,
    attackid: attackid as number,
    startedat: startedat as number,
    at: at as number,
    ...input,
    ...sessionFactsOf(value),
  };
};

/**
 * The attack session a checkpoint was bound to, rebuilt from its copy: what
 * the attack save's loot rule reads (`attackLootOf`), whether or not the
 * session itself is still stored.
 *
 * @param checkpoint - The stored checkpoint.
 */
export const checkpointSession = (checkpoint: AttackCheckpoint): AttackSession => ({
  attackerid: checkpoint.attackerid,
  attackid: checkpoint.attackid,
  startedat: checkpoint.startedat,
  ...(checkpoint.entryHoused && { entryHoused: checkpoint.entryHoused }),
  ...(checkpoint.defenderResources && { defenderResources: checkpoint.defenderResources }),
  ...(checkpoint.attackerResources && { attackerResources: checkpoint.attackerResources }),
  ...(checkpoint.attackerlevel !== undefined && { attackerlevel: checkpoint.attackerlevel }),
  ...(checkpoint.defenderForces && { defenderForces: checkpoint.defenderForces }),
});

/**
 * Whether the attack a checkpoint belongs to can no longer be saved by its
 * attacker, so the server must finish it: the session window has closed.
 *
 * @param checkpoint - The stored checkpoint.
 * @param now - Server seconds.
 */
export const checkpointExpired = (checkpoint: AttackCheckpoint, now: number): boolean =>
  now - checkpoint.startedat >= ATTACK_SESSION_WINDOW;
