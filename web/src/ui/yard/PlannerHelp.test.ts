// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_HINT_KEY,
  forgetPlannerHint,
  hasSeenPlannerHint,
  markPlannerHintSeen,
  plannerHelpPanel,
} from "./PlannerHelp";

/**
 * The card the planner shows on its first opening, and the one flag that
 * decides whether it is the first.
 *
 * Most of what matters here is the failure path. `localStorage` is not a
 * function that always works: a private window, a blocked profile or a full
 * quota makes the *read* throw as well as the write, and the wrong answer to
 * that is an exception on the way into the planner. The right answer is "show
 * the card", because seeing it twice costs four seconds and never seeing it
 * costs the feature.
 */

/** A store that throws at every door, the way a blocked profile does. */
const hostile = (): Storage =>
  new Proxy({} as Storage, {
    get() {
      return () => {
        throw new Error("blocked");
      };
    },
  });

describe("the hint flag", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is unset until the card has been dismissed", () => {
    expect(hasSeenPlannerHint(window.localStorage)).toBe(false);
    markPlannerHintSeen(window.localStorage);
    expect(hasSeenPlannerHint(window.localStorage)).toBe(true);
  });

  it("survives a reload, because it is what stops the card coming back", () => {
    markPlannerHintSeen(window.localStorage);
    expect(window.localStorage.getItem(PLANNER_HINT_KEY)).toBe("1");
  });

  it("can be forgotten, which shows the card again", () => {
    markPlannerHintSeen(window.localStorage);
    forgetPlannerHint(window.localStorage);
    expect(hasSeenPlannerHint(window.localStorage)).toBe(false);
  });

  it("reads some other value as unseen rather than as seen", () => {
    window.localStorage.setItem(PLANNER_HINT_KEY, "maybe");
    expect(hasSeenPlannerHint(window.localStorage)).toBe(false);
  });

  it("says unseen, and does not throw, where there is no storage at all", () => {
    expect(hasSeenPlannerHint(null)).toBe(false);
    expect(() => markPlannerHintSeen(null)).not.toThrow();
    expect(() => forgetPlannerHint(null)).not.toThrow();
  });

  it("says unseen, and does not throw, where storage throws", () => {
    const storage = hostile();
    expect(hasSeenPlannerHint(storage)).toBe(false);
    expect(() => markPlannerHintSeen(storage)).not.toThrow();
    expect(() => forgetPlannerHint(storage)).not.toThrow();
  });
});

describe("the help card", () => {
  it("shows a picture and a line of text for each move", () => {
    const panel = plannerHelpPanel({ onClose: () => {} });
    const rows = panel.element.querySelectorAll(".planner-help__row");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(6);
    for (const row of rows) {
      expect(row.querySelector("svg.planner-demo")).not.toBeNull();
      expect(row.querySelector(".planner-help__text")?.textContent?.length ?? 0).toBeGreaterThan(
        10,
      );
    }
  });

  it("opens on the pictures and keeps the shortcut sheet a tab away", () => {
    const panel = plannerHelpPanel({ onClose: () => {} });
    const basics = panel.element.querySelector<HTMLElement>("#planner-help-basics");
    const shortcuts = panel.element.querySelector<HTMLElement>("#planner-help-shortcuts");
    expect(basics?.hidden).toBe(false);
    expect(shortcuts?.hidden).toBe(true);
    // Every key the planner binds is still reachable, which is what the `?`
    // button used to be the only door to.
    expect(shortcuts?.querySelectorAll("dt").length ?? 0).toBeGreaterThan(10);

    const tab = panel.element.querySelector<HTMLButtonElement>("#planner-help-tab-shortcuts");
    tab?.click();
    expect(basics?.hidden).toBe(true);
    expect(shortcuts?.hidden).toBe(false);
    expect(tab?.getAttribute("aria-selected")).toBe("true");
  });

  it("can be asked for the shortcuts first", () => {
    const panel = plannerHelpPanel({ tab: "shortcuts", onClose: () => {} });
    expect(panel.element.querySelector<HTMLElement>("#planner-help-shortcuts")?.hidden).toBe(
      false,
    );
  });

  it("says why it is there when it opened on its own", () => {
    const uninvited = plannerHelpPanel({ firstOpen: true, onClose: () => {} });
    const asked = plannerHelpPanel({ onClose: () => {} });
    expect(uninvited.element.querySelector(".planner-help__intro")?.textContent).not.toBe(
      asked.element.querySelector(".planner-help__intro")?.textContent,
    );
  });

  it("closes on Got it", () => {
    const onClose = vi.fn();
    const panel = plannerHelpPanel({ onClose });
    document.body.append(panel.element);
    panel.element.querySelector<HTMLButtonElement>(".planner-help__done")?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel.element.isConnected).toBe(false);
  });
});
