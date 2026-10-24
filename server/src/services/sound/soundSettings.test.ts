import { describe, expect, test } from "bun:test";
import { brandNewYard, soundSettingsOf, withSoundSettings } from "./soundSettings.js";

const guide = (state: string) => ({ onboarding: { v: 1, guide: { state } } });

describe("soundSettingsOf", () => {
  test("both on for a yard that never chose, past the guided start", () => {
    expect(soundSettingsOf({ ...guide("done"), stats: {} })).toEqual({ music: true, effects: true });
    expect(soundSettingsOf({ ...guide("skipped"), stats: null })).toEqual({ music: true, effects: true });
  });

  test("a legacy save (no onboarding record) is not brand new", () => {
    expect(soundSettingsOf({ stats: { other: {} } })).toEqual({ music: true, effects: true });
    expect(brandNewYard({})).toBe(false);
  });

  test("music off, effects on, for a brand-new yard that never chose (Flash's TutorialStopMusic)", () => {
    expect(soundSettingsOf({ ...guide("pending"), stats: {} })).toEqual({ music: false, effects: true });
    expect(soundSettingsOf({ ...guide("active") })).toEqual({ music: false, effects: true });
  });

  test("the player's choice wins over the brand-new default", () => {
    expect(soundSettingsOf({ ...guide("active"), stats: { other: { mutemusic: 0 } } }).music).toBe(true);
    expect(soundSettingsOf({ ...guide("done"), stats: { other: { mutemusic: 1 } } }).music).toBe(false);
  });

  test("reads Flash's own keys, 1 for off, in the forms Flash wrote them", () => {
    expect(soundSettingsOf({ stats: { other: { mute: 1, mutemusic: "1" } } })).toEqual({
      music: false,
      effects: false,
    });
    expect(soundSettingsOf({ stats: { other: { mute: "0", mutemusic: 0 } } })).toEqual({
      music: true,
      effects: true,
    });
  });

  test("anything unreadable is treated as never chosen", () => {
    expect(soundSettingsOf({ ...guide("done"), stats: { other: { mute: "loud", mutemusic: 7 } } })).toEqual({
      music: true,
      effects: true,
    });
    expect(soundSettingsOf({ ...guide("pending"), stats: { other: [] as never } })).toEqual({
      music: false,
      effects: true,
    });
  });
});

describe("withSoundSettings", () => {
  test("writes 1 for off and 0 for on, and keeps every other stat", () => {
    const stats = { s: 3, other: { wmi_wave: 4, mute: 1 } } as never;
    expect(withSoundSettings(stats, { music: false })).toEqual({
      s: 3,
      other: { wmi_wave: 4, mute: 1, mutemusic: 1 },
    } as never);
    expect(withSoundSettings(stats, { effects: true, music: true })).toEqual({
      s: 3,
      other: { wmi_wave: 4, mute: 0, mutemusic: 0 },
    } as never);
  });

  test("leaves the stats it was given untouched and returns a new object", () => {
    const stats = { other: { mute: 1 } };
    const next = withSoundSettings(stats, { effects: true });
    expect(stats).toEqual({ other: { mute: 1 } });
    expect(next).not.toBe(stats);
    expect(next.other).not.toBe(stats.other);
  });

  test("starts from nothing on a save with no stats", () => {
    expect(withSoundSettings(null, { effects: false })).toEqual({ other: { mute: 1 } });
    expect(withSoundSettings(undefined, {})).toEqual({ other: {} });
  });

  test("a turned-on switch reads back as the player's choice on a brand-new yard", () => {
    const save = { ...guide("active"), stats: withSoundSettings({}, { music: true }) };
    expect(soundSettingsOf(save).music).toBe(true);
  });
});
