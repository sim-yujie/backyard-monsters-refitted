// @vitest-environment jsdom
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FriendHopButtons, HOP_ART_LARGE_SIDES, hopArt } from "./FriendHopButtons";

/** Prev and Next beside Map on a friend's yard (beta 8). */

const ann = { userid: 1, username: "Ann" };
const cat = { userid: 3, username: "Cat" };

const parts = (hop: FriendHopButtons) => ({
  prev: hop.element.querySelector<HTMLButtonElement>(".friend-hop__button--prev")!,
  next: hop.element.querySelector<HTMLButtonElement>(".friend-hop__button--next")!,
  badge: hop.element.querySelector<HTMLElement>(".friend-hop__badge")!,
});

describe("FriendHopButtons", () => {
  it("is hidden until the friends list is in", () => {
    const hop = new FriendHopButtons({ onHop: () => true });
    expect(hop.element.hidden).toBe(true);
    hop.setView({ prev: ann, next: cat, ahead: 2 });
    expect(hop.element.hidden).toBe(false);
  });

  it("names where each disc goes, with the count on Next", () => {
    const hop = new FriendHopButtons({ onHop: () => true });
    hop.setView({ prev: ann, next: cat, ahead: 2 });
    const { prev, next, badge } = parts(hop);
    expect(prev.textContent).toBe("Prev");
    expect(next.textContent).toContain("Next");
    expect(prev.title).toBe("Previous friend: Ann");
    expect(next.title).toBe("Next friend: Cat. 2 more friends can use your help");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("2");
    hop.setView({ prev: ann, next: cat, ahead: 0 });
    expect(badge.hidden).toBe(true);
  });

  it("greys out the end of the list, and both with one friend", () => {
    const hop = new FriendHopButtons({ onHop: () => true });
    hop.setView({ prev: null, next: cat, ahead: 1 });
    expect(parts(hop).prev.disabled).toBe(true);
    expect(parts(hop).next.disabled).toBe(false);
    hop.setView({ prev: ann, next: null, ahead: 0 });
    expect(parts(hop).prev.disabled).toBe(false);
    expect(parts(hop).next.disabled).toBe(true);
    expect(parts(hop).next.title).toBe("This is the last friend in your list");
    hop.setView({ prev: null, next: null, ahead: 0 });
    expect(parts(hop).prev.disabled).toBe(true);
    expect(parts(hop).next.disabled).toBe(true);
  });

  it("goes once per press, and waits while Help all runs", () => {
    const onHop = vi.fn(() => true);
    const hop = new FriendHopButtons({ onHop });
    hop.setView({ prev: ann, next: cat, ahead: 0 });
    hop.setBusy(true);
    expect(parts(hop).next.disabled).toBe(true);
    parts(hop).next.click();
    expect(onHop).not.toHaveBeenCalled();
    hop.setBusy(false);
    parts(hop).next.click();
    parts(hop).next.click();
    expect(onHop).toHaveBeenCalledTimes(1);
    expect(onHop).toHaveBeenCalledWith(1);
    expect(parts(hop).prev.disabled).toBe(true);
  });

  it("is pressable again when the hop did not go", () => {
    const onHop = vi.fn(() => false);
    const hop = new FriendHopButtons({ onHop });
    hop.setView({ prev: ann, next: cat, ahead: 0 });
    parts(hop).prev.click();
    expect(onHop).toHaveBeenCalledWith(-1);
    expect(parts(hop).prev.disabled).toBe(false);
  });

  it("shows the painted golden arrows, the Classic paint in the Classic look, sharp on a 3x phone", () => {
    expect(hopArt(-1, false)).toBe("friendprev");
    expect(hopArt(1, false)).toBe("friendnext");
    expect(hopArt(-1, true)).toBe("friendprevclassic");
    expect(hopArt(1, true)).toBe("friendnextclassic");
    const hop = new FriendHopButtons({ onHop: () => true });
    const art = hop.element.querySelector<HTMLImageElement>(".friend-hop__button--next .friend-hop__art")!;
    expect(art.getAttribute("src")).toMatch(/ui\/icons\/friendnext-32\.webp$/);
    expect(art.srcset).toMatch(/friendnext-64\.webp 64w, .*friendnext-96\.webp 96w, .*friendnext-128\.webp 128w$/);
    expect(art.sizes).toBe("40px");
    expect(art.getAttribute("aria-hidden")).toBe("true");
    expect(hop.element.querySelector("svg")).toBeNull();
    const icons = path.resolve(__dirname, "../../../public/ui/icons");
    for (const name of ["friendprev", "friendnext", "friendprevclassic", "friendnextclassic"]) {
      for (const side of HOP_ART_LARGE_SIDES) {
        const file = path.join(icons, `${name}-${side}.webp`);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size).toBeLessThan(12_000);
      }
    }
  });
});
