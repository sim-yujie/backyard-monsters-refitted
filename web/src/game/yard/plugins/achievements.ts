import { markAchievementsSeen, markSeenAction } from "@/api/achievements";
import type { Onboarding } from "@/api/types";
import { achievementsOpener } from "@/game/achievements/achievementsView";
import { unlockInbox, type UnlockInbox } from "@/game/achievements/unlockInbox";
import { YardChangeReason, type YardChange } from "@/game/yard/YardStore";
import { UnlockPopup } from "@/ui/achievements/UnlockPopup";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the achievement unlock pop-up (`docs/design/achievements.md`
 * §10.2, issue #204, WP6).
 *
 * The own yard's load and every yard answer carry `achievements`, the paid
 * unlocks not yet shown (only while the server's `ACHIEVEMENT_REWARDS` is on;
 * absent otherwise, which is nothing to show). They join the tab's
 * {@link unlockInbox}, where a takeover's answer may already have put some,
 * and come up one card at a time. Each card shown is reported through
 * `bm/yard/achievements/seen`, so no later answer carries it; a call that got
 * no answer is tried again after the yard's next answer.
 *
 * Nothing comes up while Bob's guided start is still to run or running: the
 * cards wait for it to end, so none covers a tutorial step. The HUD's Shiny
 * readout needs nothing here: the same answer's `credits` moves it.
 */

/** Whether the guided start is still to run or running: the cards wait. */
export const guideOpen = (onboarding: Onboarding | null | undefined): boolean =>
  onboarding?.guide.state === "pending" || onboarding?.guide.state === "active";

export class UnlockPopupDoor {
  readonly popup: UnlockPopup;

  private readonly mounts: Pick<YardMounts, "store" | "overlay">;
  private readonly inbox: UnlockInbox;
  private readonly send: typeof markAchievementsSeen;
  private readonly unsubscribe: () => void;
  /** A `seen` call is out. */
  private confirming = false;
  /** The last `seen` got no answer: try again after the yard's next one. */
  private retry = false;
  private destroyed = false;

  constructor(
    mounts: Pick<YardMounts, "store" | "overlay">,
    inbox: UnlockInbox = unlockInbox,
    send: typeof markAchievementsSeen = markAchievementsSeen,
  ) {
    this.mounts = mounts;
    this.inbox = inbox;
    this.send = send;
    this.popup = new UnlockPopup({
      inbox,
      onShown: (card) => {
        inbox.shown(card);
        void this.confirm();
      },
      opener: achievementsOpener,
    });
    mounts.overlay.content.append(this.popup.element);
    this.popup.hold(guideOpen(mounts.store.save.onboarding));
    this.unsubscribe = mounts.store.subscribe((change) => this.onStore(change));
    // The load the yard opened with, then anything an earlier yard showed and never confirmed.
    inbox.add(mounts.store.save.achievements);
    this.popup.pump();
    void this.confirm();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.popup.destroy();
  }

  private onStore(change: YardChange): void {
    if (this.destroyed) return;
    this.popup.hold(guideOpen(this.mounts.store.save.onboarding));
    this.inbox.add(change.achievements);
    const answered = change.reason === YardChangeReason.ACTION || change.reason === YardChangeReason.REFRESH;
    if (answered && this.retry) {
      this.retry = false;
      void this.confirm();
    }
  }

  /** Sends `seen` for every card shown and not yet confirmed, one call at a time. */
  private async confirm(): Promise<void> {
    if (this.confirming || this.destroyed) return;
    const ids = this.inbox.toConfirm();
    if (ids.length === 0) return;
    this.confirming = true;
    const result = await markSeenAction(this.mounts.store, ids, this.send);
    this.confirming = false;
    const status = result.ok ? 200 : (result.refusal.status ?? 0);
    if (status >= 200 && status < 500) {
      // Done with, either way: a 4xx is the server's "no" for good (a
      // malformed list), and asking again would only be refused again.
      this.inbox.confirmed(ids);
    } else {
      this.retry = true;
      return;
    }
    // Cards shown while the call was out.
    void this.confirm();
  }
}

export const achievementsPlugin: YardPlugin = (mounts) => {
  const door = new UnlockPopupDoor(mounts);
  return () => door.destroy();
};

YARD_PLUGINS.push(achievementsPlugin);
