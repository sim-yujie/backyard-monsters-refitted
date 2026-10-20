// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EventView } from "@/api/events";
import { EventsPanel } from "./EventsPanel";
import { PUMPKIN_HUNT_HINT, PUMPKIN_ICON } from "./pumpkinHuntHint";

const halloween: EventView = {
  id: "halloween-2026",
  title: "Halloween",
  text: "Spooky.",
  kind: "halloween",
  banner: null,
  status: "active",
  startsAt: 0,
  endsAt: 10 * 86_400,
  calendar: null,
  ladder: null,
};

describe("pumpkinHuntHint", () => {
  it("puts the pumpkin line on the Halloween card", () => {
    const options = { onClaimCalendar: vi.fn(), onClaimTier: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
    const panel = new EventsPanel(options).mount(document.body);
    panel.render({ kind: "list", events: [halloween], now: 3_600, claiming: null, refusal: null });
    const hint = panel.element.querySelector('.events-card__extra[data-event="halloween-2026"] .events-hint');
    expect(hint?.textContent).toBe(PUMPKIN_HUNT_HINT);
    expect(hint?.querySelector("img")?.getAttribute("src")).toBe(PUMPKIN_ICON);
    panel.close();
  });
});
