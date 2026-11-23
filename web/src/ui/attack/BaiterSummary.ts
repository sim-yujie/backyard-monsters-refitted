import type { AttackSessionState } from "@/game/attack/AttackSession";
import type { BaiterRun } from "@/game/baiter/baiterSession";
import { formatAmount } from "@/ui/format";
import "@/ui/styles/baiter.css";

/**
 * The Baiter scene's dock line (issue #126): what is attacking while it
 * runs. The report when it is over is `TestReport.ts` (#22, WP4).
 */

/**
 * What the test is, in words: nothing is lost or saved, and who gets the
 * replay. Shown once as the test opens, as a notice that goes by itself
 * (`baiterPlugin.ts`), not in the dock, where it took the army's room.
 */
export const baiterNote = (run: BaiterRun, replay = false): string => {
  const friend = run.friend;
  return friend?.role === "tester"
    ? replay
      ? `Replay of your test of ${friend.inviter.name}'s yard. Nothing is saved.`
      : `A test of ${friend.inviter.name}'s yard: nothing is lost or won by either of you. They get the replay.`
    : friend?.role === "owner"
      ? `${friend.tester}'s test of your yard, as it was then. Nothing was lost.`
      : replay
        ? "Replay of a test, on your yard as it was then. Nothing is saved."
        : "Test attack: nothing is saved. Your yard, its traps and your resources stay as they are.";
};

/**
 * The thin bar at the top of the dock, above the army panel (#22, WP3): the
 * bar's plate like the attack strip and the status line, no frame or title
 * plate (beta 9 play-test, 23 Nov 2026: as a framed window named "Test
 * attack" with the note and "18 monsters. Tap the yard to drop them." it took
 * about 190 px of the dock and left one army row in sight).
 *
 * Before the first drop it holds the test's note, shown only in a phone's
 * sheet (baiter.css), where the strip has no room to name the test; wider
 * screens have the strip's name and the note's notice, and no bar until then.
 * From the first drop on it keeps the running count. On a short screen it
 * never shows. The army itself, each row at its level, is in the panel below.
 */
export class BaiterDock {
  readonly element: HTMLElement;
  private readonly progress: HTMLElement;

  /** `replay`: a finished test played back (#22, WP5), on the yard as it was then. */
  constructor(run: BaiterRun, replay = false) {
    this.element = document.createElement("section");
    this.element.className = "baiter-dock";
    this.element.setAttribute("aria-label", replay ? "Test replay" : "Test attack");

    const note = document.createElement("p");
    note.className = "baiter__note baiter-dock__note";
    note.textContent = baiterNote(run, replay);

    this.progress = document.createElement("p");
    this.progress.className = "baiter__figures";
    this.progress.setAttribute("aria-live", "polite");
    this.progress.hidden = true;

    this.element.append(note, this.progress);
  }

  /** Goes first in the dock, above the army panel. */
  mount(container: HTMLElement): this {
    container.prepend(this.element);
    return this;
  }

  update(state: AttackSessionState): void {
    // Nothing dropped yet: no count to keep.
    const started = state.phase === "ended" || state.creepsAlive > 0 || state.creepsKilled > 0;
    if (!started) return;
    // Once it is over the battle is put to rest (#308), so nothing is still attacking.
    const attacking = state.phase === "ended" ? "Over" : `${formatAmount(state.creepsAlive)} attacking`;
    this.progress.textContent =
      `${attacking} · ${formatAmount(state.creepsKilled)} beaten · ${Math.floor(state.damagePercent)}% damage`;
    this.progress.hidden = false;
    this.element.classList.add("baiter-dock--started");
  }

  destroy(): void {
    this.element.remove();
  }
}
