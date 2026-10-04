import { randomBytes, randomInt } from "node:crypto";

import { redis } from "../../server.js";
import { LISTED_MONSTERS, monsterEntry } from "../../game-data/monsterCatalogue.js";
import { logBotCheck } from "./botCheckLog.js";
import { type BotTrigger, observeRealAction, resetPatterns } from "./botPatterns.js";
import { challengeKey, setChallengePending } from "./online.js";

/**
 * The in-game check (#273): "Quick check: tap the Pokey" among a few monster
 * portraits, asked when `botPatterns.ts` sees a bot-like pattern.
 *
 * While it is unanswered the player reads as offline, and so can be attacked
 * (`online.ts`, the `presence-challenge:<userid>` flag); everything else keeps
 * working. A right answer clears the flag and is a real game action
 * (`realActions.ts`), so the player is protected again at once.
 *
 * The server makes each check and keeps its answer: the client gets an opaque
 * id, the options in a shuffled order, each an opaque id with the monster to
 * draw, and the prompt. A wrong answer gets a new check;
 * {@link WRONG_ANSWER_LIMIT} of them in {@link WRONG_ANSWER_WINDOW_SECONDS}
 * start a wait of {@link COOLDOWN_SECONDS} before the next. Every trigger and
 * every answer goes in the review log (`botCheckLog.ts`).
 */

/** A check waits this long for its answer; after that the next read makes another. */
export const CHALLENGE_TTL_SECONDS = 15 * 60;
/** Portraits on one check: four to six. */
export const CHALLENGE_OPTIONS_MIN = 4;
export const CHALLENGE_OPTIONS_MAX = 6;
/**
 * The monsters a check asks for: the eight of Monster Locker levels 1 and 2,
 * the ones a player meets first. The other options come from every listed
 * monster.
 */
export const CHALLENGE_TARGETS: readonly string[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
export const WRONG_ANSWER_LIMIT = 5;
export const WRONG_ANSWER_WINDOW_SECONDS = 10 * 60;
export const COOLDOWN_SECONDS = 2 * 60;
/** The answer route, as `app.routes.ts` writes it. */
export const CHECK_ANSWER_ROUTE = "/api/:apiVersion/bm/presence/check/answer";

/** One portrait to tap: an id that means nothing outside this check, and the monster to draw. */
export interface ChallengeOption {
  readonly id: string;
  readonly monster: string;
}

/** What the client sees of a check. */
export interface PublicChallenge {
  readonly id: string;
  /** "Tap the Pokey". */
  readonly prompt: string;
  readonly options: readonly ChallengeOption[];
}

/** What the server keeps. */
interface StoredChallenge extends PublicChallenge {
  /** The option id to tap. */
  readonly answer: string;
  readonly target: string;
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

const token = (): string => randomBytes(8).toString("hex");

const shuffled = <T>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const nameOf = (monster: string): string => monsterEntry(monster)?.name ?? monster;

/** A new check: a target, the other options, all in a random order, every id fresh. */
export const makeChallenge = (): StoredChallenge => {
  const target = CHALLENGE_TARGETS[randomInt(CHALLENGE_TARGETS.length)]!;
  const count = randomInt(CHALLENGE_OPTIONS_MIN, CHALLENGE_OPTIONS_MAX + 1);
  const others = shuffled(LISTED_MONSTERS.map(({ id }) => id).filter((id) => id !== target)).slice(0, count - 1);
  const options = shuffled([target, ...others]).map((monster) => ({ id: token(), monster }));
  const answer = options.find(({ monster }) => monster === target)!.id;
  return { id: token(), prompt: `Tap the ${nameOf(target)}`, options, answer, target };
};

/** The check as the client may see it: never the answer or the target. */
export const publicChallenge = ({ id, prompt, options }: StoredChallenge): PublicChallenge => ({
  id,
  prompt,
  options: options.map(({ id: option, monster }) => ({ id: option, monster })),
});

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
  if (raw !== null) return { pending: true, challenge: publicChallenge(JSON.parse(raw) as StoredChallenge) };
  const made = makeChallenge();
  await redis.setex(storedKey(userid), CHALLENGE_TTL_SECONDS, JSON.stringify(made));
  return { pending: true, challenge: publicChallenge(made) };
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

  if (optionId === stored.answer) {
    await Promise.all([
      setChallengePending(userid, false),
      redis.del(wrongKey(userid), cooldownKey(userid)),
      resetPatterns(userid, nowMs),
    ]);
    await logBotCheck({ at: now, userid, event: "solved", detail: `tapped the ${nameOf(stored.target)}` });
    return { solved: true, state: { pending: false } };
  }

  const wrong = await redis.incr(wrongKey(userid));
  if (wrong === 1) await redis.expire(wrongKey(userid), WRONG_ANSWER_WINDOW_SECONDS);
  const picked = stored.options.find(({ id }) => id === optionId)?.monster;
  await logBotCheck({
    at: now,
    userid,
    event: "wrong",
    detail: `tapped ${picked === undefined ? "no option of the check" : `the ${nameOf(picked)}`} for the ${nameOf(stored.target)}, wrong answer ${wrong} of ${WRONG_ANSWER_LIMIT}`,
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
