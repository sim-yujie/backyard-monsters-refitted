import { postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The player's country (country chat rooms, owner 3 Nov 2026). It rides on
 * `POST /player/settings` like the privacy switches: `{ country }` stores it
 * (null clears it), `{ countryAsked: true }` puts the one-time prompt off for
 * good. The answer names the chat room the country opens, if any, so the chat
 * box can switch rooms at once.
 */
const SETTINGS_PATH = "/api/:apiVersion/player/settings";

export interface CountrySettings {
  /** ISO 3166-1 alpha-2, or null when not set. */
  readonly country: string | null;
  /** The one-time prompt was answered or put off. */
  readonly countryAsked: boolean;
  /** The country's chat room key, when the country has one. */
  readonly countryChannel: string | null;
}

interface SettingsAnswer extends ApiEnvelope {
  settings?: { country?: unknown; countryAsked?: unknown; countryChannel?: unknown };
}

/** Reads the country part of a settings block. */
export const countryOf = (settings: SettingsAnswer["settings"]): CountrySettings => ({
  country: typeof settings?.country === "string" && settings.country ? settings.country : null,
  countryAsked: settings?.countryAsked === true,
  countryChannel:
    typeof settings?.countryChannel === "string" && settings.countryChannel ? settings.countryChannel : null,
});

/** Stores the player's country (null: "Not set"); resolves with what the server stored. */
export const setCountry = async (country: string | null): Promise<CountrySettings> => {
  const response = await postJson<SettingsAnswer>(SETTINGS_PATH, { country });
  return countryOf(response.settings);
};

/** "Not now" on the one-time prompt: it is not shown again. */
export const putOffCountryPrompt = async (): Promise<CountrySettings> => {
  const response = await postJson<SettingsAnswer>(SETTINGS_PATH, { countryAsked: true });
  return countryOf(response.settings);
};
