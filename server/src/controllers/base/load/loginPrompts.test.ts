import { describe, expect, test } from "bun:test";

import { loginPromptFields, type LoginPromptFacts } from "./loginPrompts.js";

const facts = (extra: Partial<LoginPromptFacts> = {}): LoginPromptFacts => ({
  ownMainYard: true,
  tutorialStage: 205,
  country: null,
  countryAsked: false,
  quiet: false,
  ...extra,
});

describe("the load's login prompt fields", () => {
  test("QUIET_LOGIN off: the country question as before, and no quietlogin", () => {
    expect(loginPromptFields(facts())).toEqual({ countryask: 1 });
    expect(loginPromptFields(facts({ country: "PH" }))).toEqual({});
    expect(loginPromptFields(facts({ countryAsked: true }))).toEqual({});
    expect(loginPromptFields(facts({ tutorialStage: 204 }))).toEqual({});
    expect(loginPromptFields(facts({ ownMainYard: false }))).toEqual({});
  });

  test("QUIET_LOGIN on: quietlogin, and the country question is never asked", () => {
    expect(loginPromptFields(facts({ quiet: true }))).toEqual({ quietlogin: 1 });
    expect(loginPromptFields(facts({ quiet: true, ownMainYard: false }))).toEqual({ quietlogin: 1 });
  });
});
