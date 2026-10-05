// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GameNotification } from "@/api/notifications";
import type { CompletedJob } from "@/api/types";
import { lineText, NotificationPanel } from "./NotificationPanel";

/** The bell's `achievement` lines (#204, WP6): worded, not read as jobs. */

const NOW = 1_800_000_000;

const unlockJob = (id: number, name: string, shiny: number, backfill = false): CompletedJob =>
  ({
    kind: "achievement",
    id,
    t: null,
    at: NOW - 60,
    detail: { name, shiny, ...(backfill && { backfill: true }) },
  }) as CompletedJob;

const achievement = (id: number, jobs: CompletedJob[]): GameNotification => ({
  id,
  kind: "achievement",
  baseid: null,
  at: NOW - 60,
  read: false,
  jobs,
});

describe("NotificationPanel achievement lines", () => {
  it("words one unlock and the backfill's summary", () => {
    expect(lineText(achievement(1, [unlockJob(2, "Town Planner", 10)]))).toBe(
      "Achievement earned: Town Planner, +10 Shiny",
    );
    expect(
      lineText(achievement(2, [unlockJob(1, "A", 5, true), unlockJob(2, "B", 5, true), unlockJob(3, "C", 10, true)])),
    ).toBe("3 achievements earned for what you had already done: A, B and C, +20 Shiny");
  });

  it("shows the line as plain text, with the same words as its tooltip", () => {
    const panel = new NotificationPanel({ onRead: vi.fn(), onReadAll: vi.fn(), selectFor: () => vi.fn(), now: () => NOW });
    panel.mount(document.body);
    panel.show([achievement(9, [unlockJob(2, "Town Planner", 10)])]);
    const row = document.querySelector<HTMLElement>(".notif-row")!;
    expect(row.querySelector(".notif-row__text")!.textContent).toBe("Achievement earned: Town Planner, +10 Shiny");
    expect(row.title).toBe("Achievement earned: Town Planner, +10 Shiny");
    expect(row.querySelector("button")).toBeNull();
    panel.destroy();
  });
});
