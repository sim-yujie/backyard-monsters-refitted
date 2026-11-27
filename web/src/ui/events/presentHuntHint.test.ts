// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EventView } from "@/api/events";
import { EventsPanel } from "./EventsPanel";
import { PRESENT_HUNT_HINT } from "./presentHuntHint";

const christmas: EventView = {
  id: "christmas-2026",
  title: "Christmas",
  text: "Merry Christmas!",
  kind: "christmas",
  banner: null,
  status: "active",
  startsAt: 0,
  endsAt: 28 * 86_400,
  calendar: null,
  ladder: null,
  claimUntil: null,
  locked: null,
  krallen: null,
};

describe("presentHuntHint", () => {
  it("puts the present line, as plain text, on the Christmas card", () => {
    const options = { onClaimCalendar: vi.fn(), onClaimTier: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
    const panel = new EventsPanel(options).mount(document.body);
    panel.render({ kind: "list", events: [christmas], now: 3_600, claiming: null, refusal: null });
    const hint = panel.element.querySelector('.events-card__extra[data-event="christmas-2026"] .events-hint');
    expect(hint?.textContent).toBe(PRESENT_HUNT_HINT);
    expect(hint?.querySelector("img")).toBeNull();
    panel.close();
  });
});
