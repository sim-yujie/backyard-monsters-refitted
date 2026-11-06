import { describe, expect, test } from "bun:test";

import { makeWordFilter } from "../chat/badWords.js";
import { BIO_MAX, checkBio, PHOTO_CHANGE_MS, PHOTO_MIN_LEVEL, uploadGate } from "./profileRules.js";

const filter = makeWordFilter({});
const NOW = new Date("2026-11-10T12:00:00Z");

describe("bios", () => {
  test("a plain bio is kept, trimmed", () => {
    expect(checkBio("  Hi! I farm goo.  ", filter)).toEqual({ ok: true, bio: "Hi! I farm goo." });
  });

  test("an empty bio clears it", () => {
    expect(checkBio("", filter)).toEqual({ ok: true, bio: "" });
    expect(checkBio(undefined, filter)).toEqual({ ok: true, bio: "" });
    expect(checkBio("   \n  ", filter)).toEqual({ ok: true, bio: "" });
  });

  test("spaces are squeezed and at most 3 lines are kept", () => {
    expect(checkBio("a   b\n\n\nc\nd\ne", filter)).toEqual({ ok: true, bio: "a b\nc\nd e" });
    expect(checkBio("one\r\ntwo", filter)).toEqual({ ok: true, bio: "one\ntwo" });
  });

  test("control and zero-width characters go", () => {
    const odd = (code: number) => String.fromCharCode(code);
    expect(checkBio(`he${odd(0x200b)}llo${odd(7)} ${odd(0x202e)}world`, filter)).toEqual({ ok: true, bio: "hello world" });
  });

  test(`a bio over ${BIO_MAX} letters is refused`, () => {
    expect(checkBio("a".repeat(BIO_MAX), filter).ok).toBe(true);
    expect(checkBio("a".repeat(BIO_MAX + 1), filter)).toEqual({ ok: false, reason: "tooLong" });
  });

  test("a bio with a filtered word is refused, not starred out", () => {
    expect(checkBio("you are a fucking noob", filter)).toEqual({ ok: false, reason: "badWords" });
    expect(checkBio("putang ina mo", filter)).toEqual({ ok: false, reason: "badWords" });
    expect(checkBio("I love Kozu camps", filter).ok).toBe(true);
  });
});

describe("photo uploads", () => {
  const facts = { level: PHOTO_MIN_LEVEL, blocked: false, underReview: false, lastAt: null, now: NOW };

  test(`allowed from level ${PHOTO_MIN_LEVEL}`, () => {
    expect(uploadGate(facts)).toEqual({ ok: true });
    expect(uploadGate({ ...facts, level: PHOTO_MIN_LEVEL - 1 })).toEqual({ ok: false, reason: "lowLevel" });
  });

  test("once a day", () => {
    const lastAt = new Date(NOW.getTime() - PHOTO_CHANGE_MS + 60_000);
    expect(uploadGate({ ...facts, lastAt })).toEqual({
      ok: false,
      reason: "tooSoon",
      nextAt: new Date(lastAt.getTime() + PHOTO_CHANGE_MS),
    });
    expect(uploadGate({ ...facts, lastAt: new Date(NOW.getTime() - PHOTO_CHANGE_MS) })).toEqual({ ok: true });
  });

  test("never while blocked or while a hidden photo waits for review", () => {
    expect(uploadGate({ ...facts, blocked: true })).toEqual({ ok: false, reason: "blocked" });
    expect(uploadGate({ ...facts, blocked: true, level: 1 })).toEqual({ ok: false, reason: "blocked" });
    expect(uploadGate({ ...facts, underReview: true })).toEqual({ ok: false, reason: "underReview" });
  });
});
