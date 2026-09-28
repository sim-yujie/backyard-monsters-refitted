import { saveAttack } from "@/api/base";
import { ApiError, NetworkError, getAuthToken } from "@/api/http";
import type { AttackSavePayload, BaseSaveResponse } from "@/api/types";
import { ATTACK_PLUGINS, type AttackMounts, type AttackPlugin } from "@/game/attack/attackPlugins";
import { buildAttackSave, forKeepalive, summariseAttack } from "@/game/attack/attackSave";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { EndAttackPanel, type SaveFailure } from "@/ui/attack/EndAttackPanel";

/**
 * Attack-scene plugin for the "end" work package (issue #32, WP6).
 *
 * Two jobs. When the session ends — destroyed, exhausted, expired or a
 * retreat, all decided by `AttackSession` itself — build the final save from
 * it, send it exactly once, and show the {@link EndAttackPanel} over the
 * yard while it goes (§F6). And while the attack runs, warn a margin before
 * the server's 420-second save window closes (§7, Q2): the window is wall
 * time from the attack load, not battle time, so the check is on the clock
 * here rather than on the session's countdown — at 2x the two disagree, and
 * a Declare War attack's 420-second countdown alone would already run past
 * it.
 *
 * The save is sent once per attack. A success clears the defender's
 * `attackid` and ends the server's session, so a second send could only be
 * refused; the guard here is what makes a retry safe, because a retry is
 * offered only after a failure.
 *
 * Leaving the attack screen ends the attack (issue #138): a reload, a closed
 * tab or browser Back (`pagehide`), or the scene being torn down by in-app
 * navigation or a sign-out. A hidden tab — another tab, a minimised window, a
 * locked phone — is not leaving and ends nothing (owner, #138); the page is
 * still there and the player may come back to it. The session ends where it
 * stands (`AttackSession.leave`) and the save goes as a keepalive request,
 * which the browser lets finish after the page is gone, exactly once. If the
 * ordinary save was already on its way, the keepalive copy is sent too, since
 * a closing page cuts an ordinary request off; the server lands whichever
 * arrives first and refuses the other (`baseSave.ts`, the final lock). An
 * attack with nothing dropped still sends nothing (#79). A keepalive that
 * never arrives is covered by the server finishing the attack from its last
 * checkpoint (`server/src/services/base/finaliseAttack.ts`).
 *
 * The save goes the moment the attack ends; the panel waits until the screen
 * has caught up (#148). A winning bomb ends the battle on the tick it is fired,
 * while its particles take a few seconds to fall: the panel opens once the
 * battle layer says the rain is down (`AttackMounts.presentation`), or after
 * {@link END_PANEL_MAX_WAIT_MS} whatever it says, and shows the save's
 * progress as it stands by then.
 */

/** How long the server accepts this attack's save, from the attack load. */
export const SESSION_WINDOW_SECONDS = 420;
/** How early to warn (§7, Q2's "short margin"). */
export const WINDOW_MARGIN_SECONDS = 30;
/** The longest the end panel waits for the screen to catch up (#148). */
export const END_PANEL_MAX_WAIT_MS = 6000;
/** How often the wait looks again. */
const END_PANEL_POLL_MS = 100;

/** Where the save stands, for a panel that opens after it started (#148). */
type SaveShown =
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly protectedUntil: number | null; readonly now: number }
  | { readonly kind: "failed"; readonly failure: SaveFailure }
  | { readonly kind: "unsent" };

const showOn = (panel: EndAttackPanel, shown: SaveShown): void => {
  switch (shown.kind) {
    case "saving":
      panel.setSaving();
      return;
    case "saved":
      panel.setSaved({ protectedUntil: shown.protectedUntil, now: shown.now });
      return;
    case "failed":
      panel.setFailed(shown.failure);
      return;
    case "unsent":
      panel.setNothingSent();
      return;
  }
};

/** What the plugin needs that it would otherwise take from the app. */
export interface EndPluginDeps {
  readonly save?: (payload: AttackSavePayload) => Promise<BaseSaveResponse>;
  /**
   * The save sent as the page goes. A keepalive `saveAttack`, slimmed to fit
   * (`forKeepalive`), with the token as it was when the attack opened — a
   * sign-out clears the live one before the scene is torn down.
   */
  readonly saveOnLeave?: (payload: AttackSavePayload, token: string | null) => Promise<BaseSaveResponse>;
  /** Where `pagehide` is heard; the page by default. */
  readonly page?: { readonly window: Window };
  /** Wall-clock milliseconds; `Date.now` by default. */
  readonly now?: () => number;
  /** Display names for the attack report; the army panel's table by default. */
  readonly nameOf?: (id: string) => string;
}

/**
 * The refusal reasons a retry cannot fix: the attack-binding ones
 * (`docs/server-api.md` "Attack session binding") and a bomb the attacker could
 * not have fired (`bombSpend`, issue #90), which the same payload would hit again.
 */
const FINAL_REASONS = new Set([
  "expired",
  "no-session",
  "wrong-attacker",
  "stale-attack",
  "bombSpend",
  "finalising",
]);

/** The refusal's `reason`, when the error carries one. */
const bindingReason = (error: ApiError): string | null => {
  const data = error.details?.data;
  if (typeof data !== "object" || data === null) return null;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
};

/** Turns a failed save into what the panel says (§4.7). */
export const describeSaveFailure = (caught: unknown): SaveFailure => {
  if (caught instanceof NetworkError) {
    return { message: "Could not reach the server to save the result.", canRetry: true };
  }
  if (caught instanceof ApiError) {
    const reason = bindingReason(caught);
    if (reason === "expired") {
      return {
        message:
          "This attack expired before it could be saved: the server accepts a result " +
          `for ${SESSION_WINDOW_SECONDS / 60} minutes after an attack starts.`,
        canRetry: false,
      };
    }
    if (reason && FINAL_REASONS.has(reason)) {
      return { message: `The server refused the result: ${caught.message}`, canRetry: false };
    }
    return { message: `The result was not saved: ${caught.message}`, canRetry: true };
  }
  return {
    message: caught instanceof Error ? `The result was not saved: ${caught.message}` : "The result was not saved.",
    canRetry: true,
  };
};

/** The defender's protection expiry from the save's envelope, if it has one. */
const protectedUntilOf = (response: BaseSaveResponse): number | null => {
  const value = (response as { protected?: unknown }).protected;
  return typeof value === "number" ? value : null;
};

export const createEndPlugin = (deps: EndPluginDeps = {}): AttackPlugin => {
  const save = deps.save ?? saveAttack;
  const saveOnLeave =
    deps.saveOnLeave ??
    ((payload: AttackSavePayload, token: string | null) =>
      saveAttack(forKeepalive(payload), { keepalive: true, token }));
  const now = deps.now ?? (() => Date.now());
  const nameOf = deps.nameOf ?? monsterName;

  return (mounts: AttackMounts) => {
    const { session, modal, notices, goToMap, presentation } = mounts;
    const page = deps.page ?? { window };
    const mountedAt = now();
    const token = getAuthToken();
    let warned = false;
    let ended = false;
    let saved = false;
    let inFlight = false;
    /** The player is leaving the screen: the end in progress is theirs. */
    let leaving = false;
    /** The keepalive save has gone; it goes once. */
    let sentOnLeave = false;
    let panel: EndAttackPanel | null = null;
    let payload: AttackSavePayload | null = null;
    /** The save's state, for the panel now or once it opens. */
    let shown: SaveShown | null = null;
    /** The wait for the screen to catch up before the panel opens. */
    let waiting: number | null = null;
    let tornDown = false;

    const show = (next: SaveShown): void => {
      shown = next;
      if (panel) showOn(panel, next);
    };

    const warnIfDue = (): void => {
      if (warned || session.state().phase === "ended") return;
      const elapsed = (now() - mountedAt) / 1000;
      if (elapsed < SESSION_WINDOW_SECONDS - WINDOW_MARGIN_SECONDS) return;
      warned = true;
      const left = Math.max(0, Math.round(SESSION_WINDOW_SECONDS - elapsed));
      notices.show(
        "attack-window",
        `The server stops accepting this attack's result in about ${left} s. ` +
          "Retreat now to keep what you have done.",
        { level: "warning" },
      );
    };
    const timer = window.setInterval(warnIfDue, 1000);

    const attempt = async (): Promise<void> => {
      if (saved || inFlight || !payload) return;
      inFlight = true;
      show({ kind: "saving" });
      try {
        const response = await save(payload);
        saved = true;
        show({ kind: "saved", protectedUntil: protectedUntilOf(response), now: now() / 1000 });
      } catch (caught) {
        // Refused because its keepalive copy landed first is not a failure.
        if (!saved) show({ kind: "failed", failure: describeSaveFailure(caught) });
      } finally {
        inFlight = false;
      }
    };

    /** The save, as a request that outlives the page. Once. */
    const sendOnLeave = (): void => {
      if (saved || sentOnLeave || !payload) return;
      sentOnLeave = true;
      show({ kind: "saving" });
      saveOnLeave(payload, token).then(
        (response) => {
          saved = true;
          show({ kind: "saved", protectedUntil: protectedUntilOf(response), now: now() / 1000 });
        },
        (caught: unknown) => {
          // A duplicate of a save that already landed is refused; that is not a failure.
          if (!saved) show({ kind: "failed", failure: describeSaveFailure(caught) });
        },
      );
    };

    /**
     * The player is leaving the attack screen. A running attack with a drop
     * ends here and its save goes as the page goes. When the page itself is
     * going, a save already sent but not yet answered is sent again the same
     * way, because the browser cancels an ordinary request with its page; an
     * in-app exit leaves that request running.
     */
    const leave = (unloading: boolean): void => {
      const phase = session.state().phase;
      if (phase === "running" || phase === "loaded") {
        if (!session.hasActed()) return;
        leaving = true;
        session.leave();
        return;
      }
      if (phase === "ended" && unloading && !saved) sendOnLeave();
    };

    const onPageHide = (): void => leave(true);
    page.window.addEventListener("pagehide", onPageHide);

    const openPanel = (): void => {
      if (panel || tornDown) return;
      panel = new EndAttackPanel({
        summary: summariseAttack(session),
        onReturn: goToMap,
        onRetry: () => void attempt(),
        onLeave: goToMap,
      }).mount(modal);
      if (shown) showOn(panel, shown);
    };

    /** Opens the panel once nothing on screen is still playing out, or the wait runs out. */
    const openWhenSettled = (): void => {
      if (!presentation.playing()) {
        openPanel();
        return;
      }
      const since = now();
      waiting = window.setInterval(() => {
        if (presentation.playing() && now() - since < END_PANEL_MAX_WAIT_MS) return;
        if (waiting !== null) window.clearInterval(waiting);
        waiting = null;
        openPanel();
      }, END_PANEL_POLL_MS);
    };

    const onEnded = (): void => {
      if (ended) return;
      ended = true;
      notices.clear("attack-window");
      // An attack the player never touched is not saved (#79): no drop, no
      // bomb, no siege means nothing happened to either yard.
      if (!session.hasActed()) {
        show({ kind: "unsent" });
      } else {
        payload = buildAttackSave(session, { nameOf });
        if (leaving) sendOnLeave();
        else void attempt();
      }
      openWhenSettled();
    };

    const unsubscribe = session.subscribe((state) => {
      if (state.phase === "ended") onEnded();
    });
    if (session.state().phase === "ended") onEnded();

    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>)["__attackEnd"] = {
        session,
        payload: () => buildAttackSave(session, { nameOf }),
      };
    }

    return () => {
      // The scene is going (in-app navigation, a sign-out): that is leaving too.
      leave(false);
      tornDown = true;
      page.window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
      window.clearInterval(timer);
      if (waiting !== null) window.clearInterval(waiting);
      waiting = null;
      panel?.close();
      panel = null;
      if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__attackEnd"];
    };
  };
};

const plugin = createEndPlugin();
ATTACK_PLUGINS.push(plugin);
