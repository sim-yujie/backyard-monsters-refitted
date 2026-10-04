import { randomBytes, randomInt } from "node:crypto";
import alea from "alea";

import { redis } from "../../server.js";
import { monsterEntry } from "../../game-data/monsterCatalogue.js";
import { logBotCheck } from "./botCheckLog.js";
import { type BotTrigger, observeRealAction, resetPatterns } from "./botPatterns.js";
import { referencePicture, renderPicture } from "./botPicture.js";
import { challengeKey, setChallengePending } from "./online.js";

/**
 * The in-game check (#273): "How many of these are in the picture?", asked
 * when `botPatterns.ts` sees a bot-like pattern.
 *
 * While it is unanswered the player reads as offline, and so can be attacked
 * (`online.ts`, the `presence-challenge:<userid>` flag); everything else keeps
 * working. A right answer clears the flag and is a real game action
 * (`realActions.ts`), so the player is protected again at once.
 *
 * The server makes each check and keeps its answer. The picture is drawn here
 * (`botPicture.ts`): {@link CHALLENGE_COUNT_MIN}-{@link CHALLENGE_COUNT_MAX}
 * of one monster among others on the yard's grass. The client gets an opaque
 * id, the question, the monster's name, a reference portrait and the
 * picture, both as image bytes: no monster id, position or count. The answer
 * is a number from 1 to {@link CHALLENGE_ANSWER_MAX}. A wrong answer gets a
 * new picture; {@link WRONG_ANSWER_LIMIT} of them in
 * {@link WRONG_ANSWER_WINDOW_SECONDS} start a wait of {@link COOLDOWN_SECONDS}
 * before the next. Every trigger and every answer goes in the review log
 * (`botCheckLog.ts`).
 *
 * The picture is drawn once, when the check is made, and kept beside it for
 * as long as the check lasts: reading the check again never draws it again.
 * The check itself keeps the picture's seed, so a picture that has gone from
 * the store is drawn again the same.
 */

/** A check waits this long for its answer; after that the next read makes another. */
export const CHALLENGE_TTL_SECONDS = 15 * 60;
/** How many of the monster a picture holds. */
export const CHALLENGE_COUNT_MIN = 2;
export const CHALLENGE_COUNT_MAX = 7;
/** The answer buttons run from 1 to this. */
export const CHALLENGE_ANSWER_MAX = 9;
/**
 * The monsters a check asks for: the eight of Monster Locker levels 1 and 2,
 * the ones a player meets first, each with a painted portrait for the
 * reference. The other monsters in the picture come from C1-C15.
 */
export const CHALLENGE_TARGETS: readonly string[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
export const CHALLENGE_PROMPT = "How many of these are in the picture?";
export const WRONG_ANSWER_LIMIT = 5;
export const WRONG_ANSWER_WINDOW_SECONDS = 10 * 60;
export const COOLDOWN_SECONDS = 2 * 60;
/** The answer route, as `app.routes.ts` writes it. */
export const CHECK_ANSWER_ROUTE = "/api/:apiVersion/bm/presence/check/answer";

/** What the client sees of a check. */
export interface PublicChallenge {
  readonly id: string;
  /** {@link CHALLENGE_PROMPT}. */
  readonly prompt: string;
  /** The monster to count, by name: "Pokey". */
  readonly name: string;
  /** Its painted portrait, a `data:image/webp` URL. */
  readonly reference: string;
  /** The picture to count in, a `data:image/png` URL. */
  readonly picture: string;
}

/** What the server keeps. */
interface StoredChallenge {
  readonly id: string;
  readonly target: string;
  readonly count: number;
  /** Draws the picture (`botPicture.ts`). */
  readonly seed: string;
}

/** Where the player's check stands. */
export type CheckState =
  | { readonly pending: false }
  | { readonly pending: true; readonly challenge: PublicChallenge }
  /** Too many wrong answers: the next check comes at `cooldownUntil`, unix seconds. */
  | { readonly pending: true; readonly cooldownUntil: number };

const storedKey = (userid: number): string => `bot-check:challenge:${userid}`;
const wrongKey = (userid: number): string => `bot-check:wrong:${userid}`;
const cooldownKey = (userid: number): string => `bot-check:cooldown:${userid}`;
/** The check's picture, a `data:image/png` URL, by the check's id. */
export const pictureKey = (challengeId: string): string => `bot-check:picture:${challengeId}`;

const token = (bytes: number): string => randomBytes(bytes).toString("hex");

const nameOf = (monster: string): string => monsterEntry(monster)?.name ?? monster;

/** "5 Pokeys", for the review log. */
const counted = (count: number, monster: string): string => `${count} ${nameOf(monster)}${count === 1 ? "" : "s"}`;

/** A new check: a target, how many, and a fresh id and seed. */
export const makeChallenge = (): StoredChallenge => ({
  id: token(8),
  target: CHALLENGE_TARGETS[randomInt(CHALLENGE_TARGETS.length)]!,
  count: randomInt(CHALLENGE_COUNT_MIN, CHALLENGE_COUNT_MAX + 1),
  seed: token(16),
});

/** Draws the check's picture, as a `data:image/png` URL. */
export const drawPicture = ({ target, count, seed }: StoredChallenge): string =>
  `data:image/png;base64,${renderPicture(target, count, alea(seed)).toString("base64")}`;

/** The check as the client may see it: pictures and words, never the count, the target's id or the seed. */
export const publicChallenge = (stored: StoredChallenge, picture: string = drawPicture(stored)): PublicChallenge => ({
  id: stored.id,
  prompt: CHALLENGE_PROMPT,
  name: nameOf(stored.target),
  reference: `data:image/webp;base64,${referencePicture(stored.target).toString("base64")}`,
  picture,
});

/** Keeps a check's picture for as long as the check lasts. */
const keepPicture = async (challengeId: string, picture: string): Promise<void> => {
  await redis.setex(pictureKey(challengeId), CHALLENGE_TTL_SECONDS, picture);
};

/** The check as sent, with the picture kept when it was made: drawn again only if that has gone. */
const sentChallenge = async (stored: StoredChallenge): Promise<PublicChallenge> => {
  const kept = await redis.get(pictureKey(stored.id));
  if (kept !== null) return publicChallenge(stored, kept);
  const picture = drawPicture(stored);
  await keepPicture(stored.id, picture);
  return publicChallenge(stored, picture);
};

const isPending = async (userid: number): Promise<boolean> => (await redis.get(challengeKey(userid))) !== null;

const cooldownUntil = async (userid: number, now: number): Promise<number | null> => {
  const until = Number(await redis.get(cooldownKey(userid)));
  return Number.isFinite(until) && until > now ? until : null;
};

/**
 * Asks the player for a check: sets the flag that reads them as offline and
 * logs why. The check itself is made when the client asks for it.
 */
export const raiseCheck = async (userid: number, trigger: BotTrigger, now: number): Promise<void> => {
  await setChallengePending(userid, true);
  await logBotCheck({ at: now, userid, event: "trigger", rule: trigger.rule, detail: trigger.detail });
};

/** The player's check now: none, the one waiting (made if there is none), or the wait after wrong answers. */
export const readCheck = async (userid: number, now: number): Promise<CheckState> => {
  if (!(await isPending(userid))) return { pending: false };
  const until = await cooldownUntil(userid, now);
  if (until !== null) return { pending: true, cooldownUntil: until };
  const raw = await redis.get(storedKey(userid));
  if (raw !== null) return { pending: true, challenge: await sentChallenge(JSON.parse(raw) as StoredChallenge) };
  const made = makeChallenge();
  const picture = drawPicture(made);
  await Promise.all([
    redis.setex(storedKey(userid), CHALLENGE_TTL_SECONDS, JSON.stringify(made)),
    keepPicture(made.id, picture),
  ]);
  return { pending: true, challenge: publicChallenge(made, picture) };
};

/**
 * One answer. A check is used once: it is taken from the store before it is
 * marked, so two answers sent together cannot both try it. An answer to a
 * check that is gone (answered, run out, from another tab) is not counted and
 * leaves the current one alone; it gets the check that stands now.
 *
 * @returns Whether it was solved, and where the check stands after.
 */
export const answerCheck = async (
  userid: number,
  challengeId: string,
  /** The number tapped, as sent. */
  optionId: string,
  now: number,
  nowMs: number = Date.now()
): Promise<{ readonly solved: boolean; readonly state: CheckState }> => {
  if (!(await isPending(userid))) return { solved: false, state: { pending: false } };
  const until = await cooldownUntil(userid, now);
  if (until !== null) return { solved: false, state: { pending: true, cooldownUntil: until } };

  const raw = await redis.get(storedKey(userid));
  const stored = raw === null ? null : (JSON.parse(raw) as StoredChallenge);
  if (stored === null || stored.id !== challengeId || (await redis.getdel(storedKey(userid))) !== raw) {
    return { solved: false, state: await readCheck(userid, now) };
  }
  await redis.del(pictureKey(stored.id));

  if (Number(optionId) === stored.count) {
    await Promise.all([
      setChallengePending(userid, false),
      redis.del(wrongKey(userid), cooldownKey(userid)),
      resetPatterns(userid, nowMs),
    ]);
    await logBotCheck({ at: now, userid, event: "solved", detail: `counted ${counted(stored.count, stored.target)}` });
    return { solved: true, state: { pending: false } };
  }

  const wrong = await redis.incr(wrongKey(userid));
  if (wrong === 1) await redis.expire(wrongKey(userid), WRONG_ANSWER_WINDOW_SECONDS);
  await logBotCheck({
    at: now,
    userid,
    event: "wrong",
    detail: `answered ${optionId.slice(0, 8)} for ${counted(stored.count, stored.target)}, wrong answer ${wrong} of ${WRONG_ANSWER_LIMIT}`,
  });
  if (wrong >= WRONG_ANSWER_LIMIT) {
    const waitUntil = now + COOLDOWN_SECONDS;
    await Promise.all([
      redis.setex(cooldownKey(userid), COOLDOWN_SECONDS, String(waitUntil)),
      redis.del(wrongKey(userid)),
    ]);
    await logBotCheck({
      at: now,
      userid,
      event: "cooldown",
      detail: `${wrong} wrong answers; the next check in ${COOLDOWN_SECONDS} s`,
    });
    return { solved: false, state: { pending: true, cooldownUntil: waitUntil } };
  }
  return { solved: false, state: await readCheck(userid, now) };
};

/**
 * The real-action middleware's hook: notes the action and raises a check on
 * a pattern. Nothing is noted while a check is waiting, or for the answer
 * itself.
 *
 * @param route - The method and pattern, e.g. `POST /api/:apiVersion/bm/yard/bank`.
 * @returns Whether a check is waiting now.
 */
export const watchRealAction = async (userid: number, route: string, nowMs: number): Promise<boolean> => {
  if (route === `POST ${CHECK_ANSWER_ROUTE}`) return isPending(userid);
  if (await isPending(userid)) return true;
  const trigger = await observeRealAction(userid, route, nowMs);
  if (trigger === null) return false;
  await raiseCheck(userid, trigger, Math.floor(nowMs / 1000));
  return true;
};
