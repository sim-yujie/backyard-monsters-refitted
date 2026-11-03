import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  allCountries,
  countryFlag,
  countryFlagUrl,
  countryLabel,
  countryName,
  isCountryCode,
  searchCountries,
} from "./countries";

/** The country list behind the picker (country chat rooms, owner 3 Nov 2026). */

describe("the country list", () => {
  it("has every ISO 3166-1 alpha-2 country once, as the server does", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(isCountryCode("PH")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });

  it("names and flags a country", () => {
    expect(countryName("PH")).toBe("Philippines");
    expect(countryFlag("PH")).toBe("\u{1F1F5}\u{1F1ED}");
    expect(countryFlag("nope")).toBe("");
    expect(countryLabel("PH")).toBe("\u{1F1F5}\u{1F1ED} Philippines");
    expect(countryFlagUrl("PH")).toBe("/flags/ph.svg");
    expect(countryFlagUrl("nope")).toBe("");
  });

  it("is sorted by name", () => {
    const names = allCountries().map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("searchCountries", () => {
  it("puts names starting with the words first, then names containing them", () => {
    const found = searchCountries("phil").map((country) => country.code);
    expect(found[0]).toBe("PH");
  });

  it("finds a country by its two-letter code and ignores case and accents", () => {
    expect(searchCountries("ph")[0]!.code).toBe("PH");
    expect(searchCountries("cote").some((country) => country.code === "CI")).toBe(true);
  });

  it("gives the whole list for empty words, and nothing for nonsense", () => {
    expect(searchCountries("  ")).toHaveLength(249);
    expect(searchCountries("zzzz")).toEqual([]);
  });
});
