import type { Defence, DefenceLoot } from "@/api/defences";
import type { AttackSessionState } from "@/game/attack/AttackSession";
import { lootTakenOf } from "@/game/defences/defenceWatch";
import { agoText } from "@/ui/attack/autoAttackText";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, RESOURCE_NAMES } from "@/ui/resourceIcon";

/**
 * A defence replay's two pieces of UI (issue #362,
 * `docs/design/defence-replays.md` §7): the dock while another player's
 * attack on the player's yard plays back, and the result when it is over.
 * The controls are the owner's (decision 3): 1x / 2x / 4x, on the strip, and
 * Skip to end, here. No pause, no Retreat, no revenge. The result is the one
 * stored when the attack landed, never the engine's own figure.
 */

/** "1,234 Twigs and 500 Goo", or "" when nothing was taken, as the attack notice says it (held to the cap). */
export const lootText = (loot: DefenceLoot): string => {
  const taken = lootTakenOf(loot);
  const parts = RESOURCE_KEYS.flatMap((key) => {
    const amount = taken[key];
    return Number.isFinite(amount) && amount > 0 ? [`${amount.toLocaleString("en-GB")} ${RESOURCE_NAMES[key]}`] : [];
  });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
};

/**
 * The stored result in words: "Bramble attacked your yard and did 35% damage.
 * 1,234 Twigs were looted.", the housed monsters lost worded as the attack
 * notice words them, and "They left the attack." when they did.
 */
export const defenceResultText = (
  defence: Pick<Defence, "attacker" | "damageDone" | "loot" | "housedLost" | "left">,
): string => {
  const damage = Math.max(0, Math.round(defence.damageDone));
  const taken = lootText(defence.loot);
  const looted = taken === "" ? "Nothing was looted" : `${taken} were looted`;
  const lost = Math.max(0, Math.floor(defence.housedLost));
  const losses =
    lost === 0 ? `${looted}.` : `${looted}, and ${lost} housed ${lost === 1 ? "monster was" : "monsters were"} lost.`;
  return (
    `${defence.attacker.name} attacked your yard and did ${damage}% damage. ${losses}` +
    (defence.left ? " They left the attack." : "")
  );
};

/** "3 h ago", with the full date for a hover title. */
const whenOf = (landedAt: number, nowSeconds: number): { text: string; title: string } => ({
  text: agoText(nowSeconds - landedAt),
  title: new Date(landedAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
});

export interface DefenceDockOptions {
  readonly defence: Defence;
  readonly onSkip: () => void;
  /** Unix seconds now, for "3 h ago"; the wall clock by default. */
  readonly nowSeconds?: number;
}

/** The docked panel: whose attack is playing, when it was, and Skip to end. */
export class DefenceDock {
  readonly element: HTMLElement;
  private readonly panel: Panel;
  private readonly progress: HTMLElement;
  private readonly skip: HTMLButtonElement;

  constructor(options: DefenceDockOptions) {
    const { defence } = options;
    this.panel = new Panel({
      title: `Defence replay: ${defence.attacker.name}`,
      closable: false,
      className: "map-panel watch-dock defence-dock",
    });
    this.element = this.panel.element;

    const what = document.createElement("p");
    what.className = "watch__note defence-dock__when";
    const when = whenOf(defence.landedAt, options.nowSeconds ?? Math.floor(Date.now() / 1000));
    what.textContent = `${defence.attacker.name} attacked your yard ${when.text}.`;
    what.title = when.title;

    this.progress = document.createElement("p");
    this.progress.className = "watch__figures";
    this.progress.setAttribute("aria-live", "polite");

    this.skip = document.createElement("button");
    this.skip.type = "button";
    this.skip.className = "btn btn--ghost defence-dock__skip";
    this.skip.textContent = "Skip to end";
    this.skip.title = "Show how the attack ended";
    this.skip.addEventListener("click", () => options.onSkip());

    const note = document.createElement("p");
    note.className = "u-muted watch__note";
    note.textContent = "Only a replay: the result was saved when the attack landed.";

    this.panel.setContent(what, this.progress, this.skip, note);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  update(state: AttackSessionState, skipping: boolean): void {
    this.progress.textContent = skipping
      ? "Skipping to the end…"
      : `${formatAmount(state.creepsAlive)} attacking · ${formatAmount(state.creepsKilled)} lost · ` +
        `${Math.floor(state.damagePercent)}% damage`;
    this.skip.disabled = skipping || state.phase === "ended";
  }

  destroy(): void {
    this.panel.close();
  }
}

export interface DefenceResultOptions {
  readonly defence: Defence;
  readonly onAgain: () => void;
  readonly onBack: () => void;
}

/** The end of a defence replay: the stored result, Watch again and Back. */
export class DefenceResultPanel {
  readonly element: HTMLElement;
  private readonly panel: Panel;

  constructor(options: DefenceResultOptions) {
    const { defence } = options;
    this.element = document.createElement("div");
    this.element.className = "popup-backdrop attack-end__backdrop";
    this.panel = new Panel({
      title: "Defence replay over",
      closable: false,
      className: "map-panel attack-end watch-summary defence-result",
    });
    this.panel.element.setAttribute("role", "dialog");
    this.panel.element.setAttribute("aria-modal", "true");

    const outcome = document.createElement("p");
    outcome.className = "attack-end__outcome defence-result__text";
    outcome.textContent = defenceResultText(defence);

    const note = document.createElement("p");
    note.className = "u-muted";
    note.textContent = "This was a replay. The result was saved when the attack landed.";

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--ghost watch-summary__again";
    again.textContent = "Watch again";
    again.addEventListener("click", options.onAgain);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--primary watch-summary__back";
    back.textContent = "Back";
    back.addEventListener("click", options.onBack);

    const actions = document.createElement("div");
    actions.className = "attack-end__actions";
    actions.append(again, back);

    this.panel.setContent(outcome, note, actions);
    this.element.append(this.panel.element);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    this.element.querySelector<HTMLButtonElement>(".watch-summary__back")?.focus();
    return this;
  }

  close(): void {
    this.panel.close();
    this.element.remove();
  }
}
