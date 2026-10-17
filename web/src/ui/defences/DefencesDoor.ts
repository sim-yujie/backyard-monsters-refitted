import { defencesApi, type Defence, type DefencesApi } from "@/api/defences";
import { openDefence } from "@/game/defences/openDefence";
import type { DefenceWatch } from "@/game/defences/defenceWatch";
import { DefencesButton } from "./DefencesButton";
import { DefencesScreen, LOAD_FAILED_TEXT } from "./DefencesScreen";

/**
 * The own yard's way into its defences (#363): the Defences button, the
 * screen behind it (made the first time it opens), and Watch.
 *
 * Every open fetches the list again, so a defence that landed since shows.
 * Watch fetches that defence's battle and checks it can be played here
 * (`openDefence`); the scene then plays it on the watch scene (`onWatch`).
 * A replay refused after all says why on its row instead.
 */

export interface DefencesDoorOptions {
  /** Where the screen docks: the scene's overlay content. */
  readonly container: HTMLElement;
  /** Before the screen opens: the scene closes whatever else docks there. */
  readonly onOpen?: () => void;
  /** A replay to play: the scene hands it to the watch scene. */
  readonly onWatch: (run: DefenceWatch) => void;
  /** The routes, for a test. */
  readonly api?: DefencesApi;
  /** Unix seconds now, for a test. */
  readonly now?: () => number;
}

export class DefencesDoor {
  readonly button: DefencesButton;

  private readonly options: DefencesDoorOptions;
  private readonly api: DefencesApi;
  private screen: DefencesScreen | null = null;
  private destroyed = false;
  /** Bumped by every fetch, so an answer that arrives late is dropped. */
  private generation = 0;

  constructor(options: DefencesDoorOptions) {
    this.options = options;
    this.api = options.api ?? defencesApi;
    this.button = new DefencesButton(() => this.toggle());
  }

  get isOpen(): boolean {
    return this.screen?.isOpen ?? false;
  }

  /** The list as it was last shown, for a test. */
  get shown(): readonly Defence[] | null {
    return this.screen?.defences ?? null;
  }

  /** Whether the player has defences to show: a Map Room 2 player. */
  setAvailable(available: boolean): void {
    this.button.setAvailable(available);
    if (!available) this.close();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else void this.open();
  }

  async open(): Promise<void> {
    if (this.destroyed) return;
    this.options.onOpen?.();
    this.ensureScreen().open();
    await this.refresh();
  }

  close(): void {
    this.screen?.close();
  }

  /**
   * Watch one defence by id, from the list or an attack notice. Null when it
   * is on its way to the watch scene; otherwise the words to show instead.
   */
  async watch(id: number): Promise<string | null> {
    const opening = await openDefence(id, this.api);
    if (this.destroyed) return null;
    if ("refusal" in opening) return opening.refusal;
    this.options.onWatch(opening.run);
    return null;
  }

  destroy(): void {
    this.destroyed = true;
    this.screen?.destroy();
    this.screen = null;
    this.button.destroy();
  }

  private ensureScreen(): DefencesScreen {
    this.screen ??= new DefencesScreen({
      onWatch: (defence) => void this.watchRow(defence),
      onClose: (hadFocus) => {
        if (hadFocus) this.button.element.focus();
      },
      ...(this.options.now ? { now: this.options.now } : {}),
    }).mount(this.options.container);
    return this.screen;
  }

  private async watchRow(defence: Defence): Promise<void> {
    const screen = this.screen;
    if (!screen) return;
    screen.setBusy(defence.id);
    const refusal = await this.watch(defence.id);
    if (this.destroyed) return;
    if (refusal) screen.refuse(defence.id, refusal);
    else screen.setBusy(null);
  }

  private async refresh(): Promise<void> {
    const screen = this.screen;
    if (!screen) return;
    const generation = ++this.generation;
    try {
      const defences = await this.api.list();
      if (this.destroyed || generation !== this.generation) return;
      screen.show(defences);
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      screen.setStatus(LOAD_FAILED_TEXT);
    }
  }
}
