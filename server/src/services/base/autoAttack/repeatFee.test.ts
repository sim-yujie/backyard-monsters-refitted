import { describe, expect, test } from "bun:test";
import { campMaxLoot } from "../../maproom/v2/campMaxLoot.js";
import { TRIBE_IDS, tribeLevels } from "../../maproom/v2/tribeLayouts.js";
import { withCampLootBonus } from "../campLootBonus.js";
import { REPEAT_FEE_BANDS, repeatFeeFor } from "./repeatFee.js";

describe("Repeat attack's putty fee (owner, 20 Nov 2026)", () => {
  test("the owner's table, by the camp's level", () => {
    const cases: [number, number][] = [
      [25, 2_500_000],
      [29, 2_500_000],
      [30, 3_000_000],
      [34, 3_000_000],
      [35, 4_000_000],
      [39, 4_000_000],
      [40, 4_500_000],
      [44, 4_500_000],
    ];
    for (const [level, putty] of cases) expect(repeatFeeFor(level), `level ${level}`).toBe(putty);
  });

  test("a level no band covers has no fee, so it is never repeated for free", () => {
    for (const level of [0, 24, 45, 50, Number.NaN]) expect(repeatFeeFor(level), `level ${level}`).toBeNull();
  });

  test("the bands cover every Map Room 2 camp level, 25 to 44, once each", () => {
    for (let level = 25; level <= 44; level++) {
      expect(REPEAT_FEE_BANDS.filter((band) => level >= band.from && level <= band.to)).toHaveLength(1);
    }
  });

  /*
   * "Players should not be able to profit on putty for repeat attacks."
   *
   * The most putty one full destroy of a fresh camp can bank: every storage
   * falls in the order that pays most, every putty harvester's buffer, then
   * the +15% Map Room 2 camp bonus, as `finaliseAttack.ts` lands it. The
   * thinnest margin is Abunakki 31: 2,994,501 against 3,000,000 (5,499).
   *
   * Accepted by the owner (20 Nov 2026), not covered here: Tribe Plunder
   * weekends (+30%), the alliance loot star (up to +15%) and the low-level
   * loot bonus (below player level 20, up to +57%) can lift some camps' putty
   * over the fee (Plunder alone: 14 of the 19, up to Abunakki 43's 5.24M
   * against 4.5M). Storage hits during the fight also add a little (a few
   * thousand at most at Abunakki 31's silos).
   */
  test("a Repeat attack never gains putty on a normal day: every camp's fee is over its most putty", () => {
    let keys = 0;
    for (const tribe of TRIBE_IDS) {
      for (const level of tribeLevels(tribe)) {
        const putty = withCampLootBonus(campMaxLoot(tribe, level), true).r3;
        const fee = repeatFeeFor(level);
        expect(fee, `${tribe} ${level}`).not.toBeNull();
        expect(putty, `${tribe} ${level}: ${putty} putty against a fee of ${fee}`).toBeLessThan(fee!);
        keys++;
      }
    }
    // Legionnaire 25-41, Kozu 30-42, Abunakki 27-43 and Dreadnaut 28-44, every 4th level.
    expect(keys).toBe(19);
  });
});
