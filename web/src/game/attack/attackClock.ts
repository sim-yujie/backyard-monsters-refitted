import type { AttackSessionState } from "./AttackSession";

/** Below this many seconds the countdown reads as a warning (§F7). */
export const WARNING_SECONDS = 60;

/** `m:ss`, the countdown's spelling. */
export const formatClock = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
};

/** What the strip's clock says, and how it looks. */
export interface ClockReading {
  readonly text: string;
  /** A hover title explaining the reading; empty for the plain countdown. */
  readonly title: string;
  /** Near the end, or past it: drawn as a warning. */
  readonly warning: boolean;
  /** The countdown has run out and the monsters are pulling back (#149). */
  readonly grace: boolean;
}

/**
 * The clock for a session state.
 *
 * The countdown runs to 0:00, and then the attack is not over yet: the
 * monsters pull back for up to `RETREAT_GRACE_SECONDS` (120), and the engine
 * stops the attack when the last of them is gone or that runs out
 * (`engine.ts`, `ATTACK.as:237-240`). Sitting at 0:00 through that told the
 * player nothing (#149), so the grace is labelled and counted down on its
 * own, from the session's `hardStopSeconds`.
 */
export const clockReading = (
  state: Pick<AttackSessionState, "phase" | "remainingSeconds" | "hardStopSeconds">,
): ClockReading => {
  if (state.phase === "ended") return { text: "0:00", title: "", warning: false, grace: false };
  if (state.remainingSeconds <= 0 && state.hardStopSeconds > 0) {
    const left = formatClock(state.hardStopSeconds);
    return {
      text: `Retreating ${left}`,
      title: `Time is up: your monsters are pulling back. The attack ends when they are gone, or in ${left}.`,
      warning: true,
      grace: true,
    };
  }
  return {
    text: formatClock(state.remainingSeconds),
    title: "",
    warning: state.remainingSeconds <= WARNING_SECONDS,
    grace: false,
  };
};
