// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { scrollFade } from "./scrollFade";

/** A box whose sizes jsdom does not lay out, set by hand. */
const box = (scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement => {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  element.scrollTop = scrollTop;
  return element;
};

const fades = (element: HTMLElement) => ({
  above: element.classList.contains("scroll-fade--more-above"),
  below: element.classList.contains("scroll-fade--more-below"),
});

describe("scrollFade", () => {
  it("fades the bottom while more waits below, and neither edge when all fits", () => {
    const long = box(0, 200, 600);
    scrollFade(long);
    expect(long.classList.contains("scroll-fade")).toBe(true);
    expect(fades(long)).toEqual({ above: false, below: true });

    const short = box(0, 200, 200);
    scrollFade(short);
    expect(fades(short)).toEqual({ above: false, below: false });
  });

  it("follows the scroll, and stops when told", () => {
    const element = box(0, 200, 600);
    const stop = scrollFade(element);
    element.scrollTop = 200;
    element.dispatchEvent(new Event("scroll"));
    expect(fades(element)).toEqual({ above: true, below: true });
    element.scrollTop = 400;
    element.dispatchEvent(new Event("scroll"));
    expect(fades(element)).toEqual({ above: true, below: false });
    stop();
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
    expect(fades(element)).toEqual({ above: true, below: false });
  });
});
