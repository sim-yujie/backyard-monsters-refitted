/**
 * The countries a player can pick (country chat rooms, owner 3 Nov 2026):
 * every ISO 3166-1 alpha-2 code, as the server keeps them
 * (`server/src/config/Countries.ts`), named in the player's own language by
 * the browser and shown with their flag.
 */

export const COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
  "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
  "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const CODES = new Set(COUNTRY_CODES);

export const isCountryCode = (code: unknown): code is string => typeof code === "string" && CODES.has(code);

/** The flag emoji: two regional indicator letters. Some systems draw them as the two letters. */
export const countryFlag = (code: string): string =>
  isCountryCode(code)
    ? String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
    : "";

/**
 * The flag picture, for systems that draw the emoji as two letters (Windows):
 * the 4x3 flags of the MIT-licensed `flag-icons` set, kept in `public/flags`.
 */
export const countryFlagUrl = (code: string): string =>
  isCountryCode(code) ? `${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg` : "";

let names: Intl.DisplayNames | null | undefined;

/** "Philippines" for `PH`, in the browser's language; the code itself where the browser cannot name it. */
export const countryName = (code: string): string => {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(undefined, { type: "region" });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
};

export interface CountryOption {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
}

let sorted: readonly CountryOption[] | null = null;

/** Every country, A to Z by name. */
export const allCountries = (): readonly CountryOption[] => {
  sorted ??= COUNTRY_CODES.map((code) => ({ code, name: countryName(code), flag: countryFlag(code) })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  return sorted;
};

const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * The countries matching what the player typed: names starting with it first,
 * then names containing it; a two-letter code matches its country too.
 */
export const searchCountries = (query: string): readonly CountryOption[] => {
  const wanted = fold(query);
  if (!wanted) return allCountries();
  const starts: CountryOption[] = [];
  const contains: CountryOption[] = [];
  for (const option of allCountries()) {
    const name = fold(option.name);
    if (name.startsWith(wanted) || option.code.toLowerCase() === wanted) starts.push(option);
    else if (name.includes(wanted)) contains.push(option);
  }
  return [...starts, ...contains];
};

/** "🇵🇭 Philippines": what a country room's tab says. */
export const countryLabel = (code: string): string => `${countryFlag(code)} ${countryName(code)}`.trim();
