import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { ClientErrorsSchema } from "../../schemas/ClientErrorSchemas.js";
import { acceptClientErrors } from "./clientErrors.js";
import { isThirdPartyError } from "./errorText.js";

/**
 * The web client's graphics entries (`web/src/game/graphicsLog.ts`, old
 * phones, 17 Nov 2026) arrive as ordinary browser errors: one line of text,
 * no place and no stack. They must be kept whole (no part taken for an
 * address), and be told apart by picture and graphics card while devices
 * that differ only in numbers count as one row.
 */

const rows = () => {
  const inserts: unknown[][] = [];
  const em = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO bym.app_error AS e")) {
        inserts.push(params);
        return [{ id: inserts.length }];
      }
      return [];
    },
  } as unknown as EntityManager;
  return { em, inserts };
};

const entry = (message: string) => ({ kind: "error", message, place: "", stack: "", count: 1 });

const OLD_PHONE =
  "Graphics: picture did not load: monsters/krallen_1_rev_65-repaint.png (@2x) (InvalidStateError: The source image could not be decoded.) " +
  "| gpu Mali-G52 MC2 | max texture 4096 | memory 2 GB | quality medium (default) | dpr 2.75 | screen 393x873 | Android 11 SM-A125F, Chrome 120";
/** The same picture on another phone with the same card family: only numbers differ. */
const OTHER_PHONE =
  "Graphics: picture did not load: monsters/krallen_2_rev_65-repaint.png (@2x) (InvalidStateError: The source image could not be decoded.) " +
  "| gpu Mali-G57 MC2 | max texture 8192 | memory 4 GB | quality medium (default) | dpr 3 | screen 412x915 | Android 13 SM-A125F, Chrome 131";
const IPHONE =
  "Graphics: WebGL context lost: game canvas (after 412 s on the page) | gpu Apple GPU | max texture 4096 | memory unknown " +
  "| quality medium (default) | dpr 3 | screen 375x667 | iPhone iOS 15.8, Safari 15";

describe("graphics entries in the browser error rows", () => {
  test("are kept word for word, and devices differing only in numbers share a row", async () => {
    const { em, inserts } = rows();
    const body = ClientErrorsSchema.parse({
      errors: [entry(OLD_PHONE), entry(OTHER_PHONE), entry(IPHONE)],
      gameVersion: "2.0.0-beta.7.7.4",
      screen: "AttackScene",
    });
    const kept = await acceptClientErrors(em, body, { userid: 2503, username: "yardtester", ip: "203.0.113.7" });

    expect(kept).toBe(2);
    expect(inserts).toHaveLength(2);
    // [source, fingerprint, message, place, stack, count, ...]
    const [phones, iphone] = inserts;
    expect(phones?.[2]).toBe(OLD_PHONE);
    expect(phones?.[5]).toBe(2);
    expect(iphone?.[2]).toBe(IPHONE);
    expect(iphone?.[5]).toBe(1);
    expect(phones?.[1]).not.toBe(iphone?.[1]);
    // No place or stack: shown as the game's own error, not a third party's.
    expect(isThirdPartyError(String(phones?.[3]), String(phones?.[4]))).toBe(false);
  });

  test("another graphics card is a row of its own", async () => {
    const { em, inserts } = rows();
    const body = ClientErrorsSchema.parse({
      errors: [entry(OLD_PHONE), entry(OLD_PHONE.replace("Mali-G52 MC2", "Adreno (TM) 506"))],
    });
    expect(await acceptClientErrors(em, body, { userid: null, username: "", ip: "203.0.113.7" })).toBe(2);
    expect(inserts.map((params) => params[1])).toHaveLength(2);
    expect(new Set(inserts.map((params) => params[1])).size).toBe(2);
  });
});
