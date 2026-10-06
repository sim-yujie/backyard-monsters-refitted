// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrojanLetter } from "./TrojanLetter";

/** The Trojan Horse's letter popup (issue #327 WP4), as the DOM shows it. */

const buttonNamed = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((one) => one.textContent?.includes(label));
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("TrojanLetter", () => {
  it("shows the headline and the letter with the player's name, and has no close button", () => {
    const host = document.body;
    const letter = new TrojanLetter("Bob", { onAnswer: vi.fn() }).mount(host);
    const node = host.querySelector(".trojan-letter")!;
    expect(node.textContent).toContain("Wild Monsters left you a note pinned to a large wooden structure.");
    expect(node.textContent).toContain("Dear Bob,");
    expect(node.querySelector(".panel__close")).toBeNull();
    letter.close();
  });

  it("either button springs the trap, once", () => {
    const onAnswer = vi.fn();
    const node = new TrojanLetter("Bob", { onAnswer }).mount(document.body).popup.element;
    buttonNamed(node, "Send Back").click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("the other button is the same joke: it springs the trap too", () => {
    const onAnswer = vi.fn();
    const node = new TrojanLetter("Bob", { onAnswer }).mount(document.body).popup.element;
    buttonNamed(node, "Accept Truce").click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons once either is pressed, so a second click never asks twice", () => {
    const onAnswer = vi.fn();
    const node = new TrojanLetter("Bob", { onAnswer }).mount(document.body).popup.element;
    const sendBack = buttonNamed(node, "Send Back");
    const acceptTruce = buttonNamed(node, "Accept Truce");
    sendBack.click();
    sendBack.click();
    acceptTruce.click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(sendBack.disabled).toBe(true);
    expect(acceptTruce.disabled).toBe(true);
  });

  it("neither Escape nor the backdrop closes it", () => {
    const letter = new TrojanLetter("Bob", { onAnswer: vi.fn() }).mount(document.body);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.querySelector(".trojan-letter")).not.toBeNull();
    letter.close();
  });
});
