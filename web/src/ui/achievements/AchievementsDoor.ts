import type { AchievementsApi } from "@/api/achievements";
import { AchievementsScreen } from "./AchievementsScreen";

/**
 * A screen's way into the achievements screen (issue #204, §10.1): the
 * screen, made and docked the first time it opens. It has no button of its
 * own: the Account menu's "Achievements" item opens the player's list on
 * every screen with the HUD, the unlock pop-up's View (WP6) does the same,
 * and the map's panels (WP7) open another player's read-only list.
 */

export interface AchievementsDoorOptions {
  /** Where the screen docks: the scene's overlay content, looked up when it first opens. */
  readonly container: () => HTMLElement | null;
  /** Before the screen opens: the scene closes whatever else docks there. */
  readonly onOpen?: () => void;
  /** After it closes, when focus was inside it: the opener takes focus back. */
  readonly onClosedWithFocus?: () => void;
  /** The routes, for a test. */
  readonly api?: AchievementsApi;
}

export class AchievementsDoor {
  private readonly options: AchievementsDoorOptions;
  private screen: AchievementsScreen | null = null;

  constructor(options: AchievementsDoorOptions) {
    this.options = options;
  }

  get isOpen(): boolean {
    return this.screen?.isOpen ?? false;
  }

  /** The player's own list. */
  async open(): Promise<void> {
    const screen = this.ensureScreen();
    if (!screen) return;
    this.options.onOpen?.();
    await screen.open();
  }

  /** Another player's list, read-only. */
  async openPlayer(userid: number, name?: string | null): Promise<void> {
    const screen = this.ensureScreen();
    if (!screen) return;
    this.options.onOpen?.();
    await screen.openPlayer(userid, name);
  }

  close(): void {
    this.screen?.close();
  }

  destroy(): void {
    this.screen?.destroy();
    this.screen = null;
  }

  private ensureScreen(): AchievementsScreen | null {
    if (this.screen) return this.screen;
    const container = this.options.container();
    if (!container) return null;
    this.screen = new AchievementsScreen({
      ...(this.options.api ? { api: this.options.api } : {}),
      onClose: (hadFocus) => {
        if (hadFocus) this.options.onClosedWithFocus?.();
      },
    }).mount(container);
    return this.screen;
  }
}
