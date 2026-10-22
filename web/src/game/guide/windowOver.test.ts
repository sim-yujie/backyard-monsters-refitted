// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Popup } from "@/ui/Popup";
import { windowOver } from "./windowOver";

/** The yard's overlay layer with its Collect all button, as the tips see it. */
const scene = (): { root: HTMLElement; collect: HTMLElement } => {
  const root = document.createElement("div");
  const collect = document.createElement("button");
  root.append(collect);
  document.body.append(root);
  return { root, collect };
};

const panel = (root: HTMLElement): HTMLElement => {
  const element = document.createElement("section");
  element.className = "panel";
  root.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("windowOver", () => {
  it("is false over the bare yard", () => {
    const { root, collect } = scene();
    expect(windowOver({ root, target: collect })).toBe(false);
  });

  it("is true while a popup is up (the Leaderboard), false again once it closes", () => {
    const { root, collect } = scene();
    const modal = document.createElement("div");
    document.body.append(modal);
    const popup = new Popup({ title: "Leaderboard" }).mount(modal);
    expect(windowOver({ root, target: collect })).toBe(true);
    expect(windowOver({ root, target: null })).toBe(true);
    popup.close();
    expect(windowOver({ root, target: collect })).toBe(false);
  });

  it("lets a tip point into the popup it is about (the Starter Kits)", () => {
    const { root } = scene();
    const modal = document.createElement("div");
    document.body.append(modal);
    const popup = new Popup({ title: "Starter Kits" });
    const cards = document.createElement("ul");
    popup.setContent(cards);
    popup.mount(modal);
    expect(windowOver({ root, target: cards })).toBe(false);
    popup.close();
  });

  it("is true while a panel is open on the screen (the Shop), unless the tip points into it", () => {
    const { root, collect } = scene();
    const shop = panel(root);
    const inside = document.createElement("button");
    shop.append(inside);
    expect(windowOver({ root, target: collect })).toBe(true);
    expect(windowOver({ root, target: inside })).toBe(false);
    shop.hidden = true;
    expect(windowOver({ root, target: collect })).toBe(false);
  });

  it("leaves a screen that is itself a panel alone", () => {
    const { root } = scene();
    const shop = panel(root);
    const protection = document.createElement("button");
    shop.append(protection);
    expect(windowOver({ root: shop, target: protection })).toBe(false);
  });
});
