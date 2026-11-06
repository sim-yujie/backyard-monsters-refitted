import { describe, expect, test } from "bun:test";
import { COUNTRY_CODES, isCountryCode } from "./Countries.js";
import { countryChannelFor } from "./ChatConfig.js";

/**
 * Country chat rooms (owner 3 Nov 2026): every country has one, so a player
 * who picks a country always gets its room.
 */

describe("countryChannelFor", () => {
  test("every country gets its own room", () => {
    expect(countryChannelFor("PH")).toBe("chat:country:PH");
    expect(countryChannelFor("SG")).toBe("chat:country:SG");
    for (const code of COUNTRY_CODES) expect(countryChannelFor(code)).toBe(`chat:country:${code}`);
  });

  test("no country, or something that is not a country code, gets none", () => {
    expect(countryChannelFor(null)).toBeNull();
    expect(countryChannelFor(undefined)).toBeNull();
    expect(countryChannelFor("")).toBeNull();
    expect(countryChannelFor("XX")).toBeNull();
    expect(countryChannelFor("sg")).toBeNull();
  });
});

describe("COUNTRY_CODES", () => {
  test("every ISO 3166-1 alpha-2 country, once each", () => {
    expect(COUNTRY_CODES.length).toBe(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });

  test("isCountryCode takes upper-case codes only", () => {
    expect(isCountryCode("PH")).toBe(true);
    expect(isCountryCode("ph")).toBe(false);
    expect(isCountryCode("XX")).toBe(false);
    expect(isCountryCode("")).toBe(false);
  });
});
