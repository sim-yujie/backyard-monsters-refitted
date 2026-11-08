// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import fixture from "../../test/fixtures/admin-dashboard.json";
import { ErrorsView } from "./errors";

/**
 * The owner's errors page shows who hit each error (name, account number,
 * address) and marks errors from code that is not the game's (owner 3 Nov 2026).
 */
describe("the errors page", () => {
  const show = async (groups: unknown[]) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...fixture.errors, groups })),
    );
    const view = new ErrorsView(() => {});
    await view.refresh();
    return view.element;
  };

  beforeEach(() => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "t", userId: 2505 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("puts the grouped list first, with count, source and last seen, and folds the charts below", async () => {
    const page = await show(fixture.errors.groups);
    const list = page.querySelector(".rows")!;
    const charts = page.querySelector<HTMLDetailsElement>("details.error-charts")!;
    expect(charts.open).toBe(false);
    expect(list.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const first = list.querySelector(".error-row summary")!;
    expect(first.querySelector(".row-count")?.textContent).toMatch(/×$/);
    expect(first.querySelector(".row-meta")?.textContent).toMatch(/^(Browser|Server) · last seen /);
  });

  it("lists each sender's name, account number and address", async () => {
    const page = await show(fixture.errors.groups);
    const who = page.querySelector(".reporters")!;
    const lines = [...who.children].map((line) => line.textContent ?? "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Alice #3 · 203.0.113.7");
    expect(lines[1]).toContain("Signed out · 198.51.100.2");
    expect(page.textContent).not.toContain("Third-party");
  });

  it("marks an error from someone else's code as third-party, and still lists it", async () => {
    const [group] = fixture.errors.groups;
    const page = await show([
      {
        ...group,
        message: "TypeError: Cannot redefine property: ethereum",
        reporters: [],
        thirdParty: true,
      },
    ]);
    expect(page.querySelector(".row-title")?.textContent).toBe(
      "Third-party TypeError: Cannot redefine property: ethereum",
    );
    // No senders kept (an older error): the account numbers as before.
    expect(page.textContent).toContain("#3, #7, #8");
  });
});
