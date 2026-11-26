import { HELP_ALL_MAX_TARGETS, type HelpBlock, type ResourceAmounts } from "@/api/friends";
import { formatShort } from "@/ui/format";
import { helpRefusalText, isHelpOpen, rewardText, savedText, tagSeconds, type HelpTarget } from "./helpModel";

/**
 * Help all on a friend's yard (beta 8, owner 15 Nov 2026): every help the
 * visitor can still give (patch 7.6's rule: no daily cap; the first 5 helps
 * a UTC day pay the reward; 5 friends a job). Since 26 Nov 2026 they go to
 * the server in one request (`POST /bm/friends/help/all`), which gives them
 * in order by the single help's rules; the scene lands each answer as one
 * help's (`helpMany`), which keeps the block, the marks and the yard current.
 * This adds up what the server answered, and stops when a refusal is about
 * the whole visit rather than one building.
 */

/**
 * Refusals about one building only: Help all marks it and goes on with the
 * next. Every other refusal (not friends, under attack, a block or a ban,
 * `tooNew`, the rate limit, a network failure) stops it.
 */
export const BUILDING_REFUSALS: ReadonlySet<string> = new Set(["alreadyHelped", "helpersFull", "nothingToHelp"]);

/** Whether a refusal ends Help all. */
export const stopsHelpAll = (reason: string): boolean => !BUILDING_REFUSALS.has(reason);

/** What one help came to: the server's own numbers, or its refusal. */
export type HelpOutcome =
  | { readonly ok: true; readonly secondsSaved: number; readonly reward: ResourceAmounts }
  | { readonly ok: false; readonly reason: string; readonly text: string };

/** What Help all came to. */
export interface HelpAllSummary {
  /** Helps the server took. */
  readonly helped: number;
  /** Seconds taken off, all speed-ups together, each cut as its tag shows it (`tagSeconds`). */
  readonly secondsSaved: number;
  /** Everything earned. */
  readonly reward: ResourceAmounts;
  /** Helps refused for one building and passed over. */
  readonly skipped: number;
  /** The refusal that stopped it, in words; null when it ran to the end. */
  readonly stoppedBy: string | null;
}

export interface HelpAllOptions {
  /** The block as it stands now: a help no longer open in it is passed over. */
  readonly block: () => HelpBlock | null;
  /**
   * Gives the helps in one request and lands each on the screen, in order;
   * never throws. One outcome per help the server reached, ending at a stop;
   * a request refused as a whole is one stopping outcome. Fewer outcomes than
   * helps (a stop, or the visit over) ends Help all there.
   */
  readonly helpMany: (targets: readonly HelpTarget[]) => Promise<readonly HelpOutcome[]>;
  /** False once the visit is over (the player left): stops before the next request. */
  readonly goOn?: () => boolean;
  /** After each help, for a "2 of 3" on the bar. */
  readonly onStep?: (done: number, total: number) => void;
  /** Helps per request: the server's most ({@link HELP_ALL_MAX_TARGETS}); more go in turns. */
  readonly perRequest?: number;
}

const addReward = (sum: Record<string, number>, reward: ResourceAmounts): void => {
  for (const [key, amount] of Object.entries(reward)) {
    if (typeof amount === "number" && amount > 0) sum[key] = (sum[key] ?? 0) + amount;
  }
};

/** Gives every help in `targets`, in as few requests as the server takes; see the file's comment. */
export const runHelpAll = async (targets: readonly HelpTarget[], options: HelpAllOptions): Promise<HelpAllSummary> => {
  let helped = 0;
  let secondsSaved = 0;
  let skipped = 0;
  let stoppedBy: string | null = null;
  const reward: Record<string, number> = {};
  let done = 0;
  const perRequest = Math.max(1, Math.floor(options.perRequest ?? HELP_ALL_MAX_TARGETS));
  run: for (let at = 0; at < targets.length; at += perRequest) {
    if (options.goOn && !options.goOn()) break;
    const turn = targets.slice(at, at + perRequest);
    const block = options.block();
    const open = turn.filter((target) => isHelpOpen(block, target));
    const outcomes = open.length > 0 ? await options.helpMany(open) : [];
    let next = 0;
    for (const target of turn) {
      if (!open.includes(target)) {
        done += 1;
        continue;
      }
      const outcome = outcomes[next++];
      // Not reached: the server stopped before it, or the visit is over.
      if (!outcome) break run;
      done += 1;
      if (outcome.ok) {
        helped += 1;
        // Each help as its tag read, so the total is the tags' sum.
        secondsSaved += tagSeconds(outcome.secondsSaved);
        addReward(reward, outcome.reward);
      } else if (stopsHelpAll(outcome.reason)) {
        stoppedBy = outcome.text;
        options.onStep?.(done, targets.length);
        break run;
      } else {
        skipped += 1;
      }
      options.onStep?.(done, targets.length);
    }
  }
  return { helped, secondsSaved, reward, skipped, stoppedBy };
};

/**
 * The one line after Help all: "Helped 3 · saved 1h 12m · earned 1,250 of
 * each resource", and why it stopped when it did.
 */
export const helpAllResultText = (summary: HelpAllSummary): string => {
  const parts: string[] = [];
  if (summary.helped > 0) {
    parts.push(`Helped ${summary.helped}`);
    if (summary.secondsSaved > 0) parts.push(`saved ${savedText(summary.secondsSaved)}`);
    const earned = rewardText(summary.reward);
    if (earned) parts.push(`earned ${earned}`);
  }
  const line = parts.join(" · ");
  if (summary.stoppedBy) return line ? `${line}. ${summary.stoppedBy}` : summary.stoppedBy;
  return line || helpRefusalText("nothingToHelp");
};

/** "Twigs" for r1, as the short line shows a reward the four resources do not share. */
const SHORT_WORDS: Readonly<Record<string, string>> = { r1: "twigs", r2: "pebbles", r3: "putty", r4: "goo" };

/** A reward at its shortest: "+172.8K each", or "+1.2K twigs +500 goo". Empty when nothing. */
const shortReward = (reward: ResourceAmounts): string => {
  const entries = (["r1", "r2", "r3", "r4"] as const)
    .map((key) => [key, Math.max(0, Math.floor(reward[key] ?? 0))] as const)
    .filter(([, amount]) => amount > 0);
  if (entries.length === 0) return "";
  const first = entries[0]![1];
  if (entries.length === 4 && entries.every(([, amount]) => amount === first)) return `+${formatShort(first)} each`;
  return entries.map(([key, amount]) => `+${formatShort(amount)} ${SHORT_WORDS[key]}`).join(" ");
};

/**
 * The same, short enough for the one-row visit bar on a phone (owner,
 * 15 Nov 2026: one bar, numbers over words): "Helped 3 · -8h 36m · +172.8K
 * each". A stop says only the reason when nothing was helped; the full
 * sentence also goes up as a notice ({@link helpAllResultText}).
 */
export const helpAllShortText = (summary: HelpAllSummary): string => {
  if (summary.helped === 0) return summary.stoppedBy ?? helpRefusalText("nothingToHelp");
  const parts = [`Helped ${summary.helped}`];
  if (summary.secondsSaved > 0) parts.push(`-${savedText(summary.secondsSaved)}`);
  const earned = shortReward(summary.reward);
  if (earned) parts.push(earned);
  return parts.join(" · ");
};
