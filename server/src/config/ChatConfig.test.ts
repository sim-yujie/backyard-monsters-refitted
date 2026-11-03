import { afterEach, describe, expect, test } from "bun:test";
import { COUNTRY_CODES, isCountryCode } from "./Countries.js";
import { countryChannelFor, countryRooms } from "./ChatConfig.js";

/**
 * Country chat rooms (owner 3 Nov 2026): which countries have one comes from
 * `CHAT_COUNTRY_ROOMS`, Philippines only when it is not set.
 */

const saved = process.env.CHAT_COUNTRY_ROOMS;

afterEach(() => {
  if (saved === undefined) delete process.env.CHAT_COUNTRY_ROOMS;
  else process.env.CHAT_COUNTRY_ROOMS = saved;
});

describe("countryRooms", () => {
  test("unset means the Philippines only", () => {
    expect([...countryRooms({})]).toEqual(["PH"]);
  });

  test("reads a comma list, any case and spacing", () => {
    expect([...countryRooms({ CHAT_COUNTRY_ROOMS: "ph, id ,BR" })]).toEqual(["PH", "ID", "BR"]);
  });

  test("set but empty means no rooms", () => {
    expect(countryRooms({ CHAT_COUNTRY_ROOMS: "" }).size).toBe(0);
  });

  test("drops anything that is not a country code", () => {
    expect([...countryRooms({ CHAT_COUNTRY_ROOMS: "PH,XX,global,P" })]).toEqual(["PH"]);
  });
});

describe("countryChannelFor", () => {
  test("a country with a room gets its key", () => {
    delete process.env.CHAT_COUNTRY_ROOMS;
    expect(countryChannelFor("PH")).toBe("chat:country:PH");
  });

  test("a country without a room, or no country, gets none", () => {
    delete process.env.CHAT_COUNTRY_ROOMS;
    expect(countryChannelFor("SG")).toBeNull();
    expect(countryChannelFor(null)).toBeNull();
    expect(countryChannelFor(undefined)).toBeNull();
  });

  test("follows the setting: adding a country opens its room, removing it closes it", () => {
    process.env.CHAT_COUNTRY_ROOMS = "SG";
    expect(countryChannelFor("SG")).toBe("chat:country:SG");
    expect(countryChannelFor("PH")).toBeNull();
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
