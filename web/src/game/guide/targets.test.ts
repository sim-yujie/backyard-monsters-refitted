// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCanvasTargets, findTarget, registerCanvasTarget, tutTarget, TutTarget } from "./targets";

/** Bob's targets: `data-tut` controls and canvas resolvers (issue #227). */

/** A control with a size, since jsdom lays nothing out. */
const control = (name: string, rect = { left: 10, top: 20, width: 30, height: 40 }): HTMLElement => {
  const element = tutTarget(document.createElement("button"), name);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
  clearCanvasTargets();
  vi.restoreAllMocks();
});

describe("findTarget", () => {
  it("finds a tagged control on screen, with its rectangle", () => {
    const element = control(TutTarget.COLLECT_ALL);

    expect(findTarget(TutTarget.COLLECT_ALL)).toEqual({
      rect: { left: 10, top: 20, width: 30, height: 40 },
      element,
    });
  });

  it("skips a control that is hidden, detached or has no size, and takes the next shown one", () => {
    const hidden = control("build-card:21");
    hidden.hidden = true;
    const inHidden = control("build-card:21");
    const box = document.createElement("div");
    box.hidden = true;
    box.append(inHidden);
    document.body.append(box);
    control("build-card:21", { left: 0, top: 0, width: 0, height: 0 });
    const shown = control("build-card:21", { left: 5, top: 5, width: 50, height: 50 });

    expect(findTarget("build-card:21")?.element).toBe(shown);
    expect(findTarget("build-card:5")).toBeNull();
  });

  it("asks a canvas resolver, exact or by prefix with the parameter", () => {
    registerCanvasTarget(TutTarget.CARRY_GHOST, () => ({ left: 1, top: 2, width: 3, height: 4 }));
    const byId = vi.fn((param: string | undefined) =>
      param === "7" ? { left: 7, top: 7, width: 7, height: 7 } : null,
    );
    registerCanvasTarget(TutTarget.BUILDING, byId);

    expect(findTarget("carry-ghost")).toEqual({ rect: { left: 1, top: 2, width: 3, height: 4 }, element: null });
    expect(findTarget("building:7")?.rect.left).toBe(7);
    expect(findTarget("building:8")).toBeNull();
    expect(byId).toHaveBeenCalledWith("8");
  });

  it("a DOM control wins over a canvas target of the same name", () => {
    registerCanvasTarget("practice-box", () => ({ left: 1, top: 1, width: 1, height: 1 }));
    const element = control("practice-box");
    expect(findTarget("practice-box")?.element).toBe(element);
  });

  it("unregistering removes only the registration it made", () => {
    const first = registerCanvasTarget("carry-ghost", () => ({ left: 1, top: 1, width: 1, height: 1 }));
    const second = registerCanvasTarget("carry-ghost", () => ({ left: 2, top: 2, width: 2, height: 2 }));
    first();
    expect(findTarget("carry-ghost")?.rect.left).toBe(2);
    second();
    expect(findTarget("carry-ghost")).toBeNull();
  });
});
