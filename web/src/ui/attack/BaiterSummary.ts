import type { AttackSessionState } from "@/game/attack/AttackSession";
import { picksOf, type BaiterRun } from "@/game/baiter/baiterSession";
import { championEntry } from "@/game/yard/championCatalogue";
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
 * The line at the top of the dock, above the army panel (#22, WP3): one
 * line, a thin bar like the attack strip and the status line, with no frame
 * or title plate (beta 9 play-test, 23 Nov 2026: as a framed window named
 * "Test attack", with the note above, it took about 190 px of the dock and
 * left one army row in sight; the strip above already names the test).
 * Before the first drop it says how many monsters there are and how to drop
 * them; from then on the running count takes its place. The army itself,
 * each row at its level, is in the army panel below it.
 */
export class BaiterDock {
  readonly element: HTMLElement;
  private readonly army: HTMLElement;
  private readonly progress: HTMLElement;

  /** `replay`: a finished test played back (#22, WP5), on the yard as it was then. */
  constructor(run: BaiterRun, replay = false) {
    this.element = document.createElement("section");
    this.element.className = "baiter-dock";
    this.element.setAttribute("aria-label", replay ? "Test replay" : "Test attack");

    this.army = document.createElement("p");
    this.army.className = "baiter__note baiter-dock__army";
    const sent = Object.values(picksOf(run.army)).reduce((sum, count) => sum + count, 0);
    const champions = run.army.champions.map((champion) => championEntry(champion.t)?.name ?? "Champion");
    this.army.textContent =
      `${formatAmount(sent)} monsters` + (champions.length > 0 ? ` and ${champions.join(" and ")}` : "") +
      (replay ? "." : ". Tap the yard to drop them.");

    this.progress = document.createElement("p");
    this.progress.className = "baiter__figures";
    this.progress.setAttribute("aria-live", "polite");
    this.progress.hidden = true;

    this.element.append(this.army, this.progress);
  }

  /** Goes first in the dock, above the army panel. */
  mount(container: HTMLElement): this {
    container.prepend(this.element);
    return this;
  }

  update(state: AttackSessionState): void {
    // Nothing dropped yet: the army line stays, saying how to start.
    const started = state.phase === "ended" || state.creepsAlive > 0 || state.creepsKilled > 0;
    if (!started) return;
    // Once it is over the battle is put to rest (#308), so nothing is still attacking.
    const attacking = state.phase === "ended" ? "Over" : `${formatAmount(state.creepsAlive)} attacking`;
    this.progress.textContent =
      `${attacking} · ${formatAmount(state.creepsKilled)} beaten · ${Math.floor(state.damagePercent)}% damage`;
    this.progress.hidden = false;
    this.army.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}
