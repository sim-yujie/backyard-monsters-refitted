// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ViewToolsFold } from "./ViewToolsFold";

describe("ViewToolsFold", () => {
  const setup = () => {
    const tools = document.createElement("div");
    tools.append(document.createElement("canvas"));
    const onToggle = vi.fn();
    const fold = new ViewToolsFold(tools, onToggle);
    return { tools, fold, onToggle };
  };

  it("puts its button first in the tools, closed", () => {
    const { tools, fold } = setup();
    expect(tools.firstElementChild).toBe(fold.button);
    expect(fold.open).toBe(false);
    expect(fold.button.getAttribute("aria-expanded")).toBe("false");
    expect(fold.button.getAttribute("aria-label")).toBe("Overview map and zoom");
  });

  it("opens and closes the map and zoom on a tap, and says so", () => {
    const { tools, fold, onToggle } = setup();
    fold.button.click();
    expect(tools.classList.contains("attack-viewtools--open")).toBe(true);
    expect(fold.button.getAttribute("aria-expanded")).toBe("true");
    expect(onToggle).toHaveBeenLastCalledWith(true);
    fold.button.click();
    expect(fold.open).toBe(false);
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });
});
