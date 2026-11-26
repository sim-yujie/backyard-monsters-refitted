/**
 * "Last seen" on the friends list and the alliance Members tab (owner, 25 Nov
 * 2026, beta 9): five rough steps, never a time. The server works the step
 * out (`server/src/services/user/seenStep.ts`); null is a player who hides
 * their online status and is still active, so nothing shows for them.
 */
export const SEEN_STEPS = ["online", "today", "week", "weeks", "month"] as const;

export type SeenStep = (typeof SEEN_STEPS)[number];

const STEPS: ReadonlySet<string> = new Set(SEEN_STEPS);

/** A step as the server sent it; anything else (or an older server's "away") is read as nothing shown. */
export const seenStepFrom = (value: unknown): SeenStep | null =>
  typeof value === "string" && STEPS.has(value) ? (value as SeenStep) : null;
