// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { KOFI_URL, PATREON_URL } from "@/config";
import { openSupportPanel, SUPPORT_TEXT, supportLine } from "./SupportPanel";

/** "Support the game": the panel, the reminder's answers and the What's new line. */

afterEach(() => {
  document.body.replaceChildren();
});

const links = (root: ParentNode = document) => [...root.querySelectorAll<HTMLAnchorElement>("a.support__link")];
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent === text);

describe("openSupportPanel", () => {
  it("shows the heart, the one line on why and the Patreon and Ko-fi links in new tabs", () => {
    openSupportPanel({ container: document.body });
    expect(document.querySelector(".support-popup")).not.toBeNull();
    expect(document.querySelector(".support__heart")).not.toBeNull();
    expect(document.querySelector(".support__why")?.textContent).toBe(SUPPORT_TEXT.why);
    const [patreon, kofi] = links();
    expect(patreon?.href).toBe(PATREON_URL);
    expect(kofi?.href).toBe(KOFI_URL);
    for (const anchor of [patreon, kofi]) {
      expect(anchor?.target).toBe("_blank");
      expect(anchor?.rel).toContain("noopener");
    }
    expect(patreon?.textContent).toContain(SUPPORT_TEXT.patreonNote);
    expect(kofi?.textContent).toContain(SUPPORT_TEXT.kofiNote);
    // Opened by the player: no reminder answers.
    expect(button(SUPPORT_TEXT.later)).toBeUndefined();
    expect(button(SUPPORT_TEXT.never)).toBeUndefined();
  });

  it("keeps its words short and never mentions bots or GitHub", () => {
    const words = Object.values(SUPPORT_TEXT).join(" ").toLowerCase();
    expect(words).not.toContain("bot");
    expect(words).not.toContain("github");
    expect(SUPPORT_TEXT.why.length).toBeLessThanOrEqual(70);
  });

  it("as the reminder, Maybe later closes it as later", () => {
    const onLater = vi.fn();
    const onNever = vi.fn();
    openSupportPanel({ container: document.body, reminder: { onLater, onNever } });
    button(SUPPORT_TEXT.later)?.click();
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onNever).not.toHaveBeenCalled();
    expect(document.querySelector(".support-popup")).toBeNull();
  });

  it("as the reminder, Don't show again says never, not later", () => {
    const onLater = vi.fn();
    const onNever = vi.fn();
    openSupportPanel({ container: document.body, reminder: { onLater, onNever } });
    button(SUPPORT_TEXT.never)?.click();
    expect(onNever).toHaveBeenCalledTimes(1);
    expect(onLater).not.toHaveBeenCalled();
    expect(document.querySelector(".support-popup")).toBeNull();
  });

  it("as the reminder, closing it any other way counts as later", () => {
    const onLater = vi.fn();
    const popup = openSupportPanel({ container: document.body, reminder: { onLater, onNever: vi.fn() } });
    popup.close();
    expect(onLater).toHaveBeenCalledTimes(1);
  });
});

describe("supportLine", () => {
  it("is the small heart, one line and the same two links", () => {
    const line = supportLine();
    expect(line.querySelector(".game-icon--support")).not.toBeNull();
    expect(line.textContent).toContain(SUPPORT_TEXT.whatsNew);
    expect(links(line).map((anchor) => anchor.href)).toEqual([PATREON_URL, KOFI_URL]);
  });
});
