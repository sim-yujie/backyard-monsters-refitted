// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "./UpdatePrompt";

/** The small "New version" card. */

afterEach(() => {
  document.body.replaceChildren();
});

describe("UpdatePrompt", () => {
  it("shows the painted icon, two words and Reload", () => {
    const host = document.createElement("div");
    const prompt = new UpdatePrompt(host, vi.fn());
    expect(prompt.shown).toBe(false);
    prompt.show();
    prompt.show();
    expect(host.querySelectorAll(".update-prompt")).toHaveLength(1);
    expect(
      host.querySelector<HTMLImageElement>("img.update-prompt__icon")?.dataset["icon"],
    ).toBe("levelup");
    expect(host.querySelector(".update-prompt__title")?.textContent).toBe("New version");
    expect(host.querySelector(".update-prompt__reload")?.textContent).toBe("Reload");
    expect(host.querySelector(".update-prompt")?.getAttribute("aria-label")).toBe(
      "A new version of the game is ready",
    );
  });

  it("reloads the page when Reload is pressed", () => {
    const host = document.createElement("div");
    const reload = vi.fn();
    new UpdatePrompt(host, reload).show();
    host.querySelector<HTMLButtonElement>(".update-prompt__reload")!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the × hides it without reloading", () => {
    const host = document.createElement("div");
    const reload = vi.fn();
    const prompt = new UpdatePrompt(host, reload);
    prompt.show();
    host.querySelector<HTMLButtonElement>(".update-prompt__close")!.click();
    expect(prompt.shown).toBe(false);
    expect(host.querySelector(".update-prompt")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
