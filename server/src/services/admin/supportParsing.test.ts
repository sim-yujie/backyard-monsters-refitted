import { describe, expect, test } from "bun:test";

import { Save } from "../../database/models/save.model.js";
import { creditsAsDelta } from "../base/creditsDelta.js";
import { awardMail, MAX_SHINY_AWARD, parseShinyAward } from "./shinyAwards.js";
import { MAX_TEAM_TEXT, parseTeamText } from "./supportMail.js";

/** What the dashboard's reply and Shiny routes accept, and the player's mail about an award. */

const body = (overrides: Record<string, unknown> = {}) => ({
  userid: 2505,
  amount: 250,
  reason: "  Thanks for the report  ",
  requestId: "0b6f1c2e-5d1a-4c4e-9a51-2f4c4b1d9e10",
  ...overrides,
});

describe("a Shiny award's body", () => {
  test("takes a whole amount, a reason (trimmed) and the press's id; no report by default", () => {
    expect(parseShinyAward(body())).toEqual({
      ok: true,
      value: { userid: 2505, amount: 250, reason: "Thanks for the report", bugReportId: null, requestId: body().requestId },
    });
    expect(parseShinyAward(body({ bugReportId: 41 }))).toMatchObject({ ok: true, value: { bugReportId: 41 } });
  });

  test.each([
    ["no player", { userid: undefined }],
    ["a player as text", { userid: "2505" }],
    ["nothing", { amount: 0 }],
    ["less than nothing", { amount: -5 }],
    ["a part of one", { amount: 2.5 }],
    ["an amount as text", { amount: "250" }],
    ["more than the most", { amount: MAX_SHINY_AWARD + 1 }],
    ["no reason", { reason: "   " }],
    ["a reason too long", { reason: "x".repeat(201) }],
    ["a report number that is not one", { bugReportId: "41" }],
    ["no press id", { requestId: undefined }],
    ["a press id with odd characters", { requestId: "abc def ghi" }],
  ])("refuses %s", (_name, overrides) => {
    expect(parseShinyAward(body(overrides)).ok).toBe(false);
  });

  test("takes the most there is", () => {
    expect(parseShinyAward(body({ amount: MAX_SHINY_AWARD })).ok).toBe(true);
  });

  test("the player's mail says how much and why", () => {
    expect(awardMail(1500, "Lost a fight to a bug")).toEqual({
      subject: "A gift of 1,500 Shiny",
      text: "We have added 1,500 Shiny to your account.\nWhy: Lost a fight to a bug\nThank you for playing!",
    });
  });
});

describe("a reply's text", () => {
  test("trimmed, and at most the mail's own limit", () => {
    expect(parseTeamText("  Thanks, fixed now. ")).toEqual({ ok: true, text: "Thanks, fixed now." });
    expect(parseTeamText("x".repeat(MAX_TEAM_TEXT)).ok).toBe(true);
    expect(parseTeamText("x".repeat(MAX_TEAM_TEXT + 1)).ok).toBe(false);
    expect(parseTeamText("   ").ok).toBe(false);
    expect(parseTeamText(42).ok).toBe(false);
  });
});

describe("credits as an addition", () => {
  test("a save that is not a managed row is left as it is", () => {
    const save = Object.assign(new Save(), { credits: 90 });
    creditsAsDelta(save);
    expect(save.credits).toBe(90);
  });
});
