/**
 * The owner's side of a help (`docs/design/friends.md` §3.3, issue #374): a
 * friend took time off a job or repaired a building while the owner sits in
 * their own yard, whose countdowns and health are then out of date.
 *
 * The presence ping's answer carries `helped`, when the player's main yard
 * was last helped (unix seconds, for ten minutes after). A time later than
 * the last one heard, and later than the yard's load, means a help landed
 * since the yard was read, so the yard asks the server again. The bell's
 * count comes back with that answer, so the notification shows too.
 */

/** The `helped` time of a presence answer, or null when it has none. */
export const helpedOf = (answer: unknown): number | null => {
  if (answer === null || typeof answer !== "object") return null;
  const value = Number((answer as { helped?: unknown }).helped);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export class HelpedWatch {
  private last: number;

  /**
   * @param since - When the yard was read, unix seconds: a help before it is
   *   already in the yard.
   * @param onHelped - Reads the yard again.
   */
  constructor(
    since: number,
    private readonly onHelped: () => void,
  ) {
    this.last = since;
  }

  /** One presence answer. */
  hear(answer: unknown): void {
    const at = helpedOf(answer);
    if (at === null || at <= this.last) return;
    this.last = at;
    this.onHelped();
  }
}
