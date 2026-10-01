import { guideApi, type GuideApi } from "@/api/guide";
import type { YardResponse } from "@/api/types";
import type { Mr1World } from "@/game/maproom1/mr1Model";
import { GuideOverlay, type GuideStep } from "@/ui/guide/GuideOverlay";
import "@/ui/styles/guide-start.css";
import { guideBus } from "./guideBus";
import { PRACTICE_CAMP_BASEID } from "./practiceBox";
import { dotsFor, isGuideStep, LINES, type GuideStepName } from "./steps";
import { findTarget, TutTarget } from "./targets";

/**
 * Bob on Map Room 1 during the guided start (issue #227,
 * `docs/design/tutorial.md` §2.3 steps 13 to 16, §5.6): the map opens with
 * the practice camp glowing, Bob points at it and then at Attack, and when
 * the player comes back from the attack he either cheers and sends them home
 * (won) or, worried, gives them a fresh squad for a free retry (lost,
 * retreated or quit).
 *
 * The Map Room 1 read carries the guide's step while the camp is open
 * (`practice.step`); this asks the guide's routes directly, as the map has no
 * yard store, and re-reads the map after each so Bob follows the server.
 */

export interface Mr1GuideHooks {
  /** Back to the own yard (after the win). */
  readonly goHome: () => void;
  /** Reads the map again. */
  readonly refresh: () => void;
}

/** How often the screen is looked at again (the card opening and closing), ms. */
const POLL_MS = 250;

type Outcome = "won" | "lost" | null;

export class Mr1Guide {
  private readonly overlay: GuideOverlay;
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private step: GuideStepName | null = null;
  private outcome: Outcome = null;
  private picked: string | null = null;
  private busy = false;
  private asking = false;
  private shownKey: string | null = null;
  /** Steps already asked to move on, so a refresh does not ask twice. */
  private readonly asked = new Set<string>();

  constructor(
    layer: HTMLElement,
    private readonly hooks: Mr1GuideHooks,
    private readonly api: GuideApi = guideApi,
  ) {
    this.overlay = new GuideOverlay(layer);
    this.unsubscribe = guideBus.on("targetPicked", ({ baseid }) => {
      this.picked = baseid;
      this.render();
    });
    this.timer = setInterval(() => this.render(), POLL_MS);
  }

  /** Every map answer: the guide's step while the camp is open, or none. */
  update(world: Mr1World): void {
    const step = isGuideStep(world.guideStep) ? world.guideStep : null;
    // A win removes the camp from the map: Bob keeps cheering until home.
    if (step === null && this.outcome !== "won") this.step = null;
    if (step !== null) this.step = step;
    this.shownKey = null;
    this.render();
    if (step === "open-map") void this.move("open-map");
    if ((step === "attack" || step === "attack-result") && this.outcome === null) void this.resolve(step);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.unsubscribe();
    this.overlay.destroy();
  }

  private render(): void {
    if (this.asking) return;
    const view = this.view();
    const key = view ? `${view.key}` : "none";
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (!view) this.overlay.hide();
    else this.overlay.show(view.step);
  }

  private line(step: GuideStepName, line: Omit<GuideStep, "dots" | "skip">): GuideStep {
    return { ...line, dots: dotsFor(step), skip: { label: "Skip", onClick: () => this.askSkip() } };
  }

  private view(): { key: string; step: GuideStep } | null {
    if (this.outcome === "won") {
      return {
        key: "won",
        step: {
          text: LINES.wonHome,
          dots: dotsFor("attack-result"),
          actions: [{ label: "Home", primary: true, onClick: () => this.hooks.goHome() }],
        },
      };
    }
    if (this.outcome === "lost") {
      return {
        key: "lost",
        step: this.line("attack-result", {
          text: LINES.lost,
          mood: "worried",
          actions: [{ label: "Try again", primary: true, onClick: () => void this.retry() }],
        }),
      };
    }
    switch (this.step) {
      case "open-map":
      case "pick-camp": {
        const carded = this.picked === PRACTICE_CAMP_BASEID && findTarget(TutTarget.TARGET_ATTACK) !== null;
        return carded
          ? { key: "attack", step: this.line("pick-camp", { text: LINES.tapAttack, target: TutTarget.TARGET_ATTACK }) }
          : { key: "camp", step: this.line("pick-camp", { text: LINES.pickCamp, target: TutTarget.MR1_PRACTICE }) };
      }
      case "attack":
      case "attack-result":
        return { key: "wait", step: this.line(this.step, { text: LINES.checking }) };
      default:
        return null;
    }
  }

  /** The step the answer's summary says, or null. */
  private stepOf(answer: YardResponse<unknown>): GuideStepName | null {
    const step = answer.onboarding?.guide.step;
    return isGuideStep(step) ? step : null;
  }

  private async move(from: GuideStepName): Promise<void> {
    if (this.busy || this.asked.has(from)) return;
    this.asked.add(from);
    this.busy = true;
    try {
      const answer = await this.api.advance(from);
      this.step = this.stepOf(answer) ?? this.step;
    } catch {
      this.hooks.refresh();
    } finally {
      this.busy = false;
      this.shownKey = null;
      this.render();
    }
  }

  /** Back from the attack: the server's copy of the camp says won or lost. */
  private async resolve(from: "attack" | "attack-result"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.api.advance(from);
      const step = this.stepOf(answer);
      this.outcome = step === "attack-result" ? "lost" : "won";
      if (this.outcome === "won") this.step = null;
    } catch {
      this.hooks.refresh();
    } finally {
      this.busy = false;
      this.shownKey = null;
      this.render();
    }
  }

  /** The free retry (§5.6): 15 Pokeys again and the camp at full health. */
  private async retry(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const answer = await this.api.army();
      this.step = this.stepOf(answer) ?? "pick-camp";
      this.outcome = null;
      this.picked = null;
      this.asked.clear();
    } catch {
      // Refused (the camp was beaten after all, or the guide ended): the map says where we are.
      this.outcome = null;
    } finally {
      this.busy = false;
      this.shownKey = null;
      this.hooks.refresh();
      this.render();
    }
  }

  private askSkip(): void {
    this.asking = true;
    this.shownKey = "skip-ask";
    this.overlay.show({
      text: LINES.skipAsk,
      mood: "worried",
      actions: [
        {
          label: "Keep going",
          onClick: () => {
            this.asking = false;
            this.shownKey = null;
            this.render();
          },
        },
        {
          label: "Skip",
          primary: true,
          onClick: () => {
            this.asking = false;
            void this.skip();
          },
        },
      ],
    });
  }

  private async skip(): Promise<void> {
    try {
      await this.api.skip();
    } catch {
      // Already over: nothing to skip.
    }
    this.step = null;
    this.outcome = null;
    this.shownKey = null;
    this.overlay.hide();
    this.hooks.refresh();
  }
}
