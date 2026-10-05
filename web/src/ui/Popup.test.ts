// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popup } from "./Popup";

/**
 * Escape closes a popup however focus got away from it (#191): a click on its
 * text, or a button that disabled itself, leaves focus on the page, where the
 * popup's own key handler never hears the key.
 */

const escape = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

let host: HTMLElement;

const open = (title: string, onClose = vi.fn()): { popup: Popup; onClose: typeof onClose } => {
  const popup = new Popup({ title, onClose });
  const body = document.createElement("p");
  body.textContent = "Some text.";
  popup.setContent(body);
  popup.mount(host);
  return { popup, onClose };
};

const titles = (): string[] =>
  [...host.querySelectorAll(".panel__title")].map((node) => node.textContent ?? "");

afterEach(() => {
  host.remove();
});

describe("Popup Escape", () => {
  it("closes from inside, as before", () => {
    host = document.body.appendChild(document.createElement("div"));
    const { popup, onClose } = open("One");
    escape(popup.element.querySelector("button")!);
    expect(onClose).toHaveBeenCalledOnce();
    expect(titles()).toEqual([]);
  });

  it("closes the newest popup when focus has fallen back to the page, and nothing behind it hears the key", () => {
    host = document.body.appendChild(document.createElement("div"));
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    open("First");
    const { onClose } = open("Second");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    escape(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    expect(titles()).toEqual(["First"]);
    expect(behind).not.toHaveBeenCalled();

    escape(document.body);
    expect(titles()).toEqual([]);
    // With every popup closed the page has its Escape back.
    escape(document.body);
    expect(behind).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", behind);
  });

  it("leaves Escape to whatever else holds focus", () => {
    host = document.body.appendChild(document.createElement("div"));
    const field = document.body.appendChild(document.createElement("input"));
    open("Open");
    field.focus();
    escape(field);
    expect(titles()).toEqual(["Open"]);
    field.remove();
  });

  it("leaves a popup that must be answered open: no Escape, no scrim, no close button (#226)", () => {
    host = document.body.appendChild(document.createElement("div"));
    const onClose = vi.fn();
    const popup = new Popup({ title: "Alert", onClose, dismissable: false });
    const answer = document.createElement("button");
    answer.textContent = "Answer";
    popup.setContent(answer);
    popup.mount(host);
    expect(popup.titlebar.querySelector("button")).toBeNull();
    escape(answer);
    escape(document.body);
    popup.backdrop.dispatchEvent(new Event("pointerdown"));
    expect(onClose).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Alert"]);
    popup.close();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
