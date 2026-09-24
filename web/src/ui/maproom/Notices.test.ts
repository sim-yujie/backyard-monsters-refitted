// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Notices } from "./Notices";

/**
 * The dock itself: keyed replace-in-place, the timeout and the dismiss
 * button. `setTopInset` gets its own coverage because it is the fix for
 * issue #44 — the Yard Planner's top bar hiding the dock — and a CSS
 * property is easy to typo or leave stuck on once the planner closes.
 */

beforeEach(() => {
  document.body.replaceChildren();
});

describe("show and clear", () => {
  it("mounts under role=status so a screen reader announces it unprompted", () => {
    const notices = new Notices().mount(document.body);
    expect(notices.element.getAttribute("role")).toBe("status");
    expect(notices.element.getAttribute("aria-live")).toBe("polite");
  });

  it("replaces the notice under a repeated key instead of stacking it", () => {
    const notices = new Notices().mount(document.body);
    notices.show("k", "first");
    notices.show("k", "second");
    const rows = notices.element.querySelectorAll(".notice");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("second");
  });

  it("clear removes only the named notice", () => {
    const notices = new Notices().mount(document.body);
    notices.show("a", "one");
    notices.show("b", "two");
    notices.clear("a");
    expect(notices.element.querySelectorAll(".notice")).toHaveLength(1);
    expect(notices.element.textContent).toContain("two");
  });
});

describe("setTopInset (#44: dock hidden behind the planner's top bar)", () => {
  it("defaults to no inline offset, so the dock sits in its usual place", () => {
    const notices = new Notices().mount(document.body);
    expect(notices.element.style.getPropertyValue("--notice-top-inset")).toBe("");
  });

  it("pins the dock's top offset to the given pixel value while the planner is open", () => {
    const notices = new Notices().mount(document.body);
    notices.setTopInset(132);
    expect(notices.element.style.getPropertyValue("--notice-top-inset")).toBe("132px");
  });

  it("clears the override on close, restoring the default under the HUD", () => {
    const notices = new Notices().mount(document.body);
    notices.setTopInset(132);
    notices.setTopInset(null);
    expect(notices.element.style.getPropertyValue("--notice-top-inset")).toBe("");
  });
});
