// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { el } from "@/ui/dom";
import { EVENT_EXTRAS } from "@/ui/events/EventsPanel";
import { yardCardExtra } from "./eventYards";

/** The Brukkarg yard card's part (kind `yards`): the wave part above the yards when the event has waves (Brukkarg War). */
describe("yardCardExtra", () => {
  it("is the yards alone for an event without waves on the feed (Creature Carnage)", () => {
    const part = yardCardExtra({ id: "carnage-1000" }, () => el("div", "wave-card-slot"));
    expect(part.className).toBe("yard-card-slot");
  });

  it("puts the wave part first, then the yards (Brukkarg War)", () => {
    const part = yardCardExtra({ id: "brukwar-1000" }, () => {
      const slot = el("div", "wave-card-slot");
      slot.append(el("div", "wave-card"));
      return slot;
    });
    expect(part.className).toBe("yard-card-parts");
    expect([...part.children].map((child) => child.className)).toEqual(["wave-card-slot", "yard-card-slot"]);
  });

  it("is the Events card part of kind yards", () => {
    expect(EVENT_EXTRAS.has("yards")).toBe(true);
  });
});
